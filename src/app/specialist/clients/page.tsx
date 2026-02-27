import Link from "next/link";
import { CaseStatus, UserRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { listClientsForSpecialist } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";

export default async function SpecialistClientsPage() {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    notFound();
  }

  const clients = await listClientsForSpecialist(user.specialistId);
  const now = new Date();

  return (
    <AuthenticatedShell
      title="My Clients"
      subtitle="Only clients and cases currently assigned to you are shown here."
      userName={user.name}
      role={user.role}
      currentPath="/specialist/clients"
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/reviews", label: "Pending Reviews" },
        { href: "/specialist/clients", label: "My Clients" },
        { href: "/specialist/availability", label: "My Availability" },
      ]}
    >
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">My Cases</th>
                <th className="px-4 py-3 font-semibold">Open Cases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="cg-empty-state py-12">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                      <p className="text-sm font-medium">No assigned clients yet</p>
                      <p className="mt-1 text-xs">When cases are assigned to you, the associated clients will appear here.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const cases = client.participants.map((participant) => participant.case);
                  const openCaseCount = cases.filter(
                    (caseItem) => caseItem.status !== CaseStatus.CLOSED,
                  ).length;

                  return (
                    <tr key={client.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">
                        {client.firstName} {client.lastName}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--muted)]">
                        <p>{client.email}</p>
                        <p>{client.phone || "No phone"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          {cases.map((caseItem) => {
                            const nextSession =
                              caseItem.sessions.find((session) => session.providerStartTime >= now) ||
                              caseItem.sessions[caseItem.sessions.length - 1] ||
                              null;

                            return (
                              <div
                                key={caseItem.id}
                                className="rounded-md border border-[color:var(--border)] px-2 py-1.5"
                              >
                                <p>
                                  {nextSession ? (
                                    <Link
                                      href={`/specialist/sessions/${nextSession.id}`}
                                      className="font-medium underline"
                                    >
                                      {caseItem.reference}
                                    </Link>
                                  ) : (
                                    <span className="font-medium">{caseItem.reference}</span>
                                  )}
                                </p>
                                <p className="text-xs text-[color:var(--muted)]">
                                  {formatStatus(caseItem.status)}
                                </p>
                                <p className="text-xs text-[color:var(--muted)]">
                                  {nextSession
                                    ? `Session: ${formatDateTime(nextSession.providerStartTime)}`
                                    : "No sessions yet"}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">{openCaseCount}</td>
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
