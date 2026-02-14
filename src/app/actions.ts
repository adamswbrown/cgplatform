"use server";

import { CaseStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  allocateCaseAutomatically,
  canUserOverride,
  completeDocumentInstance,
  createCaseFromIntake,
  createSpecialist,
  domainErrorMessage,
  isDomainError,
  overrideCaseAssignment,
  transitionCaseStatus,
  updateSpecialistProfile,
} from "@/lib/case-service";
import {
  destinationForUserRole,
  requirePageUser,
  signInWithPassword,
  signOut,
} from "@/lib/auth";

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
    redirect(encodeErrorPath(redirectTo, domainErrorMessage(error)));
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
    redirect(encodeErrorPath(redirectTo, domainErrorMessage(error)));
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
    redirect(encodeErrorPath(redirectTo, domainErrorMessage(error)));
  }
}

export async function overrideAssignmentAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);
  const caseId = String(formData.get("caseId") || "");
  const specialistId = String(formData.get("specialistId") || "");
  const reason = String(formData.get("reason") || "").trim();
  const matchingRuleOverride = String(formData.get("matchingRuleOverride") || "").trim();
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
      actorUserId: user.id,
    });

    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
    redirect(redirectTo);
  } catch (error) {
    redirect(encodeErrorPath(redirectTo, domainErrorMessage(error)));
  }
}

export async function createSpecialistAction(formData: FormData) {
  await requirePageUser([UserRole.OPS]);

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
  const redirectTo = String(formData.get("redirectTo") || "/admin/specialists");

  if (!name || !email || !calUserId || !calIndividualEventTypeId) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Name, email, Cal.com user id, and individual event type id are required.",
      ),
    );
  }

  if (supportsCouples && !calCouplesEventTypeId) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Couples event type id is required when specialist supports couples.",
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
    });

    revalidatePath("/admin/specialists");
    redirect(redirectTo);
  } catch (error) {
    if (isDomainError(error)) {
      redirect(encodeErrorPath(redirectTo, error.message));
    }

    redirect(encodeErrorPath(redirectTo, "Failed to create specialist."));
  }
}

export async function updateSpecialistProfileAction(formData: FormData) {
  const user = await requirePageUser([UserRole.OPS]);

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
  const redirectTo = String(formData.get("redirectTo") || `/admin/specialists/${specialistId}`);

  if (!specialistId || !name || !email || !calUserId || !calIndividualEventTypeId) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Specialist id, name, email, Cal.com user id, and individual event type id are required.",
      ),
    );
  }

  if (supportsCouples && !calCouplesEventTypeId) {
    redirect(
      encodeErrorPath(
        redirectTo,
        "Couples event type id is required when specialist supports couples.",
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
      actorUserId: user.id,
    });

    revalidatePath("/admin/specialists");
    revalidatePath("/admin/cases");
    revalidatePath(redirectTo);
  } catch (error) {
    if (isDomainError(error)) {
      destination = encodeErrorPath(redirectTo, error.message);
    } else {
      destination = encodeErrorPath(redirectTo, "Failed to update specialist profile.");
    }
  }

  redirect(destination);
}
