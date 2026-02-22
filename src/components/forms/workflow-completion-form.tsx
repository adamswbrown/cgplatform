"use client";

import { FormEvent, useState } from "react";

type WorkflowCompletionFormProps = {
  caseId: string;
  participantIdentifier: string;
  accessKey: string;
  formType: string;
  confirmationLabel: string;
  detailsLabel?: string;
  detailsPlaceholder?: string;
  requireDetails?: boolean;
  successMessage?: string;
};

export function WorkflowCompletionForm({
  caseId,
  participantIdentifier,
  accessKey,
  formType,
  confirmationLabel,
  detailsLabel = "Additional details (optional)",
  detailsPlaceholder = "Add any relevant details.",
  requireDetails = false,
  successMessage = "Thank you. Your response has been recorded.",
}: WorkflowCompletionFormProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!confirmed) {
      setError("Please confirm before submitting.");
      return;
    }
    if (requireDetails && !details.trim()) {
      setError("Please provide details before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/forms/submission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          formType,
          caseId,
          participantIdentifier,
          accessKey,
          source: "secure_form_pin",
          metadata: {
            confirmed,
            details: details.trim() || null,
            submittedAt: new Date().toISOString(),
          },
        }),
      });

      const json = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !json.ok) {
        setError(json.error || "Submission failed.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="cg-alert cg-alert-success">
        {successMessage}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5"
        />
        {confirmationLabel}
      </label>

      <div>
        <label htmlFor="workflow-details" className="mb-1 block text-sm font-medium">
          {detailsLabel}
        </label>
        <textarea
          id="workflow-details"
          rows={4}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={detailsPlaceholder}
          className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
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
        className="rounded-full bg-[color:var(--cg-ink)] px-4 py-2 text-sm font-medium uppercase tracking-[2px] text-white disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
