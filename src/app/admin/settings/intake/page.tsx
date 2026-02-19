import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { IntakeStructuredEditors } from "@/components/admin/intake-structured-editors";
import { requirePageUser } from "@/lib/auth";
import { getIntakeFormContent } from "@/lib/intake-settings";
import { updateIntakeFormContentAction } from "@/app/actions";

type IntakeSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntakeSettingsPage({ searchParams }: IntakeSettingsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const content = await getIntakeFormContent();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const saved = params.saved === "1";

  return (
    <AuthenticatedShell
      title="Intake Form Settings"
      subtitle="Edit crisis modal/help text and availability notes shown in the public form."
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
      {error ? (
        <p className="rounded-2xl border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Intake form content updated.
        </p>
      ) : null}

      <p className="text-sm text-[color:var(--muted)]">
        Looking for scheduling, duration, or PIN policy defaults? Use{" "}
        <Link href="/admin/settings/operations" className="underline">
          Operational Settings
        </Link>
        .
      </p>

      <section className="cg-surface-card p-6">
        <form action={updateIntakeFormContentAction} className="space-y-5">
          <input type="hidden" name="redirectTo" value="/admin/settings/intake" />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="crisisTitle" className="mb-1 block text-sm font-medium">
                Crisis modal title
              </label>
              <input
                id="crisisTitle"
                name="crisisTitle"
                defaultValue={content.crisisModal.title}
                required
                className="w-full px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="availabilityHeading" className="mb-1 block text-sm font-medium">
                Availability heading
              </label>
              <input
                id="availabilityHeading"
                name="availabilityHeading"
                defaultValue={content.availability.heading}
                required
                className="w-full px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label htmlFor="crisisIntro" className="mb-1 block text-sm font-medium">
              Crisis modal intro
            </label>
            <textarea
              id="crisisIntro"
              name="crisisIntro"
              rows={3}
              defaultValue={content.crisisModal.intro}
              required
              className="w-full px-3 py-2"
            />
          </div>

          <IntakeStructuredEditors
            initialCrisisContacts={content.crisisModal.contacts}
            initialAvailabilityNotes={content.availability.notes}
          />

          <div>
            <label htmlFor="availabilitySubheading" className="mb-1 block text-sm font-medium">
              Availability subheading
            </label>
            <textarea
              id="availabilitySubheading"
              name="availabilitySubheading"
              rows={2}
              defaultValue={content.availability.subheading}
              required
              className="w-full px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="availabilityDisclaimer" className="mb-1 block text-sm font-medium">
              Availability disclaimer
            </label>
            <textarea
              id="availabilityDisclaimer"
              name="availabilityDisclaimer"
              rows={2}
              defaultValue={content.availability.disclaimer}
              required
              className="w-full px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="availabilityPrompt" className="mb-1 block text-sm font-medium">
              Availability prompt
            </label>
            <textarea
              id="availabilityPrompt"
              name="availabilityPrompt"
              rows={2}
              defaultValue={content.availability.prompt}
              required
              className="w-full px-3 py-2"
            />
          </div>

          <button type="submit" className="cg-cta-primary px-5 py-2.5 text-sm text-white">
            Save Intake Settings
          </button>
        </form>
      </section>
    </AuthenticatedShell>
  );
}
