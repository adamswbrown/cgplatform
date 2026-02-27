import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiUser } from "@/lib/auth";
import { syncOutlookCalendarToAvailability } from "@/lib/outlook-availability-sync";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser([UserRole.OPS]);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id: specialistId } = await context.params;

    const body = (await request.json().catch(() => ({}))) as {
      days?: number;
    };

    const result = await syncOutlookCalendarToAvailability({
      specialistId,
      actorUserId: user.id,
      days: body.days,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed.",
      },
      { status: 500 },
    );
  }
}
