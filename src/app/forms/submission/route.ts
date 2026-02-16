import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DomainError,
  domainErrorMessage,
  ingestAvailabilitySubmission,
  ingestFormSubmission,
  isDomainError,
} from "@/lib/case-service";
import { db } from "@/lib/db";
import { hasValidFormAccessSession } from "@/lib/form-access";

const AVAILABILITY_SUBMISSION_FORM_TYPE = "AVAILABILITY_SUBMISSION";

const formSubmissionSchema = z
  .object({
    formType: z.string().min(1),
    participantIdentifier: z.string().min(1),
    caseId: z.string().optional(),
    caseReference: z.string().optional(),
    accessKey: z.string().optional(),
    answersMetadata: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    source: z.string().optional(),
    timezone: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.participantIdentifier.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "participantIdentifier is required.",
        path: ["participantIdentifier"],
      });
    }
  });

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

async function assertPinGateIfRequired(payload: {
  formType: string;
  participantIdentifier: string;
  caseId?: string;
  caseReference?: string;
  accessKey?: string;
}) {
  const normalizedParticipant = normalizeIdentifier(payload.participantIdentifier);
  const caseFilters = [];
  if (payload.caseId) {
    caseFilters.push({ caseId: payload.caseId });
  }
  if (payload.caseReference) {
    caseFilters.push({ case: { reference: payload.caseReference } });
  }

  if (caseFilters.length === 0) {
    return;
  }

  const activePin = await db.formAccessPin.findFirst({
    where: {
      formType: payload.formType,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
      OR: caseFilters,
      client: {
        OR: [{ id: payload.participantIdentifier }, { email: normalizedParticipant }],
      },
    },
    include: {
      client: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!activePin) {
    return;
  }

  if (!payload.accessKey) {
    throw new DomainError("This form requires PIN verification before submission.", 401);
  }

  const session = await hasValidFormAccessSession({
    accessKey: payload.accessKey,
    formType: payload.formType,
  });
  if (!session) {
    throw new DomainError("PIN session is invalid or expired. Please verify PIN again.", 401);
  }

  if (session.caseId !== activePin.caseId) {
    throw new DomainError("PIN session does not match this case.", 401);
  }

  if (
    normalizeIdentifier(session.participantEmail) !== normalizeIdentifier(activePin.client.email)
  ) {
    throw new DomainError("PIN session does not match this participant.", 401);
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const payload = formSubmissionSchema.parse(json);
    const metadata = payload.metadata || payload.answersMetadata || {};
    const normalizedFormType = payload.formType.trim().toUpperCase();

    await assertPinGateIfRequired({
      formType: normalizedFormType,
      participantIdentifier: payload.participantIdentifier,
      caseId: payload.caseId,
      caseReference: payload.caseReference,
      accessKey: payload.accessKey,
    });

    if (normalizedFormType === AVAILABILITY_SUBMISSION_FORM_TYPE) {
      const windowsValue = (metadata as { windows?: unknown }).windows;
      if (!Array.isArray(windowsValue) || windowsValue.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "AVAILABILITY_SUBMISSION requires metadata.windows with startTime and endTime values.",
          },
          { status: 400 },
        );
      }

      const windows = windowsValue.map((value) => {
        const candidate = value as { startTime?: unknown; endTime?: unknown };
        return {
          startTime: String(candidate.startTime || ""),
          endTime: String(candidate.endTime || ""),
        };
      });

      const data = await ingestAvailabilitySubmission({
        participantIdentifier: payload.participantIdentifier,
        caseId: payload.caseId,
        caseReference: payload.caseReference,
        timezone:
          payload.timezone ||
          (metadata as { timezone?: unknown }).timezone?.toString() ||
          "UTC",
        windows,
        metadata,
        source: payload.source || "external_form",
      });

      return NextResponse.json(
        {
          ok: true,
          data,
        },
        { status: 200 },
      );
    }

    const result = await ingestFormSubmission({
      formType: payload.formType,
      participantIdentifier: payload.participantIdentifier,
      caseId: payload.caseId,
      caseReference: payload.caseReference,
      metadata,
      source: payload.source || "external_form",
    });

    return NextResponse.json(
      {
        ok: true,
        data: result,
      },
      { status: 200 },
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
