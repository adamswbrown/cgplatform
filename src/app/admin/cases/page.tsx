import Link from "next/link";
import { UserRole } from "@prisma/client";
import { issueIntakeAccessInviteAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { formatDateTime, formatStatus } from "@/lib/format";
import { requirePageUser } from "@/lib/auth";
import { listCasesForOps } from "@/lib/case-service";

type AdminCasesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCasesPage({ searchParams }: AdminCasesPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const cases = await listCasesForOps();
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

  return (
    <AuthenticatedShell
      title="Operations Cases"
      subtitle="Track lifecycle progression, workflow compliance, specialist assignment, and auditability."
      userName={user.name}
      role={user.role}
      navItems={[
        { href: "/admin/cases", label: "All Cases" },
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Specialists" },
        { href: "/admin/workflows", label: "Workflows" },
        { href: "/admin/settings/intake", label: "Intake Settings" },
        { href: "/intake", label: "Secure Intake" },
      ]}
    >
      {error ? (
        <p className="mb-4 rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}
      {intakeInviteIssued ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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

      <section className="mb-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Issue Secure Intake Link</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Intake is PIN-gated and not publicly accessible. Generate a secure link and PIN for a prospective client.
        </p>
        <form action={issueIntakeAccessInviteAction} className="mt-3 grid gap-3 md:grid-cols-4">
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
              defaultValue={72}
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
              defaultValue={5}
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
      </section>

      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Participants</th>
                <th className="px-4 py-3 font-semibold">Workflow</th>
                <th className="px-4 py-3 font-semibold">Assigned Specialist</th>
                <th className="px-4 py-3 font-semibold">Next Session</th>
                <th className="px-4 py-3 font-semibold">Required Docs</th>
                <th className="px-4 py-3 font-semibold">Scheduling Gate</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {cases.map((caseItem) => {
                const requiredDocs = caseItem.documents.filter((doc) => doc.required);
                const completedRequired = requiredDocs.filter(
                  (doc) => doc.status === "COMPLETED",
                );
                const nextSession = caseItem.sessions[0] || null;
                const pendingBlockingSteps = caseItem.workflowStates.length;

                return (
                  <tr key={caseItem.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{caseItem.reference}</td>
                    <td className="px-4 py-3">{formatStatus(caseItem.status)}</td>
                    <td className="px-4 py-3">
                      {caseItem.participants
                        .map((participant) => `${participant.client.firstName} ${participant.client.lastName}`)
                        .join(" & ")}
                    </td>
                    <td className="px-4 py-3">
                      {caseItem.caseWorkflowTemplate
                        ? `${caseItem.caseWorkflowTemplate.name} (${caseItem.caseWorkflowTemplate.counsellingType})`
                        : "Unassigned"}
                    </td>
                    <td className="px-4 py-3">{caseItem.assignedSpecialist?.name || "Unassigned"}</td>
                    <td className="px-4 py-3">
                      {nextSession ? formatDateTime(nextSession.providerStartTime) : "No session"}
                    </td>
                    <td className="px-4 py-3">
                      {completedRequired.length}/{requiredDocs.length}
                    </td>
                    <td className="px-4 py-3">
                      {pendingBlockingSteps === 0 ? "Eligible" : `${pendingBlockingSteps} pending`}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/cases/${caseItem.id}`}
                        className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent-soft)]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AuthenticatedShell>
  );
}
