import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseStatus, UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { getClientDetailsForOps } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

type IntakeSummary = {
  participantType: string | null;
  mainIssue: string | null;
  issueDuration: string | null;
  location: string | null;
  includeOnline: boolean | null;
  timePreferences: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatToken(value: string | null | undefined) {
  if (!value) {
    return "Not provided";
  }
  return formatStatus(value.toUpperCase());
}

function extractIntakeSummary(intakeFormData: unknown): IntakeSummary {
  const root = asRecord(intakeFormData);
  if (!root) {
    return {
      participantType: null,
      mainIssue: null,
      issueDuration: null,
      location: null,
      includeOnline: null,
      timePreferences: [],
    };
  }

  const presenting = asRecord(root.presenting);
  const availability = asRecord(root.availability);
  const rawTimePreferences = Array.isArray(availability?.timePreferences)
    ? availability?.timePreferences
    : [];

  return {
    participantType: readString(root.participantType),
    mainIssue: readString(presenting?.mainIssue),
    issueDuration: readString(presenting?.issueDuration),
    location: readString(availability?.location),
    includeOnline:
      typeof availability?.includeOnline === "boolean" ? availability.includeOnline : null,
    timePreferences: rawTimePreferences
      .map((value) => (typeof value === "string" ? value : null))
      .filter((value): value is string => Boolean(value)),
  };
}

function normalizeClientRole(value: string) {
  return value === "PRIMARY" ? "Primary participant" : "Secondary participant";
}

function resolveNextSessionLabel(
  sessions: Array<{
    status: string;
    providerStatus: string;
    providerStartTime: Date;
  }>,
) {
  const now = new Date();
  const active = sessions.find(
    (session) =>
      session.providerStatus === "scheduled" &&
      (session.status === "SCHEDULED" || session.status === "IN_SESSION") &&
      session.providerStartTime >= now,
  );

  if (active) {
    return formatDateTime(active.providerStartTime);
  }

  return null;
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const { id } = await params;
  const client = await getClientDetailsForOps(id);

  if (!client) {
    notFound();
  }

  const now = new Date();
  const cases = client.participants.map((participant) => ({
    ...participant.case,
    clientRole: participant.role,
  }));
  const openCaseCount = cases.filter((caseItem) => caseItem.status !== CaseStatus.CLOSED).length;
  const assignedCaseCount = cases.filter((caseItem) => Boolean(caseItem.assignedSpecialist)).length;
  const activePins = client.formAccessPins.filter(
    (pin) => !pin.revokedAt && pin.expiresAt.getTime() > now.getTime(),
  );

  return (
    <AuthenticatedShell
      title={`Client Profile: ${client.firstName} ${client.lastName}`}
      subtitle="Operations deep view of client details, submitted availability, secure access PINs, and related case records."
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
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Client ID
            </p>
            <p className="text-sm text-[color:var(--muted)]">{client.id}</p>
            <h2 className="mt-2 text-2xl font-semibold">
              {client.firstName} {client.lastName}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/clients"
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-[color:var(--accent-soft)]"
            >
              Back to clients
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Contact email
            </p>
            <p className="mt-1 text-sm">{client.email}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Contact phone
            </p>
            <p className="mt-1 text-sm">{client.phone || "Not provided"}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Cases
            </p>
            <p className="mt-1 text-sm">
              {openCaseCount}/{cases.length} open
            </p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Assigned counsellor coverage
            </p>
            <p className="mt-1 text-sm">
              {assignedCaseCount}/{cases.length} cases assigned
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Created: {formatDateTime(client.createdAt)} • Last updated: {formatDateTime(client.updatedAt)}
        </p>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Active Availability Windows
          </h3>
          {client.availabilityWindows.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No active windows on record.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {client.availabilityWindows.slice(0, 25).map((window) => (
                <li key={window.id} className="rounded-lg border border-[color:var(--border)] bg-white p-3">
                  <p className="font-medium">
                    {formatDateTime(window.startTime)} to {formatDateTime(window.endTime)}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Case:{" "}
                    <Link href={`/admin/cases/${window.case.id}`} className="underline">
                      {window.case.reference}
                    </Link>{" "}
                    • Source: {window.source}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Submitted: {formatDateTime(window.submittedAt)} • TZ: {window.timezone}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Form Access PINs
          </h3>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            Active PINs: {activePins.length} • Total shown: {client.formAccessPins.length}
          </p>
          {client.formAccessPins.length === 0 ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">No form PINs issued.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {client.formAccessPins.map((pin) => (
                <li key={pin.id} className="rounded-lg border border-[color:var(--border)] bg-white p-3">
                  <p className="font-medium">{pin.formType}</p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Case:{" "}
                    <Link href={`/admin/cases/${pin.case.id}`} className="underline">
                      {pin.case.reference}
                    </Link>{" "}
                    • Path: {pin.formPath}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Created: {formatDateTime(pin.createdAt)} • Expires: {formatDateTime(pin.expiresAt)}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    Status: {pin.revokedAt ? `Revoked ${formatDateTime(pin.revokedAt)}` : "Active"} •
                    Last verified: {pin.lastVerifiedAt ? formatDateTime(pin.lastVerifiedAt) : "Never"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-4 space-y-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
          Related Cases
        </h3>
        {cases.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">No case relationships found.</p>
        ) : (
          cases.map((caseItem) => {
            const intakeSummary = extractIntakeSummary(caseItem.intakeFormData);
            const requiredDocuments = caseItem.documents.filter((document) => document.required);
            const completedRequiredDocuments = requiredDocuments.filter(
              (document) => document.status === "COMPLETED",
            );
            const nextSession = resolveNextSessionLabel(caseItem.sessions);

            return (
              <article
                key={caseItem.id}
                className="rounded-xl border border-[color:var(--border)] bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold">
                      <Link href={`/admin/cases/${caseItem.id}`} className="underline">
                        {caseItem.reference}
                      </Link>
                    </h4>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                      Status: {formatStatus(caseItem.status)} • Client role:{" "}
                      {normalizeClientRole(caseItem.clientRole)}
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Counselling type: {caseItem.counsellingType || "Not specified"} • Intake source:{" "}
                      {caseItem.intakeSource}
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Workflow: {caseItem.caseWorkflowTemplate?.name || "Unassigned"}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[color:var(--muted)]">
                    <p>
                      Assigned counsellor: {caseItem.assignedSpecialist?.name || "Unassigned"}
                    </p>
                    <p>Next session: {nextSession || "No active session"}</p>
                    <p>
                      Required docs: {completedRequiredDocuments.length}/{requiredDocuments.length}
                    </p>
                    <p>
                      Scheduling gate:{" "}
                      {caseItem.workflowStates.length === 0
                        ? "Eligible"
                        : `${caseItem.workflowStates.length} pending`}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/30 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      Intake Snapshot
                    </p>
                    <p className="mt-1 text-sm">
                      Application type: {formatToken(intakeSummary.participantType)}
                    </p>
                    <p className="text-sm">
                      Main issue: {formatToken(intakeSummary.mainIssue)}
                    </p>
                    <p className="text-sm">
                      Duration: {intakeSummary.issueDuration || "Not provided"}
                    </p>
                    <p className="text-sm">
                      Location: {formatToken(intakeSummary.location)}
                    </p>
                    <p className="text-sm">
                      Online accepted:{" "}
                      {intakeSummary.includeOnline === null
                        ? "Not provided"
                        : intakeSummary.includeOnline
                          ? "Yes"
                          : "No"}
                    </p>
                    <p className="text-sm">
                      Time preferences:{" "}
                      {intakeSummary.timePreferences.length > 0
                        ? intakeSummary.timePreferences.map((entry) => formatToken(entry)).join(", ")
                        : "Not provided"}
                    </p>
                  </div>

                  <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/30 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      Case Notes
                    </p>
                    <p className="mt-1 text-sm">{caseItem.notes || "No case notes."}</p>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      Intake Review Notes (Ops)
                    </p>
                    <p className="mt-1 text-sm">{caseItem.intakeReviewNotes || "No intake review notes."}</p>
                  </div>

                  <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/30 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      Participants
                    </p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {caseItem.participants.map((participant) => (
                        <li key={participant.client.id}>
                          {participant.client.firstName} {participant.client.lastName} •{" "}
                          {normalizeClientRole(participant.role)} • {participant.client.email}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </AuthenticatedShell>
  );
}

