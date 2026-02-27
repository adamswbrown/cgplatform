import { getMicrosoftGraphAccessToken } from "./auth";

const GRAPH_BASE_URL =
  process.env.MICROSOFT_GRAPH_BASE_URL?.replace(/\/$/, "") ||
  "https://graph.microsoft.com/v1.0";

export type ScheduleAvailabilityItem = {
  status: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  startTime: string;
  endTime: string;
};

export type ScheduleResponse = {
  scheduleId: string;
  items: ScheduleAvailabilityItem[];
};

/**
 * Fetches free/busy schedule data for one or more users from Microsoft Graph.
 *
 * Uses app-only auth: `POST /users/{callerEmail}/calendar/getSchedule`
 * where callerEmail is one of the schedules being queried (the first one).
 *
 * Requires `Calendars.Read` or `Schedule.Read.All` application permission
 * with admin consent granted by the tenant administrator.
 */
export async function getScheduleAvailability(input: {
  schedules: string[];
  startTime: Date;
  endTime: Date;
  timeZone?: string;
  availabilityViewInterval?: number;
}): Promise<ScheduleResponse[]> {
  const token = await getMicrosoftGraphAccessToken();
  const timeZone = input.timeZone || "Europe/London";
  const callerEmail = encodeURIComponent(input.schedules[0]);

  const response = await fetch(`${GRAPH_BASE_URL}/users/${callerEmail}/calendar/getSchedule`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      schedules: input.schedules,
      startTime: {
        dateTime: input.startTime.toISOString(),
        timeZone,
      },
      endTime: {
        dateTime: input.endTime.toISOString(),
        timeZone,
      },
      availabilityViewInterval: input.availabilityViewInterval || 30,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Microsoft Graph getSchedule failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    value: Array<{
      scheduleId: string;
      scheduleItems: Array<{
        status: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
      }>;
    }>;
  };

  return json.value.map((entry) => ({
    scheduleId: entry.scheduleId,
    items: entry.scheduleItems.map((item) => ({
      status: item.status as ScheduleAvailabilityItem["status"],
      startTime: item.start.dateTime,
      endTime: item.end.dateTime,
    })),
  }));
}
