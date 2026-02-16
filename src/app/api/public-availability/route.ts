import { NextResponse } from "next/server";
import { z } from "zod";
import { listPublicAvailabilitySlots } from "@/lib/public-availability";

const querySchema = z.object({
  counsellingType: z.string().default("individual"),
  durationMinutes: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  location: z.string().optional(),
  includeOnline: z.coerce.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      counsellingType: url.searchParams.get("counsellingType") || "individual",
      durationMinutes: url.searchParams.get("durationMinutes") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      location: url.searchParams.get("location") || undefined,
      includeOnline: url.searchParams.get("includeOnline") || undefined,
    });

    const slots = await listPublicAvailabilitySlots(query);
    return NextResponse.json({ ok: true, data: { slots } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid query",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load availability.",
      },
      { status: 500 },
    );
  }
}
