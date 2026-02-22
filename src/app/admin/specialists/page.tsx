import Link from "next/link";
import { UserRole } from "@prisma/client";
import { createSpecialistAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { getOperationalSettings } from "@/lib/admin-settings";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listSpecialistsForOps } from "@/lib/case-service";

type SpecialistManagementPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SpecialistManagementPage({
  searchParams,
}: SpecialistManagementPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const [specialists, operationalSettings] = await Promise.all([
    listSpecialistsForOps(),
    getOperationalSettings(),
  ]);
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const redirectTo = "/admin/specialists";
  const usesCalCom = operationalSettings.schedulingEngineType === "calcom";
  const calLabelClass = usesCalCom ? "text-[color:var(--foreground)]" : "text-[color:var(--muted)]";
  const calInputClass = `w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm ${
    usesCalCom ? "" : "bg-slate-50 text-[color:var(--muted)]"
  }`;
  const calCellClass = usesCalCom ? "" : "text-[color:var(--muted)]";

  return (
    <AuthenticatedShell
      title="Counsellor Management"
      subtitle="Create counsellors and configure external scheduler mappings."
      userName={user.name}
      role={user.role}
      currentPath="/admin/specialists"
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
        <p className="mb-4 cg-alert cg-alert-error">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Create counsellor</h2>
        {!usesCalCom ? (
          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-[color:var(--muted)]">
            Scheduling engine is set to <strong>{operationalSettings.schedulingEngineType}</strong>.
            Cal.com IDs are stored for compatibility but are not active in this mode.
          </p>
        ) : null}
        <form action={createSpecialistAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email (used for login)
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Initial password (optional, defaults to password123)
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="standardStartHour" className="mb-1 block text-sm font-medium">
              Standard start hour (24h)
            </label>
            <input
              id="standardStartHour"
              name="standardStartHour"
              type="number"
              min={0}
              max={22}
              defaultValue={operationalSettings.defaultSpecialistStandardStartHour}
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="standardEndHour" className="mb-1 block text-sm font-medium">
              Standard end hour (24h)
            </label>
            <input
              id="standardEndHour"
              name="standardEndHour"
              type="number"
              min={1}
              max={23}
              defaultValue={operationalSettings.defaultSpecialistStandardEndHour}
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="calUserId" className={`mb-1 block text-sm font-medium ${calLabelClass}`}>
              Cal.com user id
            </label>
            <input
              id="calUserId"
              name="calUserId"
              required
              placeholder="counsellor-cal-user-id"
              className={calInputClass}
            />
          </div>

          <div>
            <label
              htmlFor="calIndividualEventTypeId"
              className={`mb-1 block text-sm font-medium ${calLabelClass}`}
            >
              Cal.com Individual event type id
            </label>
            <input
              id="calIndividualEventTypeId"
              name="calIndividualEventTypeId"
              required
              placeholder="1001"
              className={calInputClass}
            />
          </div>

          <div>
            <label
              htmlFor="calCouplesEventTypeId"
              className={`mb-1 block text-sm font-medium ${calLabelClass}`}
            >
              Cal.com Couples event type id (required if supports couples)
            </label>
            <input
              id="calCouplesEventTypeId"
              name="calCouplesEventTypeId"
              placeholder="1002"
              className={calInputClass}
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="capabilities" className="mb-1 block text-sm font-medium">
              Capabilities (comma-separated)
            </label>
            <input
              id="capabilities"
              name="capabilities"
              placeholder="individual, couples, trauma"
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="supportsCouples" />
            Supports couples
          </label>

          <div className="md:col-span-2">
            <label htmlFor="notes" className="mb-1 block text-sm font-medium">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white md:col-span-2"
          >
            Create counsellor
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Current counsellors</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Standard Hours</th>
                <th className={`px-3 py-2 font-semibold ${calCellClass}`}>Cal User</th>
                <th className="px-3 py-2 font-semibold">Couples</th>
                <th className={`px-3 py-2 font-semibold ${calCellClass}`}>Event Type IDs</th>
                <th className="px-3 py-2 font-semibold">Capabilities</th>
                <th className="px-3 py-2 font-semibold">Next Session</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {specialists.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="cg-empty-state py-12">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a23.838 23.838 0 0 0-2.688 3.291c5.852.952 10.523 3.655 12.469 5.155a48.559 48.559 0 0 1 12.469-5.155 23.837 23.837 0 0 0-2.688-3.291m-15.482 0A23.94 23.94 0 0 1 12 3.89a23.94 23.94 0 0 1 7.74 6.257M12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                      </svg>
                      <p className="text-sm font-medium">No counsellors created yet</p>
                      <p className="mt-1 text-xs">Use the form above to create your first counsellor.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
              {specialists.map((specialist) => {
                const nextSession = specialist.sessions[0];

                return (
                  <tr key={specialist.id}>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/admin/specialists/${specialist.id}`} className="underline">
                        {specialist.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{specialist.email}</td>
                    <td className="px-3 py-2">
                      {String(specialist.standardStartHour).padStart(2, "0")}:00-
                      {String(specialist.standardEndHour).padStart(2, "0")}:00
                    </td>
                    <td className={`px-3 py-2 ${calCellClass}`}>{specialist.calUserId}</td>
                    <td className="px-3 py-2">{specialist.supportsCouples ? "Yes" : "No"}</td>
                    <td className={`px-3 py-2 ${calCellClass}`}>
                      IND: {specialist.calIndividualEventTypeId}
                      <br />
                      CPL: {specialist.calCouplesEventTypeId || "-"}
                    </td>
                    <td className="px-3 py-2">{specialist.capabilities.join(", ") || "-"}</td>
                    <td className="px-3 py-2">
                      {nextSession ? formatDateTime(nextSession.providerStartTime) : "No session"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Link
                          href={`/admin/specialists/${specialist.id}`}
                          className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs hover:bg-[color:var(--accent-soft)]"
                        >
                          Profile
                        </Link>
                        <Link
                          href={`/admin/specialists/${specialist.id}/availability`}
                          className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs hover:bg-[color:var(--accent-soft)]"
                        >
                          Availability
                        </Link>
                      </div>
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
