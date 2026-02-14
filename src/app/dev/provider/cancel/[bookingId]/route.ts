import { NextResponse } from "next/server";
import { handleProviderBookingEvent } from "@/lib/scheduling/events";

type CancelRouteContext = {
  params: Promise<{ bookingId: string }>;
};

export async function POST(_request: Request, context: CancelRouteContext) {
  const { bookingId } = await context.params;
  if (!bookingId?.trim()) {
    return NextResponse.json({ ok: false, error: "bookingId is required." }, { status: 400 });
  }

  try {
    const result = await handleProviderBookingEvent({
      provider: "fake",
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
