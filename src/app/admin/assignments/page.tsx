import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { ManualAssignmentBoard } from "@/components/admin/manual-assignment-board";
import { requirePageUser } from "@/lib/auth";
import { getManualAssignmentDashboard } from "@/lib/case-service";

type ManualAssignmentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManualAssignmentsPage({
  searchParams,
}: ManualAssignmentsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const dashboard = await getManualAssignmentDashboard();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AuthenticatedShell
      title="Manual Assignment Board"
      subtitle={`Use Kanban or Calendar Grid mode to assign, reassign, and unassign cases against ${dashboard.slotPolicy.slotMinutes}-minute slots from ${String(dashboard.slotPolicy.startHour).padStart(2, "0")}:00 to ${String(dashboard.slotPolicy.endHour).padStart(2, "0")}:00.`}
      userName={user.name}
      role={user.role}
      currentPath="/admin/assignments"
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

      {dashboard.schedulingEngineType !== "manual" ? (
        <section className="cg-alert cg-alert-warning">
          <p>
            Scheduling engine is currently <strong>{dashboard.schedulingEngineType}</strong>. The
            assignment board is optimized for the manual engine.
          </p>
          <p className="mt-1">
            Change engine in{" "}
            <Link href="/admin/settings/operations" className="underline">
              Operational Settings
            </Link>
            .
          </p>
        </section>
      ) : null}

      {dashboard.assignmentMode !== "manual" ? (
        <section className="cg-alert cg-alert-warning">
          <p>
            Scheduling assignment mode is <strong>{dashboard.assignmentMode}</strong>. For this board
            workflow, switch mode to <strong>manual</strong> in Operational Settings.
          </p>
        </section>
      ) : null}

      {dashboard.providerError ? (
        <section className="cg-alert cg-alert-error">
          <p>{dashboard.providerError}</p>
        </section>
      ) : null}

      <ManualAssignmentBoard
        cases={dashboard.unassignedCases}
        assignedCases={dashboard.assignedCases}
        specialists={dashboard.specialists}
        slotPolicy={dashboard.slotPolicy}
      />
    </AuthenticatedShell>
  );
}
