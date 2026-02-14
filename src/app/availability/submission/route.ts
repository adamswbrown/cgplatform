import { NextResponse } from "next/server";
import { z } from "zod";
import {
  domainErrorMessage,
  ingestAvailabilitySubmission,
  isDomainError,
} from "@/lib/case-service";

const availabilitySubmissionSchema = z
  .object({
    participantIdentifier: z.string().min(1),
    caseId: z.string().optional(),
    caseReference: z.string().optional(),
    timezone: z.string().optional(),
    source: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    windows: z
      .array(
        z
          .object({
            startTime: z.string().min(1),
            endTime: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
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

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const payload = availabilitySubmissionSchema.parse(json);

    const data = await ingestAvailabilitySubmission({
      participantIdentifier: payload.participantIdentifier,
      caseId: payload.caseId,
      caseReference: payload.caseReference,
      timezone: payload.timezone,
      source: payload.source || "availability_form",
      metadata: payload.metadata,
      windows: payload.windows,
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
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
