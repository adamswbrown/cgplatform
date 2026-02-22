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
  counsellingType: string | null;
  mainIssue: string | null;
  otherDetails: string | null;
  issueDuration: string | null;
  previousSupport: string | null;
  previousSupportDetails: string | null;
  suicidalThoughtsRecently: string | null;
  suicidalThoughtsDetails: string | null;
  attemptedSuicide: string | null;
  attemptedSuicideDetails: string | null;
  location: string | null;
  includeOnline: boolean | null;
  availabilityNotes: string | null;
  timePreferences: string[];
  primary: {
    title: string | null;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    email: string | null;
    mainPhone: string | null;
    secondPhone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    county: string | null;
    postcode: string | null;
    countryIfNotUk: string | null;
    churchConnection: string | null;
    leadershipRole: string | null;
    heardAbout: string | null;
    heardAboutOtherDetail: string | null;
    contactPreferences: string[];
    emergencyContactFirstName: string | null;
    emergencyContactLastName: string | null;
    emergencyRelationship: string | null;
    emergencyPhone: string | null;
    gpSurgeryName: string | null;
    gpSurgeryPhone: string | null;
    gpDoctorName: string | null;
  };
  secondary: {
    title: string | null;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    email: string | null;
    mainPhone: string | null;
  } | null;
  consent: {
    signatureType: string | null;
    signedAt: string | null;
  };
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

