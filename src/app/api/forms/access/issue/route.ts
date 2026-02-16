import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { appendCaseAuditLog, domainErrorMessage, isDomainError } from "@/lib/case-service";
import { issueFormPin } from "@/lib/form-access";
import { sendFormPinEmail } from "@/lib/mailer";

const issueSchema = z
  .object({
    caseId: z.string().min(1),
    participantIdentifier: z.string().min(1),
    formType: z.string().min(1),
    formPath: z.string().min(1),
    expiresInHours: z.number().positive().max(24 * 14).optional(),
    maxAttempts: z.number().int().positive().max(20).optional(),
    sendEmail: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const user = await requireApiUser([UserRole.OPS]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = issueSchema.parse(await request.json());
    const issued = await issueFormPin({
      caseId: payload.caseId,
      participantIdentifier: payload.participantIdentifier,
      formType: payload.formType,
      formPath: payload.formPath,
      expiresInHours: payload.expiresInHours,
      maxAttempts: payload.maxAttempts,
      issuedByUserId: user.id,
      metadata: {
        issuedFrom: "api",
      },
    });

    let emailDelivered = false;
    let emailError: string | null = null;
    if (payload.sendEmail !== false) {
      try {
        const email = await sendFormPinEmail({
          to: issued.participantEmail,
          participantName: issued.participantName,
          caseReference: issued.caseReference,
          formType: issued.formType,
          pin: issued.pin,
          accessUrl: issued.accessUrl,
          expiresAt: issued.expiresAt,
        });
        emailDelivered = email.delivered;
      } catch (error) {
        emailError = domainErrorMessage(error);
        await appendCaseAuditLog({
          caseId: issued.caseId,
          userId: user.id,
          action: "FORM_PIN_EMAIL_FAILED",
          details: {
            formType: issued.formType,
            participantEmail: issued.participantEmail,
            error: emailError,
          },
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        data: {
          accessKey: issued.accessKey,
          pin: issued.pin,
          formType: issued.formType,
          formPath: issued.formPath,
          caseId: issued.caseId,
          caseReference: issued.caseReference,
          participantEmail: issued.participantEmail,
          participantName: issued.participantName,
          expiresAt: issued.expiresAt.toISOString(),
          accessUrl: issued.accessUrl,
          emailDelivered,
          emailError,
        },
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
