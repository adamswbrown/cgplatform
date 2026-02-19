import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import {
  canUserOverride,
  domainErrorMessage,
  isDomainError,
  unassignCaseAssignment,
} from "@/lib/case-service";

const unassignSchema = z.object({
  reason: z.string().min(1),
});

type UnassignRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: UnassignRouteContext) {
  const user = await requireApiUser([UserRole.OPS]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canUserOverride(user.id);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "User is not allowed to override assignments." },
      { status: 403 },
    );
  }

  try {
    const payload = unassignSchema.parse(await request.json());
    const { id } = await context.params;

    const data = await unassignCaseAssignment({
      caseId: id,
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
