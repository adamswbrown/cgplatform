import Link from "next/link";
import { UserRole } from "@prisma/client";
import { issueIntakeAccessInviteAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { formatDateTime, formatStatus, statusColorKey, statusFilterGroup } from "@/lib/format";
import { getOperationalSettings } from "@/lib/admin-settings";
import { requirePageUser } from "@/lib/auth";
import { listCasesForOps } from "@/lib/case-service";

type AdminCasesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCasesPage({ searchParams }: AdminCasesPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const [cases, operationalSettings] = await Promise.all([
    listCasesForOps(),
    getOperationalSettings(),
  ]);
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const intakeInviteIssued = params.intakeInviteIssued === "1";
  const intakeInviteRecipient =
    typeof params.intakeInviteRecipient === "string" ? params.intakeInviteRecipient : null;
  const intakeInviteAccessUrl =
    typeof params.intakeInviteAccessUrl === "string" ? params.intakeInviteAccessUrl : null;
  const intakeInviteExpiresAt =
    typeof params.intakeInviteExpiresAt === "string" ? params.intakeInviteExpiresAt : null;
  const intakeInviteEmailDelivered = params.intakeInviteEmailDelivered === "1";
  const intakeInvitePin = typeof params.intakeInvitePin === "string" ? params.intakeInvitePin : null;
  const intakeInviteEmailError =
    typeof params.intakeInviteEmailError === "string" ? params.intakeInviteEmailError : null;

  const activeFilter = typeof params.filter === "string" ? params.filter : "all";
  const filteredCases =
    activeFilter === "all"
      ? cases
      : cases.filter((c) => statusFilterGroup(c.status) === activeFilter);

  const filterCounts = {
    all: cases.length,
    needs_review: cases.filter((c) => statusFilterGroup(c.status) === "needs_review").length,
    in_progress: cases.filter((c) => statusFilterGroup(c.status) === "in_progress").length,
    scheduled: cases.filter((c) => statusFilterGroup(c.status) === "scheduled").length,
    completed: cases.filter((c) => statusFilterGroup(c.status) === "completed").length,
  };

  const FILTERS: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    { key: "needs_review", label: "Needs Review" },
    { key: "in_progress", label: "In Progress" },
    { key: "scheduled", label: "Scheduled" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <AuthenticatedShell
      title="Operations Cases"
      subtitle="Track lifecycle progression, workflow compliance, counsellor assignment, and auditability."
      userName={user.name}
      role={user.role}
      currentPath="/admin/cases"
      navItems={[
        { href: "/admin/cases", label: "All Cases" },
        { href: "/admin/assignments", label: "Assignments" },
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Counsellors" },
        { href: "/admin/workflows", label: "Workflows" },
        { href: "/admin/settings", label: "Settings" },
        { href: "/intake", label: "Secure Intake" },
      ]}
    >
      {error ? (
        <p className="cg-alert cg-alert-error mb-4">{error}</p>
      ) : null}
      {intakeInviteIssued ? (
        <div className="cg-alert cg-alert-success mb-4">
          <p>
            Intake invite issued for <strong>{intakeInviteRecipient}</strong>.
          </p>
          {intakeInviteExpiresAt ? <p className="text-xs">Expires: {formatDateTime(intakeInviteExpiresAt)}</p> : null}
          {intakeInviteAccessUrl ? (
            <p className="mt-1 text-xs">
              Access page:{" "}
              <a href={intakeInviteAccessUrl} className="underline">
                {intakeInviteAccessUrl}
              </a>
            </p>
          ) : null}
          {intakeInviteEmailDelivered ? (
            <p className="mt-1 text-xs">Invite email sent.</p>
          ) : (
            <p className="mt-1 text-xs">
              Email not sent from the system. Share this PIN manually:{" "}
              <strong>{intakeInvitePin || "Unavailable"}</strong>
            </p>
          )}
          {intakeInviteEmailError ? <p className="mt-1 text-xs">Email error: {intakeInviteEmailError}</p> : null}
        </div>
      ) : null}

      <details className="group rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 text-[color:var(--muted)]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <div>
              <h2 className="text-sm font-semibold">Issue Secure Intake Link</h2>
              <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                Generate a secure link and PIN for a prospective client.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/assignments"
              className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
            >
              Open Assignment Board
            </Link>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-[color:var(--muted)] transition group-open:rotate-180">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </summary>
        <div className="border-t border-[color:var(--border)] p-4">
          <form action={issueIntakeAccessInviteAction} className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="redirectTo" value="/admin/cases" />
            <div className="md:col-span-2">
              <label htmlFor="recipientEmail" className="mb-1 block text-xs font-medium">
                Recipient email
              </label>
              <input
                id="recipientEmail"
                name="recipientEmail"
                type="email"
                required
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="person@example.com"
              />
            </div>
            <div>
              <label htmlFor="recipientName" className="mb-1 block text-xs font-medium">
                Name (optional)
              </label>
              <input
                id="recipientName"
                name="recipientName"
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="First Last"
              />
            </div>
            <div>
              <label htmlFor="expiresInHours" className="mb-1 block text-xs font-medium">
                Expires (hours)
              </label>
              <input
                id="expiresInHours"
                name="expiresInHours"
                type="number"
                min={1}
                max={336}
                defaultValue={operationalSettings.defaultIntakeInviteExpiresHours}
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="maxAttempts" className="mb-1 block text-xs font-medium">
                Max attempts
              </label>
              <input
                id="maxAttempts"
                name="maxAttempts"
                type="number"
                min={1}
                max={20}
                defaultValue={operationalSettings.defaultIntakeInviteMaxAttempts}
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs md:col-span-2">
              <input type="checkbox" name="sendEmail" defaultChecked />
              Send secure intake link by email
            </label>
            <div className="md:col-span-1">
              <button
                type="submit"
                className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Issue intake link
              </button>
            </div>
          </form>
        </div>
      </details>

      <section className="cg-data-dense overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] px-4 py-3">
          {FILTERS.map((filter) => {
            const count = filterCounts[filter.key as keyof typeof filterCounts];
            const isActive = activeFilter === filter.key;
            return (
              <Link
                key={filter.key}
                href={filter.key === "all" ? "/admin/cases" : `/admin/cases?filter=${filter.key}`}
                className={
                  isActive
                    ? "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--cg-ink)] bg-[color:var(--cg-ink)] px-3 py-1.5 text-xs font-semibold text-white"
                    : "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] px-3 py-1.5 text-xs font-medium text-[color:var(--cg-ink)] hover:bg-[color:var(--accent-soft)]"
                }
              >
                {filter.label}
                <span
                  className={isActive
                    ? "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                    : "rounded-full bg-[color:var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--cg-ink)]"
                  }
                  style={isActive ? { background: "#fff", color: "var(--cg-ink)" } : undefined}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="cg-mobile-card-list overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-[color:var(--accent-soft)]/30 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Participants</th>
                <th className="px-4 py-3 font-semibold">Assigned Counsellor</th>
                <th className="px-4 py-3 font-semibold">Next Session</th>
                <th className="px-4 py-3 font-semibold">Docs</th>
                <th className="px-4 py-3 font-semibold">Gate</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <div className="cg-empty-state">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                      <p className="text-sm font-medium">No cases match this filter</p>
                      <p className="mt-1 text-xs">Try selecting a different filter or issue a new intake link above.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCases.map((caseItem) => {
                  const requiredDocs = caseItem.documents.filter((doc) => doc.required);
                  const completedRequired = requiredDocs.filter(
                    (doc) => doc.status === "COMPLETED",
                  );
                  const nextSession = caseItem.sessions[0] || null;
                  const pendingBlockingSteps = caseItem.workflowStates.length;
                  const colorKey = statusColorKey(caseItem.status);

                  return (
                    <tr key={caseItem.id} className="hover:bg-[color:var(--accent-soft)]/20">
                      <td data-label="Reference" className="px-4 py-3 font-medium">{caseItem.reference}</td>
                      <td data-label="Status" className="px-4 py-3">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                          style={{
                            color: `var(--cg-status-${colorKey})`,
                            background: `var(--cg-status-${colorKey}-bg)`,
                            border: `1px solid var(--cg-status-${colorKey}-border)`,
                          }}
                        >
                          <span className="cg-status-dot" style={{ background: `var(--cg-status-${colorKey})` }} />
                          {formatStatus(caseItem.status)}
                        </span>
                      </td>
                      <td data-label="Participants" className="px-4 py-3">
                        {caseItem.participants
                          .map((participant) => `${participant.client.firstName} ${participant.client.lastName}`)
                          .join(" & ")}
                      </td>
                      <td data-label="Counsellor" className="px-4 py-3">{caseItem.assignedSpecialist?.name || <span className="text-[color:var(--muted)]">Unassigned</span>}</td>
                      <td data-label="Next Session" className="px-4 py-3">
                        {nextSession ? formatDateTime(nextSession.providerStartTime) : <span className="text-[color:var(--muted)]">No session</span>}
                      </td>
                      <td data-label="Docs" className="px-4 py-3">
                        <span className={completedRequired.length === requiredDocs.length && requiredDocs.length > 0 ? "font-semibold text-[color:var(--cg-status-matched)]" : ""}>
                          {completedRequired.length}/{requiredDocs.length}
                        </span>
                      </td>
                      <td data-label="Gate" className="px-4 py-3">
                        {pendingBlockingSteps === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--cg-status-matched)]">
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                            Eligible
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-[color:var(--cg-status-review)]">{pendingBlockingSteps} pending</span>
                        )}
                      </td>
                      <td data-label="" className="px-4 py-3">
                        <Link
                          href={`/admin/cases/${caseItem.id}`}
                          className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent-soft)]"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AuthenticatedShell>
  );
}
