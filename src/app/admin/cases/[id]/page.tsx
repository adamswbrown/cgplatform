import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import {
  autoAllocateCaseAction,
  assignCaseWorkflowAction,
  completeDocumentAction,
  overrideAssignmentAction,
  transitionCaseAction,
} from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { getCaseDetails, listSpecialistsForOps, listWorkflowTemplatesForOps } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";
import { CASE_TRANSITIONS } from "@/lib/workflow";

type CaseDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CaseDetailPage({ params, searchParams }: CaseDetailPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const { id } = await params;

  const [caseItem, specialists, workflowTemplates, query] = await Promise.all([
    getCaseDetails(id),
    listSpecialistsForOps(),
    listWorkflowTemplatesForOps(),
    searchParams,
  ]);

  if (!caseItem) {
    notFound();
  }

  const transitionOptions = CASE_TRANSITIONS[caseItem.status];
  const error = typeof query.error === "string" ? query.error : null;
  const redirectTo = `/admin/cases/${caseItem.id}`;

  return (
    <AuthenticatedShell
      title={`Case ${caseItem.reference}`}
      subtitle="Manage lifecycle state, required documents, provider booking references, and audit logs."
      userName={user.name}
      role={user.role}
      navItems={[
        { href: "/admin/cases", label: "All Cases" },
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Specialists" },
        { href: "/admin/workflows", label: "Workflows" },
        { href: "/intake", label: "Public Intake" },
      ]}
    >
      {error ? (
        <p className="mb-4 rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[color:var(--muted)]">Current status</p>
              <h2 data-testid="case-current-status" className="text-xl font-semibold">
                {formatStatus(caseItem.status)}
              </h2>
            </div>
            <div className="text-right text-sm text-[color:var(--muted)]">
              <p>Assigned specialist</p>
              {caseItem.assignedSpecialist ? (
                <Link
                  href={`/admin/specialists/${caseItem.assignedSpecialist.id}`}
                  className="font-medium text-[color:var(--foreground)] underline"
                >
                  {caseItem.assignedSpecialist.name}
                </Link>
              ) : (
                <p className="font-medium text-[color:var(--foreground)]">Unassigned</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Participants
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {caseItem.participants.map((participant) => (
                  <li key={participant.id}>
                    <p className="font-medium">
                      {participant.client.firstName} {participant.client.lastName}
                    </p>
                    <p className="text-[color:var(--muted)]">{participant.client.email}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Notes & Flags
              </h3>
              <p className="mt-2 text-sm">{caseItem.notes || "No notes"}</p>
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                Counselling type: {caseItem.counsellingType || "unspecified"} • Intake source:{" "}
                {caseItem.intakeSource}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {caseItem.flags.length > 0 ? (
                  caseItem.flags.map((flag) => (
                    <span
                      key={flag}
                      className="rounded-full bg-[color:var(--accent-soft)] px-2.5 py-1 text-xs"
                    >
                      {flag}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[color:var(--muted)]">No flags</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <form action={autoAllocateCaseAction} className="rounded-xl border border-[color:var(--border)] p-4">
              <h3 className="text-sm font-semibold">Automatic allocation</h3>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                Runs matching rules, checks workflow blocking steps, filters by submitted participant-availability overlap, queries scheduling provider availability, and books the earliest returned slot.
              </p>
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button
                type="submit"
                className="mt-3 rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                Run auto allocation
              </button>
            </form>

            <form action={transitionCaseAction} className="rounded-xl border border-[color:var(--border)] p-4">
              <h3 className="text-sm font-semibold">Transition status</h3>
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />

              <label htmlFor="targetStatus" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
                Next status
              </label>
              <select
                id="targetStatus"
                name="targetStatus"
                required
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Select...</option>
                {transitionOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatStatus(option)}
                  </option>
                ))}
              </select>

              <label htmlFor="reason" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
                Reason (optional)
              </label>
              <input
                id="reason"
                name="reason"
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              />

              <button
                type="submit"
                className="mt-3 rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Apply transition
              </button>
            </form>
          </div>
        </section>

        <section className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Workflow assignment</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Scheduling is blocked until all required blocking workflow steps are completed.
            </p>

            <form action={assignCaseWorkflowAction} className="mt-3 space-y-2">
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <label htmlFor="caseWorkflowTemplateId" className="block text-xs font-medium">
                Workflow template
              </label>
              <select
                id="caseWorkflowTemplateId"
                name="caseWorkflowTemplateId"
                defaultValue={caseItem.caseWorkflowTemplateId || ""}
                required
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Select workflow...</option>
                {workflowTemplates.map((caseWorkflowTemplate) => (
                  <option key={caseWorkflowTemplate.id} value={caseWorkflowTemplate.id}>
                    {caseWorkflowTemplate.name} ({caseWorkflowTemplate.counsellingType})
                    {caseWorkflowTemplate.isDefault ? " [default]" : ""}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Assign workflow
              </button>
            </form>

            <ul className="mt-3 space-y-2 text-xs">
              {caseItem.workflowStates
                .slice()
                .sort((a, b) => a.step.sortOrder - b.step.sortOrder)
                .map((state) => (
                  <li key={state.id} className="rounded-md border border-[color:var(--border)] p-2">
                    <p className="font-medium">{state.step.name}</p>
                    <p className="text-[color:var(--muted)]">
                      {state.step.type}
                      {state.step.formType ? ` • ${state.step.formType}` : ""}
                      {state.step.blocksScheduling ? " • blocks scheduling" : ""}
                    </p>
                    <p className="mt-1">
                      {state.status === "COMPLETED" ? "Completed" : "Pending"}
                    </p>
                  </li>
                ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Manual override assignment</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Ops can override specialist. Scheduling still requires all blocking workflow steps to
              be completed.
            </p>

            <form action={overrideAssignmentAction} className="mt-3 space-y-2">
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />

              <label htmlFor="specialistId" className="block text-xs font-medium">
                Specialist
              </label>
              <select
                id="specialistId"
                name="specialistId"
                defaultValue={caseItem.assignedSpecialistId || ""}
                required
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Select specialist...</option>
                {specialists.map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>
                    {specialist.name}
                    {specialist.supportsCouples ? " (couples)" : ""}
                  </option>
                ))}
              </select>

              <label htmlFor="reasonOverride" className="block text-xs font-medium">
                Override reason
              </label>
              <textarea
                id="reasonOverride"
                name="reason"
                required
                rows={2}
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              />

              <label htmlFor="matchingRuleOverride" className="block text-xs font-medium">
                Matching rule override note
              </label>
              <input
                id="matchingRuleOverride"
                name="matchingRuleOverride"
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="Example: urgent specialist continuity request"
              />

              <button
                type="submit"
                className="w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                Apply override
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Session timeline</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {caseItem.sessions.length === 0 ? (
                <li className="text-[color:var(--muted)]">No sessions scheduled.</li>
              ) : (
                caseItem.sessions.map((session) => (
                  <li key={session.id} className="rounded-md border border-[color:var(--border)] p-2">
                    <p className="font-medium">{formatDateTime(session.providerStartTime)}</p>
                    <p>
                      <Link href={`/admin/specialists/${session.specialist.id}`} className="underline">
                        {session.specialist.name}
                      </Link>
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                    <p className="text-xs text-[color:var(--muted)]">Booking: {session.providerBookingId}</p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-12">
        <div
          data-testid="document-workflow"
          className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm lg:col-span-6"
        >
          <h3 className="text-lg font-semibold">Document workflow</h3>
          <ul className="mt-3 space-y-2">
            {caseItem.documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border)] p-3"
              >
                <div>
                  <p className="font-medium">{document.template.name}</p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Trigger: {formatStatus(document.template.triggerStatus)}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Status: {formatStatus(document.status)}
                  </p>
                </div>
                {document.status === "SENT" ? (
                  <form action={completeDocumentAction}>
                    <input type="hidden" name="documentId" value={document.id} />
                    <input type="hidden" name="redirectTo" value={redirectTo} />
                    <button
                      type="submit"
                      className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent-soft)]"
                    >
                      Mark complete
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-emerald-700">
                    Completed {document.completedAt ? formatDateTime(document.completedAt) : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm lg:col-span-6">
          <h3 className="text-lg font-semibold">Audit log</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {caseItem.auditLogs.map((log) => (
              <li key={log.id} className="rounded-md border border-[color:var(--border)] p-3">
                <p className="font-medium">{log.action}</p>
                <p className="text-xs text-[color:var(--muted)]">{formatDateTime(log.createdAt)}</p>
                <p className="text-xs text-[color:var(--muted)]">
                  By: {log.user?.name || log.user?.email || "System"}
                </p>
                {log.details ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>

          <Link
            href="/admin/cases"
            className="mt-4 inline-block rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
          >
            Back to case list
          </Link>
        </div>
      </section>
    </AuthenticatedShell>
  );
}
