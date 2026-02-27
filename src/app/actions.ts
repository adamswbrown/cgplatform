"use server";

import { CaseStatus, EmailStatus, EmailType, TriageDecision, UserRole, WorkflowStepCode } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addWorkflowStep,
  allocateCaseAutomatically,
  assignWorkflowTemplateToCase,
  canUserOverride,
  completeDocumentInstance,
  createWorkflowTemplate,
  createWorkflowTemplateFromPreset,
  createCaseFromIntake,
  createSpecialist,
  domainErrorMessage,
  isDomainError,
  overrideCaseAssignment,
  proposeCaseToCounsellor,
  proposeSlot,
  transitionCaseStatus,
  triageCase,
  updateCaseIntakeReviewNotes,
  updateSpecialistProfile,
  updateWorkflowStep,
} from "@/lib/case-service";
import { markAllRead, markRead } from "@/lib/notification-service";
import {
  destinationForUserRole,
  requirePageUser,
  signInWithPassword,
  signOut,
} from "@/lib/auth";
import {
  getOperationalSettings,
  normalizeIntakeSourceType,
  normalizeSchedulingEngineType,
  updateOperationalSettings,
} from "@/lib/admin-settings";
import { issueFormPin, issueIntakeAccessInvite, revokeFormPin } from "@/lib/form-access";
import { updateIntakeFormContent } from "@/lib/intake-settings";
import { updateIntegrationSettings } from "@/lib/integration-settings";
import { logEmail, sendFormPinEmail, sendIntakeAccessInviteEmail } from "@/lib/mailer";

const intakeSchema = z
  .object({
    participantType: z.enum(["single", "couple"]),
    primaryFirstName: z.string().min(1),
    primaryLastName: z.string().min(1),
    primaryEmail: z.string().email(),
    primaryPhone: z.string().optional(),
    secondaryFirstName: z.string().optional(),
    secondaryLastName: z.string().optional(),
    secondaryEmail: z.string().optional(),
    secondaryPhone: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.participantType === "couple") {
      if (!value.secondaryFirstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary first name is required for couples.",
          path: ["secondaryFirstName"],
        });
      }

      if (!value.secondaryLastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary last name is required for couples.",
          path: ["secondaryLastName"],
        });
      }

      if (!value.secondaryEmail?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary email is required for couples.",
          path: ["secondaryEmail"],
        });
      }
    }
  });

