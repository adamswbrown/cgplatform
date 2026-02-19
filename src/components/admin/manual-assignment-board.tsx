"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

type TimeBlock = "MORNING" | "AFTERNOON" | "EVENING";
type BoardViewMode = "kanban" | "calendar";

type AssignmentCase = {
  id: string;
  reference: string;
  status: string;
  participantCount: number;
  participants: Array<{
    id: string;
    fullName: string;
  }>;
  counsellingType: string | null;
  timePreferences: TimeBlock[];
  pendingBlockingSteps: number;
  pendingBlockingStepNames: string[];
};

type AssignedCasePlacement = AssignmentCase & {
  assignedSpecialistId: string;
  assignedTimeBlock: TimeBlock;
  assignedSlotStartTime: string | null;
};

type CasePlacement = {
  specialistId: string;
  timeBlock: TimeBlock;
  startTime: string | null;
};

type AssignmentSpecialist = {
  id: string;
  name: string;
  supportsCouples: boolean;
  availability: {
    counts: Record<TimeBlock, number>;
    next: Record<TimeBlock, string | null>;
    slots: Record<TimeBlock, string[]>;
    calendarSlots: string[];
  };
};

type ManualAssignmentBoardProps = {
  cases: AssignmentCase[];
  assignedCases: AssignedCasePlacement[];
  specialists: AssignmentSpecialist[];
  slotPolicy: {
    startHour: number;
    endHour: number;
    slotMinutes: number;
  };
};

const BLOCKS: TimeBlock[] = ["MORNING", "AFTERNOON", "EVENING"];
const BLOCK_LABELS: Record<TimeBlock, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
};
const BLOCK_WINDOWS: Record<TimeBlock, string> = {
  MORNING: "09:00-12:00",
  AFTERNOON: "12:00-17:00",
  EVENING: "17:00-18:00",
};

function assignmentKey(specialistId: string, block: TimeBlock) {
  return `${specialistId}:${block}`;
}

