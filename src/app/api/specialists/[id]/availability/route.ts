import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import {
  addSpecialistAvailabilitySlot,
  domainErrorMessage,
  getSpecialistAvailabilityCalendar,
  isDomainError,
} from "@/lib/case-service";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
});

const createSlotSchema = z.object({
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  availabilityType: z.enum(["AVAILABLE", "OUT_OF_OFFICE"]).optional(),
  timezone: z.string().optional(),
  notes: z.string().optional(),
});

type AvailabilityRouteContext = {
  params: Promise<{ id: string }>;
};

function canManageAvailability(user: NonNullable<Awaited<ReturnType<typeof requireApiUser>>>, specialistId: string) {
  if (user.role === UserRole.OPS) {
    return true;
  }
  return user.role === UserRole.SPECIALIST && user.specialistId === specialistId;
}

export async function GET(request: Request, context: AvailabilityRouteContext) {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!canManageAvailability(user, id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      days: url.searchParams.get("days") || undefined,
      startDate: url.searchParams.get("startDate") || undefined,
    });

    const data = await getSpecialistAvailabilityCalendar(id, query.days, query.startDate);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.issues[0]?.message || "Invalid query" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: domainErrorMessage(error) },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}

export async function POST(request: Request, context: AvailabilityRouteContext) {
  const user = await requireApiUser([UserRole.OPS, UserRole.SPECIALIST]);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!canManageAvailability(user, id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = createSlotSchema.parse(await request.json());
    const availabilityType = payload.availabilityType || "AVAILABLE";
    const data = await addSpecialistAvailabilitySlot({
      specialistId: id,
      startTime: payload.startTime,
      endTime: payload.endTime,
      availabilityType,
      timezone: payload.timezone,
      notes: payload.notes,
      actorUserId: user.id,
      source:
        availabilityType === "OUT_OF_OFFICE"
          ? user.role === UserRole.OPS
            ? "ops_calendar_out_of_office"
            : "specialist_calendar_out_of_office"
          : user.role === UserRole.OPS
            ? "ops_calendar"
            : "specialist_calendar",
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: data.id,
        specialistId: data.specialistId,
        startTime: data.startTime.toISOString(),
        endTime: data.endTime.toISOString(),
        availabilityType: data.availabilityType,
        timezone: data.timezone,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid payload",
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