function encodeErrorPath(path: string, error: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(error)}`;
}

function appendQuery(path: string, key: string, value: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function isNextRedirectError(error: unknown): error is { digest: string } {
  if (!error || typeof error !== "object" || !("digest" in error)) {
    return false;
  }

  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function redirectWithActionError(redirectTo: string, error: unknown): never {
  if (isNextRedirectError(error)) {
    throw error;
  }

  redirect(encodeErrorPath(redirectTo, domainErrorMessage(error)));
}

function parsePositiveIntegerField(
  formData: FormData,
  key: string,
  label: string,
) {
  const raw = String(formData.get(key) || "").trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return Math.round(value);
}

function parseIntegerField(
  formData: FormData,
  key: string,
  label: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  const raw = String(formData.get(key) || "").trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }

  const rounded = Math.round(value);
  if (typeof options.min === "number" && rounded < options.min) {
    throw new Error(`${label} must be at least ${options.min}.`);
  }
  if (typeof options.max === "number" && rounded > options.max) {
    throw new Error(`${label} must be at most ${options.max}.`);
  }

  return rounded;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();

  const user = await signInWithPassword(email, password);

  if (!user) {
    redirect(encodeErrorPath("/login", "Invalid email or password."));
  }

  redirect(destinationForUserRole(user.role));
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

export async function submitIntakeAction(formData: FormData) {
  const operationalSettings = await getOperationalSettings();
  const parsed = intakeSchema.safeParse({
    participantType: String(formData.get("participantType") || "single"),
    primaryFirstName: String(formData.get("primaryFirstName") || ""),
    primaryLastName: String(formData.get("primaryLastName") || ""),
    primaryEmail: String(formData.get("primaryEmail") || ""),
    primaryPhone: String(formData.get("primaryPhone") || ""),
    secondaryFirstName: String(formData.get("secondaryFirstName") || ""),
    secondaryLastName: String(formData.get("secondaryLastName") || ""),
    secondaryEmail: String(formData.get("secondaryEmail") || ""),
    secondaryPhone: String(formData.get("secondaryPhone") || ""),
    notes: String(formData.get("notes") || ""),
  });

  if (!parsed.success) {
    redirect(encodeErrorPath("/intake", parsed.error.issues[0]?.message || "Invalid form data."));
  }

  const result = await createCaseFromIntake({
    primary: {
      firstName: parsed.data.primaryFirstName,
      lastName: parsed.data.primaryLastName,
      email: parsed.data.primaryEmail,
      phone: parsed.data.primaryPhone,
    },
    secondary:
      parsed.data.participantType === "couple"
        ? {
            firstName: parsed.data.secondaryFirstName || "",
            lastName: parsed.data.secondaryLastName || "",
            email: parsed.data.secondaryEmail || "",
            phone: parsed.data.secondaryPhone,
          }
        : undefined,
    notes: parsed.data.notes,
    initialStatus: CaseStatus.AWAITING_REVIEW,
    intakeSource: operationalSettings.defaultIntakeSource,
    autoAllocate: false,
  });

  const query = new URLSearchParams({
    case: result.reference,
    caseId: result.caseId,
  });

  if (result.allocationError) {
    query.set("allocation", result.allocationError);
  }

  redirect(`/intake/success?${query.toString()}`);
}

export async function autoAllocateCaseAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "");
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  try {
    await allocateCaseAutomatically(caseId, user.id);
    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function transitionCaseAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "");
  const targetStatus = String(formData.get("targetStatus") || "") as CaseStatus;
  const reason = String(formData.get("reason") || "");
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  if (!Object.values(CaseStatus).includes(targetStatus)) {
    redirect(encodeErrorPath(redirectTo, "Invalid target status."));
  }

  try {
    await transitionCaseStatus({
      caseId,
      targetStatus,
      reason,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function updateCaseIntakeReviewNotesAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const notes = String(formData.get("notes") || "");
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}?panel=intake`);

  if (!caseId) {
    redirect(encodeErrorPath(redirectTo, "Case is required."));
  }

  try {
    await updateCaseIntakeReviewNotes({
      caseId,
      notes,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(`/admin/cases/${caseId}`);
    revalidatePath(redirectTo);
    redirect(appendQuery(redirectTo, "intakeNotesSaved", "1"));
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function completeDocumentAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const documentId = String(formData.get("documentId") || "");
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  try {
    await completeDocumentInstance(documentId, user.id);
    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function overrideAssignmentAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "");
  const specialistId = String(formData.get("specialistId") || "");
  const reason = String(formData.get("reason") || "").trim();
  const matchingRuleOverride = String(formData.get("matchingRuleOverride") || "").trim();
  const preferredTimeBlockRaw = String(formData.get("preferredTimeBlock") || "")
    .trim()
    .toUpperCase();
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  if (!reason) {
    redirect(encodeErrorPath(redirectTo, "Override reason is required."));
  }

  const allowed = await canUserOverride(user.id);
  if (!allowed) {
    redirect(encodeErrorPath(redirectTo, "You are not allowed to override assignments."));
  }

  try {
    await overrideCaseAssignment({
      caseId,
      specialistId,
      reason,
      matchingRuleOverride: matchingRuleOverride || undefined,
      preferredTimeBlock:
        preferredTimeBlockRaw === "MORNING" ||
        preferredTimeBlockRaw === "AFTERNOON" ||
        preferredTimeBlockRaw === "EVENING"
          ? preferredTimeBlockRaw
          : undefined,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function createSpecialistAction(formData: FormData) {
  await requirePageUser([UserRole.OPS]);
  const operationalSettings = await getOperationalSettings();
  const schedulingEngineType = operationalSettings.schedulingEngineType;

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const supportsCouples = String(formData.get("supportsCouples") || "") === "on";
  const capabilities = String(formData.get("capabilities") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const password = String(formData.get("password") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const calUserId = String(formData.get("calUserId") || "").trim();
  const calIndividualEventTypeId = String(formData.get("calIndividualEventTypeId") || "").trim();
  const calCouplesEventTypeId = String(formData.get("calCouplesEventTypeId") || "").trim();
  const microsoftBookingsBusinessId = String(
    formData.get("microsoftBookingsBusinessId") || "",
  ).trim();
  const microsoftBookingsStaffId = String(formData.get("microsoftBookingsStaffId") || "").trim();
  const microsoftBookingsIndividualServiceId = String(
    formData.get("microsoftBookingsIndividualServiceId") || "",
  ).trim();
  const microsoftBookingsCouplesServiceId = String(
    formData.get("microsoftBookingsCouplesServiceId") || "",
  ).trim();
  const redirectTo = String(formData.get("redirectTo") || "/admin/specialists");
  let standardStartHour = 9;
  let standardEndHour = 18;
  try {
    standardStartHour = parseIntegerField(formData, "standardStartHour", "Standard start hour", {
      min: 0,
      max: 22,
    });
    standardEndHour = parseIntegerField(formData, "standardEndHour", "Standard end hour", {
      min: 1,
      max: 23,
    });
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  if (!name || !email) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Name and email are required.",
      ),
    );
  }

  if (
    schedulingEngineType === "calcom" &&
    (!calUserId || !calIndividualEventTypeId)
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Cal.com user id and individual event type id are required when the scheduling engine is Cal.com.",
      ),
    );
  }

  if (
    schedulingEngineType === "calcom" &&
    supportsCouples &&
    !calCouplesEventTypeId
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Cal.com couples event type id is required when counsellor supports couples.",
      ),
    );
  }

  if (
    schedulingEngineType === "microsoft_bookings" &&
    (!microsoftBookingsStaffId || !microsoftBookingsIndividualServiceId)
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Microsoft Bookings staff id and individual service id are required when the scheduling engine is Microsoft Bookings.",
      ),
    );
  }

  if (
    schedulingEngineType === "microsoft_bookings" &&
    supportsCouples &&
    !microsoftBookingsCouplesServiceId
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Microsoft Bookings couples service id is required when counsellor supports couples.",
      ),
    );
  }

  if (standardEndHour <= standardStartHour) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Standard end hour must be after standard start hour.",
      ),
    );
  }

  try {
    await createSpecialist({
      name,
      email,
      supportsCouples,
      capabilities,
      password: password || undefined,
      notes: notes || undefined,
      calUserId,
      calIndividualEventTypeId,
      calCouplesEventTypeId: calCouplesEventTypeId || undefined,
      microsoftBookingsBusinessId: microsoftBookingsBusinessId || undefined,
      microsoftBookingsStaffId: microsoftBookingsStaffId || undefined,
      microsoftBookingsIndividualServiceId:
        microsoftBookingsIndividualServiceId || undefined,
      microsoftBookingsCouplesServiceId: microsoftBookingsCouplesServiceId || undefined,
      standardStartHour,
      standardEndHour,
    });

    revalidatePath("/admin/specialists");
    redirect(redirectTo);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    if (isDomainError(error)) {
      redirect(encodeErrorPath(redirectTo, error.message));
    }

    redirect(encodeErrorPath(redirectTo, "Failed to create counsellor."));
  }
}

