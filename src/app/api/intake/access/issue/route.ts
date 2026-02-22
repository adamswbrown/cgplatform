import { NextResponse } from "next/server";
import { EmailStatus, EmailType, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { domainErrorMessage, isDomainError } from "@/lib/case-service";
import { issueIntakeAccessInvite } from "@/lib/form-access";
import { logEmail, sendIntakeAccessInviteEmail } from "@/lib/mailer";

const issueSchema = z
  .object({
    recipientEmail: z.string().email(),
    recipientName: z.string().optional(),
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
    const issued = await issueIntakeAccessInvite({
      recipientEmail: payload.recipientEmail,
      recipientName: payload.recipientName,
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

    return NextResponse.json(
      {
        ok: true,
        data: {
          recipientEmail: issued.recipientEmail,
          recipientName: issued.recipientName,
          accessKey: issued.accessKey,
          pin: issued.pin,
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
