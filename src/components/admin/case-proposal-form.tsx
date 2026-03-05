"use client";

import { proposeCaseAction } from "@/app/actions";

type Specialist = {
  id: string;
  name: string;
  supportsCouples: boolean;
};

export function CaseProposalForm({
  caseId,
  redirectTo,
  specialists,
}: {
  caseId: string;
  redirectTo: string;
  specialists: Specialist[];
}) {
  return (
    <form action={proposeCaseAction} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-2 xl:col-span-3">
      <h3 className="text-sm font-semibold">Propose to counsellor</h3>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Send a case proposal for the counsellor to review and accept before assignment.
      </p>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <label htmlFor="proposalSpecialistId" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
        Counsellor
      </label>
      <select
        id="proposalSpecialistId"
        name="specialistId"
        required
        className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
      >
        <option value="">Select counsellor...</option>
        {specialists.map((specialist) => (
          <option key={specialist.id} value={specialist.id}>
            {specialist.name}{specialist.supportsCouples ? " (couples)" : ""}
          </option>
        ))}
      </select>

      <label htmlFor="proposalNote" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
        Note for counsellor (optional)
      </label>
      <textarea
        id="proposalNote"
        name="proposalNote"
        rows={3}
        className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
        placeholder="Any context the counsellor should know before accepting..."
      />

      <button
        type="submit"
        className="mt-3 w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
      >
        Send proposal
      </button>
    </form>
  );
}
