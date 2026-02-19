import { hash } from "bcryptjs";
import {
  CaseStatus,
  DocumentState,
  Prisma,
  SessionStatus,
  UserRole,
  WorkflowStepCode,
} from "@prisma/client";
import { getOperationalSettings, normalizeIntakeSourceType } from "@/lib/admin-settings";
import { db } from "@/lib/db";
import { createSchedulingProvider } from "@/lib/scheduling";
import { getSchedulingAssignmentMode, isAutoAllocationEnabled } from "@/lib/scheduling/config";
import type { SchedulingCaseData, SchedulingEventType } from "@/lib/scheduling/types";
import { CASE_TRANSITIONS, DOCUMENT_CODES } from "@/lib/workflow";

export class DomainError extends Error {
  statusCode: number;
  auditAction?: string;
  auditDetails?: AuditDetails;

  constructor(
    message: string,
    statusCode = 400,
    options?: {
      auditAction?: string;
      auditDetails?: AuditDetails;
    },
  ) {
    super(message);
    this.name = "DomainError";
    this.statusCode = statusCode;
    this.auditAction = options?.auditAction;
    this.auditDetails = options?.auditDetails;
  }
}

type Tx = Prisma.TransactionClient;
type AuditDetails = Prisma.InputJsonValue | undefined;

type SpecialistSchedulingConfig = {
  id: string;
  name: string;
  supportsCouples: boolean;
};

type CaseWithParticipantContacts = Prisma.CaseGetPayload<{
  include: {
    participants: {
      include: {
        client: true;
      };
    };
    availabilityWindows: true;
  };
}>;

type WorkflowSummary = {
  id: string;
  code: string;
  name: string;
};

export type IntakeParticipantInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
};

export type IntakeSubmissionInput = {
  primary: IntakeParticipantInput;
  secondary?: IntakeParticipantInput;
  notes?: string;
  counsellingType?: string;
  workflowCode?: string;
  intakeSource?: string;
  intakeExternalId?: string;
  initialStatus?: CaseStatus;
  requestedDurationMinutes?: number;
  autoAllocate?: boolean;
  intakeFormData?: Record<string, unknown>;
  consentSignature?: string;
  consentSignatureType?: string;
  consentSignedAt?: Date;
  consentIpAddress?: string;
  riskFlags?: string[];
};

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION];
const AVAILABILITY_SUBMISSION_FORM_TYPE = "AVAILABILITY_SUBMISSION";
const AVAILABILITY_CAPTURED_STEP_CODE: WorkflowStepCode = WorkflowStepCode.AVAILABILITY_CAPTURED;
const TERMS_SUBMISSION_ALLOWED_STATUSES: CaseStatus[] = [
  CaseStatus.SCHEDULED,
  CaseStatus.IN_SESSION,
  CaseStatus.COMPLETED,
  CaseStatus.CLOSED,
];

type AvailabilityRange = {
  startTime: Date;
  endTime: Date;
};

type AvailabilityWindowInput = {
  startTime: Date | string;
  endTime: Date | string;
};

type CaseAvailabilityComputation = {
  windows: AvailabilityRange[];
  participantsSubmitted: number;
  requiredParticipants: number;
  participantIdentifiersSubmitted: string[];
  hasOverlap: boolean;
  reason: string | null;
};

async function createAuditLog(
  tx: Tx,
  input: {
    caseId?: string;
    userId?: string;
    action: string;
    details?: AuditDetails;
  },
) {
  await tx.auditLog.create({
    data: {
      caseId: input.caseId,
      userId: input.userId,
      action: input.action,
      details: input.details,
    },
  });
}

async function nextCaseReference(tx: Tx) {
  const count = await tx.case.count();
  const baseNumber = 1000 + count + 1;

  for (let i = 0; i < 100; i += 1) {
    const number = baseNumber + i;
    const reference = `CASE-${String(number)}`;
    const existing = await tx.case.findUnique({
      where: { reference },
      select: { id: true },
    });

    if (!existing) {
      return reference;
    }
  }

  return `CASE-${Date.now()}`;
}

function normalizeCounsellingType(input: string | undefined, participantCount: number) {
  const normalized = input?.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  return participantCount === 2 ? "couples" : "individual";
}

