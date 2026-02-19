"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, EventClickArg, EventInput } from "@fullcalendar/core";

type SlotPolicy = {
  startHour: number;
  endHour: number;
  slotMinutes: number;
};

type AvailabilityType = "AVAILABLE" | "OUT_OF_OFFICE";

type AvailabilityWindow = {
  id: string;
  startTime: string;
  endTime: string;
  timezone: string;
  availabilityType: AvailabilityType;
};

type ScheduledSession = {
  id: string;
  startTime: string;
  endTime: string;
  caseReference: string;
};

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type PresetBlock = "MORNING" | "AFTERNOON" | "EVENING";

type SpecialistAvailabilityCalendarProps = {
  specialistId: string;
  specialistName: string;
  rangeStart: string;
  slotPolicy: SlotPolicy;
  windows: AvailabilityWindow[];
  sessions: ScheduledSession[];
  editable: boolean;
  roleLabel: "ops" | "specialist";
  defaultView: CalendarView;
};

type AvailabilityEntry = {
  windowId: string;
  startTime: string;
  endTime: string;
  availabilityType: AvailabilityType;
};

type AvailabilityApiPayload = {
  specialist: {
    id: string;
    name: string;
    active: boolean;
  };
  dayCount: number;
  rangeStart: string;
  rangeEnd: string;
  slotPolicy: SlotPolicy;
  windows: AvailabilityWindow[];
  sessions: ScheduledSession[];
};

type AvailabilityApiResponse = {
  ok: boolean;
  data?: AvailabilityApiPayload;
  error?: string;
};

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function slotKey(value: Date) {
  return `${dayKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function parseIso(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function availabilityTypeLabel(value: AvailabilityType) {
  return value === "OUT_OF_OFFICE" ? "Out of office" : "Available";
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDayHeading(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(value);
}

function formatTimeLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function expandAvailabilityWindows(windows: AvailabilityWindow[], slotMinutes: number) {
  const entries: Record<string, AvailabilityEntry> = {};
  const incrementMs = slotMinutes * 60_000;

  for (const window of windows) {
    const start = parseIso(window.startTime);
    const end = parseIso(window.endTime);
    if (!start || !end || end <= start) {
      continue;
    }

    for (let cursor = start.getTime(); cursor + incrementMs <= end.getTime(); cursor += incrementMs) {
      const candidate = new Date(cursor);
      entries[slotKey(candidate)] = {
        windowId: window.id,
        startTime: candidate.toISOString(),
        endTime: new Date(cursor + incrementMs).toISOString(),
        availabilityType: window.availabilityType,
      };
    }
  }

  return entries;
}

function buildSessionIndex(sessions: ScheduledSession[]) {
  const bySlotKey: Record<string, ScheduledSession> = {};

  for (const session of sessions) {
    const start = parseIso(session.startTime);
    if (!start) {
      continue;
    }
    bySlotKey[slotKey(start)] = session;
  }

  return bySlotKey;
}

function toFullCalendarDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}:00`;
}

function minutesBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function SpecialistAvailabilityCalendar({
  specialistId,
  specialistName,
  rangeStart,
  slotPolicy,
  windows,
  sessions,
  editable,
  roleLabel,
  defaultView,
}: SpecialistAvailabilityCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRangeLoading, startRangeTransition] = useTransition();
  const [currentView, setCurrentView] = useState<CalendarView>(defaultView);
  const [visibleRange, setVisibleRange] = useState<{
    start: Date;
    end: Date;
    key: string;
  } | null>(null);
  const [loadedRangeKey, setLoadedRangeKey] = useState<string>("");
  const [availabilityByKey, setAvailabilityByKey] = useState<Record<string, AvailabilityEntry>>(
    () => expandAvailabilityWindows(windows, slotPolicy.slotMinutes),
  );
  const [sessionByKey, setSessionByKey] = useState<Record<string, ScheduledSession>>(() =>
    buildSessionIndex(sessions),
  );
  const [presetStartDate, setPresetStartDate] = useState<string>(() => {
    const now = new Date();
    return formatDateInput(now);
  });
  const [presetEndDate, setPresetEndDate] = useState<string>(() => {
    const now = new Date();
    return formatDateInput(addDays(now, 6));
  });
  const [presetBlocks, setPresetBlocks] = useState<Record<PresetBlock, boolean>>({
    MORNING: true,
    AFTERNOON: true,
    EVENING: false,
  });
  const [entryMode, setEntryMode] = useState<AvailabilityType>("AVAILABLE");
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const events = useMemo<EventInput[]>(() => {
    const availabilityEvents = Object.entries(availabilityByKey).map(([key, entry]) => ({
      id: `availability:${key}`,
      title: availabilityTypeLabel(entry.availabilityType),
      start: entry.startTime,
      end: entry.endTime,
      allDay: false,
      color: entry.availabilityType === "OUT_OF_OFFICE" ? "#fde2e2" : "#B7C9BB",
      textColor: entry.availabilityType === "OUT_OF_OFFICE" ? "#7f1d1d" : "#052E1E",
      extendedProps: {
        kind:
          entry.availabilityType === "OUT_OF_OFFICE"
            ? ("out_of_office" as const)
            : ("availability" as const),
        windowId: entry.windowId,
        availabilityType: entry.availabilityType,
      },
    }));

    const bookedEvents = Object.values(sessionByKey).map((session) => ({
      id: `booked:${session.id}`,
      title: `Booked: ${session.caseReference}`,
      start: session.startTime,
      end: session.endTime,
      allDay: false,
      color: "#fef3c7",
      textColor: "#78350f",
      extendedProps: {
        kind: "booked" as const,
      },
    }));

    return [...availabilityEvents, ...bookedEvents];
  }, [availabilityByKey, sessionByKey]);

  const availableCount = Object.values(availabilityByKey).filter(
    (entry) => entry.availabilityType === "AVAILABLE",
  ).length;
  const outOfOfficeCount = Object.values(availabilityByKey).filter(
    (entry) => entry.availabilityType === "OUT_OF_OFFICE",
  ).length;

  async function loadRange(start: Date, end: Date, force = false) {
    const rangeStartDate = new Date(start);
    const rangeEndDate = new Date(end);
    rangeStartDate.setHours(0, 0, 0, 0);

    const rangeKey = `${rangeStartDate.toISOString()}|${rangeEndDate.toISOString()}`;
    if (!force && rangeKey === loadedRangeKey) {
      return;
    }

    const dayCount = Math.max(1, Math.round((rangeEndDate.getTime() - rangeStartDate.getTime()) / 86_400_000));

    const response = await fetch(
      `/api/specialists/${specialistId}/availability?days=${dayCount}&startDate=${encodeURIComponent(rangeStartDate.toISOString())}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as AvailabilityApiResponse;
    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error || "Failed to load availability.");
    }

    setAvailabilityByKey(
      expandAvailabilityWindows(payload.data.windows, payload.data.slotPolicy.slotMinutes),
    );
    setSessionByKey(buildSessionIndex(payload.data.sessions));
    setLoadedRangeKey(rangeKey);
  }

  function removeWindowFromState(windowId: string) {
    setAvailabilityByKey((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([, entry]) => entry.windowId !== windowId)),
    );
  }

  function upsertSlotInState(
    startTimeIso: string,
    endTimeIso: string,
    windowId: string,
    availabilityType: AvailabilityType,
  ) {
    const start = parseIso(startTimeIso);
    if (!start) {
      return;
    }

    setAvailabilityByKey((previous) => ({
      ...previous,
      [slotKey(start)]: {
        windowId,
        startTime: startTimeIso,
        endTime: endTimeIso,
        availabilityType,
      },
    }));
  }

  function handleDatesSet(info: DatesSetArg) {
    const rangeStartDate = new Date(info.start);
    const rangeEndDate = new Date(info.end);
    rangeStartDate.setHours(0, 0, 0, 0);
    const rangeKey = `${rangeStartDate.toISOString()}|${rangeEndDate.toISOString()}`;
    setCurrentView(info.view.type as CalendarView);
    setVisibleRange({
      start: rangeStartDate,
      end: rangeEndDate,
      key: rangeKey,
    });

    if (!presetStartDate || !presetEndDate) {
      setPresetStartDate(formatDateInput(rangeStartDate));
      setPresetEndDate(formatDateInput(addDays(rangeStartDate, 6)));
    }

    startRangeTransition(async () => {
      try {
        await loadRange(rangeStartDate, rangeEndDate);
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load calendar range.",
        });
      }
    });
  }

  function handleDateSelect(selection: DateSelectArg) {
    if (!editable || isPending || isRangeLoading) {
      return;
    }

    if (currentView === "dayGridMonth" || selection.allDay) {
      setNotice({
        type: "error",
        message: "Switch to Week or Day view to edit availability.",
      });
      return;
    }

    const start = new Date(selection.start);
    const end = new Date(selection.end);
    const durationMinutes = minutesBetween(start, end);
    if (durationMinutes !== slotPolicy.slotMinutes) {
      setNotice({
        type: "error",
        message: `Select exactly ${slotPolicy.slotMinutes} minutes.`,
      });
      return;
    }

    const key = slotKey(start);
    const existingEntry = availabilityByKey[key];
    if (existingEntry && existingEntry.availabilityType === entryMode) {
      setNotice({
        type: "error",
        message: `This slot is already marked as ${availabilityTypeLabel(entryMode).toLowerCase()}.`,
      });
      return;
    }

    if (sessionByKey[key]) {
      setNotice({
        type: "error",
        message: `Slot is already booked for ${sessionByKey[key].caseReference}.`,
      });
      return;
    }

    if (start < new Date()) {
      setNotice({
        type: "error",
        message: "Past slots cannot be edited.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
        const response = await fetch(`/api/specialists/${specialistId}/availability`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            availabilityType: entryMode,
            timezone,
          }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          error?: string;
          data?: {
            id: string;
            startTime: string;
            endTime: string;
            availabilityType: AvailabilityType;
          };
        };

        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error || "Failed to add availability slot.");
        }

        upsertSlotInState(
          payload.data.startTime,
          payload.data.endTime,
          payload.data.id,
          payload.data.availabilityType,
        );
        setNotice({
          type: "success",
          message: `${availabilityTypeLabel(payload.data.availabilityType)} set at ${formatTimeLabel(start)} (${formatDayHeading(start)}).`,
        });
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to update availability.",
        });
      }
    });
  }

  function handleEventClick(clickInfo: EventClickArg) {
    const kind = clickInfo.event.extendedProps.kind as
      | "availability"
      | "out_of_office"
      | "booked"
      | undefined;
    if (kind !== "availability" && kind !== "out_of_office") {
      return;
    }

    if (currentView === "dayGridMonth") {
      const slotStart = clickInfo.event.start;
      if (!slotStart) {
        return;
      }
      calendarRef.current?.getApi().changeView("timeGridDay", slotStart);
      return;
    }

    if (!editable || isPending || isRangeLoading) {
      return;
    }

    const windowId = clickInfo.event.extendedProps.windowId as string | undefined;
    const availabilityType = (clickInfo.event.extendedProps.availabilityType ||
      "AVAILABLE") as AvailabilityType;
    const slotStart = clickInfo.event.start;
    if (!windowId || !slotStart) {
      return;
    }

    if (slotStart < new Date()) {
      setNotice({
        type: "error",
        message: "Past slots cannot be edited.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/specialists/${specialistId}/availability/${windowId}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Failed to remove availability slot.");
        }

        removeWindowFromState(windowId);
        setNotice({
          type: "success",
          message: `Removed ${availabilityTypeLabel(availabilityType).toLowerCase()} block at ${formatTimeLabel(slotStart)} (${formatDayHeading(slotStart)}).`,
        });
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to update availability.",
        });
      }
    });
  }

  function togglePresetBlock(block: PresetBlock) {
    setPresetBlocks((previous) => ({
      ...previous,
      [block]: !previous[block],
    }));
  }

  function applyPresetBatch() {
    if (!editable || isPending || isRangeLoading) {
      return;
    }

    const selectedBlocks = (Object.entries(presetBlocks) as Array<[PresetBlock, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([block]) => block);

    if (selectedBlocks.length === 0) {
      setNotice({
        type: "error",
        message: "Select at least one preset block.",
      });
      return;
    }

    if (!presetStartDate || !presetEndDate) {
      setNotice({
        type: "error",
        message: "Select a preset start and end date.",
      });
      return;
    }

    const start = new Date(`${presetStartDate}T00:00:00`);
    const end = new Date(`${presetEndDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setNotice({
        type: "error",
        message: "Invalid preset date range.",
      });
      return;
    }

    if (end < start) {
      setNotice({
        type: "error",
        message: "Preset end date must be after start date.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
        const response = await fetch(`/api/specialists/${specialistId}/availability/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            blocks: selectedBlocks,
            availabilityType: entryMode,
            timezone,
          }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          error?: string;
          data?: {
            createdCount: number;
            availabilityType: AvailabilityType;
            replacedWindowCount: number;
            skipped: { past: number; booked: number; overlaps: number };
          };
        };
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error || "Failed to apply preset availability.");
        }

        if (visibleRange) {
          await loadRange(visibleRange.start, visibleRange.end, true);
        }

        setNotice({
          type: "success",
          message: `Preset applied (${availabilityTypeLabel(payload.data.availabilityType).toLowerCase()}): ${payload.data.createdCount} slot(s) set, ${payload.data.replacedWindowCount} replaced, ${payload.data.skipped.past + payload.data.skipped.booked + payload.data.skipped.overlaps} skipped.`,
        });
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to apply preset availability.",
        });
      }
    });
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Availability Calendar</h3>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {specialistName} · {slotPolicy.slotMinutes}-minute slots from{" "}
            {String(slotPolicy.startHour).padStart(2, "0")}:00 to{" "}
            {String(slotPolicy.endHour).padStart(2, "0")}:00.
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {currentView === "dayGridMonth"
              ? "Month view is overview-only. Click a day to open Day view for edits."
              : "Week and Day views support direct slot editing."}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {editable
              ? roleLabel === "ops"
                ? "Ops can set and remove available and out-of-office blocks."
                : "Counsellors can set their own available and out-of-office blocks."
              : "Read-only availability view."}
          </p>
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-xs">
          <p>Available: {availableCount}</p>
          <p>Out of office: {outOfOfficeCount}</p>
        </div>
      </header>

      {notice ? (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            notice.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-[color:var(--danger)] bg-red-50 text-[color:var(--danger)]"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
        <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-900">
          Available
        </span>
        <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-red-900">
          Out of office
        </span>
        <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
          Booked
        </span>
      </div>

      <section className="mb-3 rounded-xl border border-[color:var(--border)] bg-white p-3">
        <p className="text-sm font-semibold">Edit Mode</p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Click or drag in Week/Day view to set the selected mode.
        </p>
        <div className="mt-3 inline-flex rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-1">
          <button
            type="button"
            onClick={() => setEntryMode("AVAILABLE")}
            disabled={!editable}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              entryMode === "AVAILABLE"
                ? "bg-[color:var(--cg-dark-accent)] text-white"
                : "text-[color:var(--foreground)]"
            } ${!editable ? "cursor-not-allowed opacity-60" : ""}`}
          >
            Available
          </button>
          <button
            type="button"
            onClick={() => setEntryMode("OUT_OF_OFFICE")}
            disabled={!editable}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              entryMode === "OUT_OF_OFFICE"
                ? "bg-[color:var(--cg-dark-accent)] text-white"
                : "text-[color:var(--foreground)]"
            } ${!editable ? "cursor-not-allowed opacity-60" : ""}`}
          >
            Out of office
          </button>
        </div>
      </section>

      <section className="mb-3 rounded-xl border border-[color:var(--border)] bg-white p-3">
        <p className="text-sm font-semibold">Batch Availability Presets</p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Apply morning/afternoon/evening blocks across a date range as{" "}
          <strong>{availabilityTypeLabel(entryMode).toLowerCase()}</strong>. Slots stay 60 minutes.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs">
            Start date
            <input
              type="date"
              value={presetStartDate}
              onChange={(event) => setPresetStartDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-white px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            End date
            <input
              type="date"
              value={presetEndDate}
              onChange={(event) => setPresetEndDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-white px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            <input
              type="checkbox"
              checked={presetBlocks.MORNING}
              onChange={() => togglePresetBlock("MORNING")}
              className="mr-2"
            />
            Morning (09:00-12:00)
          </label>
          <label className="text-xs">
            <input
              type="checkbox"
              checked={presetBlocks.AFTERNOON}
              onChange={() => togglePresetBlock("AFTERNOON")}
              className="mr-2"
            />
            Afternoon (12:00-17:00)
          </label>
          <label className="text-xs">
            <input
              type="checkbox"
              checked={presetBlocks.EVENING}
              onChange={() => togglePresetBlock("EVENING")}
              className="mr-2"
            />
            Evening (17:00-18:00)
          </label>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={applyPresetBatch}
            disabled={!editable || isPending || isRangeLoading}
            className="rounded-md border border-[color:var(--cg-dark-accent)] bg-[color:var(--cg-dark-accent)] px-3 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply preset blocks
          </button>
        </div>
      </section>

      <div className={`rounded-xl border border-[color:var(--border)] bg-white p-3 ${isRangeLoading ? "opacity-85" : ""}`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={defaultView}
          initialDate={rangeStart}
          height="auto"
          nowIndicator
          navLinks
          selectable={editable && !isRangeLoading && currentView !== "dayGridMonth"}
          editable={false}
          weekends
          slotMinTime={`${String(slotPolicy.startHour).padStart(2, "0")}:00:00`}
          slotMaxTime={`${String(slotPolicy.endHour).padStart(2, "0")}:00:00`}
          slotDuration={toFullCalendarDuration(slotPolicy.slotMinutes)}
          snapDuration={toFullCalendarDuration(slotPolicy.slotMinutes)}
          allDaySlot={false}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          dayMaxEventRows={3}
          datesSet={handleDatesSet}
          events={events}
          select={handleDateSelect}
          eventClick={handleEventClick}
          dateClick={(arg) => {
            if (arg.view.type !== "dayGridMonth") {
              return;
            }
            const api = calendarRef.current?.getApi();
            if (!api) {
              return;
            }
            api.changeView("timeGridDay", arg.date);
          }}
          selectAllow={(selection) => {
            if (currentView === "dayGridMonth" || selection.allDay) {
              return false;
            }

            const start = new Date(selection.start);
            const end = new Date(selection.end);
            if (start < new Date()) {
              return false;
            }

            const durationMinutes = minutesBetween(start, end);
            return durationMinutes === slotPolicy.slotMinutes;
          }}
        />
      </div>
    </section>
  );
}
