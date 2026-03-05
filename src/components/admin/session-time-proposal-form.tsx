"use client";

import { useState } from "react";
import { proposeSessionTimesAction } from "@/app/actions";

type TimeSlot = {
  date: string;
  time: string;
};

export function SessionTimeProposalForm({
  caseId,
  specialistId,
  specialistName,
  redirectTo,
}: {
  caseId: string;
  specialistId: string;
  specialistName: string;
  redirectTo: string;
}) {
  const [slots, setSlots] = useState<TimeSlot[]>([{ date: "", time: "" }]);

  function addSlot() {
    if (slots.length < 5) {
      setSlots([...slots, { date: "", time: "" }]);
    }
  }

  function removeSlot(index: number) {
    if (slots.length > 1) {
      setSlots(slots.filter((_, i) => i !== index));
    }
  }

  function updateSlot(index: number, field: keyof TimeSlot, value: string) {
    setSlots(
      slots.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)),
    );
  }

  /**
   * Build ISO datetime strings for each slot.
   * Start = date + time, End = start + 60 minutes.
   */
  function buildSlotDatetimes(slot: TimeSlot) {
    if (!slot.date || !slot.time) return null;
    const start = new Date(`${slot.date}T${slot.time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const validSlotCount = slots.filter(
    (s) => s.date && s.time,
  ).length;

  return (
    <form
      action={proposeSessionTimesAction}
      className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-2 xl:col-span-6"
    >
      <h3 className="text-sm font-semibold">Propose Session Times</h3>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Select up to 5 time slots for {specialistName} to review.
      </p>

      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="specialistId" value={specialistId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {/* Render hidden fields for each valid slot */}
      {slots.map((slot, index) => {
        const datetimes = buildSlotDatetimes(slot);
        if (!datetimes) return null;
        return (
          <div key={`hidden-${index}`}>
            <input
              type="hidden"
              name={`slot_${index}_start`}
              value={datetimes.start}
            />
            <input
              type="hidden"
              name={`slot_${index}_end`}
              value={datetimes.end}
            />
          </div>
        );
      })}

      <div className="mt-3 space-y-3">
        {slots.map((slot, index) => (
          <div
            key={index}
            className="rounded-lg border border-[color:var(--border)] bg-white p-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[color:var(--muted)]">
                Slot {index + 1}
              </p>
              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSlot(index)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor={`slot-date-${index}`}
                  className="block text-xs font-medium text-[color:var(--muted)]"
                >
                  Date
                </label>
                <input
                  id={`slot-date-${index}`}
                  type="date"
                  required
                  value={slot.date}
                  onChange={(e) => updateSlot(index, "date", e.target.value)}
                  className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor={`slot-time-${index}`}
                  className="block text-xs font-medium text-[color:var(--muted)]"
                >
                  Start time
                </label>
                <input
                  id={`slot-time-${index}`}
                  type="time"
                  required
                  value={slot.time}
                  onChange={(e) => updateSlot(index, "time", e.target.value)}
                  className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>
            </div>

            {slot.date && slot.time && (
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                Session: {slot.time} &ndash;{" "}
                {(() => {
                  const [h, m] = slot.time.split(":").map(Number);
                  const endMinutes = h * 60 + m + 60;
                  const endH = Math.floor(endMinutes / 60) % 24;
                  const endM = endMinutes % 60;
                  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
                })()}{" "}
                (60 min)
              </p>
            )}
          </div>
        ))}
      </div>

      {slots.length < 5 && (
        <button
          type="button"
          onClick={addSlot}
          className="mt-3 w-full rounded-md border border-dashed border-[color:var(--border)] px-3 py-2 text-xs font-semibold text-[color:var(--muted)] hover:bg-[color:var(--accent-soft)]"
        >
          + Add another time slot
        </button>
      )}

      <button
        type="submit"
        disabled={validSlotCount === 0}
        className="mt-3 w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Propose {validSlotCount} time slot{validSlotCount !== 1 ? "s" : ""}
      </button>
    </form>
  );
}
