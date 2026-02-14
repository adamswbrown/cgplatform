import { CaseStatus, SessionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { SchedulingProviderType } from "@/lib/scheduling/types";

const PROVIDER_STATUS_SCHEDULED = "scheduled";
const PROVIDER_STATUS_CANCELLED = "cancelled";

export type ProviderBookingEventType =
  | "booking.created"
  | "booking.cancelled"
  | "booking.rescheduled";

type ProviderEventBase = {
  provider: SchedulingProviderType;
  bookingId: string;
  startTime?: string | Date;
  endTime?: string | Date;
};

export type BookingCreatedEvent = ProviderEventBase;
export type BookingCancelledEvent = ProviderEventBase;
export type BookingRescheduledEvent = ProviderEventBase;

export type ProviderBookingEvent = {
  provider: SchedulingProviderType;
  type: ProviderBookingEventType;
  bookingId: string;
  startTime?: string;
  endTime?: string;
};

export type ProviderEventResult = {
  found: boolean;
  applied: boolean;
  sessionId?: string;
  caseId?: string;
  sessionStatus?: SessionStatus;
  caseStatus?: CaseStatus;
};

export interface BookingEventsProvider {
  bookingCreated(data: BookingCreatedEvent): Promise<ProviderEventResult>;
  bookingCancelled(data: BookingCancelledEvent): Promise<ProviderEventResult>;
  bookingRescheduled(data: BookingRescheduledEvent): Promise<ProviderEventResult>;
}

function toDateOrThrow(value: string | Date | undefined, fieldName: string) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO datetime.`);
  }

  return parsed;
}

function sameDate(first: Date, second: Date) {
  return first.getTime() === second.getTime();
}

class DatabaseBookingEventsProvider implements BookingEventsProvider {
  async bookingCreated(data: BookingCreatedEvent): Promise<ProviderEventResult> {
    return db.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: {
          providerBookingId: data.bookingId,
        },
        include: {
          case: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!session) {
        return { found: false, applied: false };
      }

      const startTime = toDateOrThrow(data.startTime, "startTime") ?? session.providerStartTime;
      const endTime = toDateOrThrow(data.endTime, "endTime") ?? session.providerEndTime;

      const shouldUpdateSession =
        session.status !== SessionStatus.SCHEDULED ||
        session.providerStatus !== PROVIDER_STATUS_SCHEDULED ||
        !sameDate(session.providerStartTime, startTime) ||
        !sameDate(session.providerEndTime, endTime);
      const shouldUpdateCase = session.case.status !== CaseStatus.SCHEDULED;

      if (!shouldUpdateSession && !shouldUpdateCase) {
        return {
          found: true,
          applied: false,
          sessionId: session.id,
          caseId: session.caseId,
          sessionStatus: session.status,
          caseStatus: session.case.status,
        };
      }

      if (shouldUpdateSession) {
        await tx.session.update({
          where: {
            id: session.id,
          },
          data: {
            status: SessionStatus.SCHEDULED,
            providerStatus: PROVIDER_STATUS_SCHEDULED,
            providerStartTime: startTime,
            providerEndTime: endTime,
            lastProviderSyncAt: new Date(),
          },
        });
      }

      if (shouldUpdateCase) {
        await tx.case.update({
          where: {
            id: session.caseId,
          },
          data: {
            status: CaseStatus.SCHEDULED,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          caseId: session.caseId,
          action: "PROVIDER_BOOKING_CREATED",
          details: {
            provider: data.provider,
            reason: "PROVIDER_CREATED",
            bookingId: data.bookingId,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        },
      });

      return {
        found: true,
        applied: true,
        sessionId: session.id,
        caseId: session.caseId,
        sessionStatus: SessionStatus.SCHEDULED,
        caseStatus: CaseStatus.SCHEDULED,
      };
    });
  }

  async bookingCancelled(data: BookingCancelledEvent): Promise<ProviderEventResult> {
    return db.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: {
          providerBookingId: data.bookingId,
        },
        include: {
          case: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!session) {
        return { found: false, applied: false };
      }

      const shouldUpdateSession =
        session.status !== SessionStatus.CANCELLED ||
        session.providerStatus !== PROVIDER_STATUS_CANCELLED;
      const shouldUpdateCase = session.case.status !== CaseStatus.READY_TO_SCHEDULE;

      if (!shouldUpdateSession && !shouldUpdateCase) {
        return {
          found: true,
          applied: false,
          sessionId: session.id,
          caseId: session.caseId,
          sessionStatus: session.status,
          caseStatus: session.case.status,
        };
      }

      if (shouldUpdateSession) {
        await tx.session.update({
          where: {
            id: session.id,
          },
          data: {
            status: SessionStatus.CANCELLED,
            providerStatus: PROVIDER_STATUS_CANCELLED,
            lastProviderSyncAt: new Date(),
          },
        });
      }

      if (shouldUpdateCase) {
        await tx.case.update({
          where: {
            id: session.caseId,
          },
          data: {
            status: CaseStatus.READY_TO_SCHEDULE,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          caseId: session.caseId,
          action: "PROVIDER_BOOKING_CANCELLED",
          details: {
            provider: data.provider,
            reason: "PROVIDER_CANCELLED",
            bookingId: data.bookingId,
          },
        },
      });

      return {
        found: true,
        applied: true,
        sessionId: session.id,
        caseId: session.caseId,
        sessionStatus: SessionStatus.CANCELLED,
        caseStatus: CaseStatus.READY_TO_SCHEDULE,
      };
    });
  }

  async bookingRescheduled(data: BookingRescheduledEvent): Promise<ProviderEventResult> {
    const startTime = toDateOrThrow(data.startTime, "startTime");
    const endTime = toDateOrThrow(data.endTime, "endTime");

    if (!startTime || !endTime) {
      throw new Error("booking.rescheduled requires both startTime and endTime.");
    }

    return db.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: {
          providerBookingId: data.bookingId,
        },
        include: {
          case: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!session) {
        return { found: false, applied: false };
      }

      const shouldUpdateSession =
        session.status !== SessionStatus.SCHEDULED ||
        session.providerStatus !== PROVIDER_STATUS_SCHEDULED ||
        !sameDate(session.providerStartTime, startTime) ||
        !sameDate(session.providerEndTime, endTime);
      const shouldUpdateCase = session.case.status !== CaseStatus.SCHEDULED;

      if (!shouldUpdateSession && !shouldUpdateCase) {
        return {
          found: true,
          applied: false,
          sessionId: session.id,
          caseId: session.caseId,
          sessionStatus: session.status,
          caseStatus: session.case.status,
        };
      }

      if (shouldUpdateSession) {
        await tx.session.update({
          where: {
            id: session.id,
          },
          data: {
            status: SessionStatus.SCHEDULED,
            providerStatus: PROVIDER_STATUS_SCHEDULED,
            providerStartTime: startTime,
            providerEndTime: endTime,
            lastProviderSyncAt: new Date(),
          },
        });
      }

      if (shouldUpdateCase) {
        await tx.case.update({
          where: {
            id: session.caseId,
          },
          data: {
            status: CaseStatus.SCHEDULED,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          caseId: session.caseId,
          action: "PROVIDER_BOOKING_RESCHEDULED",
          details: {
            provider: data.provider,
            reason: "PROVIDER_RESCHEDULED",
            bookingId: data.bookingId,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        },
      });

      return {
        found: true,
        applied: true,
        sessionId: session.id,
        caseId: session.caseId,
        sessionStatus: SessionStatus.SCHEDULED,
        caseStatus: CaseStatus.SCHEDULED,
      };
    });
  }
}

export function createBookingEventsProvider(): BookingEventsProvider {
  return new DatabaseBookingEventsProvider();
}

export async function handleProviderBookingEvent(
  input: ProviderBookingEvent,
): Promise<ProviderEventResult> {
  const provider = createBookingEventsProvider();

  switch (input.type) {
    case "booking.created":
      return provider.bookingCreated(input);
    case "booking.cancelled":
      return provider.bookingCancelled(input);
    case "booking.rescheduled":
      return provider.bookingRescheduled(input);
    default:
      throw new Error(`Unsupported provider event type: ${(input as { type?: string }).type}`);
  }
}
