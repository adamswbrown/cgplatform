"use client";

import { useState } from "react";
import { respondToProposalAction } from "@/app/actions";

export function ProposalResponse({
  proposalId,
  redirectTo,
}: {
  proposalId: string;
  redirectTo: string;
}) {
  const [decision, setDecision] = useState<"accept" | "decline" | null>(null);

  if (!decision) {
    return (
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setDecision("accept")}
          className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Accept case
        </button>
        <button
          type="button"
          onClick={() => setDecision("decline")}
          className="rounded-md border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          Decline
        </button>
      </div>
    );
  }

  return (
    <form action={respondToProposalAction} className="mt-3">
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="decision" value={decision} />

      {decision === "decline" && (
        <div className="mb-3">
          <label htmlFor={`declineReason-${proposalId}`} className="block text-xs font-medium text-[color:var(--muted)]">
            Reason for declining (required)
          </label>
          <input
            id={`declineReason-${proposalId}`}
            name="declineReason"
            required
            className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
            placeholder="Why you cannot take this case..."
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          className={`rounded-md px-3 py-2 text-xs font-semibold text-white ${
            decision === "accept"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {decision === "accept" ? "Confirm acceptance" : "Confirm decline"}
        </button>
        <button
          type="button"
          onClick={() => setDecision(null)}
          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
