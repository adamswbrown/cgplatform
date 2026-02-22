import { EmailStatus, EmailType } from "@prisma/client";
import { db } from "@/lib/db";

type ConfirmationEmailInput = {
  to: string;
  caseReference: string;
  crisisSummary: string;
};

type FormPinEmailInput = {
  to: string;
  participantName: string;
  caseReference: string;
  formType: string;
  pin: string;
  accessUrl: string;
  expiresAt: Date;
};

type IntakeAccessInviteEmailInput = {
  to: string;
  recipientName?: string | null;
  pin: string;
  accessUrl: string;
  expiresAt: Date;
};

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtml(input: ConfirmationEmailInput) {
  return `
    <div style="font-family:Poppins,Arial,sans-serif;line-height:1.5;color:#052E1E">
      <h2 style="margin:0 0 12px 0;">Thank you. Your submission has been received.</h2>
      <p style="margin:0 0 10px 0;">Your case reference is <strong>${htmlEscape(input.caseReference)}</strong>.</p>
      <p style="margin:0 0 10px 0;">Our Counselling Coordinator will allocate you to a Counsellor as soon as one becomes available.</p>
      <p style="margin:0 0 10px 0;">${htmlEscape(input.crisisSummary)}</p>
    </div>
  `;
}

function buildFormPinHtml(input: FormPinEmailInput) {
  return `
    <div style="font-family:Poppins,Arial,sans-serif;line-height:1.5;color:#052E1E">
      <h2 style="margin:0 0 12px 0;">Your counselling form is ready</h2>
      <p style="margin:0 0 10px 0;">Hello ${htmlEscape(input.participantName)},</p>
      <p style="margin:0 0 10px 0;">
        Please use this one-time PIN to access your form for case
        <strong>${htmlEscape(input.caseReference)}</strong>.
      </p>
      <p style="margin:0 0 10px 0;">
        Form type: <strong>${htmlEscape(input.formType)}</strong><br/>
        PIN code: <strong style="font-size:1.2rem;letter-spacing:2px;">${htmlEscape(input.pin)}</strong><br/>
        Expires: <strong>${htmlEscape(input.expiresAt.toISOString())}</strong>
      </p>
      <p style="margin:0 0 10px 0;">
        Open form access page:
        <a href="${htmlEscape(input.accessUrl)}">${htmlEscape(input.accessUrl)}</a>
      </p>
    </div>
  `;
}

function buildIntakeAccessInviteHtml(input: IntakeAccessInviteEmailInput) {
  const greeting = input.recipientName?.trim()
    ? `Hello ${htmlEscape(input.recipientName.trim())},`
    : "Hello,";

  return `
    <div style="font-family:Poppins,Arial,sans-serif;line-height:1.5;color:#052E1E">
      <h2 style="margin:0 0 12px 0;">Your counselling application form link</h2>
      <p style="margin:0 0 10px 0;">${greeting}</p>
      <p style="margin:0 0 10px 0;">
        Please use the secure link and PIN below to access the Application for Counselling form.
      </p>
      <p style="margin:0 0 10px 0;">
        PIN code: <strong style="font-size:1.2rem;letter-spacing:2px;">${htmlEscape(input.pin)}</strong><br/>
        Expires: <strong>${htmlEscape(input.expiresAt.toISOString())}</strong>
      </p>
      <p style="margin:0 0 10px 0;">
        Open secure access page:
        <a href="${htmlEscape(input.accessUrl)}">${htmlEscape(input.accessUrl)}</a>
      </p>
    </div>
  `;
}

export type EmailSendResult = {
  delivered: boolean;
  provider: "resend" | "none";
  providerMessageId?: string;
  subject: string;
};

export type LogEmailInput = {
  caseId?: string;
  clientId?: string;
  emailType: EmailType;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  status: EmailStatus;
  relatedFormType?: string;
  relatedFormAccessPinId?: string;
  relatedIntakeInviteId?: string;
  providerMessageId?: string;
  error?: string;
};

export async function logEmail(input: LogEmailInput) {
  return db.emailLog.create({
    data: {
      caseId: input.caseId,
      clientId: input.clientId,
      emailType: input.emailType,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      subject: input.subject,
      status: input.status,
      relatedFormType: input.relatedFormType,
      relatedFormAccessPinId: input.relatedFormAccessPinId,
      relatedIntakeInviteId: input.relatedIntakeInviteId,
      providerMessageId: input.providerMessageId,
      error: input.error,
    },
  });
}

export async function sendIntakeConfirmationEmail(input: ConfirmationEmailInput): Promise<EmailSendResult> {
  const fromAddress = process.env.CONFIRMATION_EMAIL_FROM || "no-reply@localhost";
  const resendApiKey = process.env.RESEND_API_KEY;
  const subject = "Your counselling application has been received";

  if (!resendApiKey) {
    console.info(
      `[mailer] Confirmation email not sent. RESEND_API_KEY is not configured. target=${input.to}`,
    );
    return { delivered: false, provider: "none" as const, subject };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [input.to],
      subject,
      html: buildHtml(input),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Confirmation email failed (${response.status}): ${body}`);
  }

  const resBody = await response.json().catch(() => null);
  const providerMessageId = resBody?.id ? String(resBody.id) : undefined;

  return { delivered: true, provider: "resend" as const, providerMessageId, subject };
}

export async function sendFormPinEmail(input: FormPinEmailInput): Promise<EmailSendResult> {
  const fromAddress = process.env.CONFIRMATION_EMAIL_FROM || "no-reply@localhost";
  const resendApiKey = process.env.RESEND_API_KEY;
  const subject = "Your counselling form access PIN";

  if (!resendApiKey) {
    console.info(`[mailer] Form PIN email not sent. RESEND_API_KEY is not configured. target=${input.to}`);
    return { delivered: false, provider: "none" as const, subject };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [input.to],
      subject,
      html: buildFormPinHtml(input),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Form PIN email failed (${response.status}): ${body}`);
  }

  const resBody = await response.json().catch(() => null);
  const providerMessageId = resBody?.id ? String(resBody.id) : undefined;

  return { delivered: true, provider: "resend" as const, providerMessageId, subject };
}

export async function sendIntakeAccessInviteEmail(input: IntakeAccessInviteEmailInput): Promise<EmailSendResult> {
  const fromAddress = process.env.CONFIRMATION_EMAIL_FROM || "no-reply@localhost";
  const resendApiKey = process.env.RESEND_API_KEY;
  const subject = "Your secure counselling intake form link";

  if (!resendApiKey) {
    console.info(
      `[mailer] Intake access invite email not sent. RESEND_API_KEY is not configured. target=${input.to}`,
    );
    return { delivered: false, provider: "none" as const, subject };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [input.to],
      subject,
      html: buildIntakeAccessInviteHtml(input),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Intake access invite email failed (${response.status}): ${body}`);
  }

  const resBody = await response.json().catch(() => null);
  const providerMessageId = resBody?.id ? String(resBody.id) : undefined;

  return { delivered: true, provider: "resend" as const, providerMessageId, subject };
}
