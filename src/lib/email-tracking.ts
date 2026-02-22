import { db } from "@/lib/db";

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
      status: "SENT",
    },
    data: {
      respondedAt: now,
    },
  });
}
