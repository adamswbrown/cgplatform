import { NextResponse } from "next/server";
import { z } from "zod";
import { domainErrorMessage, isDomainError } from "@/lib/case-service";
import {
  setIntakeAccessSessionCookie,
  verifyIntakeAccessInvite,
} from "@/lib/form-access";

const verifySchema = z
  .object({
    accessKey: z.string().min(1),
    pin: z.string().min(1),
    next: z.string().optional(),
  })
  .strict();

function resolveRedirectPath(accessKey: string, nextPath: string | undefined) {
  const fallback = `/intake?accessKey=${encodeURIComponent(accessKey)}`;
  const target = nextPath?.trim() || fallback;
  if (!target.startsWith("/")) {
    return fallback;
  }

  const url = new URL(target, "http://localhost");
  if (!url.searchParams.get("accessKey")) {
    url.searchParams.set("accessKey", accessKey);
  }
  return `${url.pathname}${url.search}`;
}

function extractIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }
  return forwardedFor.split(",")[0]?.trim() || null;
}

export async function POST(request: Request) {
  try {
    const payload = verifySchema.parse(await request.json());
    const verified = await verifyIntakeAccessInvite({
      accessKey: payload.accessKey,
      pin: payload.pin,
      ipAddress: extractIpAddress(request),
      userAgent: request.headers.get("user-agent"),
    });

    await setIntakeAccessSessionCookie(
      verified.accessKey,
      verified.sessionToken,
      verified.sessionExpiresAt,
    );

    const redirectTo = resolveRedirectPath(verified.accessKey, payload.next);

    return NextResponse.json(
      {
        ok: true,
        data: {
          redirectTo,
          sessionExpiresAt: verified.sessionExpiresAt.toISOString(),
          recipientEmail: verified.recipientEmail,
          recipientName: verified.recipientName,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid payload.",
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
