import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { allocateCaseAutomatically, domainErrorMessage, isDomainError } from "@/lib/case-service";

type AllocateRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: AllocateRouteContext) {
  const user = await requireApiUser([UserRole.OPS]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const data = await allocateCaseAutomatically(id, user.id);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: domainErrorMessage(error),
      },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}
