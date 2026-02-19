import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";

export default async function AdminSettingsPage() {
  const user = await requirePageUser([UserRole.OPS]);

  return (
    <AuthenticatedShell
      title="Administrative Settings"
      subtitle="Manage operational defaults and form content without code changes."
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
      <section className="grid gap-4 md:grid-cols-2">
        <article className="cg-surface-card p-5">
          <h2 className="text-lg font-semibold">Operational Settings</h2>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Configure scheduling engine + assignment mode, default durations, workflow gates, and
            PIN policy defaults used across intake invites and form access.
          </p>
          <Link
            href="/admin/settings/operations"
            className="mt-4 inline-block rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
          >
            Open Operational Settings
          </Link>
        </article>

        <article className="cg-surface-card p-5">
          <h2 className="text-lg font-semibold">Intake Content</h2>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Update crisis support copy and availability guidance shown to clients in the intake
            journey.
          </p>
          <Link
            href="/admin/settings/intake"
            className="mt-4 inline-block rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
          >
            Open Intake Content Settings
          </Link>
        </article>
      </section>
    </AuthenticatedShell>
  );
}
