"use client";

import { useState } from "react";
import { respondToSessionTimeProposalAction } from "@/app/actions";

type Proposal = {
  id: string;
  proposedStartTime: Date | string;
  proposedEndTime: Date | string;
  status: string;
};

function formatSlotDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSlotTimeOnly(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SessionTimeResponse({
  proposals,
  caseReference,
}: {
  proposals: Proposal[];
  caseReference: string;
}) {
  const [respondingTo, setRespondingTo] = useState<{
    proposalId: string;
    action: "accept" | "decline";
  } | null>(null);

  const pendingProposals = proposals.filter((p) => p.status === "PENDING");
  const nonPendingProposals = proposals.filter((p) => p.status !== "PENDING");

  if (proposals.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
        Proposed Session Times
      </p>

      {pendingProposals.map((proposal) => (
        <div
          key={proposal.id}
          className="rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatSlotDateTime(proposal.proposedStartTime)}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {formatSlotTimeOnly(proposal.proposedStartTime)} &ndash;{" "}
                {formatSlotTimeOnly(proposal.proposedEndTime)}
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
              Pending
            </span>
          </div>

          {respondingTo?.proposalId === proposal.id ? (
            <form
              action={respondToSessionTimeProposalAction}
              className="mt-3"
            >
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input
                type="hidden"
                name="accept"
                value={respondingTo.action === "accept" ? "true" : "false"}
              />
              <input
                type="hidden"
                name="redirectTo"
                value="/specialist/sessions"
              />

              <div className="mb-3">
                <label
                  htmlFor={`notes-${proposal.id}`}
                  className="block text-xs font-medium text-[color:var(--muted)]"
                >
                  Notes (optional)
                </label>
                <textarea
                  id={`notes-${proposal.id}`}
                  name="specialistNotes"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                  placeholder={
                    respondingTo.action === "accept"
                      ? "Any notes about this session time..."
                      : "Reason for declining this time..."
                  }
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className={`rounded-md px-3 py-2 text-xs font-semibold text-white ${
                    respondingTo.action === "accept"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {respondingTo.action === "accept"
                    ? "Confirm acceptance"
                    : "Confirm decline"}
                </button>
                <button
                  type="button"
                  onClick={() => setRespondingTo(null)}
                  className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setRespondingTo({
                    proposalId: proposal.id,
                    action: "accept",
                  })
                }
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Accept this time
              </button>
              <button
                type="button"
                onClick={() =>
                  setRespondingTo({
                    proposalId: proposal.id,
                    action: "decline",
                  })
                }
                className="rounded-md border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      ))}

      {nonPendingProposals.map((proposal) => (
        <div
          key={proposal.id}
          className={`rounded-lg border p-3 ${
            proposal.status === "SPECIALIST_ACCEPTED" || proposal.status === "CLIENT_CONFIRMED"
              ? "border-emerald-200 bg-emerald-50"
              : "border-[color:var(--border)] bg-[color:var(--surface)] opacity-60"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatSlotDateTime(proposal.proposedStartTime)}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {formatSlotTimeOnly(proposal.proposedStartTime)} &ndash;{" "}
                {formatSlotTimeOnly(proposal.proposedEndTime)}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                proposal.status === "SPECIALIST_ACCEPTED"
                  ? "bg-emerald-100 text-emerald-800"
                  : proposal.status === "CLIENT_CONFIRMED"
                    ? "bg-emerald-200 text-emerald-900"
                    : proposal.status === "SPECIALIST_DECLINED"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-600"
              }`}
            >
              {proposal.status === "SPECIALIST_ACCEPTED"
                ? "Accepted"
                : proposal.status === "CLIENT_CONFIRMED"
                  ? "Confirmed"
                  : proposal.status === "SPECIALIST_DECLINED"
                    ? "Declined"
                    : proposal.status === "WITHDRAWN"
                      ? "Withdrawn"
                      : proposal.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
