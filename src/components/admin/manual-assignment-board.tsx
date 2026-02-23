"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { formatStatus, statusColorKey } from "@/lib/format";

type TimeBlock = "MORNING" | "AFTERNOON" | "EVENING";
type BoardViewMode = "kanban" | "calendar";
type BlockWindow = {
  startHour: number;
  endHour: number;
};

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
  workingHours: {
    startHour: number;
    endHour: number;
  };
  blockWindows: Record<TimeBlock, BlockWindow>;
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

function assignmentKey(specialistId: string, block: TimeBlock) {
  return `${specialistId}:${block}`;
}

function formatWindowLabel(window: BlockWindow) {
  return `${String(window.startHour).padStart(2, "0")}:00-${String(window.endHour).padStart(2, "0")}:00`;
}

function blockFromHour(hour: number, blockWindows: Record<TimeBlock, BlockWindow>): TimeBlock {
  for (const block of BLOCKS) {
    const window = blockWindows[block];
    if (hour >= window.startHour && hour < window.endHour) {
      return block;
    }
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
  const [activeSpecialistId, setActiveSpecialistId] = useState<string>(
    specialists[0]?.id ?? "",
  );
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
  const specialistById = useMemo(
    () =>
      specialists.reduce<Record<string, AssignmentSpecialist>>((acc, specialist) => {
        acc[specialist.id] = specialist;
        return acc;
      }, {}),
    [specialists],
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
    const specialist = specialistById[specialistId];
    const laneBlock =
      activeSessionDate && !Number.isNaN(activeSessionDate.getTime()) && specialist
        ? blockFromHour(activeSessionDate.getHours(), specialist.blockWindows)
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
    const unassignedCase: AssignmentCase = {
      ...caseItem,
      status:
        caseItem.status === "SCHEDULED" || caseItem.status === "IN_SESSION"
          ? "READY_TO_SCHEDULE"
          : caseItem.status,
    };
    setQueue((previous) =>
      previous.some((entry) => entry.id === caseItem.id) ? previous : [unassignedCase, ...previous],
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
    const colorKey = statusColorKey(caseItem.status);
    const isCouples = caseItem.counsellingType === "couples";
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
        className={`group relative rounded-xl border transition-shadow ${
          blocked
            ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-75"
            : "cursor-grab border-[color:var(--border)] bg-white shadow-sm hover:shadow-md active:cursor-grabbing"
        }`}
        style={!blocked ? { borderLeftWidth: "3px", borderLeftColor: `var(--cg-status-${colorKey})` } : undefined}
      >
        <div className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-[color:var(--cg-ink)] leading-snug">{caseItem.reference}</p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight"
              style={{
                backgroundColor: `var(--cg-status-${colorKey}-bg)`,
                color: `var(--cg-status-${colorKey})`,
                border: `1px solid var(--cg-status-${colorKey}-border)`,
              }}
            >
              {formatStatus(caseItem.status)}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-[color:var(--foreground)]">
            {caseItem.participants.map((participant) => participant.fullName).join(" & ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isCouples
                ? "bg-violet-50 text-violet-700 border border-violet-200"
                : "bg-slate-100 text-slate-600 border border-slate-200"
            }`}>
              {isCouples ? (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                  <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                  <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                </svg>
              )}
              {caseItem.counsellingType ? formatStatus(caseItem.counsellingType) : "Unspecified"}
            </span>
            {caseItem.timePreferences.length > 0 ? (
              caseItem.timePreferences.map((pref) => (
                <span key={pref} className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--cg-ink)]">
                  {BLOCK_LABELS[pref]}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-[color:var(--muted)]">
                Any time
              </span>
            )}
          </div>
          {blocked ? (
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 border border-amber-200">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-amber-500">
                <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{caseItem.pendingBlockingSteps} blocking step{caseItem.pendingBlockingSteps !== 1 ? "s" : ""} pending</span>
            </div>
          ) : null}
        </div>
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
    const isCouples = caseItem.counsellingType === "couples";

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
        className="cursor-grab rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-1.5">
          <p className="font-semibold leading-snug">{caseItem.reference}</p>
          {isCouples ? (
            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700">
              Couples
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] font-medium text-emerald-800">
          {caseItem.participants.map((participant) => participant.fullName).join(" & ")}
        </p>
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-700">
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 opacity-60">
            <path fillRule="evenodd" d="M1 8a.75.75 0 0 1 .75-.75h6.19L5.47 4.78a.75.75 0 0 1 1.06-1.06l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 1 1-1.06-1.06L7.94 8.75H1.75A.75.75 0 0 1 1 8Z" clipRule="evenodd" />
          </svg>
          <span>
            {assignedStartTime
              ? formatDateTime(assignedStartTime)
              : assignedBlock
                ? BLOCK_LABELS[assignedBlock]
                : "Time pending"}
          </span>
        </div>
        {!matchesPreference ? (
          <div className="mt-1.5 flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 text-amber-500">
              <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            Outside client's preferred time
          </div>
        ) : null}
      </article>
    );
  }

  const unassignedPanel = (
    <section
      className={`flex h-full min-h-[260px] flex-col rounded-2xl border bg-white p-4 transition-all ${
        draggedCase?.sourceLaneKey
          ? "border-dashed border-[color:var(--accent)] bg-[color:var(--accent-soft)]/20 shadow-[inset_0_0_0_1px_var(--accent)]"
          : "border-[color:var(--border)] shadow-sm"
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
      <header className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-500">
            <path fillRule="evenodd" d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01Z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[color:var(--cg-ink)]">
            Queue
          </h3>
          <p className="text-[11px] text-[color:var(--muted)]">
            {draggedCase?.sourceLaneKey
              ? "Drop here to unassign"
              : `${queue.length} case${queue.length !== 1 ? "s" : ""} awaiting assignment`}
          </p>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[color:var(--cg-ink)] px-1.5 text-[11px] font-bold text-white">
          {queue.length}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-emerald-500">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="mt-2 text-sm font-medium text-emerald-800">All cases assigned</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">No cases waiting in the queue.</p>
          </div>
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
            {slotPolicy.slotMinutes}-min slots,{" "}
            {String(slotPolicy.startHour).padStart(2, "0")}:00–{String(slotPolicy.endHour).padStart(2, "0")}:00
            {" "}&middot;{" "}
            Drag cards to assign, reassign, or return to queue.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "kanban"
                  ? "bg-[color:var(--cg-ink)] text-white shadow-sm"
                  : "text-[color:var(--muted)] hover:text-[color:var(--cg-ink)]"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v2A1.5 1.5 0 0 0 2.5 8h3A1.5 1.5 0 0 0 7 6.5v-2A1.5 1.5 0 0 0 5.5 3h-3ZM2.5 9.5A1.5 1.5 0 0 0 1 11v1.5A1.5 1.5 0 0 0 2.5 14h3A1.5 1.5 0 0 0 7 12.5V11A1.5 1.5 0 0 0 5.5 9.5h-3ZM9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V11a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 11V4.5Z" />
              </svg>
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "calendar"
                  ? "bg-[color:var(--cg-ink)] text-white shadow-sm"
                  : "text-[color:var(--muted)] hover:text-[color:var(--cg-ink)]"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2V1.75ZM4.5 7a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7Z" clipRule="evenodd" />
              </svg>
              Calendar
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">{queue.length}</span>
              <span className="text-[color:var(--muted)]">queued</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">{assignedCount}</span>
              <span className="text-[color:var(--muted)]">assigned</span>
            </div>
          </div>
        </div>
      </header>

      {notice ? (
        <p
          className={`mb-4 ${
            notice.type === "success"
              ? "cg-alert cg-alert-success"
              : "cg-alert cg-alert-error"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {/* Counsellor tabs */}
      {specialists.length > 0 ? (
        <div className="mb-4">
          <nav className="flex gap-1 overflow-x-auto border-b border-[color:var(--border)] pb-px" role="tablist">
            {specialists.map((specialist) => {
              const isActive = activeSpecialistId === specialist.id;
              const specialistCaseCount = (assignedCasesBySpecialist[specialist.id] || []).length;
              return (
                <button
                  key={specialist.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSpecialistId(specialist.id)}
                  className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-[color:var(--cg-ink)] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[color:var(--accent)]"
                      : "text-[color:var(--muted)] hover:text-[color:var(--cg-ink)]"
                  }`}
                >
                  {specialist.name}
                  {specialistCaseCount > 0 ? (
                    <span className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                      isActive
                        ? "bg-[color:var(--accent)] text-white"
                        : "bg-[color:var(--accent-soft)] text-[color:var(--muted)]"
                    }`}>
                      {specialistCaseCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      ) : null}

      {viewMode === "kanban" ? (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="self-start lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">{unassignedPanel}</div>

          {specialists.filter((s) => s.id === activeSpecialistId).map((specialist) => (
            <section
              key={specialist.id}
              className="rounded-2xl border border-[color:var(--border)] bg-white p-4"
            >
              <header className="mb-4">
                <h3 className="text-base font-semibold">{specialist.name}</h3>
                <p className="text-xs text-[color:var(--muted)]">
                  {specialist.supportsCouples ? "Supports couples" : "Individual only"} •
                  Working hours: {String(specialist.workingHours.startHour).padStart(2, "0")}:00–{String(specialist.workingHours.endHour).padStart(2, "0")}:00
                </p>
              </header>

              <div className="grid gap-3 md:grid-cols-3">
                {BLOCKS.map((block) => {
                  const key = assignmentKey(specialist.id, block);
                  const laneAssignments = assignments[key] || [];
                  const blockWindow = specialist.blockWindows[block];
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
                            ({formatWindowLabel(blockWindow)})
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
      ) : (
        <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <div className="xl:sticky xl:top-4 xl:h-[calc(100vh-7rem)] xl:self-start">{unassignedPanel}</div>

          {specialists.filter((s) => s.id === activeSpecialistId).map((specialist) => {
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
                      {specialist.supportsCouples ? "Supports couples" : "Individual only"} •
                      Working hours: {String(specialist.workingHours.startHour).padStart(2, "0")}:00–{String(specialist.workingHours.endHour).padStart(2, "0")}:00
                    </p>
                  </div>
                  <p className="text-xs text-[color:var(--muted)]">
                    Calendar grid: drop into a specific available {`${slotPolicy.slotMinutes}-minute`} slot.
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
                            const block = blockFromHour(hour, specialist.blockWindows);
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: `var(--cg-status-${statusColorKey(selectedCase.status)}-bg)`,
                      color: `var(--cg-status-${statusColorKey(selectedCase.status)})`,
                      border: `1px solid var(--cg-status-${statusColorKey(selectedCase.status)}-border)`,
                    }}
                  >
                    {formatStatus(selectedCase.status)}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    selectedCase.counsellingType === "couples"
                      ? "bg-violet-50 text-violet-700 border border-violet-200"
                      : "bg-slate-100 text-slate-600 border border-slate-200"
                  }`}>
                    {selectedCase.counsellingType ? formatStatus(selectedCase.counsellingType) : "Unspecified"}
                  </span>
                </div>
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
