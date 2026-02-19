import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleProviderBookingEvent } from "@/lib/scheduling/events";
import type { SchedulingProviderType } from "@/lib/scheduling/types";

type CancelRouteContext = {
  params: Promise<{ bookingId: string }>;
};

export async function POST(_request: Request, context: CancelRouteContext) {
  const { bookingId } = await context.params;
  if (!bookingId?.trim()) {
    return NextResponse.json({ ok: false, error: "bookingId is required." }, { status: 400 });
  }

  try {
    const booking = await db.session.findUnique({
      where: {
        providerBookingId: bookingId.trim(),
      },
      select: {
        providerType: true,
      },
    });

    const allowedProviders: SchedulingProviderType[] = [
      "manual",
      "calcom",
      "microsoft_bookings",
    ];
    const provider = allowedProviders.includes(
      (booking?.providerType || "") as SchedulingProviderType,
    )
      ? (booking?.providerType as SchedulingProviderType)
      : "manual";

    const result = await handleProviderBookingEvent({
      provider,
      type: "booking.cancelled",
      bookingId: bookingId.trim(),
    });

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to simulate provider cancellation.",
      },
      { status: 500 },
    );
  }
}
