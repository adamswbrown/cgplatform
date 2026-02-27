"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RespondToSlotForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResponse(accept: boolean) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/cases/${caseId}/slot/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
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

      <div className="flex gap-2">
        <button
          onClick={() => handleResponse(true)}
          disabled={loading}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "Accepting..." : "Accept slot"}
        </button>
        <button
          onClick={() => handleResponse(false)}
          disabled={loading}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Decline slot
        </button>
      </div>
    </div>
  );
}
