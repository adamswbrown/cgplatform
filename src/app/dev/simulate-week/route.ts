import { NextResponse } from "next/server";
import { z } from "zod";
import { allocateCaseAutomatically, createCaseFromIntake } from "@/lib/case-service";

const payloadSchema = z
  .object({
    durations: z.array(z.number().int().positive()).optional(),
  })
  .strict();

function buildUniqueEmail(runToken: string, type: "single" | "couple", index: number) {
  return `sim-${runToken}-${type}-${index}@example.local`;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not available in production." }, { status: 404 });
  }

  let durations = [30, 60, 90];

  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      const parsed = payloadSchema.parse(JSON.parse(text));
      if (parsed.durations && parsed.durations.length > 0) {
        durations = parsed.durations;
      }
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const runToken = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const created: Array<{
    caseId: string;
    reference: string;
    type: "single" | "couple";
    durationMinutes: number;
    allocationError: string | null;
  }> = [];

  let index = 0;
  for (const duration of durations) {
    index += 1;
    const single = await createCaseFromIntake({
      primary: {
        firstName: "Sim",
        lastName: `Single${index}`,
        email: buildUniqueEmail(runToken, "single", index),
      },
      notes: `Simulated single booking ${duration}m`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    let singleAllocationError: string | null = null;
    try {
      await allocateCaseAutomatically(single.caseId);
    } catch (error) {
      singleAllocationError = error instanceof Error ? error.message : "Allocation failed";
    }

    created.push({
      caseId: single.caseId,
      reference: single.reference,
      type: "single",
      durationMinutes: duration,
      allocationError: singleAllocationError,
    });

    index += 1;
    const couple = await createCaseFromIntake({
      primary: {
        firstName: "Sim",
        lastName: `CoupleA${index}`,
        email: buildUniqueEmail(runToken, "couple", index),
      },
      secondary: {
        firstName: "Sim",
        lastName: `CoupleB${index}`,
        email: buildUniqueEmail(runToken, "couple", index + 1000),
      },
      notes: `Simulated couple booking ${duration}m`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    let coupleAllocationError: string | null = null;
    try {
      await allocateCaseAutomatically(couple.caseId);
    } catch (error) {
      coupleAllocationError = error instanceof Error ? error.message : "Allocation failed";
    }

    created.push({
      caseId: couple.caseId,
      reference: couple.reference,
      type: "couple",
      durationMinutes: duration,
      allocationError: coupleAllocationError,
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      count: created.length,
      created,
    },
  });
}
