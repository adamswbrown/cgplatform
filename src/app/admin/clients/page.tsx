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
                  <td className="px-4 py-8 text-[color:var(--muted)]" colSpan={5}>
                    No clients found.
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
                        <Link href={`/admin/clients/${client.id}`} className="underline">
                          {client.firstName} {client.lastName}
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
