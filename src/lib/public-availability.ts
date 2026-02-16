import { db } from "@/lib/db";
import { createSchedulingProvider } from "@/lib/scheduling";
import type { SchedulingEventType } from "@/lib/scheduling/types";

export type PublicAvailabilitySlot = {
  specialistId: string;
  specialistName: string;
  startTime: string;
  endTime: string;
};

function defaultDurationMinutes(counsellingType: string) {
  return counsellingType.trim().toLowerCase().includes("couple") ? 60 : 40;
}

export async function listPublicAvailabilitySlots(input: {
  counsellingType: string;
  durationMinutes?: number;
  limit?: number;
  location?: string;
  includeOnline?: boolean;
}) {
  const counsellingType = input.counsellingType.trim().toLowerCase() || "individual";
  const isCouple = counsellingType.includes("couple");
  const eventType: SchedulingEventType = isCouple ? "couple" : "individual";
  const durationMinutes = input.durationMinutes || defaultDurationMinutes(counsellingType);
  const limit = input.limit ?? 20;
  void input.location;
  void input.includeOnline;

  const specialists = await db.specialist.findMany({
    where: {
      active: true,
      ...(isCouple ? { supportsCouples: true } : {}),
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (specialists.length === 0) {
    return [];
  }

  const provider = createSchedulingProvider(db);

  const options = await Promise.all(
    specialists.map(async (specialist) => {
      const slots = await provider.getAvailableSlots(specialist.id, eventType, durationMinutes);
      return slots.map((slot) => ({
        specialistId: specialist.id,
        specialistName: specialist.name,
        startTime: slot,
        endTime: new Date(slot.getTime() + durationMinutes * 60_000),
      }));
    }),
  );

  const deduped = new Map<string, PublicAvailabilitySlot>();
  for (const specialistSlots of options) {
    for (const slot of specialistSlots) {
      const key = `${slot.startTime.toISOString()}|${slot.endTime.toISOString()}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          specialistId: slot.specialistId,
          specialistName: slot.specialistName,
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
        });
      }
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, limit);
}
