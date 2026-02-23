import { EmailStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Status priority for Resend email lifecycle events.
 * Higher number = further along in the delivery pipeline.
 * Terminal statuses (BOUNCED, COMPLAINED, FAILED) should not be overwritten.
 */
const STATUS_PRIORITY: Record<EmailStatus, number> = {
  FAILED: -1,
  BOUNCED: -1,
  COMPLAINED: -1,
  SENT: 1,
  DELIVERY_DELAYED: 2,
  DELIVERED: 3,
  OPENED: 4,
  CLICKED: 5,
};

/** Map Resend webhook event type strings to our EmailStatus enum. */
const EVENT_TO_STATUS: Record<string, EmailStatus> = {
  "email.sent": EmailStatus.SENT,
  "email.delivered": EmailStatus.DELIVERED,
  "email.delivery_delayed": EmailStatus.DELIVERY_DELAYED,
  "email.opened": EmailStatus.OPENED,
  "email.clicked": EmailStatus.CLICKED,
  "email.bounced": EmailStatus.BOUNCED,
  "email.complained": EmailStatus.COMPLAINED,
  "email.failed": EmailStatus.FAILED,
};

/**
 * Processes a verified Resend webhook event.
 * Creates an EmailEvent record and updates the EmailLog status if appropriate.
 */
export async function processResendWebhookEvent(payload: {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    [key: string]: unknown;
  };
}): Promise<{ processed: boolean; reason?: string }> {
  const { type, created_at, data } = payload;
  const emailId = data.email_id;

  if (!emailId) {
    return { processed: false, reason: "missing email_id" };
  }

  const newStatus = EVENT_TO_STATUS[type];
  if (!newStatus) {
    return { processed: false, reason: `unhandled event type: ${type}` };
  }

  // Look up the EmailLog by Resend's email ID
  const emailLog = await db.emailLog.findFirst({
    where: { providerMessageId: emailId },
  });

  if (!emailLog) {
    return { processed: false, reason: `no EmailLog found for provider message ${emailId}` };
  }

  const eventTime = new Date(created_at);

  // Extract event-specific details for storage
  const rawPayload: Record<string, unknown> = {};
  if (type === "email.bounced" && data.bounce) {
    rawPayload.bounce = data.bounce;
  }
  if (type === "email.clicked" && data.click) {
    rawPayload.click = data.click;
  }
  if (type === "email.complained") {
    rawPayload.complained = true;
  }

  // Always record the event in the timeline
  await db.emailEvent.create({
    data: {
      emailLogId: emailLog.id,
      eventType: type.replace("email.", ""),
      occurredAt: eventTime,
      rawPayload: Object.keys(rawPayload).length > 0
        ? (rawPayload as Prisma.InputJsonValue)
        : undefined,
    },
  });

  // Update the EmailLog status only if the new status has higher priority
  const currentPriority = STATUS_PRIORITY[emailLog.status] ?? 0;
  const newPriority = STATUS_PRIORITY[newStatus] ?? 0;
  const isTerminal = currentPriority === -1;

  if (!isTerminal && (newPriority > currentPriority || newPriority === -1)) {
    await db.emailLog.update({
      where: { id: emailLog.id },
      data: { status: newStatus },
    });
  }

  return { processed: true };
}

/**
 * Marks unresponded email logs as responded for a given case, recipient, and form type.
 * Called after a form submission is successfully ingested.
 */
export async function markEmailsResponded(input: {
  caseId: string;
  recipientEmail: string;
  formType: string;
}) {
  const normalizedEmail = input.recipientEmail.trim().toLowerCase();
  const normalizedFormType = input.formType.trim().toUpperCase();
  const now = new Date();

  await db.emailLog.updateMany({
    where: {
      caseId: input.caseId,
      recipientEmail: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
      relatedFormType: normalizedFormType,
      respondedAt: null,
      status: {
        in: [
          EmailStatus.SENT,
          EmailStatus.DELIVERED,
          EmailStatus.OPENED,
          EmailStatus.CLICKED,
        ],
      },
    },
    data: {
      respondedAt: now,
    },
  });
}