export async function updateSpecialistProfileAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const operationalSettings = await getOperationalSettings();
  const schedulingEngineType = operationalSettings.schedulingEngineType;

  const specialistId = String(formData.get("specialistId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const supportsCouples = String(formData.get("supportsCouples") || "") === "on";
  const active = String(formData.get("active") || "") === "on";
  const capabilities = String(formData.get("capabilities") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const notes = String(formData.get("notes") || "").trim();
  const calUserId = String(formData.get("calUserId") || "").trim();
  const calIndividualEventTypeId = String(formData.get("calIndividualEventTypeId") || "").trim();
  const calCouplesEventTypeId = String(formData.get("calCouplesEventTypeId") || "").trim();
  const microsoftBookingsBusinessId = String(
    formData.get("microsoftBookingsBusinessId") || "",
  ).trim();
  const microsoftBookingsStaffId = String(formData.get("microsoftBookingsStaffId") || "").trim();
  const microsoftBookingsIndividualServiceId = String(
    formData.get("microsoftBookingsIndividualServiceId") || "",
  ).trim();
  const microsoftBookingsCouplesServiceId = String(
    formData.get("microsoftBookingsCouplesServiceId") || "",
  ).trim();
  const redirectTo = String(formData.get("redirectTo") || `/admin/specialists/${specialistId}`);
  let standardStartHour = 9;
  let standardEndHour = 18;
  try {
    standardStartHour = parseIntegerField(formData, "standardStartHour", "Standard start hour", {
      min: 0,
      max: 22,
    });
    standardEndHour = parseIntegerField(formData, "standardEndHour", "Standard end hour", {
      min: 1,
      max: 23,
    });
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  if (!specialistId || !name || !email) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Counsellor id, name, and email are required.",
      ),
    );
  }

  if (
    schedulingEngineType === "calcom" &&
    (!calUserId || !calIndividualEventTypeId)
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Cal.com user id and individual event type id are required when the scheduling engine is Cal.com.",
      ),
    );
  }

  if (
    schedulingEngineType === "calcom" &&
    supportsCouples &&
    !calCouplesEventTypeId
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Cal.com couples event type id is required when counsellor supports couples.",
      ),
    );
  }

  if (
    schedulingEngineType === "microsoft_bookings" &&
    (!microsoftBookingsStaffId || !microsoftBookingsIndividualServiceId)
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Microsoft Bookings staff id and individual service id are required when the scheduling engine is Microsoft Bookings.",
      ),
    );
  }

  if (
    schedulingEngineType === "microsoft_bookings" &&
    supportsCouples &&
    !microsoftBookingsCouplesServiceId
  ) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Microsoft Bookings couples service id is required when counsellor supports couples.",
      ),
    );
  }

  if (standardEndHour <= standardStartHour) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Standard end hour must be after standard start hour.",
      ),
    );
  }

  let destination = appendQuery(redirectTo, "updated", "1");

  try {
    await updateSpecialistProfile({
      specialistId,
      name,
      email,
      supportsCouples,
      active,
      capabilities,
      notes: notes || undefined,
      calUserId,
      calIndividualEventTypeId,
      calCouplesEventTypeId: calCouplesEventTypeId || undefined,
      microsoftBookingsBusinessId: microsoftBookingsBusinessId || undefined,
      microsoftBookingsStaffId: microsoftBookingsStaffId || undefined,
      microsoftBookingsIndividualServiceId:
        microsoftBookingsIndividualServiceId || undefined,
      microsoftBookingsCouplesServiceId: microsoftBookingsCouplesServiceId || undefined,
      standardStartHour,
      standardEndHour,
      actorUserId: user.id,
    });

    revalidatePath("/admin/specialists");
    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
  } catch (error) {
    if (isDomainError(error)) {
      destination = encodeErrorPath(redirectTo, error.message);
    } else {
      destination = encodeErrorPath(redirectTo, "Failed to update counsellor profile.");
    }
  }

  redirect(destination);
}

