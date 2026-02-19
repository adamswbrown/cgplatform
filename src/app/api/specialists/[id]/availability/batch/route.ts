import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import {
  addSpecialistAvailabilityPresetBatch,
  domainErrorMessage,
  isDomainError,
} from "@/lib/case-service";

const batchSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  blocks: z.array(z.enum(["MORNING", "AFTERNOON", "EVENING"])).min(1),
  availabilityType: z.enum(["AVAILABLE", "OUT_OF_OFFICE"]).optional(),
  timezone: z.string().optional(),
});

type BatchAvailabilityRouteContext = {
  params: Promise<{ id: string }>;
};

function canManageAvailability(
  user: NonNullable<Awaited<ReturnType<typeof requireApiUser>>>,
  specialistId: string,
) {
  if (user.role === UserRole.OPS) {
    return true;
  }
  return user.role === UserRole.SPECIALIST && user.specialistId === specialistId;
}

export async function POST(request: Request, context: BatchAvailabilityRouteContext) {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!canManageAvailability(user, id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = batchSchema.parse(await request.json());
    const availabilityType = payload.availabilityType || "AVAILABLE";
    const data = await addSpecialistAvailabilityPresetBatch({
      specialistId: id,
      startDate: payload.startDate,
      endDate: payload.endDate,
      blocks: payload.blocks,
      availabilityType,
      actorUserId: user.id,
      timezone: payload.timezone,
      source:
        availabilityType === "OUT_OF_OFFICE"
          ? user.role === UserRole.OPS
            ? "ops_calendar_preset_out_of_office"
            : "specialist_calendar_preset_out_of_office"
          : user.role === UserRole.OPS
            ? "ops_calendar_preset"
            : "specialist_calendar_preset",
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.issues[0]?.message || "Invalid payload" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: domainErrorMessage(error) },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}
