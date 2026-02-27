import { db } from "@/lib/db";
import {
  getScheduleAvailability,
  type ScheduleAvailabilityItem,
} from "@/lib/integrations/microsoft-graph/calendar";

const SYNC_SOURCE = "outlook_calendar_sync";
const DEFAULT_SYNC_DAYS = 28;
const MAX_SYNC_DAYS = 62;

type SyncResult = {
  specialistId: string;
  specialistEmail: string;
  syncedDays: number;
  createdWindows: number;
  skippedExisting: number;
  deactivatedConflicts: number;
  busyBlocks: number;
};

/**
 * Syncs a specialist's Outlook calendar free/busy data into SpecialistAvailabilityWindows.
 *
 * - Reads the specialist's Outlook calendar via Microsoft Graph getSchedule
 * - Identifies busy time blocks
 * - Creates OUT_OF_OFFICE availability windows for busy periods
 * - Preserves manually-created availability windows (won't overwrite non-sync sources)
 * - Only touches windows with source "outlook_calendar_sync"
 */
export async function syncOutlookCalendarToAvailability(input: {
  specialistId: string;
  actorUserId: string;
  days?: number;
  startDate?: Date;
}): Promise<SyncResult> {
  const specialist = await db.specialist.findUnique({
    where: { id: input.specialistId },
    select: {
      id: true,
      email: true,
      name: true,
      standardStartHour: true,
      standardEndHour: true,
    },
  });

  if (!specialist) {
    throw new Error(`Specialist not found: ${input.specialistId}`);
  }

  if (!specialist.email) {
    throw new Error(`Specialist ${specialist.name} has no email configured.`);
  }

  const days = Math.min(input.days || DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS);
  const startDate = input.startDate || new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);

  // Fetch free/busy from Outlook
  const scheduleResults = await getScheduleAvailability({
    schedules: [specialist.email],
    startTime: startDate,
    endTime: endDate,
    timeZone: "Europe/London",
    availabilityViewInterval: 30,
  });

  const scheduleData = scheduleResults.find(
    (s) => s.scheduleId.toLowerCase() === specialist.email.toLowerCase(),
  );

  if (!scheduleData) {
    throw new Error(`No schedule data returned for ${specialist.email}`);
  }

  // Filter to only busy/tentative/oof blocks (i.e. times the specialist is NOT available)
  const busyBlocks = scheduleData.items.filter((item) =>
    ["busy", "tentative", "oof", "workingElsewhere"].includes(item.status),
  );

  // Deactivate previous sync windows in this date range
  const deactivated = await db.specialistAvailabilityWindow.updateMany({
    where: {
      specialistId: specialist.id,
      source: SYNC_SOURCE,
      active: true,
      startTime: { gte: startDate },
      endTime: { lte: endDate },
    },
    data: {
      active: false,
    },
  });

  // Merge adjacent busy blocks into continuous periods
  const mergedBlocks = mergeBusyBlocks(busyBlocks);

  let createdWindows = 0;
  let skippedExisting = 0;

  for (const block of mergedBlocks) {
    const blockStart = new Date(block.startTime);
    const blockEnd = new Date(block.endTime);

    // Skip very short blocks (less than 30 min)
    if (blockEnd.getTime() - blockStart.getTime() < 30 * 60 * 1000) {
      continue;
    }

    // Check for an existing active window covering this period (from any source)
    const existing = await db.specialistAvailabilityWindow.findFirst({
      where: {
        specialistId: specialist.id,
        active: true,
        availabilityType: "OUT_OF_OFFICE",
        startTime: { lte: blockStart },
        endTime: { gte: blockEnd },
      },
    });

    if (existing) {
      skippedExisting++;
      continue;
    }

    await db.specialistAvailabilityWindow.create({
      data: {
        specialistId: specialist.id,
        startTime: blockStart,
        endTime: blockEnd,
        timezone: "Europe/London",
        availabilityType: "OUT_OF_OFFICE",
        source: SYNC_SOURCE,
        notes: `Outlook calendar: ${block.status}`,
        createdByUserId: input.actorUserId,
        metadata: {
          outlookStatus: block.status,
          syncedAt: new Date().toISOString(),
        },
      },
    });

    createdWindows++;
  }

  return {
    specialistId: specialist.id,
    specialistEmail: specialist.email,
    syncedDays: days,
    createdWindows,
    skippedExisting,
    deactivatedConflicts: deactivated.count,
    busyBlocks: busyBlocks.length,
  };
}

type MergedBlock = {
  startTime: string;
  endTime: string;
  status: string;
};

function mergeBusyBlocks(blocks: ScheduleAvailabilityItem[]): MergedBlock[] {
  if (blocks.length === 0) {
    return [];
  }

  const sorted = [...blocks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const merged: MergedBlock[] = [];
  let current: MergedBlock = {
    startTime: sorted[0].startTime,
    endTime: sorted[0].endTime,
    status: sorted[0].status,
  };

  for (let i = 1; i < sorted.length; i++) {
    const block = sorted[i];
    const currentEnd = new Date(current.endTime).getTime();
    const blockStart = new Date(block.startTime).getTime();

    // If blocks are adjacent or overlapping, merge them
    if (blockStart <= currentEnd) {
      const blockEnd = new Date(block.endTime).getTime();
      if (blockEnd > currentEnd) {
        current.endTime = block.endTime;
      }
      // Use the most restrictive status
      if (block.status === "busy" || block.status === "oof") {
        current.status = block.status;
      }
    } else {
      merged.push(current);
      current = {
        startTime: block.startTime,
        endTime: block.endTime,
        status: block.status,
      };
    }
  }

  merged.push(current);
  return merged;
}
