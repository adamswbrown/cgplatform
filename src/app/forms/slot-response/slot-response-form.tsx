"use client";

import { useState } from "react";

type SlotResponseFormProps = {
  caseId: string;
  accessKey: string;
  proposedStartTime: string;
  proposedEndTime: string;
};

export function SlotResponseForm({
  caseId,
  accessKey,
  proposedStartTime,
  proposedEndTime,
}: SlotResponseFormProps) {
  const [mode, setMode] = useState<"choose" | "accept" | "counter" | "done">("choose");
  const [tocAccepted, setTocAccepted] = useState(false);
  const [counterDate, setCounterDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleAccept() {
    if (!tocAccepted) {
      setError("You must accept the Terms of Counselling to confirm this appointment.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/cases/${caseId}/slot/client-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept: true,
          tocAccepted: true,
          accessKey,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setSuccessMessage("Your appointment has been confirmed. You will receive a confirmation email shortly.");
      setMode("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCounterPropose() {
    if (!counterDate) {
      setError("Please select a date for your proposed alternative.");
      return;
    }

    setLoading(true);
    setError(null);

    // Keep the same time of day from the original proposal, but use the new date
    const originalStart = new Date(proposedStartTime);
    const originalEnd = new Date(proposedEndTime);
    const newDate = new Date(counterDate);

    const counterStart = new Date(newDate);
    counterStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);

    const counterEnd = new Date(newDate);
    counterEnd.setHours(originalEnd.getHours(), originalEnd.getMinutes(), 0, 0);

    try {
      const res = await fetch(`/api/cases/${caseId}/slot/client-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept: false,
          counterProposedStartTime: counterStart.toISOString(),
          counterProposedEndTime: counterEnd.toISOString(),
          accessKey,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setSuccessMessage("Your alternative date has been sent. The counsellor will review and you will be contacted with a confirmation.");
      setMode("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "done") {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-semibold text-green-800">{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {mode === "choose" ? (
        <div className="space-y-3">
          <button
            onClick={() => setMode("accept")}
            className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700"
          >
            Accept this appointment
          </button>
          <button
            onClick={() => setMode("counter")}
            className="w-full rounded-lg border border-[color:var(--border)] px-4 py-3 text-sm font-semibold hover:bg-[color:var(--accent-soft)]"
          >
            Propose a different day
          </button>
        </div>
      ) : null}

      {mode === "accept" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <h3 className="text-sm font-semibold">Terms of Counselling</h3>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              By accepting this appointment, you agree to the Terms of Counselling as provided by Christian Guidelines.
              Please read the terms carefully before confirming.
            </p>
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={tocAccepted}
                onChange={(e) => setTocAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I have read and agree to the Terms of Counselling
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              disabled={loading}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? "Confirming..." : "Confirm appointment"}
            </button>
            <button
              onClick={() => setMode("choose")}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {mode === "counter" ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="counterDate" className="block text-sm font-medium">
              Propose a different day (same time)
            </label>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              The session will be at the same time of day, just on a different date.
            </p>
            <input
              type="date"
              id="counterDate"
              value={counterDate}
              onChange={(e) => setCounterDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="mt-2 w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCounterPropose}
              disabled={loading}
              className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Submit alternative date"}
            </button>
            <button
              onClick={() => setMode("choose")}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
