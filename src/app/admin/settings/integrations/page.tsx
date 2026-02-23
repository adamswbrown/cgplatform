import { UserRole } from "@prisma/client";
import { updateIntegrationSettingsAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { getIntegrationSettings } from "@/lib/integration-settings";

type IntegrationSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntegrationSettingsPage({
  searchParams,
}: IntegrationSettingsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const settings = await getIntegrationSettings();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const saved = params.saved === "1";

  return (
    <AuthenticatedShell
      title="Integration Settings"
      subtitle="Configure external service connections for Microsoft Bookings and Resend email."
      userName={user.name}
      role={user.role}
      currentPath="/admin/settings"
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
        <p className="cg-alert cg-alert-error">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="cg-alert cg-alert-success">
          Integration settings updated.
        </p>
      ) : null}

      <section className="cg-surface-card p-6">
        <form action={updateIntegrationSettingsAction} className="space-y-5">
          <input type="hidden" name="redirectTo" value="/admin/settings/integrations" />

          {/* --- Microsoft Bookings Connection --- */}
          <h2 className="text-lg font-semibold text-[color:var(--cg-ink)]">
            Microsoft Bookings Connection
          </h2>
          <p className="text-sm text-slate-700">
            Global defaults for the Microsoft Bookings scheduling provider. Per-counsellor overrides
            can be set on individual counsellor profiles.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="microsoftBookingsBusinessId"
                className="mb-1 block text-sm font-medium"
              >
                Business ID
              </label>
              <input
                id="microsoftBookingsBusinessId"
                name="microsoftBookingsBusinessId"
                type="text"
                defaultValue={settings.microsoftBookingsBusinessId}
                placeholder="Leave blank if set per counsellor"
                className="w-full px-3 py-2"
              />
              <p className="mt-1 text-xs text-slate-500">
                The Microsoft Bookings business ID. If blank, each counsellor must have their own configured.
              </p>
            </div>
            <div>
              <label
                htmlFor="microsoftBookingsDefaultTimeZone"
                className="mb-1 block text-sm font-medium"
              >
                Default timezone
              </label>
              <select
                id="microsoftBookingsDefaultTimeZone"
                name="microsoftBookingsDefaultTimeZone"
                defaultValue={settings.microsoftBookingsDefaultTimeZone}
                className="w-full px-3 py-2"
              >
                <option value="UTC">UTC</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Dublin">Europe/Dublin</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam</option>
                <option value="Europe/Rome">Europe/Rome</option>
                <option value="Europe/Madrid">Europe/Madrid</option>
                <option value="Europe/Lisbon">Europe/Lisbon</option>
                <option value="Europe/Zurich">Europe/Zurich</option>
                <option value="Europe/Stockholm">Europe/Stockholm</option>
                <option value="America/New_York">America/New_York (US Eastern)</option>
                <option value="America/Chicago">America/Chicago (US Central)</option>
                <option value="America/Denver">America/Denver (US Mountain)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (US Pacific)</option>
                <option value="America/Toronto">America/Toronto</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
                <option value="Australia/Melbourne">Australia/Melbourne</option>
                <option value="Pacific/Auckland">Pacific/Auckland</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
                <option value="Africa/Johannesburg">Africa/Johannesburg</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="microsoftBookingsAvailabilityHorizonDays"
                className="mb-1 block text-sm font-medium"
              >
                Availability horizon (days)
              </label>
              <input
                id="microsoftBookingsAvailabilityHorizonDays"
                name="microsoftBookingsAvailabilityHorizonDays"
                type="number"
                min={1}
                max={120}
                defaultValue={settings.microsoftBookingsAvailabilityHorizonDays}
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                How many days ahead to fetch available slots from Bookings.
              </p>
            </div>
            <div>
              <label
                htmlFor="microsoftBookingsSlotIncrementMinutes"
                className="mb-1 block text-sm font-medium"
              >
                Slot increment (minutes)
              </label>
              <input
                id="microsoftBookingsSlotIncrementMinutes"
                name="microsoftBookingsSlotIncrementMinutes"
                type="number"
                min={5}
                max={60}
                defaultValue={settings.microsoftBookingsSlotIncrementMinutes}
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Interval in minutes between available time slots.
              </p>
            </div>
          </div>

          {/* --- Microsoft Bookings Sync --- */}
          <h3 className="pt-2 text-base font-semibold text-[color:var(--cg-ink)]">
            Microsoft Bookings Sync
          </h3>
          <p className="text-sm text-slate-700">
            Controls how the background sync process fetches and reconciles bookings from Microsoft.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label
                htmlFor="microsoftBookingsSyncLookbackHours"
                className="mb-1 block text-sm font-medium"
              >
                Sync lookback (hours)
              </label>
              <input
                id="microsoftBookingsSyncLookbackHours"
                name="microsoftBookingsSyncLookbackHours"
                type="number"
                min={1}
                max={168}
                defaultValue={settings.microsoftBookingsSyncLookbackHours}
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Hours into the past to check for changed bookings.
              </p>
            </div>
            <div>
              <label
                htmlFor="microsoftBookingsSyncLookaheadDays"
                className="mb-1 block text-sm font-medium"
              >
                Sync lookahead (days)
              </label>
              <input
                id="microsoftBookingsSyncLookaheadDays"
                name="microsoftBookingsSyncLookaheadDays"
                type="number"
                min={1}
                max={90}
                defaultValue={settings.microsoftBookingsSyncLookaheadDays}
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Days into the future to check for new bookings.
              </p>
            </div>
            <div>
              <label
                htmlFor="microsoftBookingsSyncFetchLimit"
                className="mb-1 block text-sm font-medium"
              >
                Sync fetch limit
              </label>
              <input
                id="microsoftBookingsSyncFetchLimit"
                name="microsoftBookingsSyncFetchLimit"
                type="number"
                min={50}
                max={2000}
                defaultValue={settings.microsoftBookingsSyncFetchLimit}
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Maximum appointments per sync run.
              </p>
            </div>
          </div>

          {/* --- Resend Email --- */}
          <h2 className="pt-4 text-lg font-semibold text-[color:var(--cg-ink)]">
            Resend Email
          </h2>
          <p className="text-sm text-slate-700">
            Sender address for transactional emails (intake confirmations, form PINs, access
            invites). The API key and webhook secret are configured via environment variables.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="resendFromAddress" className="mb-1 block text-sm font-medium">
                Sender &quot;from&quot; address
              </label>
              <input
                id="resendFromAddress"
                name="resendFromAddress"
                type="text"
                defaultValue={settings.resendFromAddress}
                placeholder="noreply@yourdomain.com"
                className="w-full px-3 py-2"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Must use a domain verified in your Resend account.
              </p>
            </div>
          </div>

          <button type="submit" className="cg-cta-primary px-5 py-2.5 text-sm text-white">
            Save Integration Settings
          </button>
        </form>
      </section>
    </AuthenticatedShell>
  );
}
