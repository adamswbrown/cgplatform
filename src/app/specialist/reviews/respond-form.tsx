"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RespondToCaseProposalForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showDeclineNote, setShowDeclineNote] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleResponse(accept: boolean) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/cases/${caseId}/proposal/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept,
          responseNote: accept ? undefined : declineNote || undefined,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 border-t border-[color:var(--border)] pt-4">
      {error ? (
        <p className="mb-3 text-sm text-red-600">{error}</p>
      ) : null}

      {showDeclineNote ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={`decline-note-${caseId}`} className="block text-xs font-medium">
              Reason for declining
            </label>
            <textarea
              id={`decline-note-${caseId}`}
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
              placeholder="Please provide a reason..."
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleResponse(false)}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Confirm decline"}
            </button>
            <button
              onClick={() => setShowDeclineNote(false)}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => handleResponse(true)}
            disabled={loading}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "Accepting..." : "Accept case"}
          </button>
          <button
            onClick={() => setShowDeclineNote(true)}
            disabled={loading}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
