"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncOutlookButtonProps = {
  specialistId: string;
};

export function SyncOutlookButton({ specialistId }: SyncOutlookButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch(
        `/api/specialists/${specialistId}/availability/sync-outlook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: 28 }),
        },
      );

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Sync failed.");
        return;
      }

      setResult(
        `Synced ${data.data.syncedDays} days: ${data.data.createdWindows} windows created, ${data.data.skippedExisting} skipped, ${data.data.deactivatedConflicts} old sync entries cleared.`,
      );

      router.refresh();
    } catch {
      setError("Network error during sync.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
      >
        {syncing ? "Syncing Outlook..." : "Sync from Outlook"}
      </button>
      {result ? (
        <span className="text-xs text-green-700">{result}</span>
      ) : null}
      {error ? (
        <span className="text-xs text-red-700">{error}</span>
      ) : null}
    </div>
  );
}
