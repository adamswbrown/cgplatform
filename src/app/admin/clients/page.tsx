import Link from "next/link";
import { CaseStatus, UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { listClientsForOps } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";

export default async function AdminClientsPage() {
  const user = await requirePageUser([UserRole.OPS]);
  const clients = await listClientsForOps();

  return (
    <AuthenticatedShell
      title="Client Dashboard"
      subtitle="Operations view of all clients, linked cases, and current counsellor coverage."
      userName={user.name}
      role={user.role}
      currentPath="/admin/clients"
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
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Case Summary</th>
                <th className="px-4 py-3 font-semibold">Assigned Counsellors</th>
                <th className="px-4 py-3 font-semibold">Cases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="cg-empty-state py-12">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                      <p className="text-sm font-medium">No clients found</p>
                      <p className="mt-1 text-xs">Clients are created when intake forms are submitted. Start a new case from the Secure Intake page.</p>
                      <Link
                        href="/intake"
                        className="mt-3 rounded-full border border-[color:var(--border)] px-4 py-1.5 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
                      >
                        Start new intake
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const cases = client.participants.map((participant) => participant.case);
                  const openCases = cases.filter((caseItem) => caseItem.status !== CaseStatus.CLOSED);
                  const specialists = Array.from(
                    new Set(
                      cases
                        .map((caseItem) => caseItem.assignedSpecialist?.name)
                        .filter((name): name is string => Boolean(name)),
                    ),
                  );

                  return (
                    <tr key={client.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/admin/clients/${client.id}`} className="group inline-flex items-center gap-1.5 text-[color:var(--accent)] hover:underline">
                          {client.firstName} {client.lastName}
                          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100">
                            <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                          </svg>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[color:var(--muted)]">
                        <p>{client.email}</p>
                        <p>{client.phone || "No phone"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>
                          {openCases.length}/{cases.length} open
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {specialists.length > 0 ? specialists.join(", ") : "Unassigned"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          {cases.map((caseItem) => {
                            const activeSession = caseItem.sessions[0] || null;

                            return (
                              <div
                                key={caseItem.id}
                                className="rounded-md border border-[color:var(--border)] px-2 py-1.5"
                              >
                                <p>
                                  <Link href={`/admin/cases/${caseItem.id}`} className="font-medium underline">
                                    {caseItem.reference}
                                  </Link>
                                </p>
                                <p className="text-xs text-[color:var(--muted)]">
                                  {formatStatus(caseItem.status)}
                                </p>
                                <p className="text-xs text-[color:var(--muted)]">
                                  {activeSession
                                    ? `Next: ${formatDateTime(activeSession.providerStartTime)}`
                                    : "No active session"}
                                </p>
                              </div>
                            );
                          })}
                        </div>
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
