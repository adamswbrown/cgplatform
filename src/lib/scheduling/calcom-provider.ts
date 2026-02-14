import type {
  BookingResult,
  SchedulingCaseData,
  SchedulingEventType,
  SchedulingPersistence,
  SchedulingProvider,
} from "@/lib/scheduling/types";

export class CalcomSchedulingProvider implements SchedulingProvider {
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
      "SCHEDULING_PROVIDER=calcom is configured, but Cal.com provider is not implemented yet.",
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
      "SCHEDULING_PROVIDER=calcom is configured, but Cal.com provider is not implemented yet.",
    );
  }

  async cancelBooking(bookingId: string): Promise<void> {
    void bookingId;
    throw new Error(
      "SCHEDULING_PROVIDER=calcom is configured, but Cal.com provider is not implemented yet.",
    );
  }
}
