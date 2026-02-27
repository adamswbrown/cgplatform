import { SessionStatus } from "@prisma/client";
import { getOperationalSettings } from "@/lib/admin-settings";
import type {
  BookingResult,
  SchedulingCaseData,
  SchedulingEventType,
  SchedulingPersistence,
  SchedulingProviderType,
  SchedulingProvider,
} from "@/lib/scheduling/types";
import { sendProviderEventWebhook } from "@/lib/scheduling/provider-events-client";

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION] as const;

type ExistingBooking = {
  providerStartTime: Date;
  providerEndTime: Date;
};

type ExistingAvailabilityWindow = {
  id: string;
  availabilityType: "AVAILABLE" | "OUT_OF_OFFICE";
  startTime: Date;
  endTime: Date;
};

export type ManualSchedulingProviderOptions = {
  providerType?: Extract<SchedulingProviderType, "manual">;
};

type ManualProviderPolicy = {
  horizonDays: number;
  slotIncrementMinutes: number;
  workWindows: Array<{
    startMinuteOfDay: number;
    endMinuteOfDay: number;
  }>;
};

type SpecialistWorkingHours = {
  startHour: number;
  endHour: number;
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
  return `manual-${specialistId}-${caseData.caseId}-${caseData.durationMinutes}-${compact}`;
}

export class ManualSchedulingProvider implements SchedulingProvider {
  private readonly providerType: Extract<SchedulingProviderType, "manual">;
  private policyPromise: Promise<ManualProviderPolicy> | null = null;

  constructor(
    private readonly persistence: SchedulingPersistence,
    options: ManualSchedulingProviderOptions = {},
  ) {
    this.providerType = options.providerType || "manual";
  }

  private async getPolicy(): Promise<ManualProviderPolicy> {
    if (!this.policyPromise) {
      this.policyPromise = getOperationalSettings().then((operationalSettings) => ({
        horizonDays: operationalSettings.manualProviderHorizonDays,
        slotIncrementMinutes: operationalSettings.manualProviderSlotIncrementMinutes,
        workWindows: [
          {
            startMinuteOfDay: operationalSettings.manualProviderMorningStartMinute,
            endMinuteOfDay: operationalSettings.manualProviderMorningEndMinute,
          },
          {
            startMinuteOfDay: operationalSettings.manualProviderAfternoonStartMinute,
            endMinuteOfDay: operationalSettings.manualProviderAfternoonEndMinute,
          },
          {
            startMinuteOfDay: operationalSettings.manualProviderEveningStartMinute,
            endMinuteOfDay: operationalSettings.manualProviderEveningEndMinute,
          },
        ],
      }));
    }

    return this.policyPromise;
  }

  private async getSpecialistWorkingHours(specialistId: string) {
    const specialist = await this.persistence.specialist.findUnique({
      where: {
        id: specialistId,
      },
      select: {
        standardStartHour: true,
        standardEndHour: true,
      },
    });
    if (!specialist) {
      return {
        startHour: 9,
        endHour: 18,
      } satisfies SpecialistWorkingHours;
    }

    const startHour = Number.isFinite(specialist.standardStartHour)
      ? Math.max(0, Math.min(22, Math.round(specialist.standardStartHour)))
      : 9;
    const endHour = Number.isFinite(specialist.standardEndHour)
      ? Math.max(1, Math.min(23, Math.round(specialist.standardEndHour)))
      : 18;

    if (endHour <= startHour) {
      return {
        startHour: 9,
        endHour: 18,
      } satisfies SpecialistWorkingHours;
    }

    return {
      startHour,
      endHour,
    } satisfies SpecialistWorkingHours;
  }

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

  private async getAvailabilityWindows(specialistId: string, reference: Date) {
    const windows = await this.persistence.specialistAvailabilityWindow.findMany({
      where: {
        specialistId,
        active: true,
        endTime: {
          gt: reference,
        },
      },
      select: {
        id: true,
        availabilityType: true,
        startTime: true,
        endTime: true,
      },
      orderBy: {
        startTime: "asc",
      },
    });

    return windows as ExistingAvailabilityWindow[];
  }

