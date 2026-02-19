import { NextResponse } from "next/server";
import { z } from "zod";
import {
  handleProviderBookingEvent,
  type ProviderBookingEvent,
} from "@/lib/scheduling/events";

const providerEventSchema = z
  .object({
    provider: z.enum(["manual", "calcom", "microsoft_bookings"]),
    type: z.enum(["booking.created", "booking.cancelled", "booking.rescheduled"]),
    bookingId: z.string().min(1),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStart = typeof value.startTime === "string";
    const hasEnd = typeof value.endTime === "string";

    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startTime and endTime must be provided together.",
      });
    }

    if (value.type === "booking.rescheduled" && (!hasStart || !hasEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "booking.rescheduled requires startTime and endTime.",
      });
    }

    for (const [field, fieldValue] of [
      ["startTime", value.startTime],
      ["endTime", value.endTime],
    ] as const) {
      if (!fieldValue) {
        continue;
      }

      const parsed = new Date(fieldValue);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must be a valid ISO datetime.`,
          path: [field],
        });
      }
    }
  });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProviderBookingEvent;
    const payload = providerEventSchema.parse(body);

    const result = await handleProviderBookingEvent(payload);

    return NextResponse.json({
      ok: true,
      data: result,
    });
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
        error: error instanceof Error ? error.message : "Failed to ingest provider event.",
      },
      { status: 500 },
    );
  }
}
