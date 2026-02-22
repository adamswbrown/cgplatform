import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { SpecialistAvailabilityCalendar } from "@/components/availability/specialist-availability-calendar";
import { requirePageUser } from "@/lib/auth";
import { getSpecialistAvailabilityCalendar } from "@/lib/case-service";

type SpecialistAvailabilityOpsPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SpecialistAvailabilityOpsPage({
  params,
}: SpecialistAvailabilityOpsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const { id } = await params;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  let availability;
  try {
    availability = await getSpecialistAvailabilityCalendar(id, monthDays, monthStart);
  } catch {
    notFound();
  }

  return (
    <AuthenticatedShell
      title={`Availability: ${availability.specialist.name}`}
      subtitle="Ops calendar control for manual scheduling availability."
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
      <div className="mb-3 flex justify-end">
        <Link
          href={`/admin/specialists/${availability.specialist.id}`}
          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
        >
          Back to profile
        </Link>
      </div>

      <SpecialistAvailabilityCalendar
        specialistId={availability.specialist.id}
        specialistName={availability.specialist.name}
        rangeStart={availability.rangeStart}
        slotPolicy={availability.slotPolicy}
        windows={availability.windows}
        sessions={availability.sessions}
        editable
        roleLabel="ops"
        defaultView="dayGridMonth"
      />
    </AuthenticatedShell>
  );
}
