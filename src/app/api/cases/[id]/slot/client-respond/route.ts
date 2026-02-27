import { NextResponse } from "next/server";
import { z } from "zod";
import { domainErrorMessage, isDomainError, respondToSlotAsClient, getActiveSlotProposal } from "@/lib/case-service";
import { db } from "@/lib/db";

const respondSchema = z.object({
  accept: z.boolean(),
  tocAccepted: z.boolean().optional(),
  counterProposedStartTime: z.string().datetime().optional(),
  counterProposedEndTime: z.string().datetime().optional(),
  accessKey: z.string().min(1),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = respondSchema.parse(await request.json());
    const { id: caseId } = await context.params;

    // Authenticate via FormAccessPin
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

    const slot = await getActiveSlotProposal(caseId);
    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "No pending slot proposal found." },
        { status: 404 },
      );
    }

    const result = await respondToSlotAsClient({
      slotProposalId: slot.id,
      accept: payload.accept,
      tocAccepted: payload.tocAccepted,
      counterProposedStartTime: payload.counterProposedStartTime
        ? new Date(payload.counterProposedStartTime)
        : undefined,
      counterProposedEndTime: payload.counterProposedEndTime
        ? new Date(payload.counterProposedEndTime)
        : undefined,
    });

    // If accepted, include participant info for inline ToC form
    if (payload.accept) {
      const caseRecord = await db.case.findUnique({
        where: { id: caseId },
        include: {
          participants: {
            where: { role: "PRIMARY" },
            include: { client: { select: { email: true, firstName: true, lastName: true } } },
          },
        },
      });

      const primaryParticipant = caseRecord?.participants[0]?.client;
      return NextResponse.json({
        ok: true,
        data: result,
        tocInfo: primaryParticipant
          ? {
              caseId,
              participantEmail: primaryParticipant.email,
              participantName: `${primaryParticipant.firstName} ${primaryParticipant.lastName}`.trim(),
            }
          : null,
      });
    }

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
