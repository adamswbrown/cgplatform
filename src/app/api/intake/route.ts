import { CaseStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DomainError,
  appendCaseAuditLog,
  createCaseFromIntake,
  domainErrorMessage,
  ingestAvailabilitySubmission,
  ingestFormSubmission,
  isDomainError,
} from "@/lib/case-service";
import { hasValidIntakeAccessSession, markIntakeAccessInviteUsed } from "@/lib/form-access";
import {
  legacyIntakeApiSchema,
  newIntakeApiSchema,
  type NewIntakeApiPayload,
} from "@/lib/intake-form";
import { getIntakeFormContent } from "@/lib/intake-settings";
import { sendIntakeConfirmationEmail } from "@/lib/mailer";

function extractIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }

  return forwardedFor.split(",")[0]?.trim() || null;
}

function extractRiskFlags(payload: NewIntakeApiPayload) {
  const flags: string[] = [];
  if (payload.presenting.suicidalThoughtsRecently === "yes") {
    flags.push("suicidal_thoughts_recently");
  }
  if (payload.presenting.attemptedSuicide === "yes") {
    flags.push("attempted_suicide_history");
  }

  return flags;
}

function summarizeCrisisContacts(content: Awaited<ReturnType<typeof getIntakeFormContent>>) {
  return content.crisisModal.contacts
    .map((entry) => (entry.phone ? `${entry.label}: ${entry.phone}` : entry.label))
    .join(" | ");
}

async function handleModernPayload(request: Request, payload: NewIntakeApiPayload) {
  const ipAddress = extractIpAddress(request);
  const riskFlags = extractRiskFlags(payload);
  const signedAt = payload.consent.signedAt ? new Date(payload.consent.signedAt) : new Date();
  const intakeAccess = await hasValidIntakeAccessSession(payload.accessKey);
  if (!intakeAccess) {
    throw new DomainError("This intake form requires PIN verification.", 401);
  }

  const allowedEmails = [payload.primary.email, payload.secondary.email]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedEmails.includes(intakeAccess.recipientEmail.toLowerCase())) {
    throw new DomainError(
      "The verified intake access link does not match the participant details in this submission.",
      401,
    );
  }

  const intakeResult = await createCaseFromIntake({
    primary: {
      firstName: payload.primary.firstName,
      lastName: payload.primary.lastName,
      email: payload.primary.email,
      phone: payload.primary.mainPhone,
    },
    secondary:
      payload.participantType === "couple"
        ? {
            firstName: payload.secondary.firstName || "",
            lastName: payload.secondary.lastName || "",
            email: payload.secondary.email || "",
            phone: payload.secondary.mainPhone || "",
          }
        : undefined,
    notes: `${payload.presenting.mainIssue}: ${payload.presenting.issueDuration}`,
    counsellingType: payload.counsellingType,
    initialStatus: CaseStatus.AWAITING_REVIEW,
    intakeSource: "SECURE_LINK",
    autoAllocate: false,
    requestedDurationMinutes: payload.requestedDurationMinutes,
    intakeFormData: payload as unknown as Record<string, unknown>,
    consentSignature: payload.consent.signature,
    consentSignatureType: payload.consent.signatureType,
    consentSignedAt: signedAt,
    consentIpAddress: ipAddress || undefined,
    riskFlags,
  });

  await ingestFormSubmission({
    caseId: intakeResult.caseId,
    participantIdentifier: payload.primary.email,
    formType: "INTAKE_FORM",
    source: "secure_intake",
    metadata: {
      participantType: payload.participantType,
    },
  });

  if (payload.participantType === "couple" && payload.secondary.email) {
    await ingestFormSubmission({
      caseId: intakeResult.caseId,
      participantIdentifier: payload.secondary.email,
      formType: "INTAKE_FORM",
      source: "secure_intake",
      metadata: {
        participantType: payload.participantType,
      },
    });
  }

  if (payload.availability.selectedSlots.length > 0) {
    await ingestAvailabilitySubmission({
      caseId: intakeResult.caseId,
      participantIdentifier: payload.primary.email,
      timezone: "Europe/London",
      source: "secure_intake",
      windows: payload.availability.selectedSlots,
      metadata: {
        location: payload.availability.location,
        includeOnline: payload.availability.includeOnline,
        notes: payload.availability.notes,
      },
    });

    if (payload.participantType === "couple" && payload.secondary.email) {
      await ingestAvailabilitySubmission({
        caseId: intakeResult.caseId,
        participantIdentifier: payload.secondary.email,
        timezone: "Europe/London",
        source: "secure_intake",
        windows: payload.availability.selectedSlots,
        metadata: {
          location: payload.availability.location,
          includeOnline: payload.availability.includeOnline,
          notes: `${payload.availability.notes} (copied from primary submission)`,
        },
      });
    }
  }

  if (riskFlags.length > 0) {
    await appendCaseAuditLog({
      caseId: intakeResult.caseId,
      action: "HIGH_RISK_FLAGGED",
      details: {
        riskFlags,
        suicidalThoughtsRecently: payload.presenting.suicidalThoughtsRecently,
        attemptedSuicide: payload.presenting.attemptedSuicide,
      },
    });
  }

  await markIntakeAccessInviteUsed(payload.accessKey);

  const content = await getIntakeFormContent();
  const crisisSummary = summarizeCrisisContacts(content);
  try {
    await sendIntakeConfirmationEmail({
      to: payload.primary.email,
      caseReference: intakeResult.reference,
      crisisSummary,
    });

    if (payload.participantType === "couple" && payload.secondary.email) {
      await sendIntakeConfirmationEmail({
        to: payload.secondary.email,
        caseReference: intakeResult.reference,
        crisisSummary,
      });
    }
  } catch (error) {
    await appendCaseAuditLog({
      caseId: intakeResult.caseId,
      action: "CONFIRMATION_EMAIL_FAILED",
      details: {
        message: error instanceof Error ? error.message : "Unknown email failure",
      },
    });
  }

  return intakeResult;
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const modernParsed = newIntakeApiSchema.safeParse(json);
    if (modernParsed.success) {
      const result = await handleModernPayload(request, modernParsed.data);
      return NextResponse.json(
        {
          ok: true,
          data: result,
        },
        { status: 201 },
      );
    }

    const legacyParsed = legacyIntakeApiSchema.parse(json);
    const legacyResult = await createCaseFromIntake(legacyParsed);
    return NextResponse.json(
      {
        ok: true,
        data: legacyResult,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid payload.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: domainErrorMessage(error),
      },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}