export async function updateIntakeFormContentAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const redirectTo = String(formData.get("redirectTo") || "/admin/settings/intake");

  const crisisContactsRaw = String(formData.get("crisisContactsJson") || "").trim();
  const availabilityNotesRaw = String(formData.get("availabilityNotesJson") || "").trim();

  let crisisContacts: unknown[];
  let availabilityNotes: unknown[];

  if (crisisContactsRaw) {
    try {
      crisisContacts = JSON.parse(crisisContactsRaw || "[]");
    } catch {
      redirect(encodeErrorPath(redirectTo, "Crisis contacts data is invalid."));
    }
  } else {
    const labels = formData.getAll("crisisContactLabel").map((value) => String(value).trim());
    const phones = formData.getAll("crisisContactPhone").map((value) => String(value).trim());
    const descriptions = formData
      .getAll("crisisContactDescription")
      .map((value) => String(value).trim());

    crisisContacts = labels.map((label, index) => ({
      label,
      phone: phones[index] || "",
      description: descriptions[index] || "",
    }));
  }

  if (availabilityNotesRaw) {
    try {
      availabilityNotes = JSON.parse(availabilityNotesRaw || "[]");
    } catch {
      redirect(encodeErrorPath(redirectTo, "Availability notes data is invalid."));
    }
  } else {
    const titles = formData.getAll("availabilityNoteTitle").map((value) => String(value).trim());
    const bodies = formData.getAll("availabilityNoteBody").map((value) => String(value).trim());

    availabilityNotes = titles.map((title, index) => ({
      title,
      body: bodies[index] || "",
    }));
  }

  try {
    await updateIntakeFormContent(
      {
        crisisModal: {
          title: String(formData.get("crisisTitle") || "").trim(),
          intro: String(formData.get("crisisIntro") || "").trim(),
          contacts: crisisContacts as Array<{
            label: string;
            phone: string;
            description: string;
          }>,
        },
        availability: {
          heading: String(formData.get("availabilityHeading") || "").trim(),
          subheading: String(formData.get("availabilitySubheading") || "").trim(),
          notes: availabilityNotes as Array<{
            title: string;
            body: string;
          }>,
          disclaimer: String(formData.get("availabilityDisclaimer") || "").trim(),
          prompt: String(formData.get("availabilityPrompt") || "").trim(),
        },
      },
      user.id,
    );
  } catch (error) {
    if (isDomainError(error)) {
      redirect(encodeErrorPath(redirectTo, error.message));
    }

    redirect(encodeErrorPath(redirectTo, "Failed to update intake form content."));
  }

  revalidatePath("/intake");
  revalidatePath("/intake/success");
  revalidatePath("/admin/settings/intake");
  redirect(appendQuery("/admin/settings/intake", "saved", "1"));
}

export async function updateOperationalSettingsAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const redirectTo = String(formData.get("redirectTo") || "/admin/settings/operations");

  try {
    const schedulingAssignmentMode = String(
      formData.get("schedulingAssignmentMode") || "",
    ).trim();
    if (schedulingAssignmentMode !== "manual" && schedulingAssignmentMode !== "auto") {
      redirect(encodeErrorPath(redirectTo, "Scheduling assignment mode is invalid."));
    }
    const schedulingEngineType = normalizeSchedulingEngineType(
      String(formData.get("schedulingEngineType") || ""),
    );
    if (!schedulingEngineType) {
      redirect(encodeErrorPath(redirectTo, "Scheduling engine type is invalid."));
    }
    const defaultIntakeSource = normalizeIntakeSourceType(
      String(formData.get("defaultIntakeSource") || ""),
    );
    if (!defaultIntakeSource) {
      redirect(encodeErrorPath(redirectTo, "Default intake source is invalid."));
    }
    const defaultSpecialistStandardStartHour = parseIntegerField(
      formData,
      "defaultSpecialistStandardStartHour",
      "Default counsellor start hour",
      {
        min: 0,
        max: 22,
      },
    );
    const defaultSpecialistStandardEndHour = parseIntegerField(
      formData,
      "defaultSpecialistStandardEndHour",
      "Default counsellor end hour",
      {
        min: 1,
        max: 23,
      },
    );
    if (defaultSpecialistStandardEndHour <= defaultSpecialistStandardStartHour) {
      redirect(
        encodeErrorPath(
          redirectTo,
          "Default counsellor end hour must be after default counsellor start hour.",
        ),
      );
    }
    const specialistAvailabilityDefaultGridDays = parsePositiveIntegerField(
      formData,
      "specialistAvailabilityDefaultGridDays",
      "Availability calendar default range",
    );
    const specialistAvailabilityMaxGridDays = parsePositiveIntegerField(
      formData,
      "specialistAvailabilityMaxGridDays",
      "Availability calendar max range",
    );
    if (specialistAvailabilityMaxGridDays < specialistAvailabilityDefaultGridDays) {
      redirect(
        encodeErrorPath(
          redirectTo,
          "Availability calendar max range must be greater than or equal to default range.",
        ),
      );
    }

    await updateOperationalSettings(
      {
        schedulingEngineType,
        schedulingAssignmentMode,
        defaultIntakeSource,
        requireTermsBeforeScheduling:
          String(formData.get("requireTermsBeforeScheduling") || "") === "on",
        requireTermsBeforeInSession:
          String(formData.get("requireTermsBeforeInSession") || "") === "on",
        requireOuttakeBeforeClose:
          String(formData.get("requireOuttakeBeforeClose") || "") === "on",
        defaultIndividualSessionMinutes: parsePositiveIntegerField(
          formData,
          "defaultIndividualSessionMinutes",
          "Default individual session minutes",
        ),
        defaultCoupleSessionMinutes: parsePositiveIntegerField(
          formData,
          "defaultCoupleSessionMinutes",
          "Default couple session minutes",
        ),
        defaultSpecialistStandardStartHour,
        defaultSpecialistStandardEndHour,
        manualProviderHorizonDays: parsePositiveIntegerField(
          formData,
          "manualProviderHorizonDays",
          "Manual provider horizon days",
        ),
        manualProviderSlotIncrementMinutes: parsePositiveIntegerField(
          formData,
          "manualProviderSlotIncrementMinutes",
          "Manual provider slot increment minutes",
        ),
        manualProviderMorningStartMinute: parseIntegerField(
          formData,
          "manualProviderMorningStartMinute",
          "Morning block start (minute of day)",
          { min: 0, max: 1439 },
        ),
        manualProviderMorningEndMinute: parseIntegerField(
          formData,
          "manualProviderMorningEndMinute",
          "Morning block end (minute of day)",
          { min: 1, max: 1439 },
        ),
        manualProviderAfternoonStartMinute: parseIntegerField(
          formData,
          "manualProviderAfternoonStartMinute",
          "Afternoon block start (minute of day)",
          { min: 0, max: 1439 },
        ),
        manualProviderAfternoonEndMinute: parseIntegerField(
          formData,
          "manualProviderAfternoonEndMinute",
          "Afternoon block end (minute of day)",
          { min: 1, max: 1439 },
        ),
        manualProviderEveningStartMinute: parseIntegerField(
          formData,
          "manualProviderEveningStartMinute",
          "Evening block start (minute of day)",
          { min: 0, max: 1439 },
        ),
        manualProviderEveningEndMinute: parseIntegerField(
          formData,
          "manualProviderEveningEndMinute",
          "Evening block end (minute of day)",
          { min: 1, max: 1439 },
        ),
        defaultFormPinExpiresHours: parsePositiveIntegerField(
          formData,
          "defaultFormPinExpiresHours",
          "Form PIN default expiry",
        ),
        defaultFormPinMaxAttempts: parsePositiveIntegerField(
          formData,
          "defaultFormPinMaxAttempts",
          "Form PIN default max attempts",
        ),
        defaultIntakeInviteExpiresHours: parsePositiveIntegerField(
          formData,
          "defaultIntakeInviteExpiresHours",
          "Intake invite default expiry",
        ),
        defaultIntakeInviteMaxAttempts: parsePositiveIntegerField(
          formData,
          "defaultIntakeInviteMaxAttempts",
          "Intake invite default max attempts",
        ),
        formAccessSessionHours: parsePositiveIntegerField(
          formData,
          "formAccessSessionHours",
          "PIN access session hours",
        ),
        specialistAvailabilityDefaultGridDays,
        specialistAvailabilityMaxGridDays,
      },
      user.id,
    );
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/operations");
  revalidatePath("/admin/cases");
  revalidatePath("/intake");
  redirect(appendQuery("/admin/settings/operations", "saved", "1"));
}

