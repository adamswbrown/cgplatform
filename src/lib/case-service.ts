import { hash } from "bcryptjs";
import {
  CaseStatus,
  DocumentState,
  Prisma,
  SessionStatus,
  UserRole,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createSchedulingProvider } from "@/lib/scheduling";
import type { SchedulingCaseData, SchedulingEventType } from "@/lib/scheduling/types";
import {
  CASE_TRANSITIONS,
  DOCUMENT_CODES,
  REQUIRED_DOCUMENTS_TO_ENTER,
} from "@/lib/workflow";

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
};

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION];
const AVAILABILITY_SUBMISSION_FORM_TYPE = "AVAILABILITY_SUBMISSION";

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

function stepRequiresAllParticipants(stepName: string) {
  return stepName.toLowerCase().includes("both participants");
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

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
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

async function ensureRequiredDocumentsCompleted(
  tx: Tx,
  caseId: string,
  targetStatus: CaseStatus,
) {
  const requiredCodes = REQUIRED_DOCUMENTS_TO_ENTER[targetStatus] ?? [];

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

function resolveSessionDurationMinutes(flags: string[], participantCount: number) {
  const durationFlag = flags.find((flag) => flag.startsWith("duration:"));
  if (durationFlag) {
    const parsed = Number(durationFlag.split(":")[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new DomainError(`Invalid duration flag '${durationFlag}'.`, 409);
    }

    return Math.round(parsed);
  }

  return participantCount === 2 ? 60 : 40;
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
  const participantCount = input.secondary ? 2 : 1;
  const counsellingType = normalizeCounsellingType(input.counsellingType, participantCount);
  const initialStatus = input.initialStatus ?? CaseStatus.NEW;
  const intakeSource = input.intakeSource?.trim() || "WEB_FORM";
  const intakeDocumentTriggerStatus =
    initialStatus === CaseStatus.AWAITING_REVIEW ? CaseStatus.NEW : initialStatus;

  const durationFlag =
    typeof input.requestedDurationMinutes === "number"
      ? [`duration:${Math.round(input.requestedDurationMinutes)}`]
      : [];

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
        caseWorkflowTemplateId: workflow.id,
        notes: input.notes?.trim() || null,
        flags: [input.secondary ? "couple" : "individual", `workflow:${workflow.code}`, ...durationFlag],
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
    const schedulingProvider = createSchedulingProvider(tx);
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
    const durationMinutes = resolveSessionDurationMinutes(caseRecord.flags, participantCount);
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
          ? "No active specialists available for couples."
          : "No active specialists available.",
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
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    const schedulingProvider = createSchedulingProvider(tx);
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
      },
    });

    if (!specialist) {
      throw new DomainError("Specialist not found.", 404);
    }

    const participantCount = caseRecord.participants.length;
    const eventType = resolveSchedulingEventType(specialist, participantCount);
    const durationMinutes = resolveSessionDurationMinutes(caseRecord.flags, participantCount);
    const caseAvailability = computeCaseAvailability(caseRecord, durationMinutes);

    await assertCaseEligibleForScheduling(tx, input.caseId);

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

    const availableSlots = await schedulingProvider.getAvailableSlots(
      specialist.id,
      eventType,
      durationMinutes,
    );

    const earliestSlot = availableSlots.find((slot) =>
      slotFitsAvailability(slot, durationMinutes, caseAvailability.windows),
    );

    if (!earliestSlot) {
      throw new DomainError(
        `No provider slots for specialist ${specialist.name} fit the submitted client availability windows.`,
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
        overlapWindowCount: caseAvailability.windows.length,
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
    include: {
      caseWorkflowTemplate: true,
      participants: {
        include: {
          client: true,
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
        include: {
          step: true,
        },
      },
      assignedSpecialist: true,
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
      documents: {
        include: {
          template: true,
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
    include: {
      participants: {
        include: {
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
    include: {
      participants: {
        where: {
          case: {
            assignedSpecialistId: specialistId,
          },
        },
        include: {
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              sessions: {
                where: {
                  specialistId,
                },
                orderBy: {
                  providerStartTime: "asc",
                },
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
    include: {
      sessions: {
        where: {
          providerStartTime: {
            gte: new Date(),
          },
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
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
}) {
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedCalUserId = input.calUserId.trim();

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
    throw new DomainError("Another specialist already uses this Cal.com user id.", 409);
  }

  const passwordHash = await hash(input.password || "password123", 10);

  return db.specialist.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      supportsCouples: input.supportsCouples,
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
      "Couples event type id is required for specialists that support couples.",
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
    throw new DomainError("Specialist not found.", 404);
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
    throw new DomainError("Another specialist already uses this email.", 409);
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
    throw new DomainError("Another specialist already uses this Cal.com user id.", 409);
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
  formType?: string;
  required?: boolean;
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
      formType: input.formType?.trim() || null,
      required: input.required ?? true,
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
    const durationMinutes = resolveSessionDurationMinutes(refreshedCase.flags, participantCount);
    const availability = computeCaseAvailability(refreshedCase, durationMinutes);

    const availabilityStep = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: refreshedCase.id,
        step: {
          type: "FORM",
          OR: [
            {
              formType: {
                equals: AVAILABILITY_SUBMISSION_FORM_TYPE,
                mode: "insensitive",
              },
            },
            {
              name: {
                equals: AVAILABILITY_SUBMISSION_FORM_TYPE,
                mode: "insensitive",
              },
            },
          ],
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
            formType: AVAILABILITY_SUBMISSION_FORM_TYPE,
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

    const pendingState = await tx.caseWorkflowState.findFirst({
      where: {
        caseId: caseRecord.id,
        status: "PENDING",
        step: {
          type: "FORM",
          OR: [
            {
              formType: {
                equals: formType,
                mode: "insensitive",
              },
            },
            {
              name: {
                equals: formType,
                mode: "insensitive",
              },
            },
          ],
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
          OR: [
            {
              formType: {
                equals: formType,
                mode: "insensitive",
              },
            },
            {
              name: {
                equals: formType,
                mode: "insensitive",
              },
            },
          ],
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
    const requiresAllParticipants = stepRequiresAllParticipants(targetState.step.name);
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
              completedAt: shouldMarkCompleted ? new Date() : null,
              metadata: {
                ...(input.metadata || {}),
                source: input.source || "external_form",
                formType,
                ingestedAt: new Date().toISOString(),
                participantIdentifier: normalizedIdentifier,
                participantsCompleted: participantCompletions,
              },
            },
            include: {
              step: true,
            },
          })
        : targetState;

    await createAuditLog(tx, {
      caseId: caseRecord.id,
      action: "FORM_SUBMISSION_INGESTED",
      details: {
        caseReference: caseRecord.reference,
        formType,
        workflowStepId: updated.stepId,
        participantIdentifier: normalizedIdentifier,
        source: input.source || "external_form",
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

export function getRequiredDocumentCodesForStatus(status: CaseStatus) {
  return REQUIRED_DOCUMENTS_TO_ENTER[status] ?? [];
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
