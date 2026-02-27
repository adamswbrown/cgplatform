import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { domainErrorMessage, isDomainError, respondToCaseProposal, getActiveCaseProposal } from "@/lib/case-service";

const respondSchema = z.object({
  accept: z.boolean(),
  responseNote: z.string().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await requireApiUser([UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = respondSchema.parse(await request.json());
    const { id: caseId } = await context.params;

    const proposal = await getActiveCaseProposal(caseId);
    if (!proposal) {
      return NextResponse.json(
        { ok: false, error: "No pending proposal found for this case." },
        { status: 404 },
      );
    }

    const result = await respondToCaseProposal({
      proposalId: proposal.id,
      accept: payload.accept,
      responseNote: payload.responseNote,
      actorUserId: user.id,
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
