import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { getNotifications, getUnreadCount } from "@/lib/notification-service";

export async function GET() {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(user.id, { limit: 30 }),
    getUnreadCount(user.id),
  ]);

  return NextResponse.json({ ok: true, notifications, unreadCount });
}
