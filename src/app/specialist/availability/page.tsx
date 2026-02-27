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
        currentPath="/specialist/availability"
        navItems={[
          { href: "/specialist/sessions", label: "My Sessions" },
          { href: "/specialist/reviews", label: "Pending Reviews" },
          { href: "/specialist/clients", label: "My Clients" },
        ]}
      >
        <p className="cg-alert cg-alert-error">
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
      subtitle={`Set your available ${availability.slotPolicy.slotMinutes}-minute blocks between ${String(availability.slotPolicy.startHour).padStart(2, "0")}:00 and ${String(availability.slotPolicy.endHour).padStart(2, "0")}:00 for manual assignment mode.`}
      userName={user.name}
      role={user.role}
      currentPath="/specialist/availability"
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/clients", label: "My Clients" },
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
