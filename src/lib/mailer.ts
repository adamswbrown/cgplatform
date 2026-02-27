import { EmailStatus, EmailType } from "@prisma/client";
import { db } from "@/lib/db";
import { getIntegrationSettings } from "@/lib/integration-settings";

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
  const integrationSettings = await getIntegrationSettings();
  const fromAddress = integrationSettings.resendFromAddress;
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
  const integrationSettings = await getIntegrationSettings();
  const fromAddress = integrationSettings.resendFromAddress;
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
  const integrationSettings = await getIntegrationSettings();
  const fromAddress = integrationSettings.resendFromAddress;
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

// ── Review Workflow Email Templates ──

async function sendEmailDirect(to: string, subject: string, html: string): Promise<EmailSendResult> {
  const integrationSettings = await getIntegrationSettings();
  const fromAddress = integrationSettings.resendFromAddress;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.info(`[mailer] Email not sent (no RESEND_API_KEY). subject="${subject}" target=${to}`);
    return { delivered: false, provider: "none" as const, subject };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({ from: fromAddress, to: [to], subject, html }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email send failed (${response.status}): ${body}`);
  }

  const resBody = await response.json().catch(() => null);
  const providerMessageId = resBody?.id ? String(resBody.id) : undefined;

  return { delivered: true, provider: "resend" as const, providerMessageId, subject };
}

function wrapHtml(body: string) {
  return `<div style="font-family:Poppins,Arial,sans-serif;line-height:1.5;color:#052E1E">${body}</div>`;
}

type CaseProposalEmailInput = {
  to: string;
  counsellorName: string;
  caseReference: string;
  counsellingType: string;
  participantCount: number;
  proposalNote?: string;
  portalUrl: string;
};

export async function sendCaseProposalEmail(input: CaseProposalEmailInput): Promise<EmailSendResult> {
  const html = wrapHtml(`
    <h2 style="margin:0 0 12px 0;">New case proposal</h2>
    <p style="margin:0 0 10px 0;">Hello ${htmlEscape(input.counsellorName)},</p>
    <p style="margin:0 0 10px 0;">
      You have been proposed for case <strong>${htmlEscape(input.caseReference)}</strong>.
    </p>
    <p style="margin:0 0 10px 0;">
      Type: <strong>${htmlEscape(input.counsellingType)}</strong><br/>
      Participants: <strong>${String(input.participantCount)}</strong>
    </p>
    ${input.proposalNote ? `<p style="margin:0 0 10px 0;">Note: ${htmlEscape(input.proposalNote)}</p>` : ""}
    <p style="margin:0 0 10px 0;">
      Please log in to review and accept or decline:
      <a href="${htmlEscape(input.portalUrl)}">${htmlEscape(input.portalUrl)}</a>
    </p>
  `);

  return sendEmailDirect(input.to, `Case proposal: ${input.caseReference}`, html);
}

type SlotProposalCounsellorEmailInput = {
  to: string;
  counsellorName: string;
  caseReference: string;
  proposedStartTime: string;
  proposedEndTime: string;
  proposalNote?: string;
  portalUrl: string;
};

export async function sendSlotProposalToCounsellorEmail(input: SlotProposalCounsellorEmailInput): Promise<EmailSendResult> {
  const html = wrapHtml(`
    <h2 style="margin:0 0 12px 0;">Time slot proposed</h2>
    <p style="margin:0 0 10px 0;">Hello ${htmlEscape(input.counsellorName)},</p>
    <p style="margin:0 0 10px 0;">
      A session time has been proposed for case <strong>${htmlEscape(input.caseReference)}</strong>.
    </p>
    <p style="margin:0 0 10px 0;">
      Proposed time: <strong>${htmlEscape(input.proposedStartTime)}</strong> &ndash; <strong>${htmlEscape(input.proposedEndTime)}</strong>
    </p>
    ${input.proposalNote ? `<p style="margin:0 0 10px 0;">Note: ${htmlEscape(input.proposalNote)}</p>` : ""}
    <p style="margin:0 0 10px 0;">
      Please log in to accept or decline:
      <a href="${htmlEscape(input.portalUrl)}">${htmlEscape(input.portalUrl)}</a>
    </p>
  `);

  return sendEmailDirect(input.to, `Session time proposed: ${input.caseReference}`, html);
}

type SlotProposalClientEmailInput = {
  to: string;
  clientName: string;
  caseReference: string;
  counsellorFirstName: string;
  proposedStartTime: string;
  proposedEndTime: string;
  accessUrl: string;
};

export async function sendSlotProposalToClientEmail(input: SlotProposalClientEmailInput): Promise<EmailSendResult> {
  const html = wrapHtml(`
    <h2 style="margin:0 0 12px 0;">Your counselling appointment</h2>
    <p style="margin:0 0 10px 0;">Hello ${htmlEscape(input.clientName)},</p>
    <p style="margin:0 0 10px 0;">
      We have a proposed appointment time for your counselling session (case <strong>${htmlEscape(input.caseReference)}</strong>)
      with ${htmlEscape(input.counsellorFirstName)}.
    </p>
    <p style="margin:0 0 10px 0;">
      Proposed time: <strong>${htmlEscape(input.proposedStartTime)}</strong> &ndash; <strong>${htmlEscape(input.proposedEndTime)}</strong>
    </p>
    <p style="margin:0 0 10px 0;">
      Please use the link below to accept this appointment (and sign the Terms of Counselling),
      or propose a different day:
    </p>
    <p style="margin:0 0 10px 0;">
      <a href="${htmlEscape(input.accessUrl)}">${htmlEscape(input.accessUrl)}</a>
    </p>
  `);

  return sendEmailDirect(input.to, `Counselling appointment proposed: ${input.caseReference}`, html);
}

type SlotConfirmedEmailInput = {
  to: string;
  recipientName: string;
  caseReference: string;
  confirmedStartTime: string;
  confirmedEndTime: string;
};

export async function sendSlotConfirmedEmail(input: SlotConfirmedEmailInput): Promise<EmailSendResult> {
  const html = wrapHtml(`
    <h2 style="margin:0 0 12px 0;">Appointment confirmed</h2>
    <p style="margin:0 0 10px 0;">Hello ${htmlEscape(input.recipientName)},</p>
    <p style="margin:0 0 10px 0;">
      Your counselling appointment for case <strong>${htmlEscape(input.caseReference)}</strong> has been confirmed.
    </p>
    <p style="margin:0 0 10px 0;">
      Time: <strong>${htmlEscape(input.confirmedStartTime)}</strong> &ndash; <strong>${htmlEscape(input.confirmedEndTime)}</strong>
    </p>
  `);

  return sendEmailDirect(input.to, `Appointment confirmed: ${input.caseReference}`, html);
}
