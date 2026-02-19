import { compare } from "bcryptjs";
import { randomBytes } from "crypto";
import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const SESSION_COOKIE = "cg_session";
const SESSION_DAYS = 7;
const EXPIRED_SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastExpiredSessionCleanupAt = 0;

function buildToken() {
  return randomBytes(32).toString("hex");
}

function getSessionExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  return expiresAt;
}

export async function signInWithPassword(email: string, password: string) {
  const user = await db.userAccount.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      specialistId: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return null;
  }

  const isValid = await compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  const token = buildToken();
  const expiresAt = getSessionExpiryDate();

  await db.authSession.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return user;
}

export async function signOut() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.authSession.deleteMany({
      where: { token },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const now = new Date();
  const nowMs = now.getTime();
  if (nowMs - lastExpiredSessionCleanupAt >= EXPIRED_SESSION_CLEANUP_INTERVAL_MS) {
    lastExpiredSessionCleanupAt = nowMs;
    void db.authSession
      .deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      })
      .catch(() => {
        // Best-effort cleanup; auth checks should never fail because cleanup failed.
      });
  }

  const session = await db.authSession.findUnique({
    where: {
      token,
    },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          specialistId: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt < now) {
    void db.authSession.deleteMany({ where: { token } }).catch(() => {
      // Best-effort cleanup; stale session rows should not block request flow.
    });
    return null;
  }

  return session.user;
}

function fallbackRouteForRole(role: UserRole) {
  if (role === UserRole.SPECIALIST) {
    return "/specialist/sessions";
  }
  return "/admin/cases";
}

export async function requirePageUser(roles?: UserRole[]) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (roles && !roles.includes(user.role)) {
    redirect(fallbackRouteForRole(user.role));
  }

  return user;
}

export async function requireApiUser(roles?: UserRole[]) {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  if (roles && !roles.includes(user.role)) {
    return null;
  }

  return user;
}

export function destinationForUserRole(role: UserRole) {
  return fallbackRouteForRole(role);
}
