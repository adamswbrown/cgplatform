import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { markRead } from "@/lib/notification-service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  await markRead(id, user.id);

  return NextResponse.json({ ok: true });
}