function blockFromHour(hour: number): TimeBlock {
  if (hour < 12) {
    return "MORNING";
  }
  if (hour < 17) {
    return "AFTERNOON";
  }
  return "EVENING";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "No slot";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No slot";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSlotLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid slot";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCalendarDay(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(value);
}

function formatTimeLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatCasePreference(preferences: TimeBlock[]) {
  if (preferences.length === 0) {
    return "Any";
  }

  return preferences.map((preference) => BLOCK_LABELS[preference]).join(", ");
}

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function slotKey(value: Date) {
  return `${dayKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function parseSlotIso(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function buildLaneAssignments(assignedCases: AssignedCasePlacement[]) {
  const lanes: Record<string, AssignmentCase[]> = {};

  for (const assignedCase of assignedCases) {
    const key = assignmentKey(assignedCase.assignedSpecialistId, assignedCase.assignedTimeBlock);
    if (!lanes[key]) {
      lanes[key] = [];
    }

    const card: AssignmentCase = {
      id: assignedCase.id,
      reference: assignedCase.reference,
      status: assignedCase.status,
      participantCount: assignedCase.participantCount,
      participants: assignedCase.participants,
      counsellingType: assignedCase.counsellingType,
      timePreferences: assignedCase.timePreferences,
      pendingBlockingSteps: assignedCase.pendingBlockingSteps,
      pendingBlockingStepNames: assignedCase.pendingBlockingStepNames,
    };

    if (!lanes[key].some((existing) => existing.id === card.id)) {
      lanes[key].push(card);
    }
  }

  return lanes;
}

function buildPlacementMap(assignedCases: AssignedCasePlacement[]) {
  return assignedCases.reduce<Record<string, CasePlacement>>((acc, caseItem) => {
    acc[caseItem.id] = {
      specialistId: caseItem.assignedSpecialistId,
      timeBlock: caseItem.assignedTimeBlock,
      startTime: caseItem.assignedSlotStartTime,
    };
    return acc;
  }, {});
}

function removeCaseFromAllLanes(previous: Record<string, AssignmentCase[]>, caseId: string) {
  return Object.fromEntries(
    Object.entries(previous).map(([key, value]) => [
      key,
      value.filter((entry) => entry.id !== caseId),
    ]),
  );
}

function resolveCalendarDays(specialists: AssignmentSpecialist[], dayCount = 5) {
  const fromProvider = Array.from(
    new Set(
      specialists.flatMap((specialist) =>
        specialist.availability.calendarSlots
          .map((slot) => parseSlotIso(slot))
          .filter((slot): slot is Date => Boolean(slot))
          .map((slot) => dayKey(slot)),
      ),
    ),
  )
    .sort()
    .slice(0, dayCount)
    .map((entry) => {
      const parsed = new Date(`${entry}T00:00:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    })
    .filter((entry): entry is Date => Boolean(entry));

  if (fromProvider.length > 0) {
    return fromProvider;
  }

  const days: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (days.length < dayCount) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function ManualAssignmentBoard({
  cases,
  assignedCases,
  specialists,
  slotPolicy,
}: ManualAssignmentBoardProps) {
  const router = useRouter();
  const [queue, setQueue] = useState(cases);
  const [viewMode, setViewMode] = useState<BoardViewMode>("kanban");
  const [draggedCase, setDraggedCase] = useState<{
    caseId: string;
    sourceLaneKey: string | null;
  } | null>(null);
  const [assignments, setAssignments] = useState<Record<string, AssignmentCase[]>>(() =>
    buildLaneAssignments(assignedCases),
  );
  const [placements, setPlacements] = useState<Record<string, CasePlacement>>(() =>
    buildPlacementMap(assignedCases),
  );
  const [selectedCase, setSelectedCase] = useState<AssignmentCase | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedCase(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const caseById = useMemo(() => {
    const index = queue.reduce<Record<string, AssignmentCase>>((acc, caseItem) => {
      acc[caseItem.id] = caseItem;
      return acc;
    }, {});

    for (const lane of Object.values(assignments)) {
      for (const caseItem of lane) {
        index[caseItem.id] = caseItem;
      }
    }

    return index;
  }, [queue, assignments]);

  const assignedCount = useMemo(
    () => Object.values(assignments).reduce((count, lane) => count + lane.length, 0),
    [assignments],
  );

  const assignedCasesBySpecialist = useMemo(() => {
    const grouped: Record<string, AssignmentCase[]> = {};
    for (const [laneKey, caseItems] of Object.entries(assignments)) {
      const specialistId = laneKey.split(":")[0];
      if (!grouped[specialistId]) {
        grouped[specialistId] = [];
      }

      for (const caseItem of caseItems) {
        if (!grouped[specialistId].some((existing) => existing.id === caseItem.id)) {
          grouped[specialistId].push(caseItem);
        }
      }
    }

    return grouped;
  }, [assignments]);

  const calendarDays = useMemo(() => resolveCalendarDays(specialists, 5), [specialists]);
  const calendarHours = useMemo(
    () =>
      Array.from(
        { length: Math.max(slotPolicy.endHour - slotPolicy.startHour, 0) },
        (_, index) => slotPolicy.startHour + index,
      ),
    [slotPolicy.endHour, slotPolicy.startHour],
  );

  function openCaseModal(caseItem: AssignmentCase) {
    setSelectedCase(caseItem);
  }

  function onCaseCardKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    caseItem: AssignmentCase,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCaseModal(caseItem);
    }
  }

  function startDragging(caseId: string, sourceLaneKey: string | null) {
    setDraggedCase({ caseId, sourceLaneKey });
  }

  async function assignToSpecialist(
    caseItem: AssignmentCase,
    sourceLaneKey: string | null,
    specialistId: string,
    preferredTimeBlock: TimeBlock,
    preferredStartTime?: string,
  ) {
    const response = await fetch(`/api/cases/${caseItem.id}/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        specialistId,
        reason: preferredStartTime
          ? `Assignment board calendar drop (${formatDateTime(preferredStartTime)})`
          : `Assignment board drag-drop (${BLOCK_LABELS[preferredTimeBlock]})`,
        matchingRuleOverride: "manual_assignment_dashboard",
        preferredTimeBlock,
        preferredStartTime,
      }),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
      data?: {
        sessions?: Array<{
          status: string;
          providerStartTime: string;
        }>;
      };
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Assignment failed.");
    }

    const activeSessionStart =
      payload.data?.sessions
        ?.filter((session) => session.status === "SCHEDULED" || session.status === "IN_SESSION")
        .map((session) => session.providerStartTime)
        .sort()
        .at(-1) ?? preferredStartTime ?? null;
    const activeSessionDate = activeSessionStart ? new Date(activeSessionStart) : null;
    const laneBlock =
      activeSessionDate && !Number.isNaN(activeSessionDate.getTime())
        ? blockFromHour(activeSessionDate.getHours())
        : preferredTimeBlock;
    const targetLaneKey = assignmentKey(specialistId, laneBlock);

    setQueue((previous) => previous.filter((entry) => entry.id !== caseItem.id));
    setAssignments((previous) => ({
      ...removeCaseFromAllLanes(previous, caseItem.id),
      [targetLaneKey]: [
        caseItem,
        ...(previous[targetLaneKey] || []).filter((entry) => entry.id !== caseItem.id),
      ],
    }));
    setPlacements((previous) => ({
      ...previous,
      [caseItem.id]: {
        specialistId,
        timeBlock: laneBlock,
        startTime: activeSessionStart,
      },
    }));
    setNotice({
      type: "success",
      message: sourceLaneKey
        ? `Reassigned ${caseItem.reference} (${BLOCK_LABELS[laneBlock]}).`
        : `Assigned ${caseItem.reference} (${BLOCK_LABELS[laneBlock]}).`,
    });
    setDraggedCase(null);
    router.refresh();
  }

  async function unassignToQueue(caseItem: AssignmentCase) {
    const response = await fetch(`/api/cases/${caseItem.id}/unassign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "Assignment board move back to unassigned",
      }),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unassign failed.");
    }

    setAssignments((previous) => removeCaseFromAllLanes(previous, caseItem.id));
    setPlacements((previous) => {
      const next = { ...previous };
      delete next[caseItem.id];
      return next;
    });
    setQueue((previous) =>
      previous.some((entry) => entry.id === caseItem.id) ? previous : [caseItem, ...previous],
    );
    setNotice({
      type: "success",
      message: `Moved ${caseItem.reference} back to Unassigned.`,
    });
    setDraggedCase(null);
    router.refresh();
  }

  async function handleDrop(
    specialistId: string,
    preferredTimeBlock: TimeBlock,
    preferredStartTime?: string,
  ) {
    if (!draggedCase || isPending) {
      return;
    }

    const caseItem = caseById[draggedCase.caseId];
    if (!caseItem) {
      setDraggedCase(null);
      return;
    }

    const targetLaneKey = assignmentKey(specialistId, preferredTimeBlock);
    if (!preferredStartTime && draggedCase.sourceLaneKey === targetLaneKey) {
      setDraggedCase(null);
      return;
    }

    if (caseItem.pendingBlockingSteps > 0) {
      setNotice({
        type: "error",
        message: `Case ${caseItem.reference} is not eligible for assignment yet (${caseItem.pendingBlockingSteps} blocking step(s) pending).`,
      });
      setDraggedCase(null);
      return;
    }

    startTransition(async () => {
      try {
        await assignToSpecialist(
          caseItem,
          draggedCase.sourceLaneKey,
          specialistId,
          preferredTimeBlock,
          preferredStartTime,
        );
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Assignment failed.",
        });
        setDraggedCase(null);
      }
    });
  }

  async function handleDropToUnassigned() {
    if (!draggedCase || !draggedCase.sourceLaneKey || isPending) {
      return;
    }

    const caseItem = caseById[draggedCase.caseId];
    if (!caseItem) {
      setDraggedCase(null);
      return;
    }

    startTransition(async () => {
      try {
        await unassignToQueue(caseItem);
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Unassign failed.",
        });
        setDraggedCase(null);
      }
    });
  }

  function renderQueueCard(caseItem: AssignmentCase) {
    const blocked = caseItem.pendingBlockingSteps > 0;
    return (
      <article
        key={caseItem.id}
        draggable={!blocked && !isPending}
        onDragStart={() => startDragging(caseItem.id, null)}
        onDragEnd={() => setDraggedCase(null)}
        onClick={() => openCaseModal(caseItem)}
        onKeyDown={(event) => onCaseCardKeyDown(event, caseItem)}
        role="button"
        tabIndex={0}
        className={`rounded-xl border px-3 py-3 text-sm ${
          blocked
            ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-80"
            : "cursor-grab border-[color:var(--border)] bg-[color:var(--surface)] active:cursor-grabbing"
        }`}
      >
        <p className="font-semibold">{caseItem.reference}</p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          {caseItem.participants.map((participant) => participant.fullName).join(" & ")}
        </p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Type: {caseItem.counsellingType || "unspecified"} • Status: {caseItem.status}
        </p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Time preference: {formatCasePreference(caseItem.timePreferences)}
        </p>
        {blocked ? (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
            {caseItem.pendingBlockingSteps} blocking workflow step(s) pending
          </p>
        ) : null}
      </article>
    );
  }

  function renderAssignedCard(caseItem: AssignmentCase, sourceLaneKey: string) {
    const placement = placements[caseItem.id];
    const assignedStartTime = placement?.startTime ?? null;
    const assignedBlock = placement?.timeBlock ?? null;
    const hasExplicitPreference = caseItem.timePreferences.length > 0;
    const matchesPreference =
      !assignedBlock ||
      !hasExplicitPreference ||
      caseItem.timePreferences.includes(assignedBlock);

    return (
      <article
        key={`${sourceLaneKey}-${caseItem.id}`}
        draggable={!isPending}
        onDragStart={() => startDragging(caseItem.id, sourceLaneKey)}
        onDragEnd={() => setDraggedCase(null)}
        onClick={() => openCaseModal(caseItem)}
        onKeyDown={(event) => onCaseCardKeyDown(event, caseItem)}
        role="button"
        tabIndex={0}
        className="cursor-grab rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900 active:cursor-grabbing"
      >
        <p className="font-semibold">{caseItem.reference}</p>
        <p>{caseItem.participants.map((participant) => participant.fullName).join(" & ")}</p>
        <p className="mt-1 text-[11px] text-emerald-800/90">
          Preference: {formatCasePreference(caseItem.timePreferences)}
        </p>
        <p className="mt-1 text-[11px] text-emerald-800/90">
          {assignedStartTime
            ? `Session: ${formatDateTime(assignedStartTime)}`
            : assignedBlock
              ? `Session block: ${BLOCK_LABELS[assignedBlock]}`
              : "Session: Time pending"}
        </p>
        {!matchesPreference ? (
          <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
            Outside preferred time block
          </p>
        ) : null}
      </article>
    );
  }

  const unassignedPanel = (
    <section
      className={`flex h-full min-h-[260px] flex-col rounded-2xl border bg-white p-3 ${
        draggedCase?.sourceLaneKey
          ? "border-dashed border-[color:var(--cg-ink)] shadow-[inset_0_0_0_1px_var(--cg-ink)]"
          : "border-[color:var(--border)]"
      }`}
      onDragOver={(event) => {
        if (draggedCase?.sourceLaneKey) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        void handleDropToUnassigned();
      }}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-[2px] text-[color:var(--muted)]">
          Unassigned
        </h3>
        <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--accent-soft)] px-2 py-0.5 text-xs">
          {queue.length}
        </span>
      </header>
      <p className="mb-2 text-xs text-[color:var(--muted)]">
        {draggedCase?.sourceLaneKey
          ? "Drop here to remove counsellor assignment."
          : "Queue of cases not currently assigned."}
      </p>
      <div className="space-y-3 overflow-y-auto pr-1">
        {queue.length === 0 ? (
          <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)] px-3 py-2 text-sm">
            No unassigned cases waiting.
          </p>
        ) : (
          queue.map((caseItem) => renderQueueCard(caseItem))
        )}
      </div>
    </section>
  );

  return (
    <section className="cg-surface-card p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--cg-ink)]">Assignment Dashboard</h2>
          <p className="text-sm text-[color:var(--muted)]">
            Policy: {slotPolicy.slotMinutes}-minute slots from{" "}
            {String(slotPolicy.startHour).padStart(2, "0")}:00 to{" "}
            {String(slotPolicy.endHour).padStart(2, "0")}:00.
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            Drag from queue to assign, drag across counsellors to reassign, and drag back to
            Unassigned to clear assignment.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                viewMode === "kanban"
                  ? "border-[color:var(--cg-ink)] bg-[color:var(--cg-ink)] text-white"
                  : "border-[color:var(--border)] bg-white text-[color:var(--cg-ink)]"
              }`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                viewMode === "calendar"
                  ? "border-[color:var(--cg-ink)] bg-[color:var(--cg-ink)] text-white"
                  : "border-[color:var(--border)] bg-white text-[color:var(--cg-ink)]"
              }`}
            >
              Calendar Grid
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs">
              Queue: {queue.length}
            </div>
            <div className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs">
              Assigned: {assignedCount}
            </div>
          </div>
        </div>
      </header>

      {notice ? (
        <p
          className={`mb-4 rounded-2xl border px-3 py-2 text-sm ${
            notice.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-[color:var(--danger)] bg-red-50 text-[color:var(--danger)]"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {viewMode === "kanban" ? (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="self-start lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">{unassignedPanel}</div>

          <div className="overflow-x-auto pb-3">
            <div className="flex min-w-max gap-4">
              {specialists.map((specialist) => (
                <section
                  key={specialist.id}
                  className="w-[340px] shrink-0 rounded-2xl border border-[color:var(--border)] bg-white p-3"
                >
                  <header className="mb-3">
                    <h3 className="text-base font-semibold">{specialist.name}</h3>
                    <p className="text-xs text-[color:var(--muted)]">
                      {specialist.supportsCouples ? "Supports couples" : "Individual only"}
                    </p>
                  </header>

                  <div className="space-y-2">
                    {BLOCKS.map((block) => {
                      const key = assignmentKey(specialist.id, block);
                      const laneAssignments = assignments[key] || [];
                      return (
                        <div
                          key={key}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            void handleDrop(specialist.id, block);
                          }}
                          className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--accent-soft)]/45 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">
                              {BLOCK_LABELS[block]}{" "}
                              <span className="text-xs text-[color:var(--muted)]">
                                ({BLOCK_WINDOWS[block]})
                              </span>
                            </p>
                            <span className="rounded-full border border-[color:var(--border)] bg-white px-2 py-0.5 text-xs">
                              {specialist.availability.counts[block]} slots
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[color:var(--muted)]">
                            Next: {formatDateTime(specialist.availability.next[block])}
                          </p>
                          <div className="mt-2 rounded-md border border-[color:var(--border)] bg-white p-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[color:var(--muted)]">
                              Upcoming Slots
                            </p>
                            {specialist.availability.slots[block].length > 0 ? (
                              <ul className="mt-1 grid grid-cols-1 gap-1">
                                {specialist.availability.slots[block].map((slot) => (
                                  <li
                                    key={`${key}-${slot}`}
                                    className="rounded-md border border-[color:var(--border)] bg-[color:var(--accent-soft)] px-2 py-1 text-[11px] text-[color:var(--cg-ink)]"
                                  >
                                    {formatSlotLabel(slot)}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[11px] text-[color:var(--muted)]">
                                No upcoming slots in this block.
                              </p>
                            )}
                          </div>
                          <div className="mt-2 space-y-1">
                            {laneAssignments.length > 0 ? (
                              laneAssignments.map((caseItem) => renderAssignedCard(caseItem, key))
                            ) : (
                              <p className="rounded-md border border-[color:var(--border)] bg-white px-2 py-1 text-xs text-[color:var(--muted)]">
                                Drop a case here
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <div className="xl:sticky xl:top-4 xl:h-[calc(100vh-7rem)] xl:self-start">{unassignedPanel}</div>
          <div className="space-y-4">
            {specialists.map((specialist) => {
              const specialistCases = assignedCasesBySpecialist[specialist.id] || [];
              const availableSlotByKey = specialist.availability.calendarSlots.reduce<
                Record<string, string>
              >((acc, slot) => {
                const parsed = parseSlotIso(slot);
                if (!parsed) {
                  return acc;
                }
                acc[slotKey(parsed)] = slot;
                return acc;
              }, {});

              const assignedBySlotKey: Record<string, AssignmentCase[]> = {};
              const unslottedCases: AssignmentCase[] = [];

              for (const caseItem of specialistCases) {
                const placement = placements[caseItem.id];
                const startTime = placement?.startTime;
                if (!startTime) {
                  unslottedCases.push(caseItem);
                  continue;
                }

                const parsed = parseSlotIso(startTime);
                if (!parsed) {
                  unslottedCases.push(caseItem);
                  continue;
                }

                const key = slotKey(parsed);
                if (!assignedBySlotKey[key]) {
                  assignedBySlotKey[key] = [];
                }
                assignedBySlotKey[key].push(caseItem);
              }

              return (
                <section
                  key={specialist.id}
                  className="rounded-2xl border border-[color:var(--border)] bg-white p-3"
                >
                  <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold">{specialist.name}</h3>
                      <p className="text-xs text-[color:var(--muted)]">
                        {specialist.supportsCouples ? "Supports couples" : "Individual only"}
                      </p>
                    </div>
                    <p className="text-xs text-[color:var(--muted)]">
                      Calendar grid: drop into a specific available 60-minute slot.
                    </p>
                  </header>

                  <div className="overflow-x-auto">
                    <table className="min-w-[860px] divide-y divide-[color:var(--border)] text-xs">
                      <thead className="bg-[color:var(--accent-soft)]">
                        <tr>
                          <th className="w-20 px-2 py-2 text-left font-semibold">Time</th>
                          {calendarDays.map((day) => (
                            <th key={`${specialist.id}-${dayKey(day)}`} className="px-2 py-2 text-left font-semibold">
                              {formatCalendarDay(day)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--border)]">
                        {calendarHours.map((hour) => (
                          <tr key={`${specialist.id}-hour-${hour}`}>
                            <th className="bg-[color:var(--accent-soft)]/45 px-2 py-2 text-left font-medium">
                              {formatTimeLabel(hour)}
                            </th>
                            {calendarDays.map((day) => {
                              const slotDate = new Date(day);
                              slotDate.setHours(hour, 0, 0, 0);
                              const key = slotKey(slotDate);
                              const availableSlotIso = availableSlotByKey[key] || null;
                              const assignedAtSlot = assignedBySlotKey[key] || [];
                              const block = blockFromHour(hour);
                              const sourceKey = assignmentKey(specialist.id, block);

                              return (
                                <td
                                  key={`${specialist.id}-${key}`}
                                  onDragOver={(event) => {
                                    if (availableSlotIso) {
                                      event.preventDefault();
                                    }
                                  }}
                                  onDrop={(event) => {
                                    if (!availableSlotIso) {
                                      return;
                                    }
                                    event.preventDefault();
                                    void handleDrop(specialist.id, block, availableSlotIso);
                                  }}
                                  className={`h-16 px-1 py-1 align-top ${
                                    availableSlotIso
                                      ? "bg-emerald-50/45"
                                      : "bg-slate-50/70 text-[color:var(--muted)]"
                                  }`}
                                >
                                  {assignedAtSlot.length > 0 ? (
                                    <div className="space-y-1">
                                      {assignedAtSlot.map((caseItem) =>
                                        renderAssignedCard(caseItem, sourceKey),
                                      )}
                                    </div>
                                  ) : availableSlotIso ? (
                                    <div className="rounded-md border border-dashed border-emerald-300 bg-white px-2 py-1 text-[11px] text-emerald-800">
                                      Open slot
                                    </div>
                                  ) : (
                                    <div className="px-2 py-1 text-[11px]">Unavailable</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {unslottedCases.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/35 p-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[color:var(--muted)]">
                        Assigned Outside Visible Grid
                      </p>
                      <div className="mt-2 space-y-1">
                        {unslottedCases.map((caseItem) =>
                          renderAssignedCard(
                            caseItem,
                            assignmentKey(
                              specialist.id,
                              placements[caseItem.id]?.timeBlock || caseItem.timePreferences[0] || "MORNING",
                            ),
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {selectedCase ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--cg-ink)]/55 p-4"
          onClick={() => setSelectedCase(null)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl border border-[color:var(--border)] bg-white p-5 shadow-[0_24px_60px_rgba(5,46,30,0.25)]"
            role="dialog"
            aria-modal="true"
            aria-label={`Case ${selectedCase.reference}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <p className="cg-nav-label text-[color:var(--muted)]">Case</p>
                <h3 className="text-2xl font-semibold text-[color:var(--cg-ink)]">
                  {selectedCase.reference}
                </h3>
                <p className="mt-1 text-sm text-[color:var(--muted)]">
                  Status: {selectedCase.status} • Counselling type:{" "}
                  {selectedCase.counsellingType || "unspecified"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCase(null)}
                className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs font-semibold"
              >
                Close
              </button>
            </header>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/35 p-3">
                <p className="text-xs font-semibold uppercase tracking-[2px] text-[color:var(--muted)]">
                  Participants
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {selectedCase.participants.map((participant) => (
                    <li key={participant.id}>{participant.fullName}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/35 p-3">
                <p className="text-xs font-semibold uppercase tracking-[2px] text-[color:var(--muted)]">
                  Availability Preference
                </p>
                <p className="mt-2 text-sm">{formatCasePreference(selectedCase.timePreferences)}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Assigned block:{" "}
                  {placements[selectedCase.id]?.timeBlock
                    ? BLOCK_LABELS[placements[selectedCase.id]!.timeBlock]
                    : "Not set"}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Assigned time:{" "}
                  {placements[selectedCase.id]?.startTime
                    ? formatDateTime(placements[selectedCase.id]!.startTime)
                    : "Not set"}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/25 p-3">
              <p className="text-xs font-semibold uppercase tracking-[2px] text-[color:var(--muted)]">
                Scheduling Gate
              </p>
              <p className="mt-2 text-sm">
                {selectedCase.pendingBlockingSteps > 0
                  ? `${selectedCase.pendingBlockingSteps} blocking workflow step(s) pending`
                  : "No blocking workflow steps pending"}
              </p>
              {selectedCase.pendingBlockingStepNames.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--muted)]">
                  {selectedCase.pendingBlockingStepNames.map((stepName) => (
                    <li key={stepName}>{stepName}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <footer className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/admin/cases/${selectedCase.id}`}
                className="cg-cta-primary inline-flex items-center justify-center px-4 py-2 text-xs text-white"
              >
                Open Full Case
              </a>
              <button
                type="button"
                onClick={() => setSelectedCase(null)}
                className="cg-cta-secondary px-4 py-2 text-xs"
              >
                Back to Board
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
