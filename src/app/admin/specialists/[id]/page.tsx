import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { updateSpecialistProfileAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { getOperationalSettings } from "@/lib/admin-settings";
import { requirePageUser } from "@/lib/auth";
import { getSpecialistProfileForOps } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";

type SpecialistProfilePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SpecialistProfilePage({
  params,
  searchParams,
}: SpecialistProfilePageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const { id } = await params;
  const query = await searchParams;

  const [specialist, operationalSettings] = await Promise.all([
    getSpecialistProfileForOps(id),
    getOperationalSettings(),
  ]);

  if (!specialist) {
    notFound();
  }

  const error = typeof query.error === "string" ? query.error : null;
  const updated = typeof query.updated === "string";
  const now = new Date();
  const usesCalCom = operationalSettings.schedulingEngineType === "calcom";
  const usesMicrosoftBookings = operationalSettings.schedulingEngineType === "microsoft_bookings";
  const calSectionMutedClass = usesCalCom ? "" : "opacity-60";
  const calFieldClass = `w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm ${
    usesCalCom ? "" : "bg-slate-50 text-[color:var(--muted)]"
  }`;
  const bookingsSectionMutedClass = usesMicrosoftBookings ? "" : "opacity-60";
  const bookingsFieldClass = `w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm ${
    usesMicrosoftBookings ? "" : "bg-slate-50 text-[color:var(--muted)]"
  }`;

  const upcomingSessions = specialist.sessions
    .filter((session) => session.providerStartTime >= now)
    .sort((a, b) => a.providerStartTime.getTime() - b.providerStartTime.getTime());

  const previousSessions = specialist.sessions
    .filter((session) => session.providerStartTime < now)
    .sort((a, b) => b.providerStartTime.getTime() - a.providerStartTime.getTime());

  return (
    <AuthenticatedShell
      title={`Counsellor Profile: ${specialist.name}`}
      subtitle="Operations profile view for assignment fit and scheduler mappings."
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
      {updated ? (
        <p className="mb-4 cg-alert cg-alert-success">
          Counsellor profile updated.
        </p>
      ) : null}

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Upcoming sessions</h3>
          {upcomingSessions.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No upcoming sessions.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {upcomingSessions.map((session) => (
                <li key={session.id} className="rounded-md border border-[color:var(--border)] p-3">
                  <p className="font-medium">{formatDateTime(session.providerStartTime)}</p>
                  <p>
                    Case:{" "}
                    <Link href={`/admin/cases/${session.caseId}`} className="underline">
                      {session.case.reference}
                    </Link>
                  </p>
                  <p className="text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                  <p className="text-xs text-[color:var(--muted)]">Booking: {session.providerBookingId}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Previous sessions</h3>
          {previousSessions.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No historical sessions yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {previousSessions.slice(0, 20).map((session) => (
                <li key={session.id} className="rounded-md border border-[color:var(--border)] p-3">
                  <p className="font-medium">{formatDateTime(session.providerStartTime)}</p>
                  <p>
                    Case:{" "}
                    <Link href={`/admin/cases/${session.caseId}`} className="underline">
                      {session.case.reference}
                    </Link>
                  </p>
                  <p className="text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                  <p className="text-xs text-[color:var(--muted)]">Booking: {session.providerBookingId}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Counsellor ID
              </p>
              <p className="text-sm text-[color:var(--muted)]">{specialist.id}</p>
              <h2 className="mt-2 text-2xl font-semibold">{specialist.name}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/specialists/${specialist.id}/availability`}
                className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
              >
                Edit availability
              </Link>
              <Link
                href="/admin/specialists"
                className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
              >
                Back to counsellors
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Email
              </p>
              <p className="mt-1 text-sm">{specialist.email}</p>
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                Auth account: {specialist.userAccount?.email || "Not linked"}
              </p>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Couples support
              </p>
              <p className="mt-1 text-sm">{specialist.supportsCouples ? "Yes" : "No"}</p>
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                Active profile: {specialist.active ? "Yes" : "No"}
              </p>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Standard working hours
              </p>
              <p className="mt-1 text-sm">
                {String(specialist.standardStartHour).padStart(2, "0")}:00-
                {String(specialist.standardEndHour).padStart(2, "0")}:00
              </p>
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                Used for manual assignment and availability defaults.
              </p>
            </div>

            <div
              className={`rounded-xl border border-[color:var(--border)] p-4 md:col-span-2 ${calSectionMutedClass}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Cal.com mappings
              </p>
              {!usesCalCom ? (
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Engine is set to <strong>{operationalSettings.schedulingEngineType}</strong>;
                  Cal.com fields are stored but inactive.
                </p>
              ) : null}
              <p className="mt-2 text-sm">User ID: {specialist.calUserId || "-"}</p>
              <p className="text-sm">
                Individual Event Type: {specialist.calIndividualEventTypeId || "-"}
              </p>
              <p className="text-sm">Couples Event Type: {specialist.calCouplesEventTypeId || "-"}</p>
            </div>

            <div
              className={`rounded-xl border border-[color:var(--border)] p-4 md:col-span-2 ${bookingsSectionMutedClass}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Microsoft Bookings mappings
              </p>
              {!usesMicrosoftBookings ? (
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Engine is set to <strong>{operationalSettings.schedulingEngineType}</strong>;
                  Bookings fields are stored but inactive.
                </p>
              ) : null}
              <p className="mt-2 text-sm">
                Business ID: {specialist.microsoftBookingsBusinessId || "(global default)"}
              </p>
              <p className="text-sm">Staff ID: {specialist.microsoftBookingsStaffId || "-"}</p>
              <p className="text-sm">
                Individual Service ID: {specialist.microsoftBookingsIndividualServiceId || "-"}
              </p>
              <p className="text-sm">
                Couples Service ID: {specialist.microsoftBookingsCouplesServiceId || "-"}
              </p>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Capabilities
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {specialist.capabilities.length > 0 ? (
                  specialist.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-[color:var(--accent-soft)] px-2.5 py-1 text-xs"
                    >
                      {capability}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[color:var(--muted)]">No capabilities listed</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Profile notes
              </p>
              <p className="mt-2 text-sm">{specialist.notes || "No notes"}</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Edit counsellor profile</h3>
            <form action={updateSpecialistProfileAction} className="mt-3 space-y-3">
              <input type="hidden" name="specialistId" value={specialist.id} />
              <input type="hidden" name="redirectTo" value={`/admin/specialists/${specialist.id}`} />

              <div>
                <label htmlFor="name" className="mb-1 block text-xs font-medium">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  defaultValue={specialist.name}
                  required
                  className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={specialist.email}
                  required
                  className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="calUserId" className="mb-1 block text-xs font-medium">
                  Cal.com user id
                </label>
                <input
                  id="calUserId"
                  name="calUserId"
                  defaultValue={specialist.calUserId || ""}
                  className={calFieldClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="standardStartHour" className="mb-1 block text-xs font-medium">
                    Standard start hour
                  </label>
                  <input
                    id="standardStartHour"
                    name="standardStartHour"
                    type="number"
                    min={0}
                    max={22}
                    defaultValue={specialist.standardStartHour}
                    required
                    className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="standardEndHour" className="mb-1 block text-xs font-medium">
                    Standard end hour
                  </label>
                  <input
                    id="standardEndHour"
                    name="standardEndHour"
                    type="number"
                    min={1}
                    max={23}
                    defaultValue={specialist.standardEndHour}
                    required
                    className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="calIndividualEventTypeId" className="mb-1 block text-xs font-medium">
                  Cal.com Individual event type id
                </label>
                <input
                  id="calIndividualEventTypeId"
                  name="calIndividualEventTypeId"
                  defaultValue={specialist.calIndividualEventTypeId || ""}
                  className={calFieldClass}
                />
              </div>

              <div>
                <label htmlFor="calCouplesEventTypeId" className="mb-1 block text-xs font-medium">
                  Cal.com Couples event type id
                </label>
                <input
                  id="calCouplesEventTypeId"
                  name="calCouplesEventTypeId"
                  defaultValue={specialist.calCouplesEventTypeId || ""}
                  className={calFieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="microsoftBookingsBusinessId"
                  className="mb-1 block text-xs font-medium"
                >
                  Microsoft Bookings business id (optional override)
                </label>
                <input
                  id="microsoftBookingsBusinessId"
                  name="microsoftBookingsBusinessId"
                  defaultValue={specialist.microsoftBookingsBusinessId || ""}
                  className={bookingsFieldClass}
                />
              </div>

              <div>
                <label htmlFor="microsoftBookingsStaffId" className="mb-1 block text-xs font-medium">
                  Microsoft Bookings staff id
                </label>
                <input
                  id="microsoftBookingsStaffId"
                  name="microsoftBookingsStaffId"
                  defaultValue={specialist.microsoftBookingsStaffId || ""}
                  className={bookingsFieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="microsoftBookingsIndividualServiceId"
                  className="mb-1 block text-xs font-medium"
                >
                  Microsoft Bookings individual service id
                </label>
                <input
                  id="microsoftBookingsIndividualServiceId"
                  name="microsoftBookingsIndividualServiceId"
                  defaultValue={specialist.microsoftBookingsIndividualServiceId || ""}
                  className={bookingsFieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="microsoftBookingsCouplesServiceId"
                  className="mb-1 block text-xs font-medium"
                >
                  Microsoft Bookings couples service id
                </label>
                <input
                  id="microsoftBookingsCouplesServiceId"
                  name="microsoftBookingsCouplesServiceId"
                  defaultValue={specialist.microsoftBookingsCouplesServiceId || ""}
                  className={bookingsFieldClass}
                />
              </div>

              <div>
                <label htmlFor="capabilities" className="mb-1 block text-xs font-medium">
                  Capabilities (comma-separated)
                </label>
                <input
                  id="capabilities"
                  name="capabilities"
                  defaultValue={specialist.capabilities.join(", ")}
                  className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="supportsCouples"
                  defaultChecked={specialist.supportsCouples}
                />
                Supports couples
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={specialist.active} />
                Active counsellor
              </label>

              <div>
                <label htmlFor="notes" className="mb-1 block text-xs font-medium">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  defaultValue={specialist.notes || ""}
                  className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-white"
              >
                Save profile
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Workload snapshot</h3>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Upcoming sessions: {upcomingSessions.length}</li>
              <li>Open assigned cases: {specialist.assignedCases.length}</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold">Open assigned cases</h3>
            {specialist.assignedCases.length === 0 ? (
              <p className="mt-2 text-sm text-[color:var(--muted)]">No open assigned cases.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {specialist.assignedCases.map((caseItem) => (
                  <li key={caseItem.id} className="rounded-md border border-[color:var(--border)] p-2">
                    <Link href={`/admin/cases/${caseItem.id}`} className="font-medium underline">
                      {caseItem.reference}
                    </Link>
                    <p className="text-[color:var(--muted)]">{formatStatus(caseItem.status)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

    </AuthenticatedShell>
  );
}
