import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { domainErrorMessage, isDomainError, removeSpecialistAvailabilitySlot } from "@/lib/case-service";

type RemoveAvailabilityRouteContext = {
  params: Promise<{ id: string; windowId: string }>;
};

function canManageAvailability(user: NonNullable<Awaited<ReturnType<typeof requireApiUser>>>, specialistId: string) {
  if (user.role === UserRole.OPS) {
    return true;
  }
  return user.role === UserRole.SPECIALIST && user.specialistId === specialistId;
}

export async function DELETE(_request: Request, context: RemoveAvailabilityRouteContext) {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id, windowId } = await context.params;
  if (!canManageAvailability(user, id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const data = await removeSpecialistAvailabilitySlot({
      specialistId: id,
      availabilityWindowId: windowId,
      actorUserId: user.id,
      reason: user.role === UserRole.OPS ? "Removed by ops calendar editor" : "Removed by counsellor",
    });
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
