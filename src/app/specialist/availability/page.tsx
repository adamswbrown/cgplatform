import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { SpecialistAvailabilityCalendar } from "@/components/availability/specialist-availability-calendar";
import { requirePageUser } from "@/lib/auth";
import { getSpecialistAvailabilityCalendar } from "@/lib/case-service";

export default async function SpecialistAvailabilityPage() {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    return (
      <AuthenticatedShell
        title="My Availability"
        subtitle="Set your manual scheduling availability."
        userName={user.name}
        role={user.role}
        navItems={[
          { href: "/specialist/sessions", label: "My Sessions" },
          { href: "/specialist/clients", label: "My Clients" },
          { href: "/specialist/availability", label: "My Availability" },
        ]}
      >
        <p className="rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          Contact operations to link your account to a counsellor profile.
        </p>
      </AuthenticatedShell>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const availability = await getSpecialistAvailabilityCalendar(
    user.specialistId,
    monthDays,
    monthStart,
  );

  return (
    <AuthenticatedShell
      title="My Availability"
      subtitle="Set your available 60-minute blocks for manual assignment mode."
      userName={user.name}
      role={user.role}
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/clients", label: "My Clients" },
        { href: "/specialist/availability", label: "My Availability" },
      ]}
    >
      <SpecialistAvailabilityCalendar
        specialistId={availability.specialist.id}
        specialistName={availability.specialist.name}
        rangeStart={availability.rangeStart}
        slotPolicy={availability.slotPolicy}
        windows={availability.windows}
        sessions={availability.sessions}
        editable
        roleLabel="specialist"
        defaultView="timeGridWeek"
      />
    </AuthenticatedShell>
  );
}
