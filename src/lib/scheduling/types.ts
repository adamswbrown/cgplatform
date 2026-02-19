import { Prisma } from "@prisma/client";

export type SchedulingEventType = "individual" | "couple";
export type SchedulingProviderType = "manual" | "calcom" | "microsoft_bookings";

export type SchedulingCaseData = {
  caseId: string;
  caseReference: string;
  participantCount: number;
  attendeeName: string;
  attendeeEmail: string;
  eventType: SchedulingEventType;
  durationMinutes: number;
};

export type BookingResult = {
  bookingId: string;
  startTime: Date;
  endTime: Date;
  providerType: SchedulingProviderType;
};

export interface SchedulingProvider {
  getAvailableSlots(
    specialistId: string,
    eventType: SchedulingEventType,
    durationMinutes: number,
  ): Promise<Date[]>;
  createBooking(
    specialistId: string,
    startTime: Date,
    caseData: SchedulingCaseData,
  ): Promise<BookingResult>;
  cancelBooking(bookingId: string): Promise<void>;
}

export type SchedulingPersistence = Pick<
  Prisma.TransactionClient,
  "session" | "specialistAvailabilityWindow"
>;
