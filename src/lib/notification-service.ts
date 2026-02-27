import { NotificationType, UserRole } from "@prisma/client";
import { db } from "@/lib/db";

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  caseId?: string;
  linkUrl?: string;
}) {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      caseId: input.caseId,
      linkUrl: input.linkUrl,
    },
  });
}

export async function createNotificationsForRole(input: {
  role: UserRole;
  type: NotificationType;
  title: string;
  body?: string;
  caseId?: string;
  linkUrl?: string;
}) {
  const users = await db.userAccount.findMany({
    where: { role: input.role },
    select: { id: true },
  });

  if (users.length === 0) return;

  await db.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body,
      caseId: input.caseId,
      linkUrl: input.linkUrl,
    })),
  });
}

export async function getUnreadCount(userId: string) {
  return db.notification.count({
    where: { userId, readAt: null },
  });
}

export async function getNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number; offset?: number },
) {
  return db.notification.findMany({
    where: {
      userId,
      ...(options?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });
}

export async function markRead(notificationId: string, userId: string) {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
