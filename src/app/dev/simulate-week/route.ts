import { NextResponse } from "next/server";
import { z } from "zod";
import {
  allocateCaseAutomatically,
  createCaseFromIntake,
  ingestAvailabilitySubmission,
  ingestFormSubmission,
} from "@/lib/case-service";

const payloadSchema = z
  .object({
    durations: z.array(z.number().int().positive()).optional(),
  })
  .strict();

function buildUniqueEmail(runToken: string, type: "single" | "couple", index: number) {
  return `sim-${runToken}-${type}-${index}@example.local`;
}

function buildWindow(dayOffset: number, startHourUtc: number, endHourUtc: number) {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), startHourUtc, 0, 0, 0),
  );
  start.setUTCDate(start.getUTCDate() + dayOffset);

  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }

  const end = new Date(start);
  end.setUTCHours(endHourUtc, 0, 0, 0);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function buildParticipantAvailabilityWindows(participantType: "single" | "couple", variant: "primary" | "secondary") {
  if (participantType === "single") {
    return [buildWindow(2, 9, 12), buildWindow(3, 13, 17)];
  }

  if (variant === "primary") {
    return [buildWindow(2, 10, 13), buildWindow(4, 14, 17)];
  }

  return [buildWindow(2, 11, 14), buildWindow(4, 15, 17)];
}

async function completeBlockingForms(
  caseId: string,
  participants: { primaryEmail: string; secondaryEmail?: string },
  type: "single" | "couple",
) {
  await ingestFormSubmission({
    caseId,
    participantIdentifier: participants.primaryEmail,
    formType: "INTAKE_FORM",
    source: "dev_simulator",
    metadata: {
      simulated: true,
    },
  });

  if (type === "couple") {
    await ingestFormSubmission({
      caseId,
      participantIdentifier: participants.primaryEmail,
      formType: "AGREEMENT_FORM",
      source: "dev_simulator",
      metadata: {
        simulated: true,
      },
    });

    await ingestFormSubmission({
      caseId,
      participantIdentifier: participants.secondaryEmail || participants.primaryEmail,
      formType: "INTAKE_FORM",
      source: "dev_simulator",
      metadata: {
        simulated: true,
      },
    });

    await ingestFormSubmission({
      caseId,
      participantIdentifier: participants.primaryEmail,
      formType: "CONSENT_FORM",
      source: "dev_simulator",
      metadata: {
        simulated: true,
      },
    });

    await ingestFormSubmission({
      caseId,
      participantIdentifier: participants.secondaryEmail || participants.primaryEmail,
      formType: "CONSENT_FORM",
      source: "dev_simulator",
      metadata: {
        simulated: true,
      },
    });
  }

  await ingestAvailabilitySubmission({
    caseId,
    participantIdentifier: participants.primaryEmail,
    timezone: "UTC",
    source: "dev_simulator",
    windows: buildParticipantAvailabilityWindows(type, "primary"),
    metadata: {
      simulated: true,
    },
  });

  if (type === "couple") {
    await ingestAvailabilitySubmission({
      caseId,
      participantIdentifier: participants.secondaryEmail || participants.primaryEmail,
      timezone: "UTC",
      source: "dev_simulator",
      windows: buildParticipantAvailabilityWindows(type, "secondary"),
      metadata: {
        simulated: true,
      },
    });
  }
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
      counsellingType: "individual",
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
      await completeBlockingForms(
        single.caseId,
        { primaryEmail: buildUniqueEmail(runToken, "single", index) },
        "single",
      );
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
    const couplePrimaryEmail = buildUniqueEmail(runToken, "couple", index);
    const coupleSecondaryEmail = buildUniqueEmail(runToken, "couple", index + 1000);
    const couple = await createCaseFromIntake({
      counsellingType: "couples",
      primary: {
        firstName: "Sim",
        lastName: `CoupleA${index}`,
        email: couplePrimaryEmail,
      },
      secondary: {
        firstName: "Sim",
        lastName: `CoupleB${index}`,
        email: coupleSecondaryEmail,
      },
      notes: `Simulated couple booking ${duration}m`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    let coupleAllocationError: string | null = null;
    try {
      await completeBlockingForms(
        couple.caseId,
        {
          primaryEmail: couplePrimaryEmail,
          secondaryEmail: coupleSecondaryEmail,
        },
        "couple",
      );
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