  private generateCandidateSlots(
    reference: Date,
    durationMinutes: number,
    policy: ManualProviderPolicy,
    workingHours: SpecialistWorkingHours,
  ) {
    const slots: Date[] = [];
    const durationMs = durationMinutes * 60_000;
    const startOfTodayUtc = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
    );

    for (let dayOffset = 0; dayOffset < policy.horizonDays; dayOffset += 1) {
      const day = new Date(startOfTodayUtc);
      day.setUTCDate(day.getUTCDate() + dayOffset);

      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        continue;
      }

      for (const window of policy.workWindows) {
        const startMinute = Math.max(window.startMinuteOfDay, workingHours.startHour * 60);
        const endMinute = Math.min(window.endMinuteOfDay, workingHours.endHour * 60);
        if (endMinute <= startMinute) {
          continue;
        }

        const windowStart = makeUtcDate(day, Math.floor(startMinute / 60), startMinute % 60).getTime();
        const windowEnd = makeUtcDate(day, Math.floor(endMinute / 60), endMinute % 60).getTime();

        for (
          let candidateStart = windowStart;
          candidateStart + durationMs <= windowEnd;
          candidateStart += policy.slotIncrementMinutes * 60_000
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

  private generateCandidateSlotsFromAvailabilityWindows(
    reference: Date,
    durationMinutes: number,
    policy: ManualProviderPolicy,
    windows: ExistingAvailabilityWindow[],
  ) {
    const slots: Date[] = [];
    const durationMs = durationMinutes * 60_000;
    const slotIncrementMs = policy.slotIncrementMinutes * 60_000;

    for (const window of windows) {
      const windowStart = window.startTime.getTime();
      const windowEnd = window.endTime.getTime();

      for (
        let candidateStart = windowStart;
        candidateStart + durationMs <= windowEnd;
        candidateStart += slotIncrementMs
      ) {
        const candidate = new Date(candidateStart);
        if (candidate > reference) {
          slots.push(candidate);
        }
      }
    }

    const deduped = new Map<number, Date>();
    for (const slot of slots) {
      deduped.set(slot.getTime(), slot);
    }

    return Array.from(deduped.values()).sort((a, b) => a.getTime() - b.getTime());
  }

  async getAvailableSlots(
    specialistId: string,
    _eventType: SchedulingEventType,
    durationMinutes: number,
  ) {
    const normalizedDuration = normalizeDuration(durationMinutes);
    const now = new Date();
    const policy = await this.getPolicy();
    const workingHours = await this.getSpecialistWorkingHours(specialistId);
    const availabilityWindows = await this.getAvailabilityWindows(specialistId, now);
    const availableWindows = availabilityWindows.filter(
      (window) => window.availabilityType === "AVAILABLE",
    );
    const outOfOfficeWindows = availabilityWindows.filter(
      (window) => window.availabilityType === "OUT_OF_OFFICE",
    );
    const candidates =
      availableWindows.length > 0
        ? this.generateCandidateSlotsFromAvailabilityWindows(
            now,
            normalizedDuration,
            policy,
            availableWindows,
          )
        : this.generateCandidateSlots(now, normalizedDuration, policy, workingHours);
    const candidatesAfterOutOfOffice = candidates.filter((candidate) => {
      const candidateEnd = addMinutes(candidate, normalizedDuration);
      return !outOfOfficeWindows.some((window) =>
        overlaps(candidate, candidateEnd, window.startTime, window.endTime),
      );
    });
    const existing = await this.getExistingBookings(specialistId);

    return candidatesAfterOutOfOffice.filter((candidate) => {
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
      providerType: this.providerType,
    };
  }

  async cancelBooking(bookingId: string) {
    await sendProviderEventWebhook({
      provider: this.providerType,
      type: "booking.cancelled",
      bookingId,
    });
  }
}
