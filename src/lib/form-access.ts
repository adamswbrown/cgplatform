import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOperationalSettings } from "@/lib/admin-settings";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/case-service";

const FORM_ACCESS_COOKIE_PREFIX = "cg_form_access_";
const INTAKE_ACCESS_COOKIE_PREFIX = "cg_intake_access_";
const DEFAULT_PIN_DIGITS = 6;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_EXPIRES_HOURS = 72;
const MAX_EXPIRES_HOURS = 14 * 24;

type ParticipantSummary = {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
};

type CaseParticipantLookup = {
  id: string;
  reference: string;
  participants: Array<{
    client: ParticipantSummary;
  }>;
};

function sanitizeDigits(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.replace(/\D+/g, "");
}

function trimLower(value: string) {
  return value.trim().toLowerCase();
}

function normalizeFormType(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    throw new DomainError("formType is required.", 400);
  }

  return normalized;
}

function normalizeFormPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("formPath is required.", 400);
  }
  if (!trimmed.startsWith("/")) {
    throw new DomainError("formPath must start with '/'.", 400);
  }

  return trimmed;
}

function formAccessSecret() {
  return process.env.FORM_PIN_SECRET || process.env.AUTH_SECRET || "dev-form-pin-secret";
}

function hashPin(accessKey: string, pin: string) {
  return createHash("sha256")
    .update(`pin|${formAccessSecret()}|${accessKey}|${pin}`)
    .digest("hex");
}

function hashSessionToken(token: string) {
  return createHash("sha256")
    .update(`session|${formAccessSecret()}|${token}`)
    .digest("hex");
}

function equalHexHash(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function generatePin(digits = DEFAULT_PIN_DIGITS) {
  const upperBound = 10 ** digits;
  const value = randomInt(0, upperBound);
  return String(value).padStart(digits, "0");
}

function generateAccessKey() {
  return randomBytes(16).toString("hex");
}

function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

function cookieNameForAccessKey(accessKey: string) {
  const safeSegment = accessKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  return `${FORM_ACCESS_COOKIE_PREFIX}${safeSegment}`;
}

function intakeCookieNameForAccessKey(accessKey: string) {
  const safeSegment = accessKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  return `${INTAKE_ACCESS_COOKIE_PREFIX}${safeSegment}`;
}

async function resolveSessionExpiry(expiresAt: Date) {
  const operationalSettings = await getOperationalSettings();
  const now = new Date();
  const sessionCutoff = new Date(
    now.getTime() + operationalSettings.formAccessSessionHours * 60 * 60 * 1000,
  );
  return sessionCutoff < expiresAt ? sessionCutoff : expiresAt;
}

function resolveFormAccessBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000"
  );
}

function findParticipantForIdentifier(
  caseRecord: CaseParticipantLookup,
  participantIdentifier: string,
) {
  const trimmed = participantIdentifier.trim();
  const normalizedEmail = trimLower(trimmed);
  const normalizedPhone = sanitizeDigits(trimmed);

  return caseRecord.participants.find((participant) => {
    const client = participant.client;
    if (client.id === trimmed) {
      return true;
    }

    if (trimLower(client.email) === normalizedEmail) {
      return true;
    }

    const participantPhone = sanitizeDigits(client.phone);
    return Boolean(normalizedPhone && participantPhone && participantPhone === normalizedPhone);
  });
}

async function createAuditLog(input: {
  caseId: string;
  action: string;
  details?: Prisma.InputJsonValue;
  userId?: string;
}) {
  await db.auditLog.create({
    data: {
      caseId: input.caseId,
      userId: input.userId,
      action: input.action,
      details: input.details,
    },
  });
}

export type IssueFormPinInput = {
  caseId: string;
  participantIdentifier: string;
  formType: string;
  formPath: string;
  expiresInHours?: number;
  maxAttempts?: number;
  issuedByUserId?: string;
  metadata?: Prisma.InputJsonValue;
};

