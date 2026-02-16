import Link from "next/link";
import { UserRole } from "@prisma/client";
import { createSpecialistAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
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
  const specialists = await listSpecialistsForOps();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const redirectTo = "/admin/specialists";

  return (
    <AuthenticatedShell
      title="Specialist Management"
      subtitle="Create specialists and configure Cal.com scheduling mappings."
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

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Create specialist</h2>
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
            <label htmlFor="calUserId" className="mb-1 block text-sm font-medium">
              Cal.com user id
            </label>
            <input
              id="calUserId"
              name="calUserId"
              required
              placeholder="specialist-cal-user-id"
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="calIndividualEventTypeId" className="mb-1 block text-sm font-medium">
              Cal.com Individual event type id
            </label>
            <input
              id="calIndividualEventTypeId"
              name="calIndividualEventTypeId"
              required
              placeholder="1001"
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="calCouplesEventTypeId" className="mb-1 block text-sm font-medium">
              Cal.com Couples event type id (required if supports couples)
            </label>
            <input
              id="calCouplesEventTypeId"
              name="calCouplesEventTypeId"
              placeholder="1002"
              className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
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
            Create specialist
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Current specialists</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Cal User</th>
                <th className="px-3 py-2 font-semibold">Couples</th>
                <th className="px-3 py-2 font-semibold">Event Type IDs</th>
                <th className="px-3 py-2 font-semibold">Capabilities</th>
                <th className="px-3 py-2 font-semibold">Next Session</th>
                <th className="px-3 py-2 font-semibold">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {specialists.map((specialist) => {
                const nextSession = specialist.sessions
                  .slice()
                  .sort((a, b) => a.providerStartTime.getTime() - b.providerStartTime.getTime())[0];

                return (
                  <tr key={specialist.id}>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/admin/specialists/${specialist.id}`} className="underline">
                        {specialist.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{specialist.email}</td>
                    <td className="px-3 py-2">{specialist.calUserId}</td>
                    <td className="px-3 py-2">{specialist.supportsCouples ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">
                      IND: {specialist.calIndividualEventTypeId}
                      <br />
                      CPL: {specialist.calCouplesEventTypeId || "-"}
                    </td>
                    <td className="px-3 py-2">{specialist.capabilities.join(", ") || "-"}</td>
                    <td className="px-3 py-2">
                      {nextSession ? formatDateTime(nextSession.providerStartTime) : "No session"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/specialists/${specialist.id}`}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs hover:bg-[color:var(--accent-soft)]"
                      >
                        View profile
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