async function resolveWorkflowForCase(
  tx: Tx,
  input: {
    workflowCode?: string;
    counsellingType?: string;
    participantCount: number;
  },
) {
  const explicitCode = input.workflowCode?.trim().toUpperCase();
  if (explicitCode) {
    const workflow = await tx.caseWorkflowTemplate.findFirst({
      where: {
        code: explicitCode,
        active: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!workflow) {
      throw new DomainError(`Workflow '${explicitCode}' was not found or is not active.`, 409);
    }

    return workflow as WorkflowSummary;
  }

  const counsellingType = normalizeCounsellingType(
    input.counsellingType,
    input.participantCount,
  );
  if (counsellingType.includes("couple")) {
    const couples = await tx.caseWorkflowTemplate.findFirst({
      where: {
        counsellingType: "couples",
        active: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (couples) {
      return couples as WorkflowSummary;
    }
  }

  const typeMatched = await tx.caseWorkflowTemplate.findFirst({
    where: {
      counsellingType,
      active: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (typeMatched) {
    return typeMatched as WorkflowSummary;
  }

  const defaultWorkflow = await tx.caseWorkflowTemplate.findFirst({
    where: {
      active: true,
      isDefault: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (defaultWorkflow) {
    return defaultWorkflow as WorkflowSummary;
  }

  const fallbackActive = await tx.caseWorkflowTemplate.findFirst({
    where: {
      active: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!fallbackActive) {
    throw new DomainError(
      "No active counselling workflow is configured. Configure one before creating cases.",
      409,
    );
  }

  return fallbackActive as WorkflowSummary;
}

function workflowStepCodeForFormType(formType: string): WorkflowStepCode | null {
  const normalized = normalizeFormType(formType);

  switch (normalized) {
    case "INTAKE_FORM":
      return WorkflowStepCode.INTAKE_FORM;
    case "TERMS_AND_CONDITIONS":
      return WorkflowStepCode.TERMS_AND_CONDITIONS;
    case "CONSENT_FORM":
      return WorkflowStepCode.CONSENT_FORM;
    case "AGREEMENT_FORM":
      return WorkflowStepCode.AGREEMENT_FORM;
    case "OUTTAKE_FORM":
      return WorkflowStepCode.OUTTAKE_FORM;
    default:
      return null;
  }
}

function stepRequiresAllParticipants(step: {
  requiresAllParticipants?: boolean | null;
  name: string;
}) {
  return Boolean(step.requiresAllParticipants) || step.name.toLowerCase().includes("both participants");
}

function normalizeParticipantIdentifier(identifier: string) {
  return identifier.trim().toLowerCase();
}

function normalizePhoneForMatch(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d+]/g, "");
  return normalized.length > 0 ? normalized : null;
}

type IntakeTimePreference = "MORNING" | "AFTERNOON" | "EVENING";
export type ManualAssignmentTimeBlock = IntakeTimePreference;
export type SpecialistAvailabilityType = "AVAILABLE" | "OUT_OF_OFFICE";
type SpecialistWorkingHours = {
  startHour: number;
  endHour: number;
};
type ManualAssignmentBlockWindows = Record<
  ManualAssignmentTimeBlock,
  {
    startHour: number;
    endHour: number;
  }
>;

const INTAKE_TIME_PREFERENCES: IntakeTimePreference[] = ["MORNING", "AFTERNOON", "EVENING"];
const DEFAULT_SPECIALIST_STANDARD_START_HOUR = 9;
const DEFAULT_SPECIALIST_STANDARD_END_HOUR = 18;
const MANUAL_ASSIGNMENT_SLOT_MINUTES = 60;
const FALLBACK_SPECIALIST_AVAILABILITY_GRID_DAYS = 14;
const FALLBACK_SPECIALIST_AVAILABILITY_MAX_GRID_DAYS = 62;
const DEFAULT_MANUAL_ASSIGNMENT_BLOCK_WINDOWS = resolveManualAssignmentBlockWindows({
  startHour: DEFAULT_SPECIALIST_STANDARD_START_HOUR,
  endHour: DEFAULT_SPECIALIST_STANDARD_END_HOUR,
});

function clampWorkingHour(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.round(value);
}

function normalizeSpecialistWorkingHours(
  startHour?: number | null,
  endHour?: number | null,
): SpecialistWorkingHours {
  const normalizedStart = clampWorkingHour(
    Number(startHour),
    0,
    22,
  );
  const normalizedEnd = clampWorkingHour(
    Number(endHour),
    1,
    23,
  );
  if (normalizedEnd <= normalizedStart) {
    return {
      startHour: DEFAULT_SPECIALIST_STANDARD_START_HOUR,
      endHour: DEFAULT_SPECIALIST_STANDARD_END_HOUR,
    };
  }
  return {
    startHour: normalizedStart,
    endHour: normalizedEnd,
  };
}

function resolveManualAssignmentBlockWindows(
  workingHours: SpecialistWorkingHours,
): ManualAssignmentBlockWindows {
  const morningEnd = Math.min(12, workingHours.endHour);
  const afternoonStart = Math.max(12, workingHours.startHour);
  const afternoonEnd = Math.min(17, workingHours.endHour);
  const eveningStart = Math.max(17, workingHours.startHour);

  return {
    MORNING: {
      startHour: workingHours.startHour,
      endHour: Math.max(workingHours.startHour, morningEnd),
    },
    AFTERNOON: {
      startHour: afternoonStart,
      endHour: Math.max(afternoonStart, afternoonEnd),
    },
    EVENING: {
      startHour: eveningStart,
      endHour: Math.max(eveningStart, workingHours.endHour),
    },
  };
}

function getManualAssignmentBlockWindow(
  block: ManualAssignmentTimeBlock,
  windows: ManualAssignmentBlockWindows = DEFAULT_MANUAL_ASSIGNMENT_BLOCK_WINDOWS,
) {
  return windows[block];
}

function normalizeIntakeTimePreference(value: string): IntakeTimePreference | null {
  const normalized = value.trim().toUpperCase();
  if (INTAKE_TIME_PREFERENCES.includes(normalized as IntakeTimePreference)) {
    return normalized as IntakeTimePreference;
  }

  return null;
}

function normalizeSpecialistAvailabilityType(value: unknown): SpecialistAvailabilityType | null {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "AVAILABLE") {
    return "AVAILABLE";
  }
  if (normalized === "OUT_OF_OFFICE" || normalized === "OUTOFOFFICE" || normalized === "OOO") {
    return "OUT_OF_OFFICE";
  }

  return null;
}

function specialistAvailabilityTypeLabel(value: SpecialistAvailabilityType) {
  return value === "OUT_OF_OFFICE" ? "out-of-office" : "available";
}

function parsePreferredStartTime(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("Invalid preferred start time.", 400);
  }

  return parsed;
}

function extractIntakeTimePreferencesFromCase(caseRecord: {
  intakeFormData: Prisma.JsonValue | null;
}) {
  const intakeFormData = caseRecord.intakeFormData;
  if (!intakeFormData || typeof intakeFormData !== "object" || Array.isArray(intakeFormData)) {
    return [] as IntakeTimePreference[];
  }

  const availability = (intakeFormData as Record<string, unknown>).availability;
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) {
    return [] as IntakeTimePreference[];
  }

  const timePreferences = (availability as Record<string, unknown>).timePreferences;
  if (!Array.isArray(timePreferences)) {
    return [] as IntakeTimePreference[];
  }

  return Array.from(
    new Set(
      timePreferences
        .map((entry) => (typeof entry === "string" ? normalizeIntakeTimePreference(entry) : null))
        .filter((entry): entry is IntakeTimePreference => Boolean(entry)),
    ),
  );
}

function slotIsOnManualAssignmentGrid(
  slot: Date,
  workingHours: SpecialistWorkingHours = {
    startHour: DEFAULT_SPECIALIST_STANDARD_START_HOUR,
    endHour: DEFAULT_SPECIALIST_STANDARD_END_HOUR,
  },
) {
  const hour = slot.getHours();
  const minute = slot.getMinutes();
  return (
    hour >= workingHours.startHour &&
    hour < workingHours.endHour &&
    minute === 0
  );
}

function slotMatchesManualTimeBlock(
  slot: Date,
  block: ManualAssignmentTimeBlock,
  options?: {
    workingHours?: SpecialistWorkingHours;
    blockWindows?: ManualAssignmentBlockWindows;
  },
) {
  const workingHours =
    options?.workingHours ||
    normalizeSpecialistWorkingHours(
      DEFAULT_SPECIALIST_STANDARD_START_HOUR,
      DEFAULT_SPECIALIST_STANDARD_END_HOUR,
    );
  if (!slotIsOnManualAssignmentGrid(slot, workingHours)) {
    return false;
  }

  const hour = slot.getHours();
  const window = getManualAssignmentBlockWindow(
    block,
    options?.blockWindows || resolveManualAssignmentBlockWindows(workingHours),
  );
  if (window.endHour <= window.startHour) {
    return false;
  }
  return hour >= window.startHour && hour < window.endHour;
}

function slotMatchesAnyManualTimeBlock(
  slot: Date,
  blocks: ManualAssignmentTimeBlock[],
  options?: {
    workingHours?: SpecialistWorkingHours;
    blockWindows?: ManualAssignmentBlockWindows;
  },
) {
  const workingHours =
    options?.workingHours ||
    normalizeSpecialistWorkingHours(
      DEFAULT_SPECIALIST_STANDARD_START_HOUR,
      DEFAULT_SPECIALIST_STANDARD_END_HOUR,
    );
  if (blocks.length === 0) {
    return slotIsOnManualAssignmentGrid(slot, workingHours);
  }

  return blocks.some((block) => slotMatchesManualTimeBlock(slot, block, options));
}

function resolveManualAssignmentTimeBlockForSlot(
  slot: Date | null | undefined,
  options?: {
    workingHours?: SpecialistWorkingHours;
    blockWindows?: ManualAssignmentBlockWindows;
  },
): ManualAssignmentTimeBlock | null {
  if (!slot) {
    return null;
  }

  if (slotMatchesManualTimeBlock(slot, "MORNING", options)) {
    return "MORNING";
  }

  if (slotMatchesManualTimeBlock(slot, "AFTERNOON", options)) {
    return "AFTERNOON";
  }

  if (slotMatchesManualTimeBlock(slot, "EVENING", options)) {
    return "EVENING";
  }

  return null;
}

type ManualAssignmentBoardCaseRecord = {
  id: string;
  reference: string;
  status: CaseStatus;
  counsellingType: string | null;
  intakeFormData: Prisma.JsonValue | null;
  participants: Array<{
    client: {
      id: string;
      firstName: string;
      lastName: string;
    };
  }>;
  workflowStates: Array<{
    step: {
      name: string;
    };
  }>;
};

function mapCaseToManualAssignmentBoardCase(caseItem: ManualAssignmentBoardCaseRecord) {
  const timePreferences = extractIntakeTimePreferencesFromCase(caseItem);
  return {
    id: caseItem.id,
    reference: caseItem.reference,
    status: caseItem.status,
    participantCount: caseItem.participants.length,
    participants: caseItem.participants.map((participant) => ({
      id: participant.client.id,
      fullName: `${participant.client.firstName} ${participant.client.lastName}`,
    })),
    counsellingType: caseItem.counsellingType,
    timePreferences,
    pendingBlockingSteps: caseItem.workflowStates.length,
    pendingBlockingStepNames: caseItem.workflowStates
      .map((state) => state.step.name)
      .filter((value) => value.trim().length > 0),
  };
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeGridDayCount(
  dayCount: number | undefined,
  defaultGridDays: number,
  maxGridDays: number,
) {
  if (!Number.isFinite(dayCount)) {
    return defaultGridDays;
  }

  const rounded = Math.floor(Number(dayCount));
  if (rounded < 1) {
    return defaultGridDays;
  }

  return Math.min(rounded, maxGridDays);
}

function normalizeGridStartDate(startDate?: Date | string) {
  if (!startDate) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  const parsed = startDate instanceof Date ? new Date(startDate) : new Date(startDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("Invalid start date supplied for counsellor availability calendar.", 400);
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseAvailabilityDate(value: Date | string, fieldLabel: string) {
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    throw new DomainError(`Invalid ${fieldLabel} supplied for availability window.`, 400);
  }

  return dateValue;
}

function normalizeAvailabilityRanges(windows: AvailabilityWindowInput[]) {
  if (windows.length === 0) {
    throw new DomainError("At least one availability window is required.", 400);
  }

  const sorted = windows
    .map((window, index) => {
      const startTime = parseAvailabilityDate(window.startTime, `windows[${index}].startTime`);
      const endTime = parseAvailabilityDate(window.endTime, `windows[${index}].endTime`);

      if (endTime <= startTime) {
        throw new DomainError(
          `Availability window ${index + 1} must end after it starts.`,
          400,
        );
      }

      return {
        startTime,
        endTime,
      };
    })
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const merged: AvailabilityRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(range);
      continue;
    }

    if (range.startTime <= previous.endTime) {
      previous.endTime = new Date(Math.max(previous.endTime.getTime(), range.endTime.getTime()));
      continue;
    }

    merged.push(range);
  }

  return merged;
}

function intersectAvailabilityRanges(first: AvailabilityRange[], second: AvailabilityRange[]) {
  const intersections: AvailabilityRange[] = [];
  let firstIndex = 0;
  let secondIndex = 0;

  while (firstIndex < first.length && secondIndex < second.length) {
    const firstRange = first[firstIndex];
    const secondRange = second[secondIndex];

    const startTime = new Date(
      Math.max(firstRange.startTime.getTime(), secondRange.startTime.getTime()),
    );
    const endTime = new Date(Math.min(firstRange.endTime.getTime(), secondRange.endTime.getTime()));

    if (startTime < endTime) {
      intersections.push({ startTime, endTime });
    }

    if (firstRange.endTime <= secondRange.endTime) {
      firstIndex += 1;
    } else {
      secondIndex += 1;
    }
  }

  return intersections;
}

function rangeCanFitDuration(range: AvailabilityRange, durationMinutes: number) {
  return range.endTime.getTime() - range.startTime.getTime() >= durationMinutes * 60_000;
}

function slotFitsAvailability(
  slot: Date,
  durationMinutes: number,
  windows: AvailabilityRange[],
) {
  const endTime = addMinutes(slot, durationMinutes);
  return windows.some((window) => slot >= window.startTime && endTime <= window.endTime);
}

function findParticipantByIdentifier(
  caseRecord: Pick<CaseWithParticipantContacts, "participants">,
  participantIdentifier: string,
) {
  const trimmedIdentifier = participantIdentifier.trim();
  const normalizedIdentifier = normalizeParticipantIdentifier(trimmedIdentifier);
  const normalizedPhone = normalizePhoneForMatch(trimmedIdentifier);

  return caseRecord.participants.find((participant) => {
    if (participant.client.id === trimmedIdentifier) {
      return true;
    }

    const participantEmail = normalizeParticipantIdentifier(participant.client.email);
    if (participantEmail === normalizedIdentifier) {
      return true;
    }

    const participantPhone = normalizePhoneForMatch(participant.client.phone);
    return Boolean(participantPhone && normalizedPhone && participantPhone === normalizedPhone);
  });
}

function computeCaseAvailability(
  caseRecord: Pick<CaseWithParticipantContacts, "participants" | "availabilityWindows">,
  durationMinutes: number,
): CaseAvailabilityComputation {
  const requiredParticipants = caseRecord.participants.length;
  if (requiredParticipants === 0) {
    return {
      windows: [],
      participantsSubmitted: 0,
      requiredParticipants: 0,
      participantIdentifiersSubmitted: [],
      hasOverlap: false,
      reason: "Case has no participants.",
    };
  }

  const windowsByParticipant = new Map<string, AvailabilityRange[]>();

  for (const participant of caseRecord.participants) {
    windowsByParticipant.set(participant.clientId, []);
  }

  for (const window of caseRecord.availabilityWindows) {
    const participantWindows = windowsByParticipant.get(window.clientId);
    if (!participantWindows) {
      continue;
    }

    participantWindows.push({
      startTime: window.startTime,
      endTime: window.endTime,
    });
  }

  for (const windows of windowsByParticipant.values()) {
    windows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  const participantIdentifiersSubmitted = caseRecord.participants
    .filter((participant) => (windowsByParticipant.get(participant.clientId)?.length ?? 0) > 0)
    .map((participant) => normalizeParticipantIdentifier(participant.client.email));
  const participantsSubmitted = participantIdentifiersSubmitted.length;

  if (participantsSubmitted < requiredParticipants) {
    return {
      windows: [],
      participantsSubmitted,
      requiredParticipants,
      participantIdentifiersSubmitted,
      hasOverlap: false,
      reason: "Awaiting availability submissions from all participants.",
    };
  }

  let overlap = windowsByParticipant.get(caseRecord.participants[0]?.clientId || "") || [];
  for (let index = 1; index < caseRecord.participants.length; index += 1) {
    const participant = caseRecord.participants[index];
    const participantWindows = windowsByParticipant.get(participant.clientId) || [];
    overlap = intersectAvailabilityRanges(overlap, participantWindows);

    if (overlap.length === 0) {
      return {
        windows: [],
        participantsSubmitted,
        requiredParticipants,
        participantIdentifiersSubmitted,
        hasOverlap: false,
        reason: "Participant availability submissions do not overlap.",
      };
    }
  }

  const durationEligibleWindows = overlap.filter((range) => rangeCanFitDuration(range, durationMinutes));
  if (durationEligibleWindows.length === 0) {
    return {
      windows: [],
      participantsSubmitted,
      requiredParticipants,
      participantIdentifiersSubmitted,
      hasOverlap: false,
      reason: `No overlapping availability window can fit ${durationMinutes} minutes.`,
    };
  }

  return {
    windows: durationEligibleWindows,
    participantsSubmitted,
    requiredParticipants,
    participantIdentifiersSubmitted,
    hasOverlap: true,
    reason: null,
  };
}

async function sendDocumentsForStatus(
  tx: Tx,
  caseId: string,
  status: CaseStatus,
  sessionId?: string,
) {
  const templates = await tx.documentTemplate.findMany({
    where: {
      triggerStatus: status,
    },
    select: {
      id: true,
      required: true,
    },
  });

  if (templates.length === 0) {
    return;
  }

  await tx.documentInstance.createMany({
    data: templates.map((template) => ({
      caseId,
      templateId: template.id,
      sessionId: sessionId ?? null,
      status: DocumentState.SENT,
      required: template.required,
    })),
    skipDuplicates: true,
  });
}

function getDocumentCodeFromFormType(formType: string) {
  switch (formType) {
    case "TERMS_AND_CONDITIONS":
      return DOCUMENT_CODES.TERMS_AND_CONDITIONS;
    case "INTAKE_FORM":
      return DOCUMENT_CODES.INTAKE_FORM;
    case "OUTTAKE_FORM":
      return DOCUMENT_CODES.OUTTAKE_FORM;
    default:
      return null;
  }
}

async function completeDocumentFromFormSubmission(
  tx: Tx,
  input: {
    caseId: string;
    formType: string;
    source: string;
    participantIdentifier: string;
  },
) {
  const documentCode = getDocumentCodeFromFormType(input.formType);
  if (!documentCode) {
    return {
      matchedDocumentCode: null,
      matchedDocumentId: null,
      completed: false,
      alreadyCompleted: false,
    };
  }

  const existing = await tx.documentInstance.findFirst({
    where: {
      caseId: input.caseId,
      template: {
        code: documentCode,
      },
    },
    include: {
      template: true,
    },
  });

  if (!existing) {
    return {
      matchedDocumentCode: documentCode,
      matchedDocumentId: null,
      completed: false,
      alreadyCompleted: false,
    };
  }

  if (existing.status === DocumentState.COMPLETED) {
    return {
      matchedDocumentCode: documentCode,
      matchedDocumentId: existing.id,
      completed: false,
      alreadyCompleted: true,
    };
  }

  const completedAt = new Date();
  await tx.documentInstance.update({
    where: {
      id: existing.id,
    },
    data: {
      status: DocumentState.COMPLETED,
      completedAt,
    },
  });

  await createAuditLog(tx, {
    caseId: input.caseId,
    action: "DOCUMENT_COMPLETED_FROM_FORM_SUBMISSION",
    details: {
      documentId: existing.id,
      templateCode: existing.template.code,
      formType: input.formType,
      source: input.source,
      participantIdentifier: input.participantIdentifier,
      completedAt: completedAt.toISOString(),
    },
  });

  return {
    matchedDocumentCode: documentCode,
    matchedDocumentId: existing.id,
    completed: true,
    alreadyCompleted: false,
  };
}

async function ensureRequiredDocumentsCompleted(
  tx: Tx,
  caseId: string,
  targetStatus: CaseStatus,
) {
  const requiredCodes = await resolveRequiredDocumentCodesForStatus(targetStatus);

  if (requiredCodes.length === 0) {
    return;
  }

  const completedDocs = await tx.documentInstance.findMany({
    where: {
      caseId,
      status: DocumentState.COMPLETED,
      template: {
        code: {
          in: requiredCodes,
        },
      },
    },
    include: {
      template: true,
    },
  });

  const completedCodes = new Set(completedDocs.map((doc) => doc.template.code));
  const missing = requiredCodes.filter((code) => !completedCodes.has(code));

  if (missing.length > 0) {
    throw new DomainError(
      `Cannot transition to ${targetStatus}. Required documents pending: ${missing.join(", ")}.`,
      409,
    );
  }
}

async function resolveRequiredDocumentCodesForStatus(status: CaseStatus) {
  const operationalSettings = await getOperationalSettings();

  if (status === CaseStatus.IN_SESSION) {
    return operationalSettings.requireTermsBeforeInSession
      ? [DOCUMENT_CODES.TERMS_AND_CONDITIONS]
      : [];
  }

  if (status === CaseStatus.CLOSED) {
    return operationalSettings.requireOuttakeBeforeClose
      ? [DOCUMENT_CODES.OUTTAKE_FORM]
      : [];
  }

  return [] as string[];
}

async function initializeCaseWorkflowStates(tx: Tx, caseId: string, caseWorkflowTemplateId: string) {
  const steps = await tx.caseWorkflowStep.findMany({
    where: {
      templateId: caseWorkflowTemplateId,
    },
    select: {
      id: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (steps.length === 0) {
    throw new DomainError("Workflow template has no steps.", 409);
  }

  await tx.caseWorkflowState.createMany({
    data: steps.map((step) => ({
      caseId,
      stepId: step.id,
      status: "PENDING",
    })),
    skipDuplicates: true,
  });
}

async function hasIncompleteBlockingSteps(tx: Tx, caseId: string) {
  const count = await tx.caseWorkflowState.count({
    where: {
      caseId,
      status: "PENDING",
      step: {
        required: true,
        blocksScheduling: true,
      },
    },
  });

  return count > 0;
}

async function assertCaseEligibleForScheduling(tx: Tx, caseId: string) {
  if (await hasIncompleteBlockingSteps(tx, caseId)) {
    throw new DomainError("Case not eligible for scheduling", 409);
  }
}

async function setCaseStatus(
  tx: Tx,
  input: {
    caseId: string;
    currentStatus: CaseStatus;
    targetStatus: CaseStatus;
    actorUserId?: string;
    statusReason?: string;
    sessionIdForDocs?: string;
  },
) {
  if (input.currentStatus === input.targetStatus) {
    return;
  }

  const allowed = CASE_TRANSITIONS[input.currentStatus];
  if (!allowed.includes(input.targetStatus)) {
    throw new DomainError(
      `Invalid status transition: ${input.currentStatus} -> ${input.targetStatus}`,
      409,
    );
  }

  let sessionIdForDocs = input.sessionIdForDocs;
  if (input.targetStatus === CaseStatus.SCHEDULED) {
    const scheduledSession = await tx.session.findFirst({
      where: {
        caseId: input.caseId,
        status: {
          in: ACTIVE_SESSION_STATUSES,
        },
      },
      select: {
        id: true,
      },
    });

    if (!scheduledSession) {
      throw new DomainError(
        "Cannot transition to SCHEDULED without a provider booking session.",
        409,
      );
    }

    sessionIdForDocs = sessionIdForDocs ?? scheduledSession.id;
  }

  await ensureRequiredDocumentsCompleted(tx, input.caseId, input.targetStatus);

  await tx.case.update({
    where: { id: input.caseId },
    data: {
      status: input.targetStatus,
    },
  });

  if (input.targetStatus === CaseStatus.IN_SESSION) {
    await tx.session.updateMany({
      where: {
        caseId: input.caseId,
        status: SessionStatus.SCHEDULED,
      },
      data: {
        status: SessionStatus.IN_SESSION,
      },
    });
  }

  if (input.targetStatus === CaseStatus.COMPLETED) {
    await tx.session.updateMany({
      where: {
        caseId: input.caseId,
        status: {
          in: [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION],
        },
      },
      data: {
        status: SessionStatus.COMPLETED,
      },
    });
  }

  await sendDocumentsForStatus(
    tx,
    input.caseId,
    input.targetStatus,
    sessionIdForDocs,
  );

  await createAuditLog(tx, {
    caseId: input.caseId,
    userId: input.actorUserId,
    action: "CASE_STATUS_TRANSITION",
    details: {
      from: input.currentStatus,
      to: input.targetStatus,
      reason: input.statusReason ?? null,
    },
  });
}

async function sendSchedulingDocuments(
  tx: Tx,
  caseId: string,
  sessionId: string,
) {
  await sendDocumentsForStatus(tx, caseId, CaseStatus.MATCHED);
  await sendDocumentsForStatus(tx, caseId, CaseStatus.SCHEDULED, sessionId);
}

function resolveSchedulingEventType(
  specialist: SpecialistSchedulingConfig,
  participantCount: number,
): SchedulingEventType {
  if (participantCount === 2) {
    if (!specialist.supportsCouples) {
      throw new DomainError(
        `${specialist.name} cannot run couple sessions based on current capability settings.`,
        409,
      );
    }

    return "couple";
  }

  return "individual";
}

async function resolveSessionDurationMinutes(flags: string[], participantCount: number) {
  const durationFlag = flags.find((flag) => flag.startsWith("duration:"));
  if (durationFlag) {
    const parsed = Number(durationFlag.split(":")[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new DomainError(`Invalid duration flag '${durationFlag}'.`, 409);
    }

    return Math.round(parsed);
  }

  const operationalSettings = await getOperationalSettings();
  return participantCount === 2
    ? operationalSettings.defaultCoupleSessionMinutes
    : operationalSettings.defaultIndividualSessionMinutes;
}

function getPrimaryAttendee(caseRecord: CaseWithParticipantContacts) {
  const primary = caseRecord.participants[0]?.client;

  if (!primary) {
    throw new DomainError("Case has no participants and cannot be scheduled.", 409);
  }

  return {
    attendeeName: `${primary.firstName} ${primary.lastName}`,
    attendeeEmail: primary.email,
  };
}

export async function createCaseFromIntake(
  input: IntakeSubmissionInput,
  actorUserId?: string,
) {
  const operationalSettings = await getOperationalSettings();
  const participantCount = input.secondary ? 2 : 1;
  const counsellingType = normalizeCounsellingType(input.counsellingType, participantCount);
  const initialStatus = input.initialStatus ?? CaseStatus.NEW;
  const intakeSource =
    normalizeIntakeSourceType(input.intakeSource) || operationalSettings.defaultIntakeSource;
  const intakeDocumentTriggerStatus =
    initialStatus === CaseStatus.AWAITING_REVIEW ? CaseStatus.NEW : initialStatus;

  const durationFlag =
    typeof input.requestedDurationMinutes === "number"
      ? [`duration:${Math.round(input.requestedDurationMinutes)}`]
      : [];
  const riskFlags = (input.riskFlags || [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => `risk:${value}`);

  const created = await db.$transaction(async (tx) => {
    const workflow = await resolveWorkflowForCase(tx, {
      workflowCode: input.workflowCode,
      counsellingType,
      participantCount,
    });

    const reference = await nextCaseReference(tx);

    const caseRecord = await tx.case.create({
      data: {
        reference,
        status: initialStatus,
        counsellingType,
        intakeSource,
        intakeExternalId: input.intakeExternalId?.trim() || null,
        intakeReceivedAt: new Date(),
        ...(input.intakeFormData
          ? {
              intakeFormData: input.intakeFormData as Prisma.InputJsonValue,
            }
          : {}),
        consentSignature: input.consentSignature?.trim() || null,
        consentSignatureType: input.consentSignatureType?.trim() || null,
        consentSignedAt: input.consentSignedAt ?? null,
        consentIpAddress: input.consentIpAddress?.trim() || null,
        caseWorkflowTemplateId: workflow.id,
        notes: input.notes?.trim() || null,
        flags: [
          input.secondary ? "couple" : "individual",
          `workflow:${workflow.code}`,
          ...durationFlag,
          ...riskFlags,
        ],
      },
    });

    await initializeCaseWorkflowStates(tx, caseRecord.id, workflow.id);

    const primaryClient = await tx.client.create({
      data: {
        firstName: input.primary.firstName.trim(),
        lastName: input.primary.lastName.trim(),
        email: input.primary.email.trim().toLowerCase(),
        phone: input.primary.phone?.trim() || null,
      },
    });

    await tx.caseParticipant.create({
      data: {
        caseId: caseRecord.id,
        clientId: primaryClient.id,
        role: "PRIMARY",
      },
    });

    if (input.secondary) {
      const secondaryClient = await tx.client.create({
        data: {
          firstName: input.secondary.firstName.trim(),
          lastName: input.secondary.lastName.trim(),
          email: input.secondary.email.trim().toLowerCase(),
          phone: input.secondary.phone?.trim() || null,
        },
      });

      await tx.caseParticipant.create({
        data: {
          caseId: caseRecord.id,
          clientId: secondaryClient.id,
          role: "SECONDARY",
        },
      });
    }

    await sendDocumentsForStatus(
      tx,
      caseRecord.id,
      intakeDocumentTriggerStatus,
      undefined,
    );

    await createAuditLog(tx, {
      caseId: caseRecord.id,
      userId: actorUserId,
      action: "CASE_CREATED_FROM_INTAKE",
      details: {
        participantCount,
        counsellingType,
        intakeSource,
        intakeExternalId: input.intakeExternalId?.trim() || null,
        workflowCode: workflow.code,
        initialStatus,
        intakeDocumentTriggerStatus,
      },
    });

    return caseRecord;
  });

  let allocationError: string | null = null;

  const shouldAutoAllocate =
    input.autoAllocate ?? (initialStatus === CaseStatus.NEW || initialStatus === CaseStatus.MATCHED);

  if (shouldAutoAllocate) {
    try {
      await allocateCaseAutomatically(created.id, actorUserId);
    } catch (error) {
      allocationError =
        error instanceof Error
          ? error.message
          : "Automatic allocation failed after intake submission.";
    }
  }

  return {
    caseId: created.id,
    reference: created.reference,
    allocationError,
  };
}

export async function allocateCaseAutomatically(caseId: string, actorUserId?: string) {
  return db.$transaction(async (tx) => {
    if (!(await isAutoAllocationEnabled())) {
      throw new DomainError(
        "Automatic allocation is disabled in manual assignment mode. Use manual assignment from case detail.",
        409,
      );
    }

    const schedulingProvider = await createSchedulingProvider(tx);
    const caseRecord = await tx.case.findUnique({
      where: { id: caseId },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        availabilityWindows: {
          where: {
            active: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new DomainError("Cannot allocate a closed case.", 409);
    }

    if (caseRecord.sessions.length > 0) {
      throw new DomainError(
        "Case already has an active session. Use manual override to reassign.",
        409,
      );
    }

    await assertCaseEligibleForScheduling(tx, caseId);

    const participantCount = caseRecord.participants.length;
    const supportsCouplesRequired = participantCount === 2;
    const durationMinutes = await resolveSessionDurationMinutes(
      caseRecord.flags,
      participantCount,
    );
    const caseAvailability = computeCaseAvailability(caseRecord, durationMinutes);

    if (!caseAvailability.hasOverlap) {
      await createAuditLog(tx, {
        caseId,
        userId: actorUserId,
        action: "AUTO_ALLOCATION_BLOCKED_NO_AVAILABILITY_OVERLAP",
        details: {
          participantCount,
          durationMinutes,
          participantsSubmitted: caseAvailability.participantsSubmitted,
          requiredParticipants: caseAvailability.requiredParticipants,
          reason: caseAvailability.reason,
        },
      });

      throw new DomainError(caseAvailability.reason || "Case not eligible for scheduling", 409);
    }

    const specialists = await tx.specialist.findMany({
      where: {
        active: true,
        ...(supportsCouplesRequired ? { supportsCouples: true } : {}),
      },
      select: {
        id: true,
        name: true,
        supportsCouples: true,
      },
    });

    if (specialists.length === 0) {
      throw new DomainError(
        supportsCouplesRequired
          ? "No active counsellors available for couples."
          : "No active counsellors available.",
        409,
      );
    }

    const casePrimaryAttendee = getPrimaryAttendee(caseRecord);

    const availabilityChecks = await Promise.all(
      specialists.map(async (specialist) => {
        const eventType = resolveSchedulingEventType(specialist, participantCount);
        const slots = await schedulingProvider.getAvailableSlots(
          specialist.id,
          eventType,
          durationMinutes,
        );

        if (slots.length === 0) {
          return null;
        }

        const firstMatchingSlot = slots.find((slot) =>
          slotFitsAvailability(slot, durationMinutes, caseAvailability.windows),
        );
        if (!firstMatchingSlot) {
          return null;
        }

        return {
          specialist,
          eventType,
          slot: firstMatchingSlot,
        };
      }),
    );

    const firstAvailable = availabilityChecks
      .filter(
        (
          candidate,
        ): candidate is {
          specialist: SpecialistSchedulingConfig;
          eventType: SchedulingEventType;
          slot: Date;
        } => Boolean(candidate),
      )
      .sort((a, b) => {
        const first = a.slot.getTime();
        const second = b.slot.getTime();
        return first - second;
      })[0];

    if (!firstAvailable) {
      await createAuditLog(tx, {
        caseId,
        userId: actorUserId,
        action: "AUTO_ALLOCATION_NO_PROVIDER_SLOT_IN_CLIENT_AVAILABILITY",
        details: {
          participantCount,
          durationMinutes,
          overlapWindowCount: caseAvailability.windows.length,
        },
      });

      throw new DomainError(
        "No matching provider slots were returned inside the submitted client availability windows.",
        409,
      );
    }

    const bookingCaseData: SchedulingCaseData = {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantCount,
      attendeeName: casePrimaryAttendee.attendeeName,
      attendeeEmail: casePrimaryAttendee.attendeeEmail,
      eventType: firstAvailable.eventType,
      durationMinutes,
    };

    const booking = await schedulingProvider.createBooking(
      firstAvailable.specialist.id,
      firstAvailable.slot,
      bookingCaseData,
    );

    const session = await tx.session.create({
      data: {
        caseId,
        specialistId: firstAvailable.specialist.id,
        status: SessionStatus.SCHEDULED,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime,
        providerEndTime: booking.endTime,
        providerType: booking.providerType,
        providerStatus: "scheduled",
        lastProviderSyncAt: new Date(),
      },
    });

    const targetStatus = CaseStatus.SCHEDULED;

    await tx.case.update({
      where: { id: caseId },
      data: {
        assignedSpecialistId: firstAvailable.specialist.id,
        status: targetStatus,
      },
    });

    await sendSchedulingDocuments(tx, caseId, session.id);

    if (targetStatus !== caseRecord.status) {
      await createAuditLog(tx, {
        caseId,
        userId: actorUserId,
        action: "CASE_STATUS_TRANSITION",
        details: {
          from: caseRecord.status,
          to: targetStatus,
          reason: "Automatic allocation progression",
        },
      });
    }

    await createAuditLog(tx, {
      caseId,
      userId: actorUserId,
      action: "AUTO_ALLOCATED",
      details: {
        participantCount,
        durationMinutes,
        specialistId: firstAvailable.specialist.id,
        providerType: booking.providerType,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime.toISOString(),
        providerEndTime: booking.endTime.toISOString(),
        eventType: firstAvailable.eventType,
        overlapWindowCount: caseAvailability.windows.length,
      },
    });

    return tx.case.findUnique({
      where: { id: caseId },
      include: {
        assignedSpecialist: true,
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });
  });
}

export async function overrideCaseAssignment(input: {
  caseId: string;
  specialistId: string;
  reason: string;
  matchingRuleOverride?: string;
  preferredTimeBlock?: string;
  preferredStartTime?: string;
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    const assignmentMode = await getSchedulingAssignmentMode();
    const schedulingProvider = await createSchedulingProvider(tx);
    const caseRecord = await tx.case.findUnique({
      where: { id: input.caseId },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        availabilityWindows: {
          where: {
            active: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
          orderBy: {
            providerStartTime: "desc",
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new DomainError("Cannot override assignment for a closed case.", 409);
    }

    const specialist = await tx.specialist.findUnique({
      where: {
        id: input.specialistId,
      },
      select: {
        id: true,
        name: true,
        supportsCouples: true,
        standardStartHour: true,
        standardEndHour: true,
      },
    });

    if (!specialist) {
      throw new DomainError("Counsellor not found.", 404);
    }

    const participantCount = caseRecord.participants.length;
    const specialistWorkingHours = normalizeSpecialistWorkingHours(
      specialist.standardStartHour,
      specialist.standardEndHour,
    );
    const specialistBlockWindows = resolveManualAssignmentBlockWindows(specialistWorkingHours);
    const eventType = resolveSchedulingEventType(specialist, participantCount);
    const requestedDurationMinutes = await resolveSessionDurationMinutes(
      caseRecord.flags,
      participantCount,
    );
    const durationMinutes =
      assignmentMode === "manual"
        ? MANUAL_ASSIGNMENT_SLOT_MINUTES
        : requestedDurationMinutes;
    const intakeTimePreferences = extractIntakeTimePreferencesFromCase(caseRecord);
    const preferredStartTime = parsePreferredStartTime(input.preferredStartTime);
    const preferredStartTimeBlock = preferredStartTime
      ? resolveManualAssignmentTimeBlockForSlot(preferredStartTime, {
          workingHours: specialistWorkingHours,
          blockWindows: specialistBlockWindows,
        })
      : null;
    if (preferredStartTime && !preferredStartTimeBlock) {
      throw new DomainError(
        `Preferred start time must be between ${String(specialistWorkingHours.startHour).padStart(2, "0")}:00 and ${String(specialistWorkingHours.endHour).padStart(2, "0")}:00 for ${specialist.name}.`,
        409,
      );
    }
    const preferredTimeBlock = normalizeIntakeTimePreference(input.preferredTimeBlock || "");
    const manualTargetBlocks =
      preferredStartTimeBlock
        ? [preferredStartTimeBlock]
        : preferredTimeBlock
        ? [preferredTimeBlock]
        : intakeTimePreferences.length > 0
          ? intakeTimePreferences
          : INTAKE_TIME_PREFERENCES;

    await assertCaseEligibleForScheduling(tx, input.caseId);

    let overlapWindowCount: number | null = null;
    let availableSlots: Date[] = [];

    if (assignmentMode === "auto") {
      const caseAvailability = computeCaseAvailability(caseRecord, durationMinutes);
      if (!caseAvailability.hasOverlap) {
        await createAuditLog(tx, {
          caseId: input.caseId,
          userId: input.actorUserId,
          action: "MANUAL_OVERRIDE_BLOCKED_NO_AVAILABILITY_OVERLAP",
          details: {
            specialistId: input.specialistId,
            durationMinutes,
            participantsSubmitted: caseAvailability.participantsSubmitted,
            requiredParticipants: caseAvailability.requiredParticipants,
            reason: caseAvailability.reason,
          },
        });

        throw new DomainError(caseAvailability.reason || "Case not eligible for scheduling", 409);
      }

      overlapWindowCount = caseAvailability.windows.length;
      availableSlots = await schedulingProvider.getAvailableSlots(
        specialist.id,
        eventType,
        durationMinutes,
      );

      const earliestSlot = availableSlots.find((slot) =>
        slotFitsAvailability(slot, durationMinutes, caseAvailability.windows),
      );
      if (!earliestSlot) {
        throw new DomainError(
          `No provider slots for counsellor ${specialist.name} fit the submitted client availability windows.`,
          409,
        );
      }

      const attendee = getPrimaryAttendee(caseRecord);

      const bookingCaseData: SchedulingCaseData = {
        caseId: caseRecord.id,
        caseReference: caseRecord.reference,
        participantCount,
        attendeeName: attendee.attendeeName,
        attendeeEmail: attendee.attendeeEmail,
        eventType,
        durationMinutes,
      };

      const booking = await schedulingProvider.createBooking(
        specialist.id,
        earliestSlot,
        bookingCaseData,
      );

      const activeSession = caseRecord.sessions[0] ?? null;
      if (activeSession?.providerBookingId) {
        await schedulingProvider.cancelBooking(activeSession.providerBookingId);
      }

      const session = activeSession
        ? await tx.session.update({
            where: {
              id: activeSession.id,
            },
            data: {
              specialistId: input.specialistId,
              status: SessionStatus.SCHEDULED,
              providerBookingId: booking.bookingId,
              providerStartTime: booking.startTime,
              providerEndTime: booking.endTime,
              providerType: booking.providerType,
              providerStatus: "scheduled",
              lastProviderSyncAt: new Date(),
            },
          })
        : await tx.session.create({
            data: {
              caseId: input.caseId,
              specialistId: input.specialistId,
              status: SessionStatus.SCHEDULED,
              providerBookingId: booking.bookingId,
              providerStartTime: booking.startTime,
              providerEndTime: booking.endTime,
              providerType: booking.providerType,
              providerStatus: "scheduled",
              lastProviderSyncAt: new Date(),
            },
          });

      const targetStatus = CaseStatus.SCHEDULED;

      await tx.case.update({
        where: { id: input.caseId },
        data: {
          assignedSpecialistId: input.specialistId,
          manualOverride: true,
          status: targetStatus,
        },
      });

      await sendSchedulingDocuments(tx, input.caseId, session.id);

      if (targetStatus !== caseRecord.status) {
        await createAuditLog(tx, {
          caseId: input.caseId,
          userId: input.actorUserId,
          action: "CASE_STATUS_TRANSITION",
          details: {
            from: caseRecord.status,
            to: targetStatus,
            reason: "Manual override progression",
          },
        });
      }

      await createAuditLog(tx, {
        caseId: input.caseId,
        userId: input.actorUserId,
        action: "MANUAL_OVERRIDE",
        details: {
          assignmentMode,
          previousSessionId: activeSession?.id ?? null,
          previousProviderBookingId: activeSession?.providerBookingId ?? null,
          specialistId: input.specialistId,
          providerType: booking.providerType,
          providerBookingId: booking.bookingId,
          providerStartTime: booking.startTime.toISOString(),
          providerEndTime: booking.endTime.toISOString(),
          eventType,
          durationMinutes,
          reason: input.reason,
          matchingRuleOverride: input.matchingRuleOverride ?? null,
          overlapWindowCount,
        },
      });

      return tx.case.findUnique({
        where: { id: input.caseId },
        include: {
          assignedSpecialist: true,
          sessions: {
            include: {
              specialist: true,
            },
            orderBy: {
              providerStartTime: "asc",
            },
          },
        },
      });
    }

    availableSlots = await schedulingProvider.getAvailableSlots(
      specialist.id,
      eventType,
      durationMinutes,
    );

    const exactPreferredSlot = preferredStartTime
      ? availableSlots.find((slot) => slot.getTime() === preferredStartTime.getTime()) || null
      : null;
    if (preferredStartTime && !exactPreferredSlot) {
      throw new DomainError(
        `The selected ${durationMinutes}-minute slot is no longer available for counsellor ${specialist.name}.`,
        409,
      );
    }

    const preferredSlots = availableSlots.filter((slot) =>
      slotMatchesAnyManualTimeBlock(slot, manualTargetBlocks, {
        workingHours: specialistWorkingHours,
        blockWindows: specialistBlockWindows,
      }),
    );
    const earliestPreferredSlot = exactPreferredSlot || preferredSlots[0];
    if (!earliestPreferredSlot) {
      throw new DomainError(
        `No 60-minute slots between ${String(specialistWorkingHours.startHour).padStart(2, "0")}:00 and ${String(specialistWorkingHours.endHour).padStart(2, "0")}:00 match the selected manual availability block(s) for counsellor ${specialist.name}.`,
        409,
      );
    }

    const attendee = getPrimaryAttendee(caseRecord);
    const bookingCaseData: SchedulingCaseData = {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantCount,
      attendeeName: attendee.attendeeName,
      attendeeEmail: attendee.attendeeEmail,
      eventType,
      durationMinutes,
    };
    const booking = await schedulingProvider.createBooking(
      specialist.id,
      earliestPreferredSlot,
      bookingCaseData,
    );

    const activeSession = caseRecord.sessions[0] ?? null;
    if (activeSession?.providerBookingId) {
      await schedulingProvider.cancelBooking(activeSession.providerBookingId);
    }

    const session = activeSession
      ? await tx.session.update({
          where: {
            id: activeSession.id,
          },
          data: {
            specialistId: input.specialistId,
            status: SessionStatus.SCHEDULED,
            providerBookingId: booking.bookingId,
            providerStartTime: booking.startTime,
            providerEndTime: booking.endTime,
            providerType: booking.providerType,
            providerStatus: "scheduled",
            lastProviderSyncAt: new Date(),
          },
        })
      : await tx.session.create({
          data: {
            caseId: input.caseId,
            specialistId: input.specialistId,
            status: SessionStatus.SCHEDULED,
            providerBookingId: booking.bookingId,
            providerStartTime: booking.startTime,
            providerEndTime: booking.endTime,
            providerType: booking.providerType,
            providerStatus: "scheduled",
            lastProviderSyncAt: new Date(),
          },
        });

    const targetStatus = CaseStatus.SCHEDULED;

    await tx.case.update({
      where: { id: input.caseId },
      data: {
        assignedSpecialistId: input.specialistId,
        manualOverride: true,
        status: targetStatus,
      },
    });

    await sendSchedulingDocuments(tx, input.caseId, session.id);

    if (targetStatus !== caseRecord.status) {
      await createAuditLog(tx, {
        caseId: input.caseId,
        userId: input.actorUserId,
        action: "CASE_STATUS_TRANSITION",
        details: {
          from: caseRecord.status,
          to: targetStatus,
          reason: "Manual assignment progression",
        },
      });
    }

    await createAuditLog(tx, {
      caseId: input.caseId,
      userId: input.actorUserId,
      action: "MANUAL_OVERRIDE",
      details: {
        assignmentMode,
        previousSessionId: activeSession?.id ?? null,
        previousProviderBookingId: activeSession?.providerBookingId ?? null,
        specialistId: input.specialistId,
        providerType: booking.providerType,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime.toISOString(),
        providerEndTime: booking.endTime.toISOString(),
        eventType,
        durationMinutes,
        requestedDurationMinutes,
        reason: input.reason,
        matchingRuleOverride: input.matchingRuleOverride ?? null,
        selectedTimePreferences: intakeTimePreferences,
        preferredTimeBlock: preferredStartTimeBlock ?? preferredTimeBlock ?? null,
        preferredStartTime: preferredStartTime ? preferredStartTime.toISOString() : null,
        manualTargetBlocks,
        manualAssignmentPolicy: {
          slotMinutes: MANUAL_ASSIGNMENT_SLOT_MINUTES,
          dayStartHour: specialistWorkingHours.startHour,
          dayEndHour: specialistWorkingHours.endHour,
          blockWindows: specialistBlockWindows,
        },
        overlapWindowCount,
      },
    });

    return tx.case.findUnique({
      where: { id: input.caseId },
      include: {
        assignedSpecialist: true,
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });
  });
}

export async function unassignCaseAssignment(input: {
  caseId: string;
  reason: string;
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    const schedulingProvider = await createSchedulingProvider(tx);
    const caseRecord = await tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
          orderBy: {
            providerStartTime: "desc",
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new DomainError("Cannot unassign a closed case.", 409);
    }

    const activeSession = caseRecord.sessions[0] ?? null;
    if (!caseRecord.assignedSpecialistId && !activeSession) {
      throw new DomainError("Case is already unassigned.", 409);
    }

    if (activeSession?.providerBookingId) {
      await schedulingProvider.cancelBooking(activeSession.providerBookingId);

      await tx.session.update({
        where: {
          id: activeSession.id,
        },
        data: {
          status: SessionStatus.CANCELLED,
          providerStatus: "cancelled",
          lastProviderSyncAt: new Date(),
        },
      });
    }

    const targetStatus =
      caseRecord.status === CaseStatus.SCHEDULED || caseRecord.status === CaseStatus.IN_SESSION
        ? CaseStatus.READY_TO_SCHEDULE
        : caseRecord.status;

    await tx.case.update({
      where: {
        id: input.caseId,
      },
      data: {
        assignedSpecialistId: null,
        manualOverride: true,
        status: targetStatus,
      },
    });

    if (targetStatus !== caseRecord.status) {
      await createAuditLog(tx, {
        caseId: input.caseId,
        userId: input.actorUserId,
        action: "CASE_STATUS_TRANSITION",
        details: {
          from: caseRecord.status,
          to: targetStatus,
          reason: "Manual unassignment progression",
        },
      });
    }

    await createAuditLog(tx, {
      caseId: input.caseId,
      userId: input.actorUserId,
      action: "MANUAL_UNASSIGN",
      details: {
        previousSpecialistId: caseRecord.assignedSpecialistId,
        previousSessionId: activeSession?.id ?? null,
        previousProviderBookingId: activeSession?.providerBookingId ?? null,
        reason: input.reason,
      },
    });

    return tx.case.findUnique({
      where: { id: input.caseId },
      include: {
        assignedSpecialist: true,
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });
  });
}

export async function transitionCaseStatus(input: {
  caseId: string;
  targetStatus: CaseStatus;
  actorUserId?: string;
  reason?: string;
}) {
  return db.$transaction(async (tx) => {
    const caseRecord = await tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    await setCaseStatus(tx, {
      caseId: input.caseId,
      currentStatus: caseRecord.status,
      targetStatus: input.targetStatus,
      actorUserId: input.actorUserId,
      statusReason: input.reason,
      sessionIdForDocs:
        input.targetStatus === CaseStatus.SCHEDULED
          ? caseRecord.sessions[0]?.id
          : undefined,
    });

    return tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        assignedSpecialist: true,
        participants: {
          include: {
            client: true,
          },
        },
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
        documents: {
          include: {
            template: true,
          },
          orderBy: {
            sentAt: "asc",
          },
        },
      },
    });
  });
}

export async function completeDocumentInstance(documentId: string, actorUserId?: string) {
  return db.$transaction(async (tx) => {
    const document = await tx.documentInstance.findUnique({
      where: {
        id: documentId,
      },
      include: {
        case: true,
        template: true,
      },
    });

    if (!document) {
      throw new DomainError("Document not found.", 404);
    }

    if (document.status === DocumentState.COMPLETED) {
      return document;
    }

    const updated = await tx.documentInstance.update({
      where: {
        id: documentId,
      },
      data: {
        status: DocumentState.COMPLETED,
        completedAt: new Date(),
      },
      include: {
        template: true,
      },
    });

    await createAuditLog(tx, {
      caseId: document.caseId,
      userId: actorUserId,
      action: "DOCUMENT_COMPLETED",
      details: {
        documentId,
        templateCode: document.template.code,
      },
    });

    return updated;
  });
}

export async function listCasesForOps() {
  return db.case.findMany({
    select: {
      id: true,
      reference: true,
      status: true,
      caseWorkflowTemplate: {
        select: {
          id: true,
          name: true,
          counsellingType: true,
        },
      },
      participants: {
        select: {
          client: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      workflowStates: {
        where: {
          status: "PENDING",
          step: {
            blocksScheduling: true,
            required: true,
          },
        },
        select: {
          id: true,
        },
      },
      assignedSpecialist: {
        select: {
          name: true,
        },
      },
      sessions: {
        where: {
          status: {
            in: ACTIVE_SESSION_STATUSES,
          },
          providerStatus: "scheduled",
        },
        orderBy: {
          providerStartTime: "asc",
        },
        take: 1,
        select: {
          providerStartTime: true,
        },
      },
      documents: {
        where: {
          required: true,
        },
        select: {
          required: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function listClientsForOps() {
  return db.client.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      participants: {
        select: {
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              assignedSpecialist: {
                select: {
                  id: true,
                  name: true,
                },
              },
              sessions: {
                where: {
                  status: {
                    in: ACTIVE_SESSION_STATUSES,
                  },
                },
                orderBy: {
                  providerStartTime: "asc",
                },
                take: 1,
                select: {
                  id: true,
                  providerStartTime: true,
                },
              },
            },
          },
        },
        orderBy: {
          case: {
            updatedAt: "desc",
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function getClientDetailsForOps(clientId: string) {
  return db.client.findUnique({
    where: {
      id: clientId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
      availabilityWindows: {
        where: {
          active: true,
        },
        orderBy: {
          startTime: "asc",
        },
        select: {
          id: true,
          caseId: true,
          startTime: true,
          endTime: true,
          timezone: true,
          source: true,
          submittedAt: true,
          case: {
            select: {
              id: true,
              reference: true,
            },
          },
        },
      },
      formAccessPins: {
        orderBy: {
          createdAt: "desc",
        },
        take: 25,
        select: {
          id: true,
          formType: true,
          formPath: true,
          accessKey: true,
          expiresAt: true,
          lastVerifiedAt: true,
          revokedAt: true,
          createdAt: true,
          case: {
            select: {
              id: true,
              reference: true,
            },
          },
          issuedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      participants: {
        orderBy: {
          case: {
            updatedAt: "desc",
          },
        },
        select: {
          role: true,
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              counsellingType: true,
              intakeSource: true,
              intakeReceivedAt: true,
              intakeFormData: true,
              notes: true,
              intakeReviewNotes: true,
              flags: true,
              assignedSpecialist: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              caseWorkflowTemplate: {
                select: {
                  id: true,
                  name: true,
                  counsellingType: true,
                },
              },
              workflowStates: {
                where: {
                  status: "PENDING",
                  step: {
                    required: true,
                    blocksScheduling: true,
                  },
                },
                select: {
                  id: true,
                  stepId: true,
                  step: {
                    select: {
                      name: true,
                      type: true,
                      formType: true,
                    },
                  },
                },
                orderBy: {
                  step: {
                    sortOrder: "asc",
                  },
                },
              },
              sessions: {
                orderBy: {
                  providerStartTime: "asc",
                },
                select: {
                  id: true,
                  status: true,
                  providerStartTime: true,
                  providerEndTime: true,
                  providerType: true,
                  providerStatus: true,
                  specialist: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
              participants: {
                select: {
                  role: true,
                  client: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true,
                      phone: true,
                    },
                  },
                },
                orderBy: {
                  role: "asc",
                },
              },
              documents: {
                orderBy: {
                  sentAt: "asc",
                },
                select: {
                  id: true,
                  status: true,
                  required: true,
                  sentAt: true,
                  completedAt: true,
                  template: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function listClientsForSpecialist(specialistId: string) {
  return db.client.findMany({
    where: {
      participants: {
        some: {
          case: {
            assignedSpecialistId: specialistId,
          },
        },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      participants: {
        where: {
          case: {
            assignedSpecialistId: specialistId,
          },
        },
        select: {
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              sessions: {
                where: {
                  specialistId,
                  status: {
                    in: ACTIVE_SESSION_STATUSES,
                  },
                  providerStatus: "scheduled",
                },
                orderBy: {
                  providerStartTime: "asc",
                },
                take: 1,
                select: {
                  id: true,
                  providerStartTime: true,
                },
              },
            },
          },
        },
        orderBy: {
          case: {
            updatedAt: "desc",
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function getCaseDetails(caseId: string) {
  return db.case.findUnique({
    where: { id: caseId },
    include: {
      caseWorkflowTemplate: {
        include: {
          steps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      participants: {
        include: {
          client: true,
        },
      },
      workflowStates: {
        include: {
          step: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      assignedSpecialist: true,
      sessions: {
        include: {
          specialist: true,
          documents: {
            include: {
              template: true,
            },
          },
        },
        orderBy: {
          providerStartTime: "asc",
        },
      },
      documents: {
        include: {
          template: true,
        },
        orderBy: {
          sentAt: "asc",
        },
      },
      formAccessPins: {
        include: {
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          issuedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 25,
      },
      auditLogs: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      },
    },
  });
}

export async function listSpecialistsForOps() {
  return db.specialist.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      calUserId: true,
      supportsCouples: true,
      standardStartHour: true,
      standardEndHour: true,
      calIndividualEventTypeId: true,
      calCouplesEventTypeId: true,
      capabilities: true,
      sessions: {
        where: {
          status: {
            in: ACTIVE_SESSION_STATUSES,
          },
          providerStatus: "scheduled",
          providerStartTime: {
            gte: new Date(),
          },
        },
        orderBy: {
          providerStartTime: "asc",
        },
        take: 1,
        select: {
          providerStartTime: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getManualAssignmentDashboard() {
  const operationalSettings = await getOperationalSettings();
  const assignmentMode = operationalSettings.schedulingAssignmentMode;

  const [unassignedCases, assignedCases, specialists] = await Promise.all([
    db.case.findMany({
      where: {
        assignedSpecialistId: null,
        status: {
          in: [
            CaseStatus.NEW,
            CaseStatus.AWAITING_REVIEW,
            CaseStatus.MATCHED,
            CaseStatus.AGREEMENT_PENDING,
            CaseStatus.READY_TO_SCHEDULE,
          ],
        },
        sessions: {
          none: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
        },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        counsellingType: true,
        intakeFormData: true,
        participants: {
          select: {
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        workflowStates: {
          where: {
            status: "PENDING",
            step: {
              blocksScheduling: true,
              required: true,
            },
          },
          select: {
            step: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    db.case.findMany({
      where: {
        assignedSpecialistId: {
          not: null,
        },
        status: {
          in: [
            CaseStatus.MATCHED,
            CaseStatus.AGREEMENT_PENDING,
            CaseStatus.READY_TO_SCHEDULE,
            CaseStatus.SCHEDULED,
          ],
        },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        counsellingType: true,
        intakeFormData: true,
        assignedSpecialistId: true,
        participants: {
          select: {
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        workflowStates: {
          where: {
            status: "PENDING",
            step: {
              blocksScheduling: true,
              required: true,
            },
          },
          select: {
            step: {
              select: {
                name: true,
              },
            },
          },
        },
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
            providerStatus: "scheduled",
          },
          orderBy: {
            providerStartTime: "asc",
          },
          take: 1,
          select: {
            providerStartTime: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    db.specialist.findMany({
      where: {
        active: true,
      },
      select: {
        id: true,
        name: true,
        supportsCouples: true,
        standardStartHour: true,
        standardEndHour: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  let providerError: string | null = null;
  const availabilityBySpecialist = new Map<
    string,
    {
      counts: Record<ManualAssignmentTimeBlock, number>;
      next: Partial<Record<ManualAssignmentTimeBlock, Date>>;
      slotPreview: Record<ManualAssignmentTimeBlock, Date[]>;
      calendarSlots: Date[];
      workingHours: SpecialistWorkingHours;
      blockWindows: ManualAssignmentBlockWindows;
    }
  >();

  if (assignmentMode === "manual") {
    try {
      const schedulingProvider = await createSchedulingProvider(db);
      const results = await Promise.all(
        specialists.map(async (specialist) => {
          const workingHours = normalizeSpecialistWorkingHours(
            specialist.standardStartHour,
            specialist.standardEndHour,
          );
          const blockWindows = resolveManualAssignmentBlockWindows(workingHours);
          const slots = await schedulingProvider.getAvailableSlots(
            specialist.id,
            "individual",
            MANUAL_ASSIGNMENT_SLOT_MINUTES,
          );
          const manualSlots = slots.filter((slot) => slotIsOnManualAssignmentGrid(slot, workingHours));
          const slotsByBlock: Record<ManualAssignmentTimeBlock, Date[]> = {
            MORNING: manualSlots.filter((slot) =>
              slotMatchesManualTimeBlock(slot, "MORNING", {
                workingHours,
                blockWindows,
              }),
            ),
            AFTERNOON: manualSlots.filter((slot) =>
              slotMatchesManualTimeBlock(slot, "AFTERNOON", {
                workingHours,
                blockWindows,
              }),
            ),
            EVENING: manualSlots.filter((slot) =>
              slotMatchesManualTimeBlock(slot, "EVENING", {
                workingHours,
                blockWindows,
              }),
            ),
          };
          const counts: Record<ManualAssignmentTimeBlock, number> = {
            MORNING: slotsByBlock.MORNING.length,
            AFTERNOON: slotsByBlock.AFTERNOON.length,
            EVENING: slotsByBlock.EVENING.length,
          };

          const next: Partial<Record<ManualAssignmentTimeBlock, Date>> = {
            MORNING: slotsByBlock.MORNING[0],
            AFTERNOON: slotsByBlock.AFTERNOON[0],
            EVENING: slotsByBlock.EVENING[0],
          };

          const slotPreview: Record<ManualAssignmentTimeBlock, Date[]> = {
            MORNING: slotsByBlock.MORNING.slice(0, 8),
            AFTERNOON: slotsByBlock.AFTERNOON.slice(0, 8),
            EVENING: slotsByBlock.EVENING.slice(0, 8),
          };
          const calendarSlots = manualSlots.slice(0, 140);

          return {
            specialistId: specialist.id,
            counts,
            next,
            slotPreview,
            calendarSlots,
            workingHours,
            blockWindows,
          };
        }),
      );

      for (const result of results) {
        availabilityBySpecialist.set(result.specialistId, {
          counts: result.counts,
          next: result.next,
          slotPreview: result.slotPreview,
          calendarSlots: result.calendarSlots,
          workingHours: result.workingHours,
          blockWindows: result.blockWindows,
        });
      }
    } catch (error) {
      providerError =
        error instanceof Error
          ? error.message
          : "Unable to load provider availability for manual assignment dashboard.";
    }
  }

  const specialistIdSet = new Set(specialists.map((specialist) => specialist.id));
  const specialistHoursById = new Map(
    specialists.map((specialist) => [
      specialist.id,
      normalizeSpecialistWorkingHours(
        specialist.standardStartHour,
        specialist.standardEndHour,
      ),
    ]),
  );
  const slotPolicyStartHour =
    specialists.length > 0
      ? Math.min(
          ...specialists.map((specialist) =>
            normalizeSpecialistWorkingHours(
              specialist.standardStartHour,
              specialist.standardEndHour,
            ).startHour,
          ),
        )
      : operationalSettings.defaultSpecialistStandardStartHour;
  const slotPolicyEndHour =
    specialists.length > 0
      ? Math.max(
          ...specialists.map((specialist) =>
            normalizeSpecialistWorkingHours(
              specialist.standardStartHour,
              specialist.standardEndHour,
            ).endHour,
          ),
        )
      : operationalSettings.defaultSpecialistStandardEndHour;

  const assignedCasesForBoard = assignedCases
    .filter(
      (
        caseItem,
      ): caseItem is typeof caseItem & {
        assignedSpecialistId: string;
      } => {
        const specialistId = caseItem.assignedSpecialistId;
        return typeof specialistId === "string" && specialistIdSet.has(specialistId);
      },
    )
    .map((caseItem) => {
      const boardCase = mapCaseToManualAssignmentBoardCase(caseItem);
      const sessionStart = caseItem.sessions[0]?.providerStartTime || null;
      const workingHours = specialistHoursById.get(caseItem.assignedSpecialistId) ||
        normalizeSpecialistWorkingHours(
          operationalSettings.defaultSpecialistStandardStartHour,
          operationalSettings.defaultSpecialistStandardEndHour,
        );
      const blockFromSession = resolveManualAssignmentTimeBlockForSlot(sessionStart, {
        workingHours,
        blockWindows: resolveManualAssignmentBlockWindows(workingHours),
      });

      return {
        ...boardCase,
        assignedSpecialistId: caseItem.assignedSpecialistId,
        assignedTimeBlock: blockFromSession || boardCase.timePreferences[0] || "MORNING",
        assignedSlotStartTime: sessionStart ? sessionStart.toISOString() : null,
      };
    });

  return {
    assignmentMode,
    schedulingEngineType: operationalSettings.schedulingEngineType,
    slotPolicy: {
      startHour: slotPolicyStartHour,
      endHour: slotPolicyEndHour,
      slotMinutes: MANUAL_ASSIGNMENT_SLOT_MINUTES,
    },
    providerError,
    unassignedCases: unassignedCases.map(mapCaseToManualAssignmentBoardCase),
    assignedCases: assignedCasesForBoard,
    specialists: specialists.map((specialist) => {
      const availability = availabilityBySpecialist.get(specialist.id);
      const next = availability?.next || {};
      const slotPreview = availability?.slotPreview;
      const calendarSlots = availability?.calendarSlots;
      return {
        id: specialist.id,
        name: specialist.name,
        supportsCouples: specialist.supportsCouples,
        workingHours:
          availability?.workingHours ||
          normalizeSpecialistWorkingHours(
            specialist.standardStartHour,
            specialist.standardEndHour,
          ),
        blockWindows:
          availability?.blockWindows ||
          resolveManualAssignmentBlockWindows(
            normalizeSpecialistWorkingHours(
              specialist.standardStartHour,
              specialist.standardEndHour,
            ),
          ),
        availability: availability
          ? {
              counts: availability.counts,
              next: {
                MORNING: next.MORNING ? next.MORNING.toISOString() : null,
                AFTERNOON: next.AFTERNOON ? next.AFTERNOON.toISOString() : null,
                EVENING: next.EVENING ? next.EVENING.toISOString() : null,
              },
              slots: {
                MORNING: (slotPreview?.MORNING || []).map((slot) => slot.toISOString()),
                AFTERNOON: (slotPreview?.AFTERNOON || []).map((slot) => slot.toISOString()),
                EVENING: (slotPreview?.EVENING || []).map((slot) => slot.toISOString()),
              },
              calendarSlots: (calendarSlots || []).map((slot) => slot.toISOString()),
            }
          : {
          counts: {
            MORNING: 0,
            AFTERNOON: 0,
            EVENING: 0,
          },
          next: {
            MORNING: null,
            AFTERNOON: null,
            EVENING: null,
          },
          slots: {
            MORNING: [],
            AFTERNOON: [],
            EVENING: [],
          },
          calendarSlots: [],
        },
      };
    }),
  };
}

export async function getCaseSpecialistAvailability(caseId: string) {
  const assignmentMode = await getSchedulingAssignmentMode();
  const caseRecord = await db.case.findUnique({
    where: {
      id: caseId,
    },
    include: {
      participants: {
        include: {
          client: true,
        },
      },
      availabilityWindows: {
        where: {
          active: true,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  if (!caseRecord) {
    throw new DomainError("Case not found.", 404);
  }

  const participantCount = caseRecord.participants.length;
  const supportsCouplesRequired = participantCount === 2;
  const durationMinutes =
    participantCount > 0
      ? assignmentMode === "manual"
        ? MANUAL_ASSIGNMENT_SLOT_MINUTES
        : await resolveSessionDurationMinutes(caseRecord.flags, participantCount)
      : 0;
  const intakeTimePreferences = extractIntakeTimePreferencesFromCase(caseRecord);
  const manualTargetBlocks =
    intakeTimePreferences.length > 0 ? intakeTimePreferences : INTAKE_TIME_PREFERENCES;
  const clientAvailability =
    assignmentMode === "auto"
      ? participantCount > 0
        ? computeCaseAvailability(caseRecord, durationMinutes)
        : {
            windows: [],
            participantsSubmitted: 0,
            requiredParticipants: 0,
            participantIdentifiersSubmitted: [],
            hasOverlap: false,
            reason: "Case has no participants.",
          }
      : {
          windows: [] as AvailabilityRange[],
          participantsSubmitted: caseRecord.participants.length,
          requiredParticipants: caseRecord.participants.length,
          participantIdentifiersSubmitted: caseRecord.participants.map((participant) =>
            normalizeParticipantIdentifier(participant.client.email),
          ),
          hasOverlap: true,
          reason:
            intakeTimePreferences.length === 0
              ? "No time-of-day preference submitted. Showing earliest provider slots."
              : null,
        };

  const specialists = await db.specialist.findMany({
    where: {
      active: true,
      ...(supportsCouplesRequired ? { supportsCouples: true } : {}),
    },
    select: {
      id: true,
      name: true,
      supportsCouples: true,
      standardStartHour: true,
      standardEndHour: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  if (participantCount === 0 || specialists.length === 0) {
    return {
      assignmentMode,
      participantCount,
      durationMinutes,
      requiresCouplesSupport: supportsCouplesRequired,
      clientAvailability: {
        participantsSubmitted: clientAvailability.participantsSubmitted,
        requiredParticipants: clientAvailability.requiredParticipants,
        hasOverlap: clientAvailability.hasOverlap,
        reason: clientAvailability.reason,
        overlapWindowCount: clientAvailability.windows.length,
        timePreferences: intakeTimePreferences,
      },
      specialists: [],
    };
  }

  const schedulingProvider = await createSchedulingProvider(db);
  const availabilityBySpecialist = await Promise.all(
    specialists.map(async (specialist) => {
      const workingHours = normalizeSpecialistWorkingHours(
        specialist.standardStartHour,
        specialist.standardEndHour,
      );
      const blockWindows = resolveManualAssignmentBlockWindows(workingHours);
      const eventType = resolveSchedulingEventType(specialist, participantCount);

      try {
        const slots = await schedulingProvider.getAvailableSlots(
          specialist.id,
          eventType,
          durationMinutes,
        );

        const nextProviderSlot = slots[0] ?? null;
        const nextClientMatchedSlot =
          assignmentMode === "auto"
            ? clientAvailability.hasOverlap
              ? slots.find((slot) =>
                  slotFitsAvailability(slot, durationMinutes, clientAvailability.windows),
                ) || null
              : null
            : slots.find((slot) =>
                slotMatchesAnyManualTimeBlock(slot, manualTargetBlocks, {
                  workingHours,
                  blockWindows,
                }),
              ) || null;

        return {
          specialistId: specialist.id,
          specialistName: specialist.name,
          supportsCouples: specialist.supportsCouples,
          eventType,
          providerSlotCount: slots.length,
          workingHours,
          blockWindows,
          nextProviderSlot,
          nextClientMatchedSlot,
          error: null as string | null,
        };
      } catch (error) {
        return {
          specialistId: specialist.id,
          specialistName: specialist.name,
          supportsCouples: specialist.supportsCouples,
          eventType,
          providerSlotCount: 0,
          workingHours,
          blockWindows,
          nextProviderSlot: null,
          nextClientMatchedSlot: null,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load availability from scheduling provider.",
        };
      }
    }),
  );

  return {
    assignmentMode,
    participantCount,
    durationMinutes,
    requiresCouplesSupport: supportsCouplesRequired,
    clientAvailability: {
      participantsSubmitted: clientAvailability.participantsSubmitted,
      requiredParticipants: clientAvailability.requiredParticipants,
      hasOverlap: clientAvailability.hasOverlap,
      reason: clientAvailability.reason,
      overlapWindowCount: clientAvailability.windows.length,
      participantIdentifiersSubmitted: clientAvailability.participantIdentifiersSubmitted,
      timePreferences: intakeTimePreferences,
    },
    specialists: availabilityBySpecialist.sort((first, second) => {
      if (first.specialistId === caseRecord.assignedSpecialistId) {
        return -1;
      }
      if (second.specialistId === caseRecord.assignedSpecialistId) {
        return 1;
      }
      return first.specialistName.localeCompare(second.specialistName);
    }),
  };
}

export async function getSpecialistProfileForOps(specialistId: string) {
  return db.specialist.findUnique({
    where: {
      id: specialistId,
    },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      },
      sessions: {
        include: {
          case: {
            include: {
              participants: {
                include: {
                  client: true,
                },
              },
            },
          },
        },
        orderBy: {
          providerStartTime: "desc",
        },
        take: 50,
      },
      assignedCases: {
        where: {
          status: {
            not: CaseStatus.CLOSED,
          },
        },
        include: {
          participants: {
            include: {
              client: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 25,
      },
    },
  });
}

export async function getSpecialistAvailabilityCalendar(
  specialistId: string,
  dayCount?: number,
  startDate?: Date | string,
) {
  const operationalSettings = await getOperationalSettings();
  const defaultGridDays =
    operationalSettings.specialistAvailabilityDefaultGridDays ||
    FALLBACK_SPECIALIST_AVAILABILITY_GRID_DAYS;
  const maxGridDays =
    operationalSettings.specialistAvailabilityMaxGridDays ||
    FALLBACK_SPECIALIST_AVAILABILITY_MAX_GRID_DAYS;
  const days = normalizeGridDayCount(dayCount, defaultGridDays, maxGridDays);
  const rangeStart = normalizeGridStartDate(startDate);
  const rangeEnd = addDays(rangeStart, days);

  const specialist = await db.specialist.findUnique({
    where: {
      id: specialistId,
    },
    select: {
      id: true,
      name: true,
      active: true,
      standardStartHour: true,
      standardEndHour: true,
    },
  });

  if (!specialist) {
    throw new DomainError("Counsellor not found.", 404);
  }

  const workingHours = normalizeSpecialistWorkingHours(
    specialist.standardStartHour,
    specialist.standardEndHour,
  );

  const [availabilityWindows, sessions] = await Promise.all([
    db.specialistAvailabilityWindow.findMany({
      where: {
        specialistId,
        active: true,
        startTime: {
          lt: rangeEnd,
        },
        endTime: {
          gt: rangeStart,
        },
      },
      orderBy: {
        startTime: "asc",
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        timezone: true,
        availabilityType: true,
      },
    }),
    db.session.findMany({
      where: {
        specialistId,
        status: {
          in: ACTIVE_SESSION_STATUSES,
        },
        providerStatus: "scheduled",
        providerStartTime: {
          gte: rangeStart,
          lt: rangeEnd,
        },
      },
      select: {
        id: true,
        providerStartTime: true,
        providerEndTime: true,
        case: {
          select: {
            reference: true,
          },
        },
      },
      orderBy: {
        providerStartTime: "asc",
      },
    }),
  ]);

  return {
    specialist,
    dayCount: days,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    slotPolicy: {
      startHour: workingHours.startHour,
      endHour: workingHours.endHour,
      slotMinutes: MANUAL_ASSIGNMENT_SLOT_MINUTES,
    },
    windows: availabilityWindows.map((window) => ({
      id: window.id,
      startTime: window.startTime.toISOString(),
      endTime: window.endTime.toISOString(),
      timezone: window.timezone,
      availabilityType: window.availabilityType,
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      startTime: session.providerStartTime.toISOString(),
      endTime: session.providerEndTime.toISOString(),
      caseReference: session.case.reference,
    })),
  };
}

export async function addSpecialistAvailabilitySlot(input: {
  specialistId: string;
  startTime: Date | string;
  endTime: Date | string;
  timezone?: string;
  availabilityType?: SpecialistAvailabilityType | string;
  notes?: string;
  actorUserId: string;
  source?: string;
}) {
  const startTime = parseAvailabilityDate(input.startTime, "startTime");
  const endTime = parseAvailabilityDate(input.endTime, "endTime");

  if (endTime <= startTime) {
    throw new DomainError("Availability end time must be after start time.", 400);
  }

  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60_000);
  if (durationMinutes !== MANUAL_ASSIGNMENT_SLOT_MINUTES) {
    throw new DomainError(
      `Availability slots must be ${MANUAL_ASSIGNMENT_SLOT_MINUTES} minutes.`,
      409,
    );
  }

  if (startTime.getMinutes() !== 0 || endTime.getMinutes() !== 0) {
    throw new DomainError("Availability slots must start and end on the hour.", 409);
  }

  const specialist = await db.specialist.findUnique({
    where: {
      id: input.specialistId,
    },
    select: {
      id: true,
      name: true,
      standardStartHour: true,
      standardEndHour: true,
    },
  });

  if (!specialist) {
    throw new DomainError("Counsellor not found.", 404);
  }

  const workingHours = normalizeSpecialistWorkingHours(
    specialist.standardStartHour,
    specialist.standardEndHour,
  );
  const startHour = startTime.getHours();
  const endHour = endTime.getHours();
  if (startHour < workingHours.startHour || endHour > workingHours.endHour) {
    throw new DomainError(
      `Availability slots for ${specialist.name} must be between ${String(workingHours.startHour).padStart(2, "0")}:00 and ${String(workingHours.endHour).padStart(2, "0")}:00.`,
      409,
    );
  }

  const availabilityType =
    normalizeSpecialistAvailabilityType(input.availabilityType) || "AVAILABLE";

  const overlappingSession = await db.session.findFirst({
    where: {
      specialistId: input.specialistId,
      status: {
        in: ACTIVE_SESSION_STATUSES,
      },
      providerStatus: "scheduled",
      providerStartTime: {
        lt: endTime,
      },
      providerEndTime: {
        gt: startTime,
      },
    },
    select: {
      case: {
        select: {
          reference: true,
        },
      },
    },
  });
  if (overlappingSession) {
    throw new DomainError(
      `Cannot update this slot because it is already booked for ${overlappingSession.case.reference}.`,
      409,
    );
  }

  return db.$transaction(async (tx) => {
    const exact = await tx.specialistAvailabilityWindow.findFirst({
      where: {
        specialistId: input.specialistId,
        active: true,
        startTime,
        endTime,
        availabilityType,
      },
      select: {
        id: true,
        specialistId: true,
        startTime: true,
        endTime: true,
        timezone: true,
        availabilityType: true,
      },
    });

    if (exact) {
      return exact;
    }

    const overlaps = await tx.specialistAvailabilityWindow.findMany({
      where: {
        specialistId: input.specialistId,
        active: true,
        startTime: {
          lt: endTime,
        },
        endTime: {
          gt: startTime,
        },
      },
      select: {
        id: true,
        availabilityType: true,
      },
    });

    const sameTypeConflict = overlaps.some((window) => window.availabilityType === availabilityType);
    if (sameTypeConflict) {
      throw new DomainError(
        `This slot is already marked as ${specialistAvailabilityTypeLabel(availabilityType)}.`,
        409,
      );
    }

    const oppositeTypeOverlaps = overlaps.filter((window) => window.availabilityType !== availabilityType);
    if (oppositeTypeOverlaps.length > 0) {
      await tx.specialistAvailabilityWindow.updateMany({
        where: {
          id: {
            in: oppositeTypeOverlaps.map((window) => window.id),
          },
        },
        data: {
          active: false,
        },
      });
    }

    const created = await tx.specialistAvailabilityWindow.create({
      data: {
        specialistId: input.specialistId,
        startTime,
        endTime,
        timezone: input.timezone?.trim() || "Europe/London",
        availabilityType,
        notes: input.notes?.trim() || null,
        source: input.source?.trim() || "manual_calendar",
        createdByUserId: input.actorUserId,
      },
      select: {
        id: true,
        specialistId: true,
        startTime: true,
        endTime: true,
        timezone: true,
        availabilityType: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "SPECIALIST_AVAILABILITY_SLOT_ADDED",
        details: {
          specialistId: specialist.id,
          specialistName: specialist.name,
          availabilityWindowId: created.id,
          startTime: created.startTime.toISOString(),
          endTime: created.endTime.toISOString(),
          timezone: created.timezone,
          availabilityType,
          replacedWindowIds: oppositeTypeOverlaps.map((window) => window.id),
          source: input.source?.trim() || "manual_calendar",
        },
      },
    });

    return created;
  });
}

export async function addSpecialistAvailabilityPresetBatch(input: {
  specialistId: string;
  startDate: Date | string;
  endDate: Date | string;
  blocks: ManualAssignmentTimeBlock[];
  availabilityType?: SpecialistAvailabilityType | string;
  actorUserId: string;
  timezone?: string;
  source?: string;
}) {
  const operationalSettings = await getOperationalSettings();
  const maxGridDays =
    operationalSettings.specialistAvailabilityMaxGridDays ||
    FALLBACK_SPECIALIST_AVAILABILITY_MAX_GRID_DAYS;
  const startDate = parseAvailabilityDate(input.startDate, "startDate");
  const endDate = parseAvailabilityDate(input.endDate, "endDate");
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  if (endDate < startDate) {
    throw new DomainError("Preset end date must be on or after start date.", 400);
  }

  const rangeDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  if (rangeDays > maxGridDays) {
    throw new DomainError(
      `Preset range cannot exceed ${maxGridDays} days.`,
      409,
    );
  }

  const normalizedBlocks = Array.from(
    new Set(
      input.blocks
        .map((value) => normalizeIntakeTimePreference(value))
        .filter((value): value is ManualAssignmentTimeBlock => Boolean(value)),
    ),
  );
  if (normalizedBlocks.length === 0) {
    throw new DomainError("At least one preset block is required.", 400);
  }

  const availabilityType =
    normalizeSpecialistAvailabilityType(input.availabilityType) || "AVAILABLE";

  const specialist = await db.specialist.findUnique({
    where: {
      id: input.specialistId,
    },
    select: {
      id: true,
      name: true,
      standardStartHour: true,
      standardEndHour: true,
    },
  });
  if (!specialist) {
    throw new DomainError("Counsellor not found.", 404);
  }
  const workingHours = normalizeSpecialistWorkingHours(
    specialist.standardStartHour,
    specialist.standardEndHour,
  );
  const blockWindows = resolveManualAssignmentBlockWindows(workingHours);

  const queryRangeEnd = addDays(endDate, 1);

  const [existingWindows, bookedSessions] = await Promise.all([
    db.specialistAvailabilityWindow.findMany({
      where: {
        specialistId: input.specialistId,
        active: true,
        startTime: {
          lt: queryRangeEnd,
        },
        endTime: {
          gt: startDate,
        },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        availabilityType: true,
      },
    }),
    db.session.findMany({
      where: {
        specialistId: input.specialistId,
        status: {
          in: ACTIVE_SESSION_STATUSES,
        },
        providerStatus: "scheduled",
        providerStartTime: {
          gte: startDate,
          lt: queryRangeEnd,
        },
      },
      select: {
        providerStartTime: true,
        providerEndTime: true,
      },
    }),
  ]);

  const existingWindowsExpanded = existingWindows.flatMap((window) => {
    const slots: Array<{
      windowId: string;
      availabilityType: SpecialistAvailabilityType;
      startTime: Date;
      endTime: Date;
    }> = [];
    for (
      let cursor = window.startTime.getTime();
      cursor + MANUAL_ASSIGNMENT_SLOT_MINUTES * 60_000 <= window.endTime.getTime();
      cursor += MANUAL_ASSIGNMENT_SLOT_MINUTES * 60_000
    ) {
      slots.push({
        windowId: window.id,
        availabilityType: window.availabilityType,
        startTime: new Date(cursor),
        endTime: new Date(cursor + MANUAL_ASSIGNMENT_SLOT_MINUTES * 60_000),
      });
    }
    return slots;
  });

  const now = new Date();
  const skipped = {
    past: 0,
    booked: 0,
    overlaps: 0,
  };
  const candidateSlots: Array<{ startTime: Date; endTime: Date }> = [];
  const windowsToDeactivate = new Set<string>();

  for (let dayOffset = 0; dayOffset < rangeDays; dayOffset += 1) {
    const day = addDays(startDate, dayOffset);

    for (const block of normalizedBlocks) {
      const window = getManualAssignmentBlockWindow(block, blockWindows);
      if (window.endHour <= window.startHour) {
        continue;
      }
      for (
        let hour = window.startHour;
        hour + MANUAL_ASSIGNMENT_SLOT_MINUTES / 60 <= window.endHour;
        hour += MANUAL_ASSIGNMENT_SLOT_MINUTES / 60
      ) {
        const slotStart = new Date(day);
        slotStart.setHours(hour, 0, 0, 0);
        const slotEnd = addMinutes(slotStart, MANUAL_ASSIGNMENT_SLOT_MINUTES);

        if (slotStart < now) {
          skipped.past += 1;
          continue;
        }

        const overlapsBooked = bookedSessions.some(
          (session) =>
            slotStart < session.providerEndTime && slotEnd > session.providerStartTime,
        );
        if (overlapsBooked) {
          skipped.booked += 1;
          continue;
        }

        const overlappingExisting = existingWindowsExpanded.filter(
          (existing) => slotStart < existing.endTime && slotEnd > existing.startTime,
        );
        const overlapsSameType = overlappingExisting.some(
          (existing) => existing.availabilityType === availabilityType,
        );
        const overlapsCandidate = candidateSlots.some(
          (existing) => slotStart < existing.endTime && slotEnd > existing.startTime,
        );
        if (overlapsSameType || overlapsCandidate) {
          skipped.overlaps += 1;
          continue;
        }

        for (const existing of overlappingExisting) {
          if (existing.availabilityType !== availabilityType) {
            windowsToDeactivate.add(existing.windowId);
          }
        }

        candidateSlots.push({
          startTime: slotStart,
          endTime: slotEnd,
        });
      }
    }
  }

  if (candidateSlots.length === 0) {
    return {
      specialistId: specialist.id,
      createdCount: 0,
      availabilityType,
      replacedWindowCount: 0,
      skipped,
      rangeStart: startDate.toISOString(),
      rangeEnd: endDate.toISOString(),
      blocks: normalizedBlocks,
    };
  }

  await db.$transaction(async (tx) => {
    if (windowsToDeactivate.size > 0) {
      await tx.specialistAvailabilityWindow.updateMany({
        where: {
          id: {
            in: Array.from(windowsToDeactivate),
          },
        },
        data: {
          active: false,
        },
      });
    }

    await tx.specialistAvailabilityWindow.createMany({
      data: candidateSlots.map((slot) => ({
        specialistId: input.specialistId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        timezone: input.timezone?.trim() || "Europe/London",
        availabilityType,
        source: input.source?.trim() || "manual_preset",
        createdByUserId: input.actorUserId,
      })),
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "SPECIALIST_AVAILABILITY_PRESET_BATCH_ADDED",
        details: {
          specialistId: specialist.id,
          specialistName: specialist.name,
          createdCount: candidateSlots.length,
          skipped,
          availabilityType,
          replacedWindowCount: windowsToDeactivate.size,
          blocks: normalizedBlocks,
          rangeStart: startDate.toISOString(),
          rangeEnd: endDate.toISOString(),
          source: input.source?.trim() || "manual_preset",
        },
      },
    });
  });

  return {
    specialistId: specialist.id,
    createdCount: candidateSlots.length,
    availabilityType,
    replacedWindowCount: windowsToDeactivate.size,
    skipped,
    rangeStart: startDate.toISOString(),
    rangeEnd: endDate.toISOString(),
    blocks: normalizedBlocks,
  };
}

export async function removeSpecialistAvailabilitySlot(input: {
  specialistId: string;
  availabilityWindowId: string;
  actorUserId: string;
  reason?: string;
}) {
  const specialist = await db.specialist.findUnique({
    where: {
      id: input.specialistId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!specialist) {
    throw new DomainError("Counsellor not found.", 404);
  }

  return db.$transaction(async (tx) => {
    const window = await tx.specialistAvailabilityWindow.findFirst({
      where: {
        id: input.availabilityWindowId,
        specialistId: input.specialistId,
      },
      select: {
        id: true,
        active: true,
        startTime: true,
        endTime: true,
        availabilityType: true,
      },
    });

    if (!window) {
      throw new DomainError("Availability slot not found.", 404);
    }

    if (!window.active) {
      return {
        id: window.id,
        specialistId: input.specialistId,
        availabilityType: window.availabilityType,
        active: false,
      };
    }

    const updated = await tx.specialistAvailabilityWindow.update({
      where: {
        id: window.id,
      },
      data: {
        active: false,
      },
      select: {
        id: true,
        specialistId: true,
        availabilityType: true,
        active: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "SPECIALIST_AVAILABILITY_SLOT_REMOVED",
        details: {
          specialistId: specialist.id,
          specialistName: specialist.name,
          availabilityWindowId: window.id,
          startTime: window.startTime.toISOString(),
          endTime: window.endTime.toISOString(),
          availabilityType: window.availabilityType,
          reason: input.reason?.trim() || null,
        },
      },
    });

    return updated;
  });
}

export async function updateCaseIntakeReviewNotes(input: {
  caseId: string;
  notes?: string;
  actorUserId: string;
}) {
  const normalizedNotes = input.notes?.trim() || null;

  return db.$transaction(async (tx) => {
    const existing = await tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      select: {
        id: true,
        reference: true,
        intakeReviewNotes: true,
      },
    });

    if (!existing) {
      throw new DomainError("Case not found.", 404);
    }

    if ((existing.intakeReviewNotes || null) === normalizedNotes) {
      return existing;
    }

    const updated = await tx.case.update({
      where: {
        id: existing.id,
      },
      data: {
        intakeReviewNotes: normalizedNotes,
      },
      select: {
        id: true,
        reference: true,
        intakeReviewNotes: true,
      },
    });

    await createAuditLog(tx, {
      caseId: existing.id,
      userId: input.actorUserId,
      action: "CASE_INTAKE_REVIEW_NOTES_UPDATED",
      details: {
        caseReference: existing.reference,
        before: existing.intakeReviewNotes || null,
        after: updated.intakeReviewNotes || null,
      },
    });

    return updated;
  });
}

export async function createSpecialist(input: {
  name: string;
  email: string;
  supportsCouples: boolean;
  capabilities: string[];
  calUserId: string;
  calIndividualEventTypeId: string;
  calCouplesEventTypeId?: string;
  password?: string;
  notes?: string;
  standardStartHour?: number;
  standardEndHour?: number;
}) {
  const operationalSettings = await getOperationalSettings();
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedCalUserId = input.calUserId.trim();
  const normalizedWorkingHours = normalizeSpecialistWorkingHours(
    input.standardStartHour ?? operationalSettings.defaultSpecialistStandardStartHour,
    input.standardEndHour ?? operationalSettings.defaultSpecialistStandardEndHour,
  );

  const existingUser = await db.userAccount.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new DomainError("A user with this email already exists.", 409);
  }

  const existingCalUserId = await db.specialist.findUnique({
    where: {
      calUserId: normalizedCalUserId,
    },
    select: {
      id: true,
    },
  });

  if (existingCalUserId) {
    throw new DomainError("Another counsellor already uses this Cal.com user id.", 409);
  }

  const passwordHash = await hash(input.password || "password123", 10);

  return db.specialist.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      supportsCouples: input.supportsCouples,
      standardStartHour: normalizedWorkingHours.startHour,
      standardEndHour: normalizedWorkingHours.endHour,
      capabilities: input.capabilities,
      notes: input.notes?.trim() || null,
      calUserId: normalizedCalUserId,
      calIndividualEventTypeId: input.calIndividualEventTypeId.trim(),
      calCouplesEventTypeId: input.calCouplesEventTypeId?.trim() || null,
      userAccount: {
        create: {
          email: normalizedEmail,
          name: input.name.trim(),
          passwordHash,
          role: UserRole.SPECIALIST,
        },
      },
    },
  });
}

export async function updateSpecialistProfile(input: {
  specialistId: string;
  name: string;
  email: string;
  supportsCouples: boolean;
  active: boolean;
  standardStartHour: number;
  standardEndHour: number;
  capabilities: string[];
  notes?: string;
  calUserId: string;
  calIndividualEventTypeId: string;
  calCouplesEventTypeId?: string;
  actorUserId: string;
}) {
  const normalizedName = input.name.trim();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedNotes = input.notes?.trim() || null;
  const normalizedCalUserId = input.calUserId.trim();
  const normalizedIndividualEventTypeId = input.calIndividualEventTypeId.trim();
  const normalizedCouplesEventTypeId = input.calCouplesEventTypeId?.trim() || null;
  const normalizedWorkingHours = normalizeSpecialistWorkingHours(
    input.standardStartHour,
    input.standardEndHour,
  );

  if (
    !normalizedName ||
    !normalizedEmail ||
    !normalizedCalUserId ||
    !normalizedIndividualEventTypeId
  ) {
    throw new DomainError(
      "Name, email, Cal.com user id, and individual event type id are required.",
      409,
    );
  }

  if (input.supportsCouples && !normalizedCouplesEventTypeId) {
    throw new DomainError(
      "Couples event type id is required for counsellors that support couples.",
      409,
    );
  }

  const specialist = await db.specialist.findUnique({
    where: {
      id: input.specialistId,
    },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  if (!specialist) {
    throw new DomainError("Counsellor not found.", 404);
  }

  const accountConflict = await db.userAccount.findFirst({
    where: {
      email: normalizedEmail,
      ...(specialist.userAccount ? { NOT: { id: specialist.userAccount.id } } : {}),
    },
    select: {
      id: true,
    },
  });

  if (accountConflict) {
    throw new DomainError("Another user already uses this email.", 409);
  }

  const specialistConflict = await db.specialist.findFirst({
    where: {
      email: normalizedEmail,
      NOT: {
        id: specialist.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (specialistConflict) {
    throw new DomainError("Another counsellor already uses this email.", 409);
  }

  const calUserConflict = await db.specialist.findFirst({
    where: {
      calUserId: normalizedCalUserId,
      NOT: {
        id: specialist.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (calUserConflict) {
    throw new DomainError("Another counsellor already uses this Cal.com user id.", 409);
  }

  const changedFields = {
    name:
      specialist.name !== normalizedName
        ? { from: specialist.name, to: normalizedName }
        : null,
    email:
      specialist.email !== normalizedEmail
        ? { from: specialist.email, to: normalizedEmail }
        : null,
    supportsCouples:
      specialist.supportsCouples !== input.supportsCouples
        ? { from: specialist.supportsCouples, to: input.supportsCouples }
        : null,
    active:
      specialist.active !== input.active
        ? { from: specialist.active, to: input.active }
        : null,
    standardWorkingHours:
      specialist.standardStartHour !== normalizedWorkingHours.startHour ||
      specialist.standardEndHour !== normalizedWorkingHours.endHour
        ? {
            from: {
              startHour: specialist.standardStartHour,
              endHour: specialist.standardEndHour,
            },
            to: {
              startHour: normalizedWorkingHours.startHour,
              endHour: normalizedWorkingHours.endHour,
            },
          }
        : null,
    capabilities:
      JSON.stringify(specialist.capabilities) !== JSON.stringify(input.capabilities)
        ? { from: specialist.capabilities, to: input.capabilities }
        : null,
    notes:
      (specialist.notes || null) !== normalizedNotes
        ? { from: specialist.notes || null, to: normalizedNotes }
        : null,
    calUserId:
      specialist.calUserId !== normalizedCalUserId
        ? { from: specialist.calUserId, to: normalizedCalUserId }
        : null,
    calIndividualEventTypeId:
      specialist.calIndividualEventTypeId !== normalizedIndividualEventTypeId
        ? {
            from: specialist.calIndividualEventTypeId,
            to: normalizedIndividualEventTypeId,
          }
        : null,
    calCouplesEventTypeId:
      (specialist.calCouplesEventTypeId || null) !== normalizedCouplesEventTypeId
        ? {
            from: specialist.calCouplesEventTypeId || null,
            to: normalizedCouplesEventTypeId,
          }
        : null,
  };

  return db.$transaction(async (tx) => {
    const updatedSpecialist = await tx.specialist.update({
      where: {
        id: specialist.id,
      },
      data: {
        name: normalizedName,
        email: normalizedEmail,
        supportsCouples: input.supportsCouples,
        active: input.active,
        standardStartHour: normalizedWorkingHours.startHour,
        standardEndHour: normalizedWorkingHours.endHour,
        capabilities: input.capabilities,
        notes: normalizedNotes,
        calUserId: normalizedCalUserId,
        calIndividualEventTypeId: normalizedIndividualEventTypeId,
        calCouplesEventTypeId: normalizedCouplesEventTypeId,
      },
    });

    if (specialist.userAccount) {
      await tx.userAccount.update({
        where: {
          id: specialist.userAccount.id,
        },
        data: {
          name: normalizedName,
          email: normalizedEmail,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "SPECIALIST_PROFILE_UPDATED",
        details: {
          specialistId: specialist.id,
          changedFields,
        },
      },
    });

    return updatedSpecialist;
  });
}

export async function getUpcomingSessionsForSpecialist(specialistId: string) {
  return db.session.findMany({
    where: {
      specialistId,
      providerStartTime: {
        gte: new Date(),
      },
      status: {
        in: [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION],
      },
    },
    include: {
      case: {
        include: {
          participants: {
            include: {
              client: true,
            },
          },
          documents: {
            include: {
              template: true,
            },
          },
          sessions: {
            include: {
              specialist: true,
            },
            orderBy: {
              providerStartTime: "asc",
            },
          },
        },
      },
    },
    orderBy: {
      providerStartTime: "asc",
    },
  });
}

export async function getSessionBriefingForSpecialist(
  sessionId: string,
  specialistId: string,
) {
  return db.session.findFirst({
    where: {
      id: sessionId,
      specialistId,
    },
    include: {
      specialist: true,
      case: {
        include: {
          participants: {
            include: {
              client: true,
            },
          },
          documents: {
            include: {
              template: true,
            },
            orderBy: {
              sentAt: "asc",
            },
          },
          sessions: {
            include: {
              specialist: true,
            },
            orderBy: {
              providerStartTime: "asc",
            },
          },
        },
      },
    },
  });
}

export async function listWorkflowTemplatesForOps() {
  return db.caseWorkflowTemplate.findMany({
    include: {
      steps: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ isDefault: "desc" }, { counsellingType: "asc" }, { name: "asc" }],
  });
}

export async function listDocumentTemplates() {
  return db.documentTemplate.findMany({
    orderBy: [{ triggerStatus: "asc" }, { name: "asc" }],
  });
}

export async function createWorkflowTemplate(input: {
  code: string;
  name: string;
  counsellingType: string;
  description?: string;
  isDefault?: boolean;
  actorUserId: string;
}) {
  const code = input.code.trim().toUpperCase();
  const counsellingType = input.counsellingType.trim().toLowerCase();

  if (!code || !input.name.trim() || !counsellingType) {
    throw new DomainError("Workflow code, name, and counselling type are required.", 409);
  }

  return db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.caseWorkflowTemplate.updateMany({
        where: {
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const created = await tx.caseWorkflowTemplate.create({
      data: {
        code,
        name: input.name.trim(),
        counsellingType,
        description: input.description?.trim() || null,
        isDefault: Boolean(input.isDefault),
        active: true,
      },
    });

    await createAuditLog(tx, {
      userId: input.actorUserId,
      action: "WORKFLOW_TEMPLATE_CREATED",
      details: {
        caseWorkflowTemplateId: created.id,
        code: created.code,
      },
    });

    return created;
  });
}

export async function addWorkflowStep(input: {
  caseWorkflowTemplateId: string;
  name: string;
  type: "FORM" | "REVIEW" | "SYSTEM";
  stepCode?: WorkflowStepCode | null;
  formType?: string;
  required?: boolean;
  requiresAllParticipants?: boolean;
  blocksScheduling?: boolean;
  sortOrder?: number;
  actorUserId: string;
}) {
  const template = await db.caseWorkflowTemplate.findUnique({
    where: {
      id: input.caseWorkflowTemplateId,
    },
    select: {
      id: true,
    },
  });

  if (!template) {
    throw new DomainError("Workflow template not found.", 404);
  }

  const step = await db.caseWorkflowStep.create({
    data: {
      templateId: input.caseWorkflowTemplateId,
      name: input.name.trim(),
      type: input.type,
      stepCode: input.stepCode ?? null,
      formType: input.type === "FORM" ? input.formType?.trim() || null : null,
      required: input.required ?? true,
      requiresAllParticipants: input.requiresAllParticipants ?? false,
      blocksScheduling: input.blocksScheduling ?? false,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  await db.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: "WORKFLOW_STEP_CREATED",
      details: {
        caseWorkflowTemplateId: input.caseWorkflowTemplateId,
        workflowStepId: step.id,
      },
    },
  });

  return step;
}

export async function updateWorkflowStep(input: {
  workflowStepId: string;
  caseWorkflowTemplateId: string;
  name: string;
  type: "FORM" | "REVIEW" | "SYSTEM";
  stepCode?: WorkflowStepCode | null;
  formType?: string;
  required?: boolean;
  requiresAllParticipants?: boolean;
  blocksScheduling?: boolean;
  sortOrder?: number;
  actorUserId: string;
}) {
  const existing = await db.caseWorkflowStep.findUnique({
    where: {
      id: input.workflowStepId,
    },
    select: {
      id: true,
      templateId: true,
      name: true,
      type: true,
      stepCode: true,
      formType: true,
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: true,
      sortOrder: true,
    },
  });

  if (!existing) {
    throw new DomainError("Workflow step not found.", 404);
  }

  if (existing.templateId !== input.caseWorkflowTemplateId) {
    throw new DomainError("Workflow step does not belong to selected template.", 409);
  }

  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new DomainError("Workflow step name is required.", 409);
  }

  const normalizedFormType = input.type === "FORM" ? input.formType?.trim() || null : null;
  const normalizedSortOrder = input.sortOrder ?? 0;

  const updated = await db.caseWorkflowStep.update({
    where: {
      id: existing.id,
    },
    data: {
      name: normalizedName,
      type: input.type,
      stepCode: input.stepCode ?? null,
      formType: normalizedFormType,
      required: input.required ?? true,
      requiresAllParticipants: input.requiresAllParticipants ?? false,
      blocksScheduling: input.blocksScheduling ?? false,
      sortOrder: normalizedSortOrder,
    },
  });

  await db.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: "WORKFLOW_STEP_UPDATED",
      details: {
        caseWorkflowTemplateId: input.caseWorkflowTemplateId,
        workflowStepId: existing.id,
        before: {
          name: existing.name,
          type: existing.type,
          stepCode: existing.stepCode,
          formType: existing.formType,
          required: existing.required,
          requiresAllParticipants: existing.requiresAllParticipants,
          blocksScheduling: existing.blocksScheduling,
          sortOrder: existing.sortOrder,
        },
        after: {
          name: updated.name,
          type: updated.type,
          stepCode: updated.stepCode,
          formType: updated.formType,
          required: updated.required,
          requiresAllParticipants: updated.requiresAllParticipants,
          blocksScheduling: updated.blocksScheduling,
          sortOrder: updated.sortOrder,
        },
      },
    },
  });

  return updated;
}

export async function assignWorkflowTemplateToCase(input: {
  caseId: string;
  caseWorkflowTemplateId: string;
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    const [caseRecord, template] = await Promise.all([
      tx.case.findUnique({
        where: {
          id: input.caseId,
        },
        select: {
          id: true,
          caseWorkflowTemplateId: true,
        },
      }),
      tx.caseWorkflowTemplate.findFirst({
        where: {
          id: input.caseWorkflowTemplateId,
          active: true,
        },
        select: {
          id: true,
          code: true,
          counsellingType: true,
        },
      }),
    ]);

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (!template) {
      throw new DomainError("Workflow template not found or inactive.", 404);
    }

    await tx.case.update({
      where: {
        id: input.caseId,
      },
      data: {
        caseWorkflowTemplateId: template.id,
        counsellingType: template.counsellingType,
      },
    });

    await tx.caseWorkflowState.deleteMany({
      where: {
        caseId: input.caseId,
      },
    });

    await initializeCaseWorkflowStates(tx, input.caseId, template.id);

    await createAuditLog(tx, {
      caseId: input.caseId,
      userId: input.actorUserId,
      action: "CASE_WORKFLOW_ASSIGNED",
      details: {
        previousWorkflowTemplateId: caseRecord.caseWorkflowTemplateId ?? null,
        caseWorkflowTemplateId: template.id,
        workflowCode: template.code,
      },
    });

    return tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        caseWorkflowTemplate: true,
        workflowStates: {
          include: {
            step: true,
          },
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });
  });
}

function normalizeFormType(formType: string) {
  return formType.trim().toUpperCase();
}

async function resolveCaseForFormSubmission(
  tx: Tx,
  input: {
    participantIdentifier?: string;
    caseId?: string;
    caseReference?: string;
  },
) {
  const participantIdentifier = input.participantIdentifier?.trim();
  const participantEmail = participantIdentifier?.includes("@")
    ? participantIdentifier.toLowerCase()
    : null;

  if (input.caseId?.trim()) {
    return tx.case.findFirst({
      where: {
        id: input.caseId.trim(),
        ...(participantIdentifier
          ? {
              participants: {
                some: {
                  client: participantEmail
                    ? { email: participantEmail }
                    : {
                        OR: [
                          { phone: participantIdentifier },
                          { email: participantIdentifier.toLowerCase() },
                        ],
                      },
                },
              },
            }
          : {}),
      },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        availabilityWindows: {
          where: {
            active: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
      },
    });
  }

  if (input.caseReference?.trim()) {
    return tx.case.findFirst({
      where: {
        reference: input.caseReference.trim().toUpperCase(),
        ...(participantIdentifier
          ? {
              participants: {
                some: {
                  client: participantEmail
                    ? { email: participantEmail }
                    : {
                        OR: [
                          { phone: participantIdentifier },
                          { email: participantIdentifier.toLowerCase() },
                        ],
                      },
                },
              },
            }
          : {}),
      },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        availabilityWindows: {
          where: {
            active: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
      },
    });
  }

  if (!participantIdentifier) {
    return null;
  }

  return tx.case.findFirst({
    where: {
      participants: {
        some: {
          client: participantEmail
            ? { email: participantEmail }
            : {
                OR: [
                  { phone: participantIdentifier },
                  { email: participantIdentifier.toLowerCase() },
                ],
              },
        },
      },
      status: {
        not: CaseStatus.CLOSED,
      },
    },
    include: {
      participants: {
        include: {
          client: true,
        },
      },
      availabilityWindows: {
        where: {
          active: true,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function ingestAvailabilitySubmission(input: {
  participantIdentifier: string;
  windows: AvailabilityWindowInput[];
  timezone?: string;
  caseId?: string;
  caseReference?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}) {
  return db.$transaction(async (tx) => {
    const participantIdentifier = input.participantIdentifier.trim();
    if (!participantIdentifier) {
      throw new DomainError("participantIdentifier is required.", 400);
    }

    if (!Array.isArray(input.windows)) {
      throw new DomainError("windows must be an array.", 400);
    }

    const normalizedWindows = normalizeAvailabilityRanges(input.windows);
    const timezone = input.timezone?.trim() || "UTC";
    const source = input.source?.trim() || "availability_form";
    const submittedAt = new Date();

    const caseRecord = await resolveCaseForFormSubmission(tx, {
      participantIdentifier,
      caseId: input.caseId,
      caseReference: input.caseReference,
    });

    if (!caseRecord) {
      throw new DomainError("No matching case found for availability submission.", 404);
    }

    const participant = findParticipantByIdentifier(caseRecord, participantIdentifier);
    if (!participant) {
      throw new DomainError("Participant was not found on this case.", 404);
    }

    const normalizedIdentifier = normalizeParticipantIdentifier(participantIdentifier);

    await tx.caseAvailabilityWindow.updateMany({
      where: {
        caseId: caseRecord.id,
        clientId: participant.clientId,
        active: true,
      },
      data: {
        active: false,
      },
    });

    await tx.caseAvailabilityWindow.createMany({
      data: normalizedWindows.map((window) => ({
        caseId: caseRecord.id,
        clientId: participant.clientId,
        startTime: window.startTime,
        endTime: window.endTime,
        timezone,
        source,
        submittedAt,
        active: true,
        metadata: {
          ...(input.metadata || {}),
          participantIdentifier: normalizedIdentifier,
          submittedAt: submittedAt.toISOString(),
        },
      })),
    });

    const refreshedCase = await tx.case.findUnique({
      where: {
        id: caseRecord.id,
      },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        availabilityWindows: {
          where: {
            active: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
      },
    });

    if (!refreshedCase) {
      throw new DomainError("Case not found after availability submission.", 404);
    }

    const participantCount = refreshedCase.participants.length;
    const durationMinutes = await resolveSessionDurationMinutes(
      refreshedCase.flags,
      participantCount,
    );
    const availability = computeCaseAvailability(refreshedCase, durationMinutes);

    const availabilityStep = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: refreshedCase.id,
        step: {
          stepCode: AVAILABILITY_CAPTURED_STEP_CODE,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    if (availabilityStep) {
      const shouldMarkCompleted =
        availability.participantsSubmitted >= availability.requiredParticipants &&
        availability.hasOverlap;

      await tx.caseWorkflowState.update({
        where: {
          id: availabilityStep.id,
        },
        data: {
          status: shouldMarkCompleted ? "COMPLETED" : "PENDING",
          completedAt: shouldMarkCompleted ? submittedAt : null,
          metadata: {
            ...(input.metadata || {}),
            source,
            stepCode: AVAILABILITY_CAPTURED_STEP_CODE,
            timezone,
            ingestedAt: submittedAt.toISOString(),
            participantIdentifier: normalizedIdentifier,
            participantsCompleted: availability.participantIdentifiersSubmitted,
            participantsSubmitted: availability.participantsSubmitted,
            requiredParticipants: availability.requiredParticipants,
            overlapWindowCount: availability.windows.length,
            overlapReason: availability.reason,
            submittedWindows: normalizedWindows.map((window) => ({
              startTime: window.startTime.toISOString(),
              endTime: window.endTime.toISOString(),
            })),
          },
        },
      });
    }

    await createAuditLog(tx, {
      caseId: refreshedCase.id,
      action: "AVAILABILITY_SUBMISSION_INGESTED",
      details: {
        caseReference: refreshedCase.reference,
        participantIdentifier: normalizedIdentifier,
        participantClientId: participant.clientId,
        submittedWindowCount: normalizedWindows.length,
        timezone,
        source,
        participantsSubmitted: availability.participantsSubmitted,
        requiredParticipants: availability.requiredParticipants,
        overlapWindowCount: availability.windows.length,
        overlapReason: availability.reason,
      },
    });

    const pendingBlockingSteps = await tx.caseWorkflowState.findMany({
      where: {
        caseId: refreshedCase.id,
        status: "PENDING",
        step: {
          required: true,
          blocksScheduling: true,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    return {
      caseId: refreshedCase.id,
      caseReference: refreshedCase.reference,
      participantClientId: participant.clientId,
      submittedWindowCount: normalizedWindows.length,
      participantsSubmitted: availability.participantsSubmitted,
      requiredParticipants: availability.requiredParticipants,
      overlapWindowCount: availability.windows.length,
      overlapReason: availability.reason,
      hasOverlap: availability.hasOverlap,
      eligibleForScheduling: pendingBlockingSteps.length === 0,
      pendingBlockingSteps: pendingBlockingSteps.map((state) => ({
        id: state.stepId,
        name: state.step.name,
        formType: state.step.formType,
        type: state.step.type,
      })),
    };
  });
}

export async function ingestAvailabilityPreferenceSubmission(input: {
  caseId?: string;
  caseReference?: string;
  participantIdentifiers: string[];
  timePreferences: string[];
  location?: string;
  includeOnline?: boolean;
  notes?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}) {
  return db.$transaction(async (tx) => {
    const caseId = input.caseId?.trim();
    const caseReference = input.caseReference?.trim().toUpperCase();
    if (!caseId && !caseReference) {
      throw new DomainError("caseId or caseReference is required.", 400);
    }

    const caseRecord = caseId
      ? await tx.case.findUnique({
          where: {
            id: caseId,
          },
          include: {
            participants: {
              include: {
                client: true,
              },
            },
          },
        })
      : await tx.case.findFirst({
          where: {
            reference: caseReference,
          },
          include: {
            participants: {
              include: {
                client: true,
              },
            },
          },
        });

    if (!caseRecord) {
      throw new DomainError("Case not found for availability preference submission.", 404);
    }

    const normalizedTimePreferences = Array.from(
      new Set(
        input.timePreferences
          .map((entry) => normalizeIntakeTimePreference(String(entry || "")))
          .filter((entry): entry is IntakeTimePreference => Boolean(entry)),
      ),
    );

    if (normalizedTimePreferences.length === 0) {
      throw new DomainError(
        "At least one time-of-day preference is required (morning/afternoon/evening).",
        400,
      );
    }

    const source = input.source?.trim() || "secure_intake";
    const submittedAt = new Date();
    const matchedParticipantIdentifiersSet = new Set<string>();
    for (const rawIdentifier of input.participantIdentifiers) {
      const identifier = rawIdentifier.trim();
      if (!identifier) {
        continue;
      }

      const participant = findParticipantByIdentifier(caseRecord, identifier);
      if (!participant) {
        continue;
      }

      matchedParticipantIdentifiersSet.add(
        normalizeParticipantIdentifier(participant.client.email),
      );
    }
    const matchedParticipantIdentifiers = Array.from(matchedParticipantIdentifiersSet);

    if (matchedParticipantIdentifiers.length === 0) {
      throw new DomainError("No matching participant found for availability preference submission.", 404);
    }

    const availabilityStep = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: caseRecord.id,
        step: {
          stepCode: AVAILABILITY_CAPTURED_STEP_CODE,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    if (availabilityStep) {
      const requiresAllParticipants = stepRequiresAllParticipants(availabilityStep.step);
      const existingParticipantCompletions = Array.isArray(
        (availabilityStep.metadata as { participantsCompleted?: unknown } | null)
          ?.participantsCompleted,
      )
        ? (
            (availabilityStep.metadata as { participantsCompleted: unknown[] })
              .participantsCompleted
          )
            .map((value) => String(value))
            .map((value) => normalizeParticipantIdentifier(value))
        : [];

      const participantCompletions = Array.from(
        new Set([...existingParticipantCompletions, ...matchedParticipantIdentifiers]),
      );

      const shouldMarkCompleted =
        !requiresAllParticipants ||
        participantCompletions.length >= caseRecord.participants.length;

      await tx.caseWorkflowState.update({
        where: {
          id: availabilityStep.id,
        },
        data: {
          status: shouldMarkCompleted ? "COMPLETED" : "PENDING",
          completedAt: shouldMarkCompleted ? submittedAt : null,
          metadata: {
            ...(input.metadata || {}),
            source,
            stepCode: AVAILABILITY_CAPTURED_STEP_CODE,
            ingestedAt: submittedAt.toISOString(),
            mode: "manual_assignment_preferences",
            location: input.location || null,
            includeOnline: Boolean(input.includeOnline),
            notes: input.notes || null,
            timePreferences: normalizedTimePreferences,
            participantsCompleted: participantCompletions,
          },
        },
      });
    }

    await createAuditLog(tx, {
      caseId: caseRecord.id,
      action: "AVAILABILITY_PREFERENCE_SUBMISSION_INGESTED",
      details: {
        caseReference: caseRecord.reference,
        source,
        location: input.location || null,
        includeOnline: Boolean(input.includeOnline),
        timePreferences: normalizedTimePreferences,
        participantsCompleted: matchedParticipantIdentifiers,
      },
    });

    const pendingBlockingSteps = await tx.caseWorkflowState.findMany({
      where: {
        caseId: caseRecord.id,
        status: "PENDING",
        step: {
          required: true,
          blocksScheduling: true,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    return {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantCompletions: matchedParticipantIdentifiers.length,
      requiredParticipantCompletions: caseRecord.participants.length,
      eligibleForScheduling: pendingBlockingSteps.length === 0,
      pendingBlockingSteps: pendingBlockingSteps.map((state) => ({
        id: state.stepId,
        name: state.step.name,
        formType: state.step.formType,
        type: state.step.type,
      })),
      timePreferences: normalizedTimePreferences,
    };
  });
}

export async function getCaseSchedulingEligibility(caseId: string) {
  const pendingBlockingSteps = await db.caseWorkflowState.findMany({
    where: {
      caseId,
      status: "PENDING",
      step: {
        required: true,
        blocksScheduling: true,
      },
    },
    include: {
      step: true,
    },
    orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });

  return {
    eligible: pendingBlockingSteps.length === 0,
    pendingBlockingSteps: pendingBlockingSteps.map((state) => ({
      stepId: state.stepId,
      name: state.step.name,
      formType: state.step.formType,
      type: state.step.type,
    })),
  };
}

export async function ingestFormSubmission(input: {
  formType: string;
  participantIdentifier: string;
  caseId?: string;
  caseReference?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}) {
  return db.$transaction(async (tx) => {
    const formType = normalizeFormType(input.formType);
    const participantIdentifier = input.participantIdentifier.trim();
    const source = input.source || "external_form";
    const submittedAt = new Date();
    if (!formType) {
      throw new DomainError("formType is required.", 400);
    }
    if (formType === AVAILABILITY_SUBMISSION_FORM_TYPE) {
      throw new DomainError(
        "Use /availability/submission for availability windows.",
        409,
      );
    }
    if (!participantIdentifier) {
      throw new DomainError("participantIdentifier is required.", 400);
    }

    const caseRecord = await resolveCaseForFormSubmission(tx, {
      participantIdentifier,
      caseId: input.caseId,
      caseReference: input.caseReference,
    });

    if (!caseRecord) {
      throw new DomainError("No matching case found for form submission.", 404);
    }

    if (
      formType === DOCUMENT_CODES.TERMS_AND_CONDITIONS &&
      !TERMS_SUBMISSION_ALLOWED_STATUSES.includes(caseRecord.status)
    ) {
      throw new DomainError(
        "Terms of Counselling can only be completed after a session has been booked.",
        409,
      );
    }
    const formStepCode = workflowStepCodeForFormType(formType);
    const formStepMatcher = [
      ...(formStepCode
        ? [
            {
              stepCode: formStepCode,
            },
          ]
        : []),
      {
        formType: {
          equals: formType,
          mode: "insensitive" as const,
        },
      },
      {
        name: {
          equals: formType,
          mode: "insensitive" as const,
        },
      },
    ];

    const pendingState = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: caseRecord.id,
        status: "PENDING",
        step: {
          type: "FORM",
          OR: formStepMatcher,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    const existingCompleted = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: caseRecord.id,
        status: "COMPLETED",
        step: {
          type: "FORM",
          OR: formStepMatcher,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { completedAt: "desc" }],
    });

    const targetState = pendingState ?? existingCompleted;
    if (!targetState) {
      throw new DomainError(
        `No workflow form step matches formType '${formType}' for case ${caseRecord.reference}.`,
        409,
      );
    }

    const participantCount = caseRecord.participants.length;
    const requiresAllParticipants = stepRequiresAllParticipants(targetState.step);
    const normalizedIdentifier = normalizeParticipantIdentifier(participantIdentifier);
    const existingParticipantCompletions = Array.isArray(
      (targetState.metadata as { participantsCompleted?: unknown } | null)?.participantsCompleted,
    )
      ? (
          (targetState.metadata as { participantsCompleted: unknown[] }).participantsCompleted
        )
          .map((value) => String(value))
          .map((value) => normalizeParticipantIdentifier(value))
      : [];

    const participantCompletions = Array.from(
      new Set([...existingParticipantCompletions, normalizedIdentifier]),
    );
    const shouldMarkCompleted =
      targetState.status === "COMPLETED" ||
      !requiresAllParticipants ||
      participantCompletions.length >= participantCount;

    const updated =
      targetState.status === "PENDING"
        ? await tx.caseWorkflowState.update({
            where: {
              id: targetState.id,
            },
            data: {
              status: shouldMarkCompleted ? "COMPLETED" : "PENDING",
              completedAt: shouldMarkCompleted ? submittedAt : null,
              metadata: {
                ...(input.metadata || {}),
                source,
                formType,
                ingestedAt: submittedAt.toISOString(),
                participantIdentifier: normalizedIdentifier,
                participantsCompleted: participantCompletions,
              },
            },
            include: {
              step: true,
            },
          })
        : targetState;

    const documentCompletion = shouldMarkCompleted
      ? await completeDocumentFromFormSubmission(tx, {
          caseId: caseRecord.id,
          formType,
          source,
          participantIdentifier: normalizedIdentifier,
        })
      : null;

    await createAuditLog(tx, {
      caseId: caseRecord.id,
      action: "FORM_SUBMISSION_INGESTED",
      details: {
        caseReference: caseRecord.reference,
        formType,
        workflowStepId: updated.stepId,
        participantIdentifier: normalizedIdentifier,
        source,
        documentCompletion,
      },
    });

    const pendingBlockingSteps = await tx.caseWorkflowState.findMany({
      where: {
        caseId: caseRecord.id,
        status: "PENDING",
        step: {
          required: true,
          blocksScheduling: true,
        },
      },
      include: {
        step: true,
      },
      orderBy: [{ step: { sortOrder: "asc" } }, { createdAt: "asc" }],
    });

    return {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      completedStep: {
        id: updated.stepId,
        name: updated.step.name,
        formType: updated.step.formType,
      },
      eligibleForScheduling: pendingBlockingSteps.length === 0,
      pendingBlockingSteps: pendingBlockingSteps.map((state) => ({
        id: state.stepId,
        name: state.step.name,
        formType: state.step.formType,
        type: state.step.type,
      })),
      requiresAllParticipants,
      participantCompletions: requiresAllParticipants ? participantCompletions.length : 1,
      requiredParticipantCompletions: requiresAllParticipants ? participantCount : 1,
      alreadyCompleted: targetState.status === "COMPLETED" && requiresAllParticipants
        ? participantCompletions.length >= participantCount
        : targetState.status === "COMPLETED",
      documentCompletion,
    };
  });
}

export async function getCaseStatusOptions(current: CaseStatus) {
  return CASE_TRANSITIONS[current];
}

export async function transitionToStatusIfAllowed(input: {
  caseId: string;
  targetStatus: CaseStatus;
  actorUserId?: string;
  reason?: string;
}) {
  return transitionCaseStatus(input);
}

export async function markDocumentComplete(input: {
  documentId: string;
  actorUserId?: string;
}) {
  return completeDocumentInstance(input.documentId, input.actorUserId);
}

export async function canUserOverride(userId: string) {
  const operationsUser = await db.operationsUser.findFirst({
    where: {
      userId,
      canOverride: true,
    },
    select: {
      id: true,
    },
  });

  return Boolean(operationsUser);
}

export async function appendCaseAuditLog(input: {
  caseId: string;
  userId?: string;
  action: string;
  details?: Prisma.InputJsonValue;
}) {
  await db.auditLog.create({
    data: {
      caseId: input.caseId,
      userId: input.userId,
      action: input.action,
      details: input.details,
    },
  });
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function domainErrorMessage(error: unknown) {
  if (error instanceof DomainError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export function isCoupleCase(participantCount: number) {
  return participantCount === 2;
}

export async function getRequiredDocumentCodesForStatus(status: CaseStatus) {
  return resolveRequiredDocumentCodesForStatus(status);
}

export function getDocumentCodeFriendlyName(code: string) {
  switch (code) {
    case DOCUMENT_CODES.TERMS_AND_CONDITIONS:
      return "Terms & Conditions";
    case DOCUMENT_CODES.CONTRACT:
      return "Contract";
    case DOCUMENT_CODES.INTAKE_FORM:
      return "Intake Form";
    case DOCUMENT_CODES.OUTTAKE_FORM:
      return "Outtake Form";
    default:
      return code;
  }
}