function extractIntakeSummary(intakeFormData: unknown): IntakeSummary {
  const root = asRecord(intakeFormData);
  const empty: IntakeSummary = {
    participantType: null,
    counsellingType: null,
    mainIssue: null,
    otherDetails: null,
    issueDuration: null,
    previousSupport: null,
    previousSupportDetails: null,
    suicidalThoughtsRecently: null,
    suicidalThoughtsDetails: null,
    attemptedSuicide: null,
    attemptedSuicideDetails: null,
    location: null,
    includeOnline: null,
    availabilityNotes: null,
    timePreferences: [],
    primary: {
      title: null, firstName: null, lastName: null, dateOfBirth: null,
      gender: null, email: null, mainPhone: null, secondPhone: null,
      addressLine1: null, addressLine2: null, city: null, county: null,
      postcode: null, countryIfNotUk: null, churchConnection: null,
      leadershipRole: null, heardAbout: null, heardAboutOtherDetail: null,
      contactPreferences: [], emergencyContactFirstName: null,
      emergencyContactLastName: null, emergencyRelationship: null,
      emergencyPhone: null, gpSurgeryName: null, gpSurgeryPhone: null,
      gpDoctorName: null,
    },
    secondary: null,
    consent: { signatureType: null, signedAt: null },
  };

  if (!root) return empty;

  const presenting = asRecord(root.presenting);
  const availability = asRecord(root.availability);
  const primary = asRecord(root.primary);
  const secondary = asRecord(root.secondary);
  const consent = asRecord(root.consent);

  const extractPrimary = (p: Record<string, unknown> | null) => {
    if (!p) return empty.primary;
    return {
      title: readString(p.title),
      firstName: readString(p.firstName),
      lastName: readString(p.lastName),
      dateOfBirth: readString(p.dateOfBirth),
      gender: readString(p.gender),
      email: readString(p.email),
      mainPhone: readString(p.mainPhone),
      secondPhone: readString(p.secondPhone),
      addressLine1: readString(p.addressLine1),
      addressLine2: readString(p.addressLine2),
      city: readString(p.city),
      county: readString(p.county),
      postcode: readString(p.postcode),
      countryIfNotUk: readString(p.countryIfNotUk),
      churchConnection: readString(p.churchConnection),
      leadershipRole: readString(p.leadershipRole),
      heardAbout: readString(p.heardAbout),
      heardAboutOtherDetail: readString(p.heardAboutOtherDetail),
      contactPreferences: readStringArray(p.contactPreferences),
      emergencyContactFirstName: readString(p.emergencyContactFirstName),
      emergencyContactLastName: readString(p.emergencyContactLastName),
      emergencyRelationship: readString(p.emergencyRelationship),
      emergencyPhone: readString(p.emergencyPhone),
      gpSurgeryName: readString(p.gpSurgeryName),
      gpSurgeryPhone: readString(p.gpSurgeryPhone),
      gpDoctorName: readString(p.gpDoctorName),
    };
  };

  return {
    participantType: readString(root.participantType),
    counsellingType: readString(root.counsellingType),
    mainIssue: readString(presenting?.mainIssue),
    otherDetails: readString(presenting?.otherDetails),
    issueDuration: readString(presenting?.issueDuration),
    previousSupport: readString(presenting?.previousSupport),
    previousSupportDetails: readString(presenting?.previousSupportDetails),
    suicidalThoughtsRecently: readString(presenting?.suicidalThoughtsRecently),
    suicidalThoughtsDetails: readString(presenting?.suicidalThoughtsDetails),
    attemptedSuicide: readString(presenting?.attemptedSuicide),
    attemptedSuicideDetails: readString(presenting?.attemptedSuicideDetails),
    location: readString(availability?.location),
    includeOnline:
      typeof availability?.includeOnline === "boolean" ? availability.includeOnline : null,
    availabilityNotes: readString(availability?.notes),
    timePreferences: readStringArray(availability?.timePreferences),
    primary: extractPrimary(primary),
    secondary: secondary
      ? {
          title: readString(secondary.title),
          firstName: readString(secondary.firstName),
          lastName: readString(secondary.lastName),
          dateOfBirth: readString(secondary.dateOfBirth),
          gender: readString(secondary.gender),
          email: readString(secondary.email),
          mainPhone: readString(secondary.mainPhone),
        }
      : null,
    consent: {
      signatureType: readString(consent?.signatureType),
      signedAt: readString(consent?.signedAt),
    },
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
      currentPath="/admin/clients"
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

                <div className="mt-3 grid gap-3 xl:grid-cols-2">
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

                {/* Full Intake Form Data */}
                {intakeSummary.primary.firstName ? (
                  <details className="group mt-3 rounded-lg border border-[color:var(--border)] bg-white">
                    <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-[color:var(--cg-ink)] hover:bg-[color:var(--accent-soft)]/30">
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-[color:var(--muted)] transition-transform group-open:rotate-90">
                        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
                      </svg>
                      Intake Form Data
                      <span className="ml-auto text-xs font-normal text-[color:var(--muted)]">
                        {formatToken(intakeSummary.participantType)} • {formatToken(intakeSummary.counsellingType)}
                      </span>
                    </summary>
                    <div className="border-t border-[color:var(--border)] px-4 py-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        {/* Primary Participant */}
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                              Primary Participant
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Name</p>
                                <p>{[intakeSummary.primary.title, intakeSummary.primary.firstName, intakeSummary.primary.lastName].filter(Boolean).join(" ") || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Date of Birth</p>
                                <p>{intakeSummary.primary.dateOfBirth || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Gender</p>
                                <p>{formatToken(intakeSummary.primary.gender)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Email</p>
                                <p>{intakeSummary.primary.email || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Main Phone</p>
                                <p>{intakeSummary.primary.mainPhone || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Second Phone</p>
                                <p>{intakeSummary.primary.secondPhone || "Not provided"}</p>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">Address</p>
                            <p className="mt-1 text-sm">
                              {[
                                intakeSummary.primary.addressLine1,
                                intakeSummary.primary.addressLine2,
                                intakeSummary.primary.city,
                                intakeSummary.primary.county,
                                intakeSummary.primary.postcode,
                                intakeSummary.primary.countryIfNotUk,
                              ].filter(Boolean).join(", ") || "Not provided"}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Church Connection</p>
                              <p>{formatToken(intakeSummary.primary.churchConnection)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Leadership Role</p>
                              <p>{formatToken(intakeSummary.primary.leadershipRole)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Heard About</p>
                              <p>{formatToken(intakeSummary.primary.heardAbout)}{intakeSummary.primary.heardAboutOtherDetail ? ` (${intakeSummary.primary.heardAboutOtherDetail})` : ""}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Contact Preferences</p>
                              <p>{intakeSummary.primary.contactPreferences.length > 0 ? intakeSummary.primary.contactPreferences.map((entry) => formatToken(entry)).join(", ") : "Not provided"}</p>
                            </div>
                          </div>
                        </div>

                        {/* Emergency Contact & GP */}
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                              Emergency Contact
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Name</p>
                                <p>{[intakeSummary.primary.emergencyContactFirstName, intakeSummary.primary.emergencyContactLastName].filter(Boolean).join(" ") || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Relationship</p>
                                <p>{formatToken(intakeSummary.primary.emergencyRelationship)}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="text-[11px] text-[color:var(--muted)]">Phone</p>
                                <p>{intakeSummary.primary.emergencyPhone || "Not provided"}</p>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                              GP / Doctor
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Surgery Name</p>
                                <p>{intakeSummary.primary.gpSurgeryName || "Not provided"}</p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Surgery Phone</p>
                                <p>{intakeSummary.primary.gpSurgeryPhone || "Not provided"}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="text-[11px] text-[color:var(--muted)]">Doctor Name</p>
                                <p>{intakeSummary.primary.gpDoctorName || "Not provided"}</p>
                              </div>
                            </div>
                          </div>

                          {/* Secondary Participant (couples) */}
                          {intakeSummary.secondary ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                                Secondary Participant
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                                <div>
                                  <p className="text-[11px] text-[color:var(--muted)]">Name</p>
                                  <p>{[intakeSummary.secondary.title, intakeSummary.secondary.firstName, intakeSummary.secondary.lastName].filter(Boolean).join(" ") || "Not provided"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-[color:var(--muted)]">Date of Birth</p>
                                  <p>{intakeSummary.secondary.dateOfBirth || "Not provided"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-[color:var(--muted)]">Gender</p>
                                  <p>{formatToken(intakeSummary.secondary.gender)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-[color:var(--muted)]">Email</p>
                                  <p>{intakeSummary.secondary.email || "Not provided"}</p>
                                </div>
                                <div className="col-span-2">
                                  <p className="text-[11px] text-[color:var(--muted)]">Phone</p>
                                  <p>{intakeSummary.secondary.mainPhone || "Not provided"}</p>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Presenting Issues */}
                      <div className="mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                          Presenting Issues
                        </p>
                        <div className="mt-2 grid gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
                          <div>
                            <p className="text-[11px] text-[color:var(--muted)]">Main Issue</p>
                            <p>{formatToken(intakeSummary.mainIssue)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[color:var(--muted)]">Duration</p>
                            <p>{intakeSummary.issueDuration || "Not provided"}</p>
                          </div>
                          {intakeSummary.otherDetails ? (
                            <div className="lg:col-span-2">
                              <p className="text-[11px] text-[color:var(--muted)]">Additional Details</p>
                              <p>{intakeSummary.otherDetails}</p>
                            </div>
                          ) : null}
                          <div>
                            <p className="text-[11px] text-[color:var(--muted)]">Previous Support</p>
                            <p>{formatToken(intakeSummary.previousSupport)}</p>
                          </div>
                          {intakeSummary.previousSupportDetails ? (
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Previous Support Details</p>
                              <p>{intakeSummary.previousSupportDetails}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Safeguarding */}
                      {(intakeSummary.suicidalThoughtsRecently || intakeSummary.attemptedSuicide) ? (
                        <div className="cg-sensitive-section mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                            Safeguarding Responses
                          </p>
                          <div className="mt-2 grid gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
                            <div>
                              <p className="text-[11px] text-amber-700">Recent suicidal thoughts</p>
                              <p className="font-medium">{formatToken(intakeSummary.suicidalThoughtsRecently)}</p>
                            </div>
                            {intakeSummary.suicidalThoughtsDetails ? (
                              <div>
                                <p className="text-[11px] text-amber-700">Details</p>
                                <p>{intakeSummary.suicidalThoughtsDetails}</p>
                              </div>
                            ) : null}
                            <div>
                              <p className="text-[11px] text-amber-700">Previous suicide attempt</p>
                              <p className="font-medium">{formatToken(intakeSummary.attemptedSuicide)}</p>
                            </div>
                            {intakeSummary.attemptedSuicideDetails ? (
                              <div>
                                <p className="text-[11px] text-amber-700">Details</p>
                                <p>{intakeSummary.attemptedSuicideDetails}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {/* Availability & Consent */}
                      <div className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                            Availability Preferences
                          </p>
                          <div className="mt-2 space-y-1.5">
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Location</p>
                              <p>{formatToken(intakeSummary.location)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Online Accepted</p>
                              <p>{intakeSummary.includeOnline === null ? "Not provided" : intakeSummary.includeOnline ? "Yes" : "No"}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Time Preferences</p>
                              <p>{intakeSummary.timePreferences.length > 0 ? intakeSummary.timePreferences.map((entry) => formatToken(entry)).join(", ") : "Not provided"}</p>
                            </div>
                            {intakeSummary.availabilityNotes ? (
                              <div>
                                <p className="text-[11px] text-[color:var(--muted)]">Notes</p>
                                <p>{intakeSummary.availabilityNotes}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                            Consent
                          </p>
                          <div className="mt-2 space-y-1.5">
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Signature Type</p>
                              <p>{formatToken(intakeSummary.consent.signatureType)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[color:var(--muted)]">Signed At</p>
                              <p>{intakeSummary.consent.signedAt || "Not provided"}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </AuthenticatedShell>
  );
}

