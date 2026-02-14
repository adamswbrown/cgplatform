import { NextResponse } from "next/server";
import { CaseStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { domainErrorMessage, isDomainError, transitionCaseStatus } from "@/lib/case-service";

const transitionSchema = z.object({
  targetStatus: z.nativeEnum(CaseStatus),
  reason: z.string().optional(),
});

type TransitionRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: TransitionRouteContext) {
  const user = await requireApiUser([UserRole.OPS]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = transitionSchema.parse(await request.json());
    const { id } = await context.params;

    const data = await transitionCaseStatus({
      caseId: id,
      targetStatus: payload.targetStatus,
      reason: payload.reason,
      actorUserId: user.id,
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid payload",
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
