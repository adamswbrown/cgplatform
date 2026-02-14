import { SessionStatus } from "@prisma/client";
import type {
  BookingResult,
  SchedulingCaseData,
  SchedulingEventType,
  SchedulingPersistence,
  SchedulingProvider,
} from "@/lib/scheduling/types";
import { sendProviderEventWebhook } from "@/lib/scheduling/provider-events-client";

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION] as const;
const SLOT_INCREMENT_MINUTES = 10;
const HORIZON_DAYS = 14;

const WORK_WINDOWS = [
  { startHour: 9, endHour: 12 },
  { startHour: 13, endHour: 17 },
] as const;

type ExistingBooking = {
  providerStartTime: Date;
  providerEndTime: Date;
};

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function overlaps(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function normalizeDuration(durationMinutes: number) {
  const parsed = Number(durationMinutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid scheduling duration: ${durationMinutes}`);
  }

  return Math.round(parsed);
}

function makeUtcDate(base: Date, hours: number, minutes: number) {
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      hours,
      minutes,
      0,
      0,
    ),
  );
}

function makeDeterministicBookingId(
  specialistId: string,
  caseData: SchedulingCaseData,
  startTime: Date,
) {
  const compact = startTime.toISOString().replace(/[-:.TZ]/g, "");
  return `fake-${specialistId}-${caseData.caseId}-${caseData.durationMinutes}-${compact}`;
}

export class FakeSchedulingProvider implements SchedulingProvider {
  constructor(private readonly persistence: SchedulingPersistence) {}

  private async getExistingBookings(specialistId: string) {
    const sessions = await this.persistence.session.findMany({
      where: {
        specialistId,
        status: {
          in: [...ACTIVE_SESSION_STATUSES],
        },
      },
      select: {
        providerStartTime: true,
        providerEndTime: true,
      },
    });

    return sessions as ExistingBooking[];
  }

  private generateCandidateSlots(reference: Date, durationMinutes: number) {
    const slots: Date[] = [];
    const durationMs = durationMinutes * 60_000;
    const startOfTodayUtc = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
    );

    for (let dayOffset = 0; dayOffset < HORIZON_DAYS; dayOffset += 1) {
      const day = new Date(startOfTodayUtc);
      day.setUTCDate(day.getUTCDate() + dayOffset);

      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        continue;
      }

      for (const window of WORK_WINDOWS) {
        const windowStart = makeUtcDate(day, window.startHour, 0).getTime();
        const windowEnd = makeUtcDate(day, window.endHour, 0).getTime();

        for (
          let candidateStart = windowStart;
          candidateStart + durationMs <= windowEnd;
          candidateStart += SLOT_INCREMENT_MINUTES * 60_000
        ) {
          const candidate = new Date(candidateStart);
          if (candidate > reference) {
            slots.push(candidate);
          }
        }
      }
    }

    return slots;
  }

  async getAvailableSlots(
    specialistId: string,
    _eventType: SchedulingEventType,
    durationMinutes: number,
  ) {
    const normalizedDuration = normalizeDuration(durationMinutes);
    const now = new Date();
    const candidates = this.generateCandidateSlots(now, normalizedDuration);
    const existing = await this.getExistingBookings(specialistId);

    return candidates.filter((candidate) => {
      const candidateEnd = addMinutes(candidate, normalizedDuration);
      return !existing.some((booking) =>
        overlaps(candidate, candidateEnd, booking.providerStartTime, booking.providerEndTime),
      );
    });
  }

  async createBooking(
    specialistId: string,
    startTime: Date,
    caseData: SchedulingCaseData,
  ): Promise<BookingResult> {
    const normalizedDuration = normalizeDuration(caseData.durationMinutes);
    const candidate = new Date(startTime);

    if (Number.isNaN(candidate.getTime())) {
      throw new Error("Invalid booking start time.");
    }

    const available = await this.getAvailableSlots(
      specialistId,
      caseData.eventType,
      normalizedDuration,
    );

    const isAvailable = available.some((slot) => slot.getTime() === candidate.getTime());
    if (!isAvailable) {
      throw new Error("Selected slot is no longer available.");
    }

    return {
      bookingId: makeDeterministicBookingId(specialistId, caseData, candidate),
      startTime: candidate,
      endTime: addMinutes(candidate, normalizedDuration),
      providerType: "fake",
    };
  }

  async cancelBooking(bookingId: string) {
    await sendProviderEventWebhook({
      provider: "fake",
      type: "booking.cancelled",
      bookingId,
    });
  }
}
