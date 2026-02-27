import { UserRole } from "@prisma/client";
import { updateOperationalSettingsAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { getOperationalSettings, minuteOfDayToDisplay } from "@/lib/admin-settings";

type OperationalSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OperationalSettingsPage({
  searchParams,
}: OperationalSettingsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const settings = await getOperationalSettings();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const saved = params.saved === "1";

  return (
    <AuthenticatedShell
      title="Operational Settings"
      subtitle="Control runtime defaults for scheduling behavior, workflow gates, and secure form access."
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
          Operational settings updated.
        </p>
      ) : null}

      <section className="cg-surface-card p-6">
        <form action={updateOperationalSettingsAction} className="space-y-5">
          <input type="hidden" name="redirectTo" value="/admin/settings/operations" />

          <h2 className="text-lg font-semibold text-[color:var(--cg-ink)]">
            Scheduling Controls
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="schedulingEngineType" className="mb-1 block text-sm font-medium">
                Scheduling engine
              </label>
              <select
                id="schedulingEngineType"
                name="schedulingEngineType"
                defaultValue={settings.schedulingEngineType}
                className="w-full px-3 py-2"
              >
                <option value="manual">Manual (internal deterministic scheduler)</option>
                <option value="calcom">Cal.com</option>
                <option value="microsoft_bookings">Microsoft Bookings</option>
              </select>
            </div>
            <div>
              <label htmlFor="schedulingAssignmentMode" className="mb-1 block text-sm font-medium">
                Scheduling assignment mode
              </label>
              <select
                id="schedulingAssignmentMode"
                name="schedulingAssignmentMode"
                defaultValue={settings.schedulingAssignmentMode}
                className="w-full px-3 py-2"
              >
                <option value="manual">Manual (ops assigns counsellor)</option>
                <option value="auto">Auto (overlap + provider slot matching)</option>
              </select>
            </div>
            <div>
              <label htmlFor="defaultIntakeSource" className="mb-1 block text-sm font-medium">
                Default intake source
              </label>
              <select
                id="defaultIntakeSource"
                name="defaultIntakeSource"
                defaultValue={settings.defaultIntakeSource}
                className="w-full px-3 py-2"
              >
                <option value="SECURE_LINK">Secure intake link (recommended)</option>
                <option value="MICROSOFT_FORMS">Microsoft Forms</option>
                <option value="JOTFORM">JotForm</option>
                <option value="WEB_FORM">Website form</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-1">
              <label htmlFor="formAccessSessionHours" className="mb-1 block text-sm font-medium">
                PIN access session hours
              </label>
              <input
                id="formAccessSessionHours"
                name="formAccessSessionHours"
                type="number"
                min={1}
                max={24}
                defaultValue={settings.formAccessSessionHours}
                className="w-full px-3 py-2"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
              <input
                id="requireTermsBeforeScheduling"
                name="requireTermsBeforeScheduling"
                type="checkbox"
                defaultChecked={settings.requireTermsBeforeScheduling}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <strong>Require Terms &amp; Counselling completion before scheduling</strong>
                <br />
                Cases cannot be scheduled until Terms of Counselling is completed.
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
              <input
                id="requireTermsBeforeInSession"
                name="requireTermsBeforeInSession"
                type="checkbox"
                defaultChecked={settings.requireTermsBeforeInSession}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <strong>Require Terms &amp; Counselling completion before IN_SESSION</strong>
                <br />
                Cases cannot move to <code>IN_SESSION</code> until Terms is completed.
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
              <input
                id="requireOuttakeBeforeClose"
                name="requireOuttakeBeforeClose"
                type="checkbox"
                defaultChecked={settings.requireOuttakeBeforeClose}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <strong>Require Outtake completion before CLOSED</strong>
                <br />
                Cases cannot move to <code>CLOSED</code> until Outtake is completed.
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="defaultIndividualSessionMinutes"
                className="mb-1 block text-sm font-medium"
              >
                Default individual session minutes
              </label>
              <input
                id="defaultIndividualSessionMinutes"
                name="defaultIndividualSessionMinutes"
                type="number"
                min={30}
                max={180}
                defaultValue={settings.defaultIndividualSessionMinutes}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label htmlFor="defaultCoupleSessionMinutes" className="mb-1 block text-sm font-medium">
                Default couple session minutes
              </label>
              <input
                id="defaultCoupleSessionMinutes"
                name="defaultCoupleSessionMinutes"
                type="number"
                min={30}
                max={180}
                defaultValue={settings.defaultCoupleSessionMinutes}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="defaultSpecialistStandardStartHour"
                className="mb-1 block text-sm font-medium"
              >
                Default counsellor start hour (24h)
              </label>
              <input
                id="defaultSpecialistStandardStartHour"
                name="defaultSpecialistStandardStartHour"
                type="number"
                min={0}
                max={22}
                defaultValue={settings.defaultSpecialistStandardStartHour}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="defaultSpecialistStandardEndHour"
                className="mb-1 block text-sm font-medium"
              >
                Default counsellor end hour (24h)
              </label>
              <input
                id="defaultSpecialistStandardEndHour"
                name="defaultSpecialistStandardEndHour"
                type="number"
                min={1}
                max={23}
                defaultValue={settings.defaultSpecialistStandardEndHour}
                className="w-full px-3 py-2"
                required
              />
            </div>
          </div>

          <h3 className="pt-2 text-base font-semibold text-[color:var(--cg-ink)]">
            Manual Engine Simulation Policy
          </h3>
          <p className="text-sm text-slate-700">
            Used when Scheduling engine is <code>manual</code>. These values define deterministic slot
            generation and booking simulation windows for local/MVP operation.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="manualProviderHorizonDays"
                className="mb-1 block text-sm font-medium"
              >
                Slot horizon (days)
              </label>
              <input
                id="manualProviderHorizonDays"
                name="manualProviderHorizonDays"
                type="number"
                min={1}
                max={60}
                defaultValue={settings.manualProviderHorizonDays}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="manualProviderSlotIncrementMinutes"
                className="mb-1 block text-sm font-medium"
              >
                Slot increment (minutes)
              </label>
              <input
                id="manualProviderSlotIncrementMinutes"
                name="manualProviderSlotIncrementMinutes"
                type="number"
                min={5}
                max={60}
                defaultValue={settings.manualProviderSlotIncrementMinutes}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="specialistAvailabilityDefaultGridDays"
                className="mb-1 block text-sm font-medium"
              >
                Availability calendar default range (days)
              </label>
              <input
                id="specialistAvailabilityDefaultGridDays"
                name="specialistAvailabilityDefaultGridDays"
                type="number"
                min={1}
                max={120}
                defaultValue={settings.specialistAvailabilityDefaultGridDays}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="specialistAvailabilityMaxGridDays"
                className="mb-1 block text-sm font-medium"
              >
                Availability calendar max range (days)
              </label>
              <input
                id="specialistAvailabilityMaxGridDays"
                name="specialistAvailabilityMaxGridDays"
                type="number"
                min={1}
                max={180}
                defaultValue={settings.specialistAvailabilityMaxGridDays}
                className="w-full px-3 py-2"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="manualProviderMorningStartMinute" className="mb-1 block text-sm font-medium">
                Morning block start (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderMorningStartMinute)}</span>
              </label>
              <input id="manualProviderMorningStartMinute" name="manualProviderMorningStartMinute" type="number" min={0} max={1439} defaultValue={settings.manualProviderMorningStartMinute} className="w-full px-3 py-2" required />
            </div>
            <div>
              <label htmlFor="manualProviderMorningEndMinute" className="mb-1 block text-sm font-medium">
                Morning block end (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderMorningEndMinute)}</span>
              </label>
              <input id="manualProviderMorningEndMinute" name="manualProviderMorningEndMinute" type="number" min={1} max={1439} defaultValue={settings.manualProviderMorningEndMinute} className="w-full px-3 py-2" required />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="manualProviderAfternoonStartMinute" className="mb-1 block text-sm font-medium">
                Afternoon block start (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderAfternoonStartMinute)}</span>
              </label>
              <input id="manualProviderAfternoonStartMinute" name="manualProviderAfternoonStartMinute" type="number" min={0} max={1439} defaultValue={settings.manualProviderAfternoonStartMinute} className="w-full px-3 py-2" required />
            </div>
            <div>
              <label htmlFor="manualProviderAfternoonEndMinute" className="mb-1 block text-sm font-medium">
                Afternoon block end (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderAfternoonEndMinute)}</span>
              </label>
              <input id="manualProviderAfternoonEndMinute" name="manualProviderAfternoonEndMinute" type="number" min={1} max={1439} defaultValue={settings.manualProviderAfternoonEndMinute} className="w-full px-3 py-2" required />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="manualProviderEveningStartMinute" className="mb-1 block text-sm font-medium">
                Evening block start (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderEveningStartMinute)}</span>
              </label>
              <input id="manualProviderEveningStartMinute" name="manualProviderEveningStartMinute" type="number" min={0} max={1439} defaultValue={settings.manualProviderEveningStartMinute} className="w-full px-3 py-2" required />
            </div>
            <div>
              <label htmlFor="manualProviderEveningEndMinute" className="mb-1 block text-sm font-medium">
                Evening block end (minute of day) <span className="text-xs text-[color:var(--muted)]">Currently: {minuteOfDayToDisplay(settings.manualProviderEveningEndMinute)}</span>
              </label>
              <input id="manualProviderEveningEndMinute" name="manualProviderEveningEndMinute" type="number" min={1} max={1439} defaultValue={settings.manualProviderEveningEndMinute} className="w-full px-3 py-2" required />
            </div>
          </div>

          <h3 className="pt-2 text-base font-semibold text-[color:var(--cg-ink)]">
            Form Access Policy
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="defaultFormPinExpiresHours" className="mb-1 block text-sm font-medium">
                Form PIN default expiry (hours)
              </label>
              <input
                id="defaultFormPinExpiresHours"
                name="defaultFormPinExpiresHours"
                type="number"
                min={1}
                max={336}
                defaultValue={settings.defaultFormPinExpiresHours}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label htmlFor="defaultFormPinMaxAttempts" className="mb-1 block text-sm font-medium">
                Form PIN default max attempts
              </label>
              <input
                id="defaultFormPinMaxAttempts"
                name="defaultFormPinMaxAttempts"
                type="number"
                min={1}
                max={20}
                defaultValue={settings.defaultFormPinMaxAttempts}
                className="w-full px-3 py-2"
                required
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="defaultIntakeInviteExpiresHours"
                className="mb-1 block text-sm font-medium"
              >
                Intake invite default expiry (hours)
              </label>
              <input
                id="defaultIntakeInviteExpiresHours"
                name="defaultIntakeInviteExpiresHours"
                type="number"
                min={1}
                max={336}
                defaultValue={settings.defaultIntakeInviteExpiresHours}
                className="w-full px-3 py-2"
                required
              />
            </div>
            <div>
              <label
                htmlFor="defaultIntakeInviteMaxAttempts"
                className="mb-1 block text-sm font-medium"
              >
                Intake invite default max attempts
              </label>
              <input
                id="defaultIntakeInviteMaxAttempts"
                name="defaultIntakeInviteMaxAttempts"
                type="number"
                min={1}
                max={20}
                defaultValue={settings.defaultIntakeInviteMaxAttempts}
                className="w-full px-3 py-2"
                required
              />
            </div>
          </div>

          <button type="submit" className="cg-cta-primary px-5 py-2.5 text-sm text-white">
            Save Operational Settings
          </button>
        </form>
      </section>
    </AuthenticatedShell>
  );
}
