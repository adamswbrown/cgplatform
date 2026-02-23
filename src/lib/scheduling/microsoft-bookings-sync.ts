import { SessionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getIntegrationSettings } from "@/lib/integration-settings";
import { MicrosoftBookingsClient } from "@/lib/integrations/microsoft-bookings/client";
import { handleProviderBookingEvent } from "@/lib/scheduling/events";

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION] as const;
const DEFAULT_SYNC_LOOKBACK_HOURS = 24;
const DEFAULT_SYNC_LOOKAHEAD_DAYS = 30;
const DEFAULT_APPOINTMENT_FETCH_LIMIT = 500;

type SessionForSync = {
  id: string;
  providerBookingId: string;
  providerStartTime: Date;
  providerEndTime: Date;
  providerStatus: string;
  specialist: {
    id: string;
    name: string;
    microsoftBookingsBusinessId: string | null;
  };
};

export type MicrosoftBookingsSyncResult = {
  windowStart: string;
  windowEnd: string;
  checkedSessions: number;
  unavailableBusinessMappings: number;
  missingRemoteAppointments: number;
  cancelledSessionsApplied: number;
  rescheduledSessionsApplied: number;
  unchangedSessions: number;
  errors: Array<{
    bookingId: string;
    error: string;
  }>;
};

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }

  return rounded;
}

function resolveBusinessId(specialistBusinessId: string | null, globalBusinessId?: string) {
  const specialistValue = specialistBusinessId?.trim();
  if (specialistValue) {
    return specialistValue;
  }

  const resolvedGlobal = globalBusinessId?.trim() ||
    String(process.env.MICROSOFT_BOOKINGS_BUSINESS_ID || "").trim();
  if (resolvedGlobal) {
    return resolvedGlobal;
  }

  return null;
}

function sameTime(first: Date, second: Date) {
  return first.getTime() === second.getTime();
}

function buildRange(configuredLookbackHours?: number, configuredLookaheadDays?: number) {
  const now = new Date();
  const lookbackHours = normalizePositiveInteger(
    configuredLookbackHours,
    DEFAULT_SYNC_LOOKBACK_HOURS,
    1,
    24 * 14,
  );
  const lookaheadDays = normalizePositiveInteger(
    configuredLookaheadDays,
    DEFAULT_SYNC_LOOKAHEAD_DAYS,
    1,
    365,
  );

  const rangeStart = new Date(now);
  rangeStart.setHours(rangeStart.getHours() - lookbackHours);

  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + lookaheadDays);

  return {
    rangeStart,
    rangeEnd,
  };
}

function groupSessionsByBusiness(sessions: SessionForSync[], globalBusinessId?: string) {
  const sessionsByBusiness = new Map<string, SessionForSync[]>();
  let unavailableBusinessMappings = 0;

  for (const session of sessions) {
    const businessId = resolveBusinessId(session.specialist.microsoftBookingsBusinessId, globalBusinessId);
    if (!businessId) {
      unavailableBusinessMappings += 1;
      continue;
    }

    const bucket = sessionsByBusiness.get(businessId) || [];
    bucket.push(session);
    sessionsByBusiness.set(businessId, bucket);
  }

  return {
    sessionsByBusiness,
    unavailableBusinessMappings,
  };
}

export async function syncMicrosoftBookingsAppointments(): Promise<MicrosoftBookingsSyncResult> {
  const integrationSettings = await getIntegrationSettings();
  const { rangeStart, rangeEnd } = buildRange(
    integrationSettings.microsoftBookingsSyncLookbackHours,
    integrationSettings.microsoftBookingsSyncLookaheadDays,
  );
  const limit = normalizePositiveInteger(
    integrationSettings.microsoftBookingsSyncFetchLimit,
    DEFAULT_APPOINTMENT_FETCH_LIMIT,
    1,
    2000,
  );

  const sessions = (await db.session.findMany({
    where: {
      providerType: "microsoft_bookings",
      status: {
        in: [...ACTIVE_SESSION_STATUSES],
      },
      providerStartTime: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    },
    select: {
      id: true,
      providerBookingId: true,
      providerStartTime: true,
      providerEndTime: true,
      providerStatus: true,
      specialist: {
        select: {
          id: true,
          name: true,
          microsoftBookingsBusinessId: true,
        },
      },
    },
  })) as SessionForSync[];

  const { sessionsByBusiness, unavailableBusinessMappings } = groupSessionsByBusiness(
    sessions,
    integrationSettings.microsoftBookingsBusinessId,
  );
  const client = new MicrosoftBookingsClient();

  let missingRemoteAppointments = 0;
  let cancelledSessionsApplied = 0;
  let rescheduledSessionsApplied = 0;
  let unchangedSessions = 0;
  const errors: Array<{ bookingId: string; error: string }> = [];

  for (const [businessId, sessionsForBusiness] of sessionsByBusiness) {
    const appointments = await client.listAppointments({
      businessId,
      startTime: rangeStart,
      endTime: rangeEnd,
      limit,
    });

    const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));

    for (const session of sessionsForBusiness) {
      try {
        const remote = appointmentsById.get(session.providerBookingId);
        if (!remote) {
          missingRemoteAppointments += 1;
          continue;
        }

        if (remote.isCancelled) {
          const result = await handleProviderBookingEvent({
            provider: "microsoft_bookings",
            type: "booking.cancelled",
            bookingId: session.providerBookingId,
          });
          if (result.applied) {
            cancelledSessionsApplied += 1;
          } else {
            unchangedSessions += 1;
          }
          continue;
        }

        const requiresReschedule =
          !sameTime(session.providerStartTime, remote.startTime) ||
          !sameTime(session.providerEndTime, remote.endTime);

        if (requiresReschedule) {
          const result = await handleProviderBookingEvent({
            provider: "microsoft_bookings",
            type: "booking.rescheduled",
            bookingId: session.providerBookingId,
            startTime: remote.startTime.toISOString(),
            endTime: remote.endTime.toISOString(),
          });
          if (result.applied) {
            rescheduledSessionsApplied += 1;
          } else {
            unchangedSessions += 1;
          }
          continue;
        }

        unchangedSessions += 1;
      } catch (error) {
        errors.push({
          bookingId: session.providerBookingId,
          error: error instanceof Error ? error.message : "Failed to sync appointment.",
        });
      }
    }
  }

  return {
    windowStart: rangeStart.toISOString(),
    windowEnd: rangeEnd.toISOString(),
    checkedSessions: sessions.length,
    unavailableBusinessMappings,
    missingRemoteAppointments,
    cancelledSessionsApplied,
    rescheduledSessionsApplied,
    unchangedSessions,
    errors,
  };
}
