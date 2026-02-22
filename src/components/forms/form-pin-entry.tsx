"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type FormPinEntryProps = {
  accessKey: string;
  nextPath?: string | null;
  verifyEndpoint?: string;
};

export function FormPinEntry({
  accessKey,
  nextPath,
  verifyEndpoint = "/api/forms/access/verify",
}: FormPinEntryProps) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(verifyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessKey,
          pin,
          next: nextPath || undefined,
        }),
      });

      const json = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: {
          redirectTo: string;
        };
      };

      if (!response.ok || !json.ok || !json.data?.redirectTo) {
        setError(json.error || "Invalid PIN. Please try again.");
        return;
      }

      router.push(json.data.redirectTo);
    } catch {
      setError("Unable to verify PIN right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="pin" className="mb-1 block text-sm font-medium">
          Enter your PIN code
        </label>
        <input
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{4,8}"
          minLength={4}
          maxLength={8}
          required
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D+/g, ""))}
          className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-lg tracking-[0.2em]"
          placeholder="000000"
        />
      </div>

      {error ? (
        <p className="cg-alert cg-alert-error">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-[color:var(--cg-ink)] px-4 py-2 text-sm font-medium uppercase tracking-[2px] text-white disabled:opacity-60"
      >
        {submitting ? "Verifying..." : "Continue"}
      </button>
    </form>
  );
}
