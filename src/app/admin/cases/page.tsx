import Link from "next/link";
import { UserRole } from "@prisma/client";
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

  return (
    <AuthenticatedShell
      title="Operations Cases"
      subtitle="Track lifecycle progression, assignments, document completion, and auditability."
      userName={user.name}
      role={user.role}
      navItems={[
        { href: "/admin/cases", label: "All Cases" },
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Specialists" },
        { href: "/intake", label: "Public Intake" },
      ]}
    >
      {error ? (
        <p className="mb-4 rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Participants</th>
                <th className="px-4 py-3 font-semibold">Assigned Specialist</th>
                <th className="px-4 py-3 font-semibold">Next Session</th>
                <th className="px-4 py-3 font-semibold">Required Docs</th>
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

                return (
                  <tr key={caseItem.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{caseItem.reference}</td>
                    <td className="px-4 py-3">{formatStatus(caseItem.status)}</td>
                    <td className="px-4 py-3">
                      {caseItem.participants
                        .map((participant) => `${participant.client.firstName} ${participant.client.lastName}`)
                        .join(" & ")}
                    </td>
                    <td className="px-4 py-3">{caseItem.assignedSpecialist?.name || "Unassigned"}</td>
                    <td className="px-4 py-3">
                      {nextSession ? formatDateTime(nextSession.providerStartTime) : "No session"}
                    </td>
                    <td className="px-4 py-3">
                      {completedRequired.length}/{requiredDocs.length}
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