export async function updateIntegrationSettingsAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const redirectTo = String(formData.get("redirectTo") || "/admin/settings/integrations");

  try {
    await updateIntegrationSettings(
      {
        microsoftBookingsBusinessId: String(
          formData.get("microsoftBookingsBusinessId") || "",
        ).trim(),
        microsoftBookingsDefaultTimeZone: String(
          formData.get("microsoftBookingsDefaultTimeZone") || "UTC",
        ).trim(),
        microsoftBookingsAvailabilityHorizonDays: parseIntegerField(
          formData,
          "microsoftBookingsAvailabilityHorizonDays",
          "Availability horizon days",
          { min: 1, max: 120 },
        ),
        microsoftBookingsSlotIncrementMinutes: parseIntegerField(
          formData,
          "microsoftBookingsSlotIncrementMinutes",
          "Slot increment minutes",
          { min: 5, max: 60 },
        ),
        microsoftBookingsSyncLookbackHours: parseIntegerField(
          formData,
          "microsoftBookingsSyncLookbackHours",
          "Sync lookback hours",
          { min: 1, max: 168 },
        ),
        microsoftBookingsSyncLookaheadDays: parseIntegerField(
          formData,
          "microsoftBookingsSyncLookaheadDays",
          "Sync lookahead days",
          { min: 1, max: 90 },
        ),
        microsoftBookingsSyncFetchLimit: parseIntegerField(
          formData,
          "microsoftBookingsSyncFetchLimit",
          "Sync fetch limit",
          { min: 50, max: 2000 },
        ),
        resendFromAddress: String(
          formData.get("resendFromAddress") || "",
        ).trim(),
      },
      user.id,
    );
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/integrations");
  redirect(appendQuery("/admin/settings/integrations", "saved", "1"));
}

