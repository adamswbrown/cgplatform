"use client";

import { useState, useTransition } from "react";
import { clientConfirmSessionTimeAction } from "@/app/actions";

type SessionTimeConfirmationProps = {
  proposalId: string;
  token: string;
  specialistName: string;
  startTime: string; // ISO
  endTime: string; // ISO
  caseReference: string;
};

export function SessionTimeConfirmation({
  proposalId,
  token,
  specialistName,
  startTime,
  endTime,
  caseReference,
}: SessionTimeConfirmationProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  const start = new Date(startTime);
  const end = new Date(endTime);

  const dateFormatted = start.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const startTimeFormatted = start.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const endTimeFormatted = end.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      clientConfirmSessionTimeAction(formData);
    });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Your Proposed Session</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Please review the details below and confirm your session time.
      </p>

      <div className="mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
        <p>
          <span className="font-medium">Counsellor:</span> {specialistName}
        </p>
        <p className="mt-1">
          <span className="font-medium">Date:</span> {dateFormatted}
        </p>
        <p className="mt-1">
          <span className="font-medium">Time:</span> {startTimeFormatted} &ndash; {endTimeFormatted}
        </p>
        <p className="mt-1">
          <span className="font-medium">Reference:</span> {caseReference}
        </p>
      </div>

      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Confirm this session time
        </button>
      ) : (
        <div className="mt-6">
          <p className="mb-3 text-center text-sm font-medium">
            Are you sure? This will book your session.
          </p>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="token" value={token} />
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
              className="flex-1 rounded-lg border border-[color:var(--border)] px-4 py-3 text-sm font-medium transition-colors hover:bg-[color:var(--surface)]"
            >
              Go back
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? "Confirming..." : "Yes, confirm"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
