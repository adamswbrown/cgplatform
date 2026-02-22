import { SessionStatus } from "@prisma/client";
import { getOperationalSettings } from "@/lib/admin-settings";
import { MicrosoftBookingsClient } from "@/lib/integrations/microsoft-bookings/client";
import { sendProviderEventWebhook } from "@/lib/scheduling/provider-events-client";
import type {
  BookingResult,
  SchedulingCaseData,
  SchedulingEventType,
  SchedulingPersistence,
  SchedulingProviderType,
  SchedulingProvider,
} from "@/lib/scheduling/types";

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION] as const;
const DEFAULT_BOOKINGS_TIME_ZONE = "UTC";
const DEFAULT_AVAILABILITY_HORIZON_DAYS = 30;
const DEFAULT_SLOT_INCREMENT_MINUTES = 15;

type SpecialistBookingsConfig = {
  id: string;
  name: string;
  microsoftBookingsBusinessId: string | null;
  microsoftBookingsStaffId: string | null;
  microsoftBookingsIndividualServiceId: string | null;
  microsoftBookingsCouplesServiceId: string | null;
};

type ExistingBooking = {
  providerStartTime: Date;
  providerEndTime: Date;
};

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function overlaps(firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function normalizeDuration(durationMinutes: number) {
  const parsed = Number(durationMinutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid scheduling duration: ${durationMinutes}`);
  }

  return Math.round(parsed);
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  options: { min: number; max: number },
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.round(parsed);
  if (normalized < options.min) {
    return options.min;
  }
  if (normalized > options.max) {
    return options.max;
  }

  return normalized;
}

function normalizeProviderType(value: unknown): SchedulingProviderType | null {
  if (value === "manual" || value === "calcom" || value === "microsoft_bookings") {
    return value;
  }
  return null;
}

function normalizeDateOrThrow(value: Date) {
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid booking start time.");
  }

  return value;
}

function resolveAvailableStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "available" || normalized === "free";
}

function resolveBookingsBusinessId(specialist: SpecialistBookingsConfig) {
  const specialistBusinessId = specialist.microsoftBookingsBusinessId?.trim();
  if (specialistBusinessId) {
    return specialistBusinessId;
  }

  const globalBusinessId = String(process.env.MICROSOFT_BOOKINGS_BUSINESS_ID || "").trim();
  if (globalBusinessId) {
    return globalBusinessId;
  }

  throw new Error(
    `No Microsoft Bookings business id configured for counsellor ${specialist.name}. Set microsoftBookingsBusinessId on the counsellor or MICROSOFT_BOOKINGS_BUSINESS_ID.`,
  );
}

function resolveBookingsStaffId(specialist: SpecialistBookingsConfig) {
  const staffId = specialist.microsoftBookingsStaffId?.trim();
  if (!staffId) {
    throw new Error(
      `No Microsoft Bookings staff id configured for counsellor ${specialist.name}.`,
    );
  }

  return staffId;
}

function resolveBookingsServiceId(
  specialist: SpecialistBookingsConfig,
  eventType: SchedulingEventType,
) {
  if (eventType === "couple") {
    const couplesServiceId = specialist.microsoftBookingsCouplesServiceId?.trim();
    if (!couplesServiceId) {
      throw new Error(
        `No Microsoft Bookings couples service id configured for counsellor ${specialist.name}.`,
      );
    }
    return couplesServiceId;
  }

  const individualServiceId = specialist.microsoftBookingsIndividualServiceId?.trim();
  if (!individualServiceId) {
    throw new Error(
      `No Microsoft Bookings individual service id configured for counsellor ${specialist.name}.`,
    );
  }

  return individualServiceId;
}

function resolveBookingsTimeZone() {
  return String(process.env.MICROSOFT_BOOKINGS_DEFAULT_TIME_ZONE || DEFAULT_BOOKINGS_TIME_ZONE).trim();
}

export class MicrosoftBookingsSchedulingProvider implements SchedulingProvider {
  private readonly client = new MicrosoftBookingsClient();

  constructor(private readonly _persistence: SchedulingPersistence) {}

  private async getSpecialistConfig(
    specialistId: string,
  ): Promise<SpecialistBookingsConfig> {
    const specialist = await this._persistence.specialist.findUnique({
      where: {
        id: specialistId,
      },
      select: {
        id: true,
        name: true,
        microsoftBookingsBusinessId: true,
        microsoftBookingsStaffId: true,
        microsoftBookingsIndividualServiceId: true,
        microsoftBookingsCouplesServiceId: true,
      },
    });

    if (!specialist) {
      throw new Error("Counsellor not found for Microsoft Bookings scheduling.");
    }

    return specialist;
  }

  private async getExistingBookings(specialistId: string) {
    const sessions = await this._persistence.session.findMany({
      where: {
        specialistId,
        status: {
          in: [...ACTIVE_SESSION_STATUSES],
        },
        providerStatus: "scheduled",
      },
      select: {
        providerStartTime: true,
        providerEndTime: true,
      },
    });

    return sessions as ExistingBooking[];
  }

  private buildCandidateSlots(input: {
    startReference: Date;
    endReference: Date;
    durationMinutes: number;
    slotIncrementMinutes: number;
    items: Array<{
      status: string;
      startTime: Date;
      endTime: Date;
    }>;
  }) {
    const candidates: Date[] = [];
    const durationMs = input.durationMinutes * 60_000;
    const slotIncrementMs = input.slotIncrementMinutes * 60_000;

    for (const item of input.items) {
      if (!resolveAvailableStatus(item.status)) {
        continue;
      }
      if (item.endTime <= item.startTime) {
        continue;
      }

      const start = Math.max(item.startTime.getTime(), input.startReference.getTime());
      const end = Math.min(item.endTime.getTime(), input.endReference.getTime());
      if (end <= start) {
        continue;
      }

      for (let cursor = start; cursor + durationMs <= end; cursor += slotIncrementMs) {
        candidates.push(new Date(cursor));
      }
    }

    const deduped = new Map<number, Date>();
    for (const candidate of candidates) {
      deduped.set(candidate.getTime(), candidate);
    }

    return Array.from(deduped.values()).sort((first, second) => first.getTime() - second.getTime());
  }

  async getAvailableSlots(
    specialistId: string,
    eventType: SchedulingEventType,
    durationMinutes: number,
  ): Promise<Date[]> {
    const normalizedDuration = normalizeDuration(durationMinutes);
    const [operationalSettings, specialist] = await Promise.all([
      getOperationalSettings(),
      this.getSpecialistConfig(specialistId),
    ]);

    const businessId = resolveBookingsBusinessId(specialist);
    const staffId = resolveBookingsStaffId(specialist);
    void resolveBookingsServiceId(specialist, eventType);

    const now = new Date();
    const horizonDays = normalizePositiveInteger(
      process.env.MICROSOFT_BOOKINGS_AVAILABILITY_HORIZON_DAYS,
      operationalSettings.manualProviderHorizonDays || DEFAULT_AVAILABILITY_HORIZON_DAYS,
      {
        min: 1,
        max: 120,
      },
    );
    const endReference = addDays(now, horizonDays);
    const slotIncrementMinutes = normalizePositiveInteger(
      process.env.MICROSOFT_BOOKINGS_SLOT_INCREMENT_MINUTES,
      operationalSettings.manualProviderSlotIncrementMinutes || DEFAULT_SLOT_INCREMENT_MINUTES,
      {
        min: 5,
        max: 60,
      },
    );
    const timeZone = resolveBookingsTimeZone();

    const availability = await this.client.getStaffAvailability({
      businessId,
      staffIds: [staffId],
      startTime: now,
      endTime: endReference,
      timeZone,
    });
    const availabilityItems = availability.flatMap((entry) => entry.items);
    const candidates = this.buildCandidateSlots({
      startReference: now,
      endReference,
      durationMinutes: normalizedDuration,
      slotIncrementMinutes,
      items: availabilityItems,
    });

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
    const candidate = normalizeDateOrThrow(new Date(startTime));
    const availableSlots = await this.getAvailableSlots(
      specialistId,
      caseData.eventType,
      normalizedDuration,
    );
    const isAvailable = availableSlots.some((slot) => slot.getTime() === candidate.getTime());
    if (!isAvailable) {
      throw new Error("Selected slot is no longer available.");
    }

    const specialist = await this.getSpecialistConfig(specialistId);
    const businessId = resolveBookingsBusinessId(specialist);
    const staffId = resolveBookingsStaffId(specialist);
    const serviceId = resolveBookingsServiceId(specialist, caseData.eventType);
    const endTime = addMinutes(candidate, normalizedDuration);
    const timeZone = resolveBookingsTimeZone();

    const appointment = await this.client.createAppointment({
      businessId,
      serviceId,
      staffMemberIds: [staffId],
      startTime: candidate,
      endTime,
      customerTimeZone: timeZone,
      customers: [
        {
          email: caseData.attendeeEmail,
          name: caseData.attendeeName,
          timeZone,
        },
      ],
      additionalInformation: `Case ${caseData.caseReference} (${caseData.caseId})`,
    });

    return {
      bookingId: appointment.id,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      providerType: "microsoft_bookings",
    };
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const normalizedBookingId = bookingId.trim();
    if (!normalizedBookingId) {
      return;
    }

    const session = await this._persistence.session.findUnique({
      where: {
        providerBookingId: normalizedBookingId,
      },
      select: {
        specialistId: true,
        providerType: true,
      },
    });

    if (!session) {
      return;
    }

    if (session.providerType !== "microsoft_bookings") {
      const providerType = normalizeProviderType(session.providerType) || "manual";
      await sendProviderEventWebhook({
        provider: providerType,
        type: "booking.cancelled",
        bookingId: normalizedBookingId,
      });
      return;
    }

    const specialist = await this.getSpecialistConfig(session.specialistId);
    const businessId = resolveBookingsBusinessId(specialist);
    await this.client.cancelAppointment({
      businessId,
      appointmentId: normalizedBookingId,
      reason: "Cancelled by counselling operations platform.",
    });
  }
}
