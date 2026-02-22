import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { syncMicrosoftBookingsAppointments } from "@/lib/scheduling/microsoft-bookings-sync";

function hasValidSyncSecret(request: Request) {
  const configuredSecret = String(process.env.MICROSOFT_BOOKINGS_SYNC_SECRET || "").trim();
  if (!configuredSecret) {
    return false;
  }

  const providedSecret = String(request.headers.get("x-provider-sync-key") || "").trim();
  return providedSecret.length > 0 && providedSecret === configuredSecret;
}

export async function POST(request: Request) {
  const authorizedBySecret = hasValidSyncSecret(request);
  if (!authorizedBySecret) {
    const user = await requireApiUser([UserRole.OPS]);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const data = await syncMicrosoftBookingsAppointments();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Microsoft Bookings sync failed.",
      },
      { status: 500 },
    );
  }
}
