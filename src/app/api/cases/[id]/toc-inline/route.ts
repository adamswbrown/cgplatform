import { NextResponse } from "next/server";
import { z } from "zod";
import {
  domainErrorMessage,
  ingestFormSubmission,
  isDomainError,
} from "@/lib/case-service";
import { db } from "@/lib/db";

const tocInlineSchema = z.object({
  participantIdentifier: z.string().email(),
  accessKey: z.string().min(1),
  metadata: z.object({
    acceptedTerms: z.boolean(),
    acceptedDataPolicy: z.boolean(),
    printedName: z.string().min(1),
    signedDate: z.string().min(1),
    signatureType: z.enum(["typed", "drawn"]),
    signature: z.string().min(1),
    submittedAt: z.string(),
    termsVersion: z.string(),
  }),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = tocInlineSchema.parse(await request.json());
    const { id: caseId } = await context.params;

    // Authenticate via the slot response FormAccessPin (still valid after acceptance)
    const pin = await db.formAccessPin.findFirst({
      where: {
        caseId,
        accessKey: payload.accessKey,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!pin) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired access key." },
        { status: 401 },
      );
    }

    const result = await ingestFormSubmission({
      caseId,
      participantIdentifier: payload.participantIdentifier,
      formType: "TERMS_AND_CONDITIONS",
      source: "slot_acceptance_inline",
      metadata: payload.metadata,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.issues[0]?.message || "Invalid payload" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: domainErrorMessage(error) },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}
