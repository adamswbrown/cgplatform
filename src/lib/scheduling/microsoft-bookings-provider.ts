import type {
  BookingResult,
  SchedulingCaseData,
  SchedulingEventType,
  SchedulingPersistence,
  SchedulingProvider,
} from "@/lib/scheduling/types";

export class MicrosoftBookingsSchedulingProvider implements SchedulingProvider {
  constructor(private readonly _persistence: SchedulingPersistence) {}

  async getAvailableSlots(
    specialistId: string,
    eventType: SchedulingEventType,
    durationMinutes: number,
  ): Promise<Date[]> {
    void specialistId;
    void eventType;
    void durationMinutes;
    throw new Error(
      "Scheduling engine 'microsoft_bookings' is selected, but the Microsoft Bookings provider is not implemented yet.",
    );
  }

  async createBooking(
    specialistId: string,
    startTime: Date,
    caseData: SchedulingCaseData,
  ): Promise<BookingResult> {
    void specialistId;
    void startTime;
    void caseData;
    throw new Error(
      "Scheduling engine 'microsoft_bookings' is selected, but the Microsoft Bookings provider is not implemented yet.",
    );
  }

  async cancelBooking(bookingId: string): Promise<void> {
    void bookingId;
    throw new Error(
      "Scheduling engine 'microsoft_bookings' is selected, but the Microsoft Bookings provider is not implemented yet.",
    );
  }
}