export async function assignCaseWorkflowAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const caseWorkflowTemplateId = String(formData.get("caseWorkflowTemplateId") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}`);
  const redirectPathOnly = redirectTo.split("?")[0] || `/admin/cases/${caseId}`;

  if (!caseId || !caseWorkflowTemplateId) {
    redirect(encodeErrorPath(redirectTo, "Case and workflow template are required."));
  }

  let destination = redirectTo;
  try {
    await assignWorkflowTemplateToCase({
      caseId,
      caseWorkflowTemplateId,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath("/admin/workflows");
    revalidatePath(redirectPathOnly);
  } catch (error) {
    destination = encodeErrorPath(redirectTo, domainErrorMessage(error));
  }

  redirect(destination);
}

export async function issueFormPinAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const participantIdentifier = String(formData.get("participantIdentifier") || "").trim();
  const formType = String(formData.get("formType") || "").trim();
  const formPath = String(formData.get("formPath") || "").trim();
  const expiresInHoursRaw = String(formData.get("expiresInHours") || "").trim();
  const maxAttemptsRaw = String(formData.get("maxAttempts") || "").trim();
  const sendEmail = String(formData.get("sendEmail") || "") === "on";
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}`);

  const expiresInHours = expiresInHoursRaw ? Number(expiresInHoursRaw) : undefined;
  const maxAttempts = maxAttemptsRaw ? Number(maxAttemptsRaw) : undefined;

  if (!caseId || !participantIdentifier || !formType || !formPath) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Case, participant, form type, and form path are required to issue a PIN.",
      ),
    );
  }

  let issued:
    | Awaited<ReturnType<typeof issueFormPin>>
    | null = null;
  let emailDelivered = false;
  let emailError = "";

  try {
    issued = await issueFormPin({
      caseId,
      participantIdentifier,
      formType,
      formPath,
      expiresInHours,
      maxAttempts,
      issuedByUserId: user.id,
      metadata: {
        issuedFrom: "ops_case_detail",
      },
    });
    if (sendEmail) {
      try {
        const result = await sendFormPinEmail({
          to: issued.participantEmail,
          participantName: issued.participantName,
          caseReference: issued.caseReference,
          formType: issued.formType,
          pin: issued.pin,
          accessUrl: issued.accessUrl,
          expiresAt: issued.expiresAt,
        });
        emailDelivered = result.delivered;
        await logEmail({
          caseId: issued.caseId,
          clientId: issued.clientId,
          emailType: EmailType.FORM_PIN,
          recipientEmail: issued.participantEmail,
          recipientName: issued.participantName,
          subject: result.subject,
          status: result.delivered ? EmailStatus.SENT : EmailStatus.FAILED,
          relatedFormType: issued.formType,
          relatedFormAccessPinId: issued.pinId,
          providerMessageId: result.providerMessageId,
        });
      } catch (error) {
        emailError = domainErrorMessage(error);
        await logEmail({
          caseId: issued.caseId,
          clientId: issued.clientId,
          emailType: EmailType.FORM_PIN,
          recipientEmail: issued.participantEmail,
          recipientName: issued.participantName,
          subject: "Your counselling form access PIN",
          status: EmailStatus.FAILED,
          relatedFormType: issued.formType,
          relatedFormAccessPinId: issued.pinId,
          error: emailError,
        });
      }
    }
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  if (!issued) {
    redirect(encodeErrorPath(redirectTo, "Failed to issue PIN."));
  }

  revalidatePath(redirectTo);

  let destination = appendQuery(redirectTo, "pinIssued", "1");
  destination = appendQuery(destination, "pinRecipient", issued.participantEmail);
  destination = appendQuery(destination, "pinFormType", issued.formType);
  destination = appendQuery(destination, "pinExpiresAt", issued.expiresAt.toISOString());
  destination = appendQuery(destination, "pinAccessUrl", issued.accessUrl);
  destination = appendQuery(destination, "pinEmailDelivered", emailDelivered ? "1" : "0");
  if (!emailDelivered) {
    destination = appendQuery(destination, "pinFallbackCode", issued.pin);
  }
  if (emailError) {
    destination = appendQuery(destination, "pinEmailError", emailError);
  }

  redirect(destination);
}

export async function revokeFormPinAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const pinId = String(formData.get("pinId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  if (!pinId) {
    redirect(encodeErrorPath(redirectTo, "PIN id is required."));
  }

  let revoked:
    | Awaited<ReturnType<typeof revokeFormPin>>
    | null = null;

  try {
    revoked = await revokeFormPin({
      pinId,
      revokedByUserId: user.id,
      reason: reason || undefined,
    });
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }

  if (!revoked) {
    redirect(encodeErrorPath(redirectTo, "Failed to disable PIN."));
  }

  revalidatePath(redirectTo);
  let destination = appendQuery(redirectTo, "pinRevoked", "1");
  destination = appendQuery(destination, "pinRevokedFormType", revoked.formType);
  destination = appendQuery(destination, "pinRevokedRecipient", revoked.participantEmail);
  destination = appendQuery(destination, "pinRevokedAt", revoked.revokedAt.toISOString());
  destination = appendQuery(destination, "pinRevokedAlready", revoked.alreadyRevoked ? "1" : "0");
  redirect(destination);
}

export async function issueIntakeAccessInviteAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const recipientEmail = String(formData.get("recipientEmail") || "").trim();
  const recipientName = String(formData.get("recipientName") || "").trim();
  const expiresInHoursRaw = String(formData.get("expiresInHours") || "").trim();
  const maxAttemptsRaw = String(formData.get("maxAttempts") || "").trim();
  const sendEmail = String(formData.get("sendEmail") || "") === "on";
  const redirectTo = String(formData.get("redirectTo") || "/admin/cases");

  if (!recipientEmail) {
    redirect(encodeErrorPath(redirectTo, "Recipient email is required."));
  }

  const expiresInHours = expiresInHoursRaw ? Number(expiresInHoursRaw) : undefined;
  const maxAttempts = maxAttemptsRaw ? Number(maxAttemptsRaw) : undefined;

  try {
    const issued = await issueIntakeAccessInvite({
      recipientEmail,
      recipientName: recipientName || undefined,
      expiresInHours,
      maxAttempts,
      issuedByUserId: user.id,
      metadata: {
        issuedFrom: "ops_cases_page",
      },
    });

    let emailDelivered = false;
    let emailError = "";

    if (sendEmail) {
      try {
        const result = await sendIntakeAccessInviteEmail({
          to: issued.recipientEmail,
          recipientName: issued.recipientName,
          pin: issued.pin,
          accessUrl: issued.accessUrl,
          expiresAt: issued.expiresAt,
        });
        emailDelivered = result.delivered;
        await logEmail({
          emailType: EmailType.INTAKE_ACCESS_INVITE,
          recipientEmail: issued.recipientEmail,
          recipientName: issued.recipientName || undefined,
          subject: result.subject,
          status: result.delivered ? EmailStatus.SENT : EmailStatus.FAILED,
          relatedIntakeInviteId: issued.inviteId,
          providerMessageId: result.providerMessageId,
        });
      } catch (error) {
        emailError = domainErrorMessage(error);
        await logEmail({
          emailType: EmailType.INTAKE_ACCESS_INVITE,
          recipientEmail: issued.recipientEmail,
          recipientName: issued.recipientName || undefined,
          subject: "Your secure counselling intake form link",
          status: EmailStatus.FAILED,
          relatedIntakeInviteId: issued.inviteId,
          error: emailError,
        });
      }
    }

    let destination = appendQuery(redirectTo, "intakeInviteIssued", "1");
    destination = appendQuery(destination, "intakeInviteRecipient", issued.recipientEmail);
    destination = appendQuery(destination, "intakeInviteAccessUrl", issued.accessUrl);
    destination = appendQuery(destination, "intakeInviteExpiresAt", issued.expiresAt.toISOString());
    destination = appendQuery(destination, "intakeInviteEmailDelivered", emailDelivered ? "1" : "0");
    if (!emailDelivered) {
      destination = appendQuery(destination, "intakeInvitePin", issued.pin);
    }
    if (emailError) {
      destination = appendQuery(destination, "intakeInviteEmailError", emailError);
    }

    revalidatePath("/admin/cases");
    redirect(destination);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function createWorkflowTemplateAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const counsellingType = String(formData.get("counsellingType") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isDefault = String(formData.get("isDefault") || "") === "on";
  const redirectTo = String(formData.get("redirectTo") || "/admin/workflows");

  if (!code || !name || !counsellingType) {
    redirect(encodeErrorPath(redirectTo, "Code, name, and counselling type are required."));
  }

  try {
    await createWorkflowTemplate({
      code,
      name,
      counsellingType,
      description: description || undefined,
      isDefault,
      actorUserId: user.id,
    });

    revalidatePath("/admin/workflows");
    revalidatePath("/admin/cases");
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

const workflowPresetSchema = z.enum(["INDIVIDUAL", "COUPLES"]);

export async function createWorkflowPresetAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const presetRaw = String(formData.get("preset") || "").trim().toUpperCase();
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isDefault = String(formData.get("isDefault") || "") === "on";
  const redirectTo = String(formData.get("redirectTo") || "/admin/workflows");

  const presetParsed = workflowPresetSchema.safeParse(presetRaw);
  if (!presetParsed.success) {
    redirect(encodeErrorPath(redirectTo, "Invalid preset selection."));
  }

  try {
    await createWorkflowTemplateFromPreset({
      preset: presetParsed.data,
      code: code || undefined,
      name: name || undefined,
      description: description || undefined,
      isDefault,
      actorUserId: user.id,
    });

    revalidatePath("/admin/workflows");
    revalidatePath("/admin/cases");
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

const workflowStepTypeSchema = z.enum(["FORM", "REVIEW", "SYSTEM"]);
const workflowStepCodeSchema = z.enum([
  "INTAKE_FORM",
  "AVAILABILITY_CAPTURED",
  "TERMS_AND_CONDITIONS",
  "CONSENT_FORM",
  "AGREEMENT_FORM",
  "OUTTAKE_FORM",
  "CUSTOM",
]);

export async function addWorkflowStepAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseWorkflowTemplateId = String(formData.get("caseWorkflowTemplateId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const typeRaw = String(formData.get("type") || "").trim().toUpperCase();
  const stepCodeRaw = String(formData.get("stepCode") || "").trim().toUpperCase();
  const formType = String(formData.get("formType") || "").trim();
  const required = String(formData.get("required") || "") === "on";
  const requiresAllParticipants = String(formData.get("requiresAllParticipants") || "") === "on";
  const blocksScheduling = String(formData.get("blocksScheduling") || "") === "on";
  const sortOrderRaw = String(formData.get("sortOrder") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || "/admin/workflows");

  if (!caseWorkflowTemplateId || !name) {
    redirect(encodeErrorPath(redirectTo, "Workflow template and step name are required."));
  }

  const typeParsed = workflowStepTypeSchema.safeParse(typeRaw);
  if (!typeParsed.success) {
    redirect(encodeErrorPath(redirectTo, "Invalid workflow step type."));
  }
  const stepCodeParsed = stepCodeRaw ? workflowStepCodeSchema.safeParse(stepCodeRaw) : null;
  if (stepCodeRaw && stepCodeParsed && !stepCodeParsed.success) {
    redirect(encodeErrorPath(redirectTo, "Invalid workflow step code."));
  }

  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;
  if (!Number.isFinite(sortOrder)) {
    redirect(encodeErrorPath(redirectTo, "Sort order must be a number."));
  }

  try {
    await addWorkflowStep({
      caseWorkflowTemplateId,
      name,
      type: typeParsed.data,
      stepCode: stepCodeParsed?.success ? (stepCodeParsed.data as WorkflowStepCode) : undefined,
      formType: formType || undefined,
      required,
      requiresAllParticipants,
      blocksScheduling,
      sortOrder: Math.round(sortOrder),
      actorUserId: user.id,
    });

    revalidatePath("/admin/workflows");
    revalidatePath("/admin/cases");
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function updateWorkflowStepAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const workflowStepId = String(formData.get("workflowStepId") || "").trim();
  const caseWorkflowTemplateId = String(formData.get("caseWorkflowTemplateId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const typeRaw = String(formData.get("type") || "").trim().toUpperCase();
  const stepCodeRaw = String(formData.get("stepCode") || "").trim().toUpperCase();
  const formType = String(formData.get("formType") || "").trim();
  const required = String(formData.get("required") || "") === "on";
  const requiresAllParticipants = String(formData.get("requiresAllParticipants") || "") === "on";
  const blocksScheduling = String(formData.get("blocksScheduling") || "") === "on";
  const sortOrderRaw = String(formData.get("sortOrder") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || "/admin/workflows");

  if (!workflowStepId || !caseWorkflowTemplateId || !name) {
    redirect(encodeErrorPath(redirectTo, "Workflow template, step id, and step name are required."));
  }

  const typeParsed = workflowStepTypeSchema.safeParse(typeRaw);
  if (!typeParsed.success) {
    redirect(encodeErrorPath(redirectTo, "Invalid workflow step type."));
  }
  const stepCodeParsed = stepCodeRaw ? workflowStepCodeSchema.safeParse(stepCodeRaw) : null;
  if (stepCodeRaw && stepCodeParsed && !stepCodeParsed.success) {
    redirect(encodeErrorPath(redirectTo, "Invalid workflow step code."));
  }

  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;
  if (!Number.isFinite(sortOrder)) {
    redirect(encodeErrorPath(redirectTo, "Sort order must be a number."));
  }

  try {
    await updateWorkflowStep({
      workflowStepId,
      caseWorkflowTemplateId,
      name,
      type: typeParsed.data,
      stepCode: stepCodeParsed?.success ? (stepCodeParsed.data as WorkflowStepCode) : undefined,
      formType: formType || undefined,
      required,
      requiresAllParticipants,
      blocksScheduling,
      sortOrder: Math.round(sortOrder),
      actorUserId: user.id,
    });

    revalidatePath("/admin/workflows");
    revalidatePath("/admin/cases");
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

// ── Review Workflow Actions ──

export async function triageCaseAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const decision = String(formData.get("decision") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}`);

  if (!caseId) {
    redirect(encodeErrorPath(redirectTo, "Case is required."));
  }

  if (!Object.values(TriageDecision).includes(decision as TriageDecision)) {
    redirect(encodeErrorPath(redirectTo, "Invalid triage decision."));
  }

  try {
    await triageCase({
      caseId,
      decision: decision as TriageDecision,
      notes: notes || undefined,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function proposeCaseToCounsellorAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const specialistId = String(formData.get("specialistId") || "").trim();
  const proposalNote = String(formData.get("proposalNote") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}`);

  if (!caseId || !specialistId) {
    redirect(encodeErrorPath(redirectTo, "Case and specialist are required."));
  }

  try {
    await proposeCaseToCounsellor({
      caseId,
      specialistId,
      proposalNote: proposalNote || undefined,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function proposeSlotAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "").trim();
  const startTime = String(formData.get("proposedStartTime") || "").trim();
  const endTime = String(formData.get("proposedEndTime") || "").trim();
  const timezone = String(formData.get("proposedTimezone") || "Europe/London").trim();
  const proposalNote = String(formData.get("proposalNote") || "").trim();
  const redirectTo = String(formData.get("redirectTo") || `/admin/cases/${caseId}`);

  if (!caseId || !startTime || !endTime) {
    redirect(encodeErrorPath(redirectTo, "Case, start time, and end time are required."));
  }

  const parsedStart = new Date(startTime);
  const parsedEnd = new Date(endTime);

  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    redirect(encodeErrorPath(redirectTo, "Invalid date/time values."));
  }

  if (parsedEnd <= parsedStart) {
    redirect(encodeErrorPath(redirectTo, "End time must be after start time."));
  }

  try {
    await proposeSlot({
      caseId,
      proposedStartTime: parsedStart,
      proposedEndTime: parsedEnd,
      proposedTimezone: timezone,
      proposalNote: proposalNote || undefined,
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirectWithActionError(redirectTo, error);
  }
}

export async function markNotificationReadAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS, UserRole.SPECIALIST]);
  const notificationId = String(formData.get("notificationId") || "").trim();

  if (!notificationId) return;

  await markRead(notificationId, user.id);
  revalidatePath("/");
}

export async function markAllNotificationsReadAction() {
  const user = await requirePageUser([UserRole.OPS, UserRole.SPECIALIST]);
  await markAllRead(user.id);
  revalidatePath("/");
}