export type IssueFormPinResult = {
  accessKey: string;
  pin: string;
  formType: string;
  formPath: string;
  caseId: string;
  caseReference: string;
  participantEmail: string;
  participantName: string;
  expiresAt: Date;
  accessUrl: string;
};

export async function issueFormPin(input: IssueFormPinInput): Promise<IssueFormPinResult> {
  const caseId = input.caseId.trim();
  const participantIdentifier = input.participantIdentifier.trim();
  const formType = normalizeFormType(input.formType);
  const formPath = normalizeFormPath(input.formPath);

  if (!caseId || !participantIdentifier) {
    throw new DomainError("caseId and participantIdentifier are required.", 400);
  }

  const operationalSettings = await getOperationalSettings();
  const expiresInHours =
    Number.isFinite(input.expiresInHours) && (input.expiresInHours || 0) > 0
      ? Math.min(Math.round(input.expiresInHours || DEFAULT_EXPIRES_HOURS), MAX_EXPIRES_HOURS)
      : operationalSettings.defaultFormPinExpiresHours;
  const maxAttempts =
    Number.isFinite(input.maxAttempts) && (input.maxAttempts || 0) > 0
      ? Math.min(Math.round(input.maxAttempts || DEFAULT_MAX_ATTEMPTS), 20)
      : operationalSettings.defaultFormPinMaxAttempts;

  const caseRecord = await db.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      reference: true,
      participants: {
        select: {
          client: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  if (!caseRecord) {
    throw new DomainError("Case not found.", 404);
  }

  const participant = findParticipantForIdentifier(caseRecord, participantIdentifier);
  if (!participant) {
    throw new DomainError("Participant not found for this case.", 404);
  }

  const accessKey = generateAccessKey();
  const pin = generatePin(DEFAULT_PIN_DIGITS);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.formAccessPin.updateMany({
      where: {
        caseId,
        clientId: participant.client.id,
        formType,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.formAccessPin.create({
      data: {
        caseId,
        clientId: participant.client.id,
        formType,
        formPath,
        accessKey,
        pinHash: hashPin(accessKey, pin),
        expiresAt,
        maxAttempts,
        issuedByUserId: input.issuedByUserId || null,
        metadata: input.metadata,
      },
    });

    await tx.auditLog.create({
      data: {
        caseId,
        userId: input.issuedByUserId,
        action: "FORM_PIN_ISSUED",
        details: {
          formType,
          formPath,
          participantEmail: participant.client.email,
          expiresAt: expiresAt.toISOString(),
          maxAttempts,
        },
      },
    });
  });

  const accessUrl = `${resolveFormAccessBaseUrl()}/forms/access/${accessKey}`;

  return {
    accessKey,
    pin,
    formType,
    formPath,
    caseId,
    caseReference: caseRecord.reference,
    participantEmail: participant.client.email,
    participantName: `${participant.client.firstName} ${participant.client.lastName}`,
    expiresAt,
    accessUrl,
  };
}

export type VerifyFormPinInput = {
  accessKey: string;
  pin: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type VerifyFormPinResult = {
  accessKey: string;
  formType: string;
  formPath: string;
  caseId: string;
  caseReference: string;
  participantEmail: string;
  sessionToken: string;
  sessionExpiresAt: Date;
};

export async function verifyFormPin(input: VerifyFormPinInput): Promise<VerifyFormPinResult> {
  const accessKey = input.accessKey.trim();
  const pin = input.pin.trim();
  if (!accessKey || !pin) {
    throw new DomainError("accessKey and pin are required.", 400);
  }

  const record = await db.formAccessPin.findUnique({
    where: { accessKey },
    include: {
      case: {
        select: {
          id: true,
          reference: true,
        },
      },
      client: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!record) {
    throw new DomainError("Invalid form access link.", 404);
  }

  const now = new Date();
  if (record.revokedAt || record.expiresAt <= now) {
    throw new DomainError("This form access PIN has expired. Request a new code.", 410);
  }
  if (record.attemptCount >= record.maxAttempts) {
    throw new DomainError("This PIN is locked after too many attempts.", 423);
  }

  const expectedHash = record.pinHash;
  const candidateHash = hashPin(accessKey, pin);
  if (!equalHexHash(expectedHash, candidateHash)) {
    const nextAttempts = record.attemptCount + 1;
    await db.formAccessPin.update({
      where: { id: record.id },
      data: {
        attemptCount: nextAttempts,
        lastAttemptAt: now,
      },
    });

    await createAuditLog({
      caseId: record.caseId,
      action: "FORM_PIN_VERIFY_FAILED",
      details: {
        formType: record.formType,
        accessKey,
        attempts: nextAttempts,
        maxAttempts: record.maxAttempts,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      },
    });
    throw new DomainError("Invalid PIN.", 401);
  }

  const sessionToken = generateSessionToken();
  const sessionExpiresAt = await resolveSessionExpiry(record.expiresAt);
  await db.formAccessPin.update({
    where: { id: record.id },
    data: {
      sessionTokenHash: hashSessionToken(sessionToken),
      sessionExpiresAt,
      lastVerifiedAt: now,
    },
  });

  await createAuditLog({
    caseId: record.caseId,
    action: "FORM_PIN_VERIFIED",
    details: {
      formType: record.formType,
      accessKey,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
    },
  });

  return {
    accessKey,
    formType: record.formType,
    formPath: record.formPath,
    caseId: record.case.id,
    caseReference: record.case.reference,
    participantEmail: record.client.email,
    sessionToken,
    sessionExpiresAt,
  };
}

export async function setFormAccessSessionCookie(
  accessKey: string,
  sessionToken: string,
  expiresAt: Date,
) {
  const cookieStore = await cookies();
  cookieStore.set(cookieNameForAccessKey(accessKey), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearFormAccessSessionCookie(accessKey: string) {
  const cookieStore = await cookies();
  cookieStore.delete(cookieNameForAccessKey(accessKey));
}

export type RevokeFormPinInput = {
  pinId: string;
  revokedByUserId?: string;
  reason?: string;
};

export type RevokeFormPinResult = {
  pinId: string;
  caseId: string;
  caseReference: string;
  formType: string;
  formPath: string;
  participantEmail: string;
  accessKey: string;
  revokedAt: Date;
  alreadyRevoked: boolean;
};

export async function revokeFormPin(input: RevokeFormPinInput): Promise<RevokeFormPinResult> {
  const pinId = input.pinId.trim();
  if (!pinId) {
    throw new DomainError("pinId is required.", 400);
  }

  const pinRecord = await db.formAccessPin.findUnique({
    where: {
      id: pinId,
    },
    include: {
      case: {
        select: {
          id: true,
          reference: true,
        },
      },
      client: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!pinRecord) {
    throw new DomainError("Form PIN not found.", 404);
  }

  if (pinRecord.revokedAt) {
    return {
      pinId: pinRecord.id,
      caseId: pinRecord.caseId,
      caseReference: pinRecord.case.reference,
      formType: pinRecord.formType,
      formPath: pinRecord.formPath,
      participantEmail: pinRecord.client.email,
      accessKey: pinRecord.accessKey,
      revokedAt: pinRecord.revokedAt,
      alreadyRevoked: true,
    };
  }

  const revokedAt = new Date();

  await db.$transaction(async (tx) => {
    await tx.formAccessPin.update({
      where: {
        id: pinRecord.id,
      },
      data: {
        revokedAt,
        sessionTokenHash: null,
        sessionExpiresAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        caseId: pinRecord.caseId,
        userId: input.revokedByUserId || null,
        action: "FORM_PIN_REVOKED",
        details: {
          formType: pinRecord.formType,
          formPath: pinRecord.formPath,
          participantEmail: pinRecord.client.email,
          accessKey: pinRecord.accessKey,
          reason: input.reason?.trim() || null,
        },
      },
    });
  });

  return {
    pinId: pinRecord.id,
    caseId: pinRecord.caseId,
    caseReference: pinRecord.case.reference,
    formType: pinRecord.formType,
    formPath: pinRecord.formPath,
    participantEmail: pinRecord.client.email,
    accessKey: pinRecord.accessKey,
    revokedAt,
    alreadyRevoked: false,
  };
}

export async function hasValidFormAccessSession(input: {
  accessKey: string;
  formType?: string;
}) {
  const accessKey = input.accessKey.trim();
  if (!accessKey) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(cookieNameForAccessKey(accessKey))?.value;
  if (!token) {
    return null;
  }

  const record = await db.formAccessPin.findUnique({
    where: { accessKey },
    include: {
      case: {
        select: {
          id: true,
          reference: true,
        },
      },
      client: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  if (!record) {
    return null;
  }

  const now = new Date();
  if (record.revokedAt || record.expiresAt <= now) {
    return null;
  }
  if (!record.sessionTokenHash || !record.sessionExpiresAt || record.sessionExpiresAt <= now) {
    return null;
  }
  if (input.formType && normalizeFormType(input.formType) !== record.formType) {
    return null;
  }

  if (!equalHexHash(record.sessionTokenHash, hashSessionToken(token))) {
    return null;
  }

  return {
    accessKey: record.accessKey,
    formType: record.formType,
    formPath: record.formPath,
    caseId: record.case.id,
    caseReference: record.case.reference,
    clientId: record.client.id,
    participantEmail: record.client.email,
    participantName: `${record.client.firstName} ${record.client.lastName}`,
    expiresAt: record.expiresAt,
  };
}

export async function requireFormAccessOrRedirect(input: {
  accessKey: string;
  formType: string;
  nextPath: string;
}) {
  const session = await hasValidFormAccessSession({
    accessKey: input.accessKey,
    formType: input.formType,
  });

  if (!session) {
    const search = new URLSearchParams({
      next: input.nextPath,
    });
    redirect(`/forms/access/${encodeURIComponent(input.accessKey)}?${search.toString()}`);
  }

  return session;
}

export type IssueIntakeAccessInviteInput = {
  recipientEmail: string;
  recipientName?: string;
  expiresInHours?: number;
  maxAttempts?: number;
  issuedByUserId?: string;
  metadata?: Prisma.InputJsonValue;
};

export type IssueIntakeAccessInviteResult = {
  recipientEmail: string;
  recipientName: string | null;
  accessKey: string;
  pin: string;
  expiresAt: Date;
  accessUrl: string;
};

export async function issueIntakeAccessInvite(
  input: IssueIntakeAccessInviteInput,
): Promise<IssueIntakeAccessInviteResult> {
  const recipientEmail = trimLower(input.recipientEmail || "");
  if (!recipientEmail) {
    throw new DomainError("recipientEmail is required.", 400);
  }

  const recipientName = input.recipientName?.trim() || null;
  const operationalSettings = await getOperationalSettings();
  const expiresInHours =
    Number.isFinite(input.expiresInHours) && (input.expiresInHours || 0) > 0
      ? Math.min(Math.round(input.expiresInHours || DEFAULT_EXPIRES_HOURS), MAX_EXPIRES_HOURS)
      : operationalSettings.defaultIntakeInviteExpiresHours;
  const maxAttempts =
    Number.isFinite(input.maxAttempts) && (input.maxAttempts || 0) > 0
      ? Math.min(Math.round(input.maxAttempts || DEFAULT_MAX_ATTEMPTS), 20)
      : operationalSettings.defaultIntakeInviteMaxAttempts;

  const accessKey = generateAccessKey();
  const pin = generatePin(DEFAULT_PIN_DIGITS);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.intakeAccessInvite.updateMany({
      where: {
        recipientEmail,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.intakeAccessInvite.create({
      data: {
        recipientEmail,
        recipientName,
        accessKey,
        pinHash: hashPin(accessKey, pin),
        expiresAt,
        maxAttempts,
        issuedByUserId: input.issuedByUserId || null,
        metadata: input.metadata,
      },
    });
  });

  return {
    recipientEmail,
    recipientName,
    accessKey,
    pin,
    expiresAt,
    accessUrl: `${resolveFormAccessBaseUrl()}/intake/access/${accessKey}`,
  };
}

export type VerifyIntakeAccessInviteInput = {
  accessKey: string;
  pin: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type VerifyIntakeAccessInviteResult = {
  recipientEmail: string;
  recipientName: string | null;
  accessKey: string;
  sessionToken: string;
  sessionExpiresAt: Date;
};

export async function verifyIntakeAccessInvite(
  input: VerifyIntakeAccessInviteInput,
): Promise<VerifyIntakeAccessInviteResult> {
  const accessKey = input.accessKey.trim();
  const pin = input.pin.trim();
  if (!accessKey || !pin) {
    throw new DomainError("accessKey and pin are required.", 400);
  }

  const record = await db.intakeAccessInvite.findUnique({
    where: {
      accessKey,
    },
  });

  if (!record) {
    throw new DomainError("Invalid intake access link.", 404);
  }

  const now = new Date();
  if (record.revokedAt || record.expiresAt <= now) {
    throw new DomainError("This intake PIN has expired. Request a new link.", 410);
  }
  if (record.attemptCount >= record.maxAttempts) {
    throw new DomainError("This intake PIN is locked after too many attempts.", 423);
  }

  const expectedHash = record.pinHash;
  const candidateHash = hashPin(accessKey, pin);
  if (!equalHexHash(expectedHash, candidateHash)) {
    await db.intakeAccessInvite.update({
      where: {
        id: record.id,
      },
      data: {
        attemptCount: record.attemptCount + 1,
        lastAttemptAt: now,
      },
    });
    throw new DomainError("Invalid PIN.", 401);
  }

  const sessionToken = generateSessionToken();
  const sessionExpiresAt = await resolveSessionExpiry(record.expiresAt);

  await db.intakeAccessInvite.update({
    where: {
      id: record.id,
    },
    data: {
      sessionTokenHash: hashSessionToken(sessionToken),
      sessionExpiresAt,
      lastVerifiedAt: now,
    },
  });

  return {
    recipientEmail: record.recipientEmail,
    recipientName: record.recipientName,
    accessKey: record.accessKey,
    sessionToken,
    sessionExpiresAt,
  };
}

export async function setIntakeAccessSessionCookie(
  accessKey: string,
  sessionToken: string,
  expiresAt: Date,
) {
  const cookieStore = await cookies();
  cookieStore.set(intakeCookieNameForAccessKey(accessKey), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function hasValidIntakeAccessSession(accessKey: string) {
  const normalizedAccessKey = accessKey.trim();
  if (!normalizedAccessKey) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(intakeCookieNameForAccessKey(normalizedAccessKey))?.value;
  if (!token) {
    return null;
  }

  const record = await db.intakeAccessInvite.findUnique({
    where: {
      accessKey: normalizedAccessKey,
    },
  });
  if (!record) {
    return null;
  }

  const now = new Date();
  if (record.revokedAt || record.expiresAt <= now) {
    return null;
  }
  if (!record.sessionTokenHash || !record.sessionExpiresAt || record.sessionExpiresAt <= now) {
    return null;
  }

  if (!equalHexHash(record.sessionTokenHash, hashSessionToken(token))) {
    return null;
  }

  return {
    accessKey: record.accessKey,
    recipientEmail: record.recipientEmail,
    recipientName: record.recipientName,
    expiresAt: record.expiresAt,
    usedAt: record.usedAt,
  };
}

export async function requireIntakeAccessOrRedirect(input: {
  accessKey: string;
  nextPath: string;
}) {
  const session = await hasValidIntakeAccessSession(input.accessKey);
  if (!session) {
    const search = new URLSearchParams({
      next: input.nextPath,
    });
    redirect(`/intake/access/${encodeURIComponent(input.accessKey)}?${search.toString()}`);
  }

  return session;
}

export async function markIntakeAccessInviteUsed(accessKey: string) {
  const normalizedAccessKey = accessKey.trim();
  if (!normalizedAccessKey) {
    return;
  }

  await db.intakeAccessInvite.updateMany({
    where: {
      accessKey: normalizedAccessKey,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });
}
