"use client";

import { useState } from "react";
import { transitionCaseAction } from "@/app/actions";

type ReviewDecision = "accept" | "flag" | "decline" | null;

export function IntakeReviewDecision({
  caseId,
  redirectTo,
}: {
  caseId: string;
  redirectTo: string;
}) {
  const [decision, setDecision] = useState<ReviewDecision>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (decision !== "flag") return;
    const formData = new FormData(event.currentTarget);
    const reason = formData.get("reason");
    if (typeof reason === "string" && !reason.startsWith("[FLAGGED] ")) {
      // Mutate the hidden input so the server action receives the prefixed value
      const input = event.currentTarget.querySelector<HTMLInputElement>(
        'input[name="reason"]',
      );
      if (input) {
        input.value = `[FLAGGED] ${input.value}`;
      }
    }
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-1 xl:col-span-3">
      <h3 className="text-sm font-semibold">Clinical Review Decision</h3>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Review the intake submission and select an outcome.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDecision("accept")}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
            decision === "accept"
              ? "bg-emerald-600 text-white"
              : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          }`}
        >
          Accept referral
        </button>
        <button
          type="button"
          onClick={() => setDecision("flag")}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
            decision === "flag"
              ? "bg-amber-500 text-white"
              : "border border-amber-300 text-amber-700 hover:bg-amber-50"
          }`}
        >
          Accept with flag
        </button>
        <button
          type="button"
          onClick={() => setDecision("decline")}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
            decision === "decline"
              ? "bg-red-600 text-white"
              : "border border-red-300 text-red-700 hover:bg-red-50"
          }`}
        >
          Not accepted
        </button>
      </div>

      {decision && (
        <form action={transitionCaseAction} onSubmit={handleSubmit} className="mt-3">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input
            type="hidden"
            name="targetStatus"
            value={decision === "decline" ? "CLOSED" : "MATCHED"}
          />

          {decision === "flag" && (
            <div className="mb-3">
              <label
                htmlFor="reviewFlag"
                className="block text-xs font-medium text-[color:var(--muted)]"
              >
                Flag note (will be visible to the assigned counsellor)
              </label>
              <input
                id="reviewFlag"
                name="reason"
                required
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="Describe what the counsellor should be aware of..."
              />
            </div>
          )}

          {decision === "decline" && (
            <div className="mb-3">
              <label
                htmlFor="declineReason"
                className="block text-xs font-medium text-[color:var(--muted)]"
              >
                Reason for declining (required)
              </label>
              <input
                id="declineReason"
                name="reason"
                required
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="Reason this referral is not being accepted..."
              />
            </div>
          )}

          <button
            type="submit"
            className={`rounded-md px-3 py-2 text-xs font-semibold text-white ${
              decision === "decline"
                ? "bg-red-600 hover:bg-red-700"
                : decision === "flag"
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {decision === "accept" && "Confirm acceptance"}
            {decision === "flag" && "Accept with flag"}
            {decision === "decline" && "Confirm decline"}
          </button>

          <button
            type="button"
            onClick={() => setDecision(null)}
            className="ml-2 rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
