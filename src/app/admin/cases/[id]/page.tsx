import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import {
  autoAllocateCaseAction,
  assignCaseWorkflowAction,
  completeDocumentAction,
  issueFormPinAction,
  revokeFormPinAction,
  overrideAssignmentAction,
  transitionCaseAction,
  updateCaseIntakeReviewNotesAction,
} from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { FormPinRoutingFields } from "@/components/forms/form-pin-routing-fields";
import { requirePageUser } from "@/lib/auth";
import { getOperationalSettings } from "@/lib/admin-settings";
import {
  getCaseDetails,
  getCaseSpecialistAvailability,
  listSpecialistsForOps,
  listWorkflowTemplatesForOps,
} from "@/lib/case-service";
import { formatDateTime, formatStatus, statusColorKey } from "@/lib/format";
import { CASE_TRANSITIONS } from "@/lib/workflow";

type CaseDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type IntakeFieldRow = {
  path: string;
  rawValue: unknown;
};

type IntakeDisplayRow = {
  path: string;
  label: string;
  response: string;
};

type IntakeFieldGroupKey =
  | "snapshot"
  | "participants"
  | "presenting"
  | "availability"
  | "contact"
  | "consent"
  | "additional";

type IntakeFieldGroup = {
  key: IntakeFieldGroupKey;
  label: string;
  rows: IntakeDisplayRow[];
};

type IntakeProfileSnapshot = {
  displayName: string;
  initials: string;
  applicationType: string;
  requestedSupport: string;
  mainIssue: string;
  issueDuration: string;
  preferredLocation: string;
  onlinePreference: string;
  timePreferences: string[];
  riskSignals: string[];
};

type CasePanel = "assignment" | "intake" | "forms" | "history";

const CASE_PANELS: Array<{ id: CasePanel; label: string }> = [
  { id: "intake", label: "Intake" },
  { id: "assignment", label: "Assignment" },
  { id: "forms", label: "Forms & PINs" },
  { id: "history", label: "History" },
];

function normalizeCasePanel(value: string | undefined): CasePanel {
  if (value === "assignment" || value === "intake" || value === "forms" || value === "history") {
    return value;
  }
  return "intake";
}

function tabClassName(active: boolean) {
  return active
    ? "cg-tab cg-tab-active"
    : "cg-tab";
}

function readStringMetadata(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatIntakeScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value.trim() ? value : "(empty)";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return String(value);
}

const INTAKE_FIELD_LABELS: Record<string, string> = {
  participantType: "Application type",
  counsellingType: "Counselling type",
  requestedDurationMinutes: "Requested session length (minutes)",
  "primary.title": "Primary participant title",
  "primary.firstName": "Primary first name",
  "primary.lastName": "Primary last name",
  "primary.dateOfBirth": "Primary date of birth",
  "primary.gender": "Primary gender",
  "primary.email": "Primary email",
  "primary.mainPhone": "Primary main phone",
  "primary.secondPhone": "Primary second phone",
  "primary.addressLine1": "Primary address line 1",
  "primary.addressLine2": "Primary address line 2",
  "primary.city": "Primary city/town",
  "primary.county": "Primary county",
  "primary.postcode": "Primary postcode",
  "primary.countryIfNotUk": "Primary country (if not UK)",
  "primary.churchConnection": "Church connection",
  "primary.leadershipRole": "Church leadership role",
  "primary.heardAbout": "How they heard about us",
  "primary.heardAboutOtherDetail": "How they heard about us (other detail)",
  "primary.contactPreferences.contactMainPhone": "Contact preference: main phone",
  "primary.contactPreferences.leaveVoicemailMainPhone": "Contact preference: voicemail on main phone",
  "primary.contactPreferences.contactSecondPhone": "Contact preference: second phone",
  "primary.contactPreferences.leaveVoicemailSecondPhone":
    "Contact preference: voicemail on second phone",
  "primary.contactPreferences.contactEmail": "Contact preference: email",
  "primary.emergencyContactFirstName": "Emergency contact first name",
  "primary.emergencyContactLastName": "Emergency contact last name",
  "primary.emergencyRelationship": "Emergency contact relationship",
  "primary.emergencyPhone": "Emergency contact phone",
  "primary.gpSurgeryName": "GP surgery name",
  "primary.gpSurgeryPhone": "GP surgery phone",
  "primary.gpDoctorName": "GP doctor name",
  "secondary.title": "Secondary participant title",
  "secondary.firstName": "Secondary first name",
  "secondary.lastName": "Secondary last name",
  "secondary.dateOfBirth": "Secondary date of birth",
  "secondary.gender": "Secondary gender",
  "secondary.email": "Secondary email",
  "secondary.mainPhone": "Secondary main phone",
  "presenting.mainIssue": "Main presenting issue",
  "presenting.otherDetails": "Presenting issue (other detail)",
  "presenting.issueDuration": "How long issue has affected participant(s)",
  "presenting.previousSupport": "Previous support received",
  "presenting.previousSupportDetails": "Previous support details",
  "presenting.suicidalThoughtsRecently": "Recent suicidal thoughts",
  "presenting.suicidalThoughtsDetails": "Recent suicidal thoughts details",
  "presenting.attemptedSuicide": "Attempted suicide history",
  "presenting.attemptedSuicideDetails": "Attempted suicide details",
  "availability.location": "Preferred location",
  "availability.includeOnline": "Online sessions acceptable",
  "availability.notes": "Availability notes",
  "availability.timePreferences[]": "Preferred time block",
  "availability.selectedSlots[]": "Selected availability slot",
  "availability.selectedSlots[].startTime": "Selected slot start time",
  "availability.selectedSlots[].endTime": "Selected slot end time",
  "consent.signatureType": "Consent signature type",
  "consent.signedAt": "Consent signed at",
  "consent.signature": "Consent signature",
};

const INTAKE_GROUP_ORDER: IntakeFieldGroupKey[] = [
  "snapshot",
  "participants",
  "presenting",
  "availability",
  "contact",
  "consent",
  "additional",
];

const INTAKE_GROUP_CONFIG: Record<
  IntakeFieldGroupKey,
  {
    label: string;
  }
> = {
  snapshot: {
    label: "Application",
  },
  participants: {
    label: "Intake Responses",
  },
  presenting: {
    label: "Presenting Concerns",
  },
  availability: {
    label: "Availability",
  },
  contact: {
    label: "Contact, Emergency & GP",
  },
  consent: {
    label: "Consent Record",
  },
  additional: {
    label: "Additional Responses",
  },
};

const INTAKE_FIELD_PATH_ORDER = [
  "participantType",
  "counsellingType",
  "requestedDurationMinutes",
  "primary.title",
  "primary.firstName",
  "primary.lastName",
  "primary.dateOfBirth",
  "primary.gender",
  "primary.email",
  "primary.mainPhone",
  "primary.secondPhone",
  "primary.addressLine1",
  "primary.addressLine2",
  "primary.city",
  "primary.county",
  "primary.postcode",
  "primary.countryIfNotUk",
  "primary.heardAbout",
  "primary.heardAboutOtherDetail",
  "primary.churchConnection",
  "primary.leadershipRole",
  "secondary.title",
  "secondary.firstName",
  "secondary.lastName",
  "secondary.dateOfBirth",
  "secondary.gender",
  "secondary.email",
  "secondary.mainPhone",
  "presenting.mainIssue",
  "presenting.otherDetails",
  "presenting.issueDuration",
  "presenting.previousSupport",
  "presenting.previousSupportDetails",
  "presenting.suicidalThoughtsRecently",
  "presenting.suicidalThoughtsDetails",
  "presenting.attemptedSuicide",
  "presenting.attemptedSuicideDetails",
  "availability.location",
  "availability.includeOnline",
  "availability.timePreferences[]",
  "availability.selectedSlots[].startTime",
  "availability.selectedSlots[].endTime",
  "availability.selectedSlots[]",
  "availability.notes",
  "primary.contactPreferences.contactMainPhone",
  "primary.contactPreferences.leaveVoicemailMainPhone",
  "primary.contactPreferences.contactSecondPhone",
  "primary.contactPreferences.leaveVoicemailSecondPhone",
  "primary.contactPreferences.contactEmail",
  "primary.emergencyContactFirstName",
  "primary.emergencyContactLastName",
  "primary.emergencyRelationship",
  "primary.emergencyPhone",
  "primary.gpSurgeryName",
  "primary.gpSurgeryPhone",
  "primary.gpDoctorName",
  "consent.signatureType",
  "consent.signature",
  "consent.signedAt",
] as const;

const INTAKE_FIELD_PATH_ORDER_INDEX: Map<string, number> = new Map(
  INTAKE_FIELD_PATH_ORDER.map((path, index) => [path, index] as const),
);

function normalizeIntakePath(path: string) {
  return path.replace(/\[\d+\]/g, "[]");
}

function extractPathIndices(path: string) {
  return Array.from(path.matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1]));
}

function formatLabelToken(token: string) {
  const withSpaces = token
    .replace(/\[\d+\]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withSpaces) {
    return token;
  }

  return withSpaces
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .replace(/\bGp\b/g, "GP")
    .replace(/\bUk\b/g, "UK");
}

function defaultManualBlockWindows(startHour: number, endHour: number) {
  const morningEnd = Math.min(12, endHour);
  const afternoonStart = Math.max(12, startHour);
  const afternoonEnd = Math.min(17, endHour);
  const eveningStart = Math.max(17, startHour);
  return {
    MORNING: {
      startHour,
      endHour: Math.max(startHour, morningEnd),
    },
    AFTERNOON: {
      startHour: afternoonStart,
      endHour: Math.max(afternoonStart, afternoonEnd),
    },
    EVENING: {
      startHour: eveningStart,
      endHour: Math.max(eveningStart, endHour),
    },
  };
}

function formatBlockWindow(window: { startHour: number; endHour: number }) {
  return `${String(window.startHour).padStart(2, "0")}:00-${String(window.endHour).padStart(2, "0")}:00`;
}

function formatIntakeFieldLabel(path: string) {
  const normalizedPath = normalizeIntakePath(path);
  const mapped = INTAKE_FIELD_LABELS[normalizedPath];
  const indices = extractPathIndices(path);

  if (mapped) {
    if (indices.length === 0) {
      return mapped;
    }
    return `${mapped} #${indices.map((index) => index + 1).join(".")}`;
  }

  return normalizedPath.split(".").map(formatLabelToken).join(" > ");
}

function formatIntakeFieldValue(path: string, rawValue: unknown) {
  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) {
      return "No entries";
    }
    return JSON.stringify(rawValue);
  }

  if (rawValue && typeof rawValue === "object") {
    const entries = Object.keys(rawValue as Record<string, unknown>);
    if (entries.length === 0) {
      return "No data";
    }
    return JSON.stringify(rawValue);
  }

  if (typeof rawValue === "string") {
    const value = rawValue.trim();
    if (!value) {
      return "(empty)";
    }

    if (normalizeIntakePath(path) === "consent.signature") {
      return `Captured signature (${value.length} chars)`;
    }

    if (value === "yes" || value === "no") {
      return value === "yes" ? "Yes" : "No";
    }

    if (value === "prefer_not_to_say") {
      return "Prefer not to say";
    }

    if (value === "single") {
      return "Individual";
    }

    if (value === "couple") {
      return "Couple";
    }

    if (value.includes("_")) {
      return formatStatus(value.toUpperCase());
    }

    return value;
  }

  if (typeof rawValue === "boolean") {
    return rawValue ? "Yes" : "No";
  }

  if (rawValue === null) {
    return "Not provided";
  }

  return formatIntakeScalar(rawValue);
}

function resolveIntakeFieldGroup(path: string): IntakeFieldGroupKey {
  const normalizedPath = normalizeIntakePath(path);

  if (
    normalizedPath === "participantType" ||
    normalizedPath === "counsellingType" ||
    normalizedPath === "requestedDurationMinutes"
  ) {
    return "snapshot";
  }

  if (normalizedPath.startsWith("presenting.")) {
    return "presenting";
  }

  if (normalizedPath.startsWith("availability.")) {
    return "availability";
  }

  if (normalizedPath.startsWith("consent.")) {
    return "consent";
  }

  if (
    normalizedPath.startsWith("primary.contactPreferences.") ||
    normalizedPath.startsWith("primary.emergency") ||
    normalizedPath.startsWith("primary.gp")
  ) {
    return "contact";
  }

  if (normalizedPath.startsWith("primary.") || normalizedPath.startsWith("secondary.")) {
    return "participants";
  }

  return "additional";
}

function intakePathSortWeight(path: string) {
  const normalizedPath = normalizeIntakePath(path);
  const explicitIndex = INTAKE_FIELD_PATH_ORDER_INDEX.get(normalizedPath);
  const pathIndices = extractPathIndices(path);
  const indexWeight =
    pathIndices.length > 0
      ? pathIndices.reduce((total, value, position) => total + value / 10 ** (position + 2), 0)
      : 0;

  if (typeof explicitIndex === "number") {
    return explicitIndex + indexWeight;
  }

  if (normalizedPath.startsWith("primary.")) {
    return 500 + indexWeight;
  }
  if (normalizedPath.startsWith("secondary.")) {
    return 650 + indexWeight;
  }
  if (normalizedPath.startsWith("presenting.")) {
    return 800 + indexWeight;
  }
  if (normalizedPath.startsWith("availability.")) {
    return 950 + indexWeight;
  }
  if (normalizedPath.startsWith("consent.")) {
    return 1100 + indexWeight;
  }

  return 2000 + indexWeight;
}

function compareIntakeDisplayRows(a: IntakeDisplayRow, b: IntakeDisplayRow) {
  const weightDiff = intakePathSortWeight(a.path) - intakePathSortWeight(b.path);
  if (weightDiff !== 0) {
    return weightDiff;
  }

  return a.path.localeCompare(b.path);
}

function flattenIntakeFields(
  value: unknown,
  path = "",
  rows: IntakeFieldRow[] = [],
): IntakeFieldRow[] {
  if (value === undefined) {
    if (!path) {
      rows.push({
        path: "(root)",
        rawValue: "No intake payload stored.",
      });
    }
    return rows;
  }

  if (value === null || typeof value !== "object") {
    rows.push({
      path: path || "(root)",
      rawValue: value,
    });
    return rows;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({
        path: path || "(root)",
        rawValue: [],
      });
      return rows;
    }

    value.forEach((item, index) => {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`;
      flattenIntakeFields(item, nextPath, rows);
    });
    return rows;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  if (entries.length === 0) {
    rows.push({
      path: path || "(root)",
      rawValue: {},
    });
    return rows;
  }

  entries.forEach(([key, nextValue]) => {
    const nextPath = path ? `${path}.${key}` : key;
    flattenIntakeFields(nextValue, nextPath, rows);
  });

  return rows;
}

function buildIntakeDisplayGroups(rows: IntakeFieldRow[]): IntakeFieldGroup[] {
  if (rows.length === 0) {
    return [];
  }

  const groupedRows: Record<IntakeFieldGroupKey, IntakeDisplayRow[]> = {
    snapshot: [],
    participants: [],
    presenting: [],
    availability: [],
    contact: [],
    consent: [],
    additional: [],
  };

  rows
    .filter((row) => row.path !== "(root)")
    .forEach((row) => {
      const response = formatIntakeFieldValue(row.path, row.rawValue);
      if (
        response === "Not provided" ||
        response === "(empty)" ||
        response === "No data" ||
        response === "No entries"
      ) {
        return;
      }

      const group = resolveIntakeFieldGroup(row.path);
      groupedRows[group].push({
        path: row.path,
        label: formatIntakeFieldLabel(row.path),
        response,
      });
    });

  return INTAKE_GROUP_ORDER.map((key) => ({
    key,
    label: INTAKE_GROUP_CONFIG[key].label,
    rows: groupedRows[key].sort(compareIntakeDisplayRows),
  })).filter((group) => group.rows.length > 0);
}

function buildIntakeValueLookup(rows: IntakeFieldRow[]) {
  const lookup = new Map<string, string[]>();

  rows
    .filter((row) => row.path !== "(root)")
    .forEach((row) => {
      const key = normalizeIntakePath(row.path);
      const value = formatIntakeFieldValue(row.path, row.rawValue);
      if (
        value === "Not provided" ||
        value === "(empty)" ||
        value === "No data" ||
        value === "No entries"
      ) {
        return;
      }

      const existing = lookup.get(key) || [];
      existing.push(value);
      lookup.set(key, existing);
    });

  return lookup;
}

function firstLookupValue(lookup: Map<string, string[]>, key: string) {
  return lookup.get(key)?.[0] || "Not provided";
}

function formatParticipantInitials(participantNames: string[]) {
  const initials = participantNames
    .map((name) => name.trim().charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 3)
    .join("");

  return initials || "N/A";
}

function isYesValue(value: string) {
  return value.trim().toLowerCase() === "yes";
}

function deriveRequestedSupport(counsellingType: string, applicationType: string) {
  if (counsellingType && counsellingType !== "Not provided") {
    return counsellingType;
  }

  if (applicationType === "Couple") {
    return "Couples counselling";
  }

  if (applicationType === "Individual") {
    return "Individual counselling";
  }

  return "Not specified";
}

function buildIntakeProfileSnapshot(
  rows: IntakeFieldRow[],
  participantNames: string[],
): IntakeProfileSnapshot {
  const lookup = buildIntakeValueLookup(rows);
  const applicationType = firstLookupValue(lookup, "participantType");
  const counsellingType = firstLookupValue(lookup, "counsellingType");
  const timePreferences = lookup.get("availability.timePreferences[]") || [];
  const suicidalThoughts = firstLookupValue(lookup, "presenting.suicidalThoughtsRecently");
  const attemptedSuicide = firstLookupValue(lookup, "presenting.attemptedSuicide");
  const riskSignals: string[] = [];

  if (isYesValue(suicidalThoughts)) {
    riskSignals.push("Recent suicidal thoughts");
  }
  if (isYesValue(attemptedSuicide)) {
    riskSignals.push("Attempted suicide history");
  }

  return {
    displayName: participantNames.length > 0 ? participantNames.join(" & ") : "Intake profile",
    initials: formatParticipantInitials(participantNames),
    applicationType,
    requestedSupport: deriveRequestedSupport(counsellingType, applicationType),
    mainIssue: firstLookupValue(lookup, "presenting.mainIssue"),
    issueDuration: firstLookupValue(lookup, "presenting.issueDuration"),
    preferredLocation: firstLookupValue(lookup, "availability.location"),
    onlinePreference: firstLookupValue(lookup, "availability.includeOnline"),
    timePreferences,
    riskSignals,
  };
}

function buildIntakeGroupMap(groups: IntakeFieldGroup[]) {
  const map: Record<IntakeFieldGroupKey, IntakeDisplayRow[]> = {
    snapshot: [],
    participants: [],
    presenting: [],
    availability: [],
    contact: [],
    consent: [],
    additional: [],
  };

  groups.forEach((group) => {
    map[group.key] = group.rows;
  });

  return map;
}

export default async function CaseDetailPage({ params, searchParams }: CaseDetailPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const { id } = await params;
  const query = await searchParams;
  const activePanel = normalizeCasePanel(typeof query.panel === "string" ? query.panel : undefined);
  const assignmentPanelActive = activePanel === "assignment";
  const formsPanelActive = activePanel === "forms";

  const [caseItem, specialists, workflowTemplates, operationalSettings] = await Promise.all([
    getCaseDetails(id),
    assignmentPanelActive ? listSpecialistsForOps() : Promise.resolve([]),
    assignmentPanelActive ? listWorkflowTemplatesForOps() : Promise.resolve([]),
    formsPanelActive || assignmentPanelActive ? getOperationalSettings() : Promise.resolve(null),
  ]);

  if (!caseItem) {
    notFound();
  }

  const specialistAvailability = assignmentPanelActive
    ? await getCaseSpecialistAvailability(caseItem.id)
    : null;
  const assignmentMode = specialistAvailability?.assignmentMode ?? "manual";

  const transitionOptions = CASE_TRANSITIONS[caseItem.status];
  const error = typeof query.error === "string" ? query.error : null;
  const pinIssued = query.pinIssued === "1";
  const pinRecipient = typeof query.pinRecipient === "string" ? query.pinRecipient : null;
  const pinFormType = typeof query.pinFormType === "string" ? query.pinFormType : null;
  const pinExpiresAt = typeof query.pinExpiresAt === "string" ? query.pinExpiresAt : null;
  const pinAccessUrl = typeof query.pinAccessUrl === "string" ? query.pinAccessUrl : null;
  const pinEmailDelivered = query.pinEmailDelivered === "1";
  const pinFallbackCode = typeof query.pinFallbackCode === "string" ? query.pinFallbackCode : null;
  const pinEmailError = typeof query.pinEmailError === "string" ? query.pinEmailError : null;
  const pinRevoked = query.pinRevoked === "1";
  const pinRevokedFormType =
    typeof query.pinRevokedFormType === "string" ? query.pinRevokedFormType : null;
  const pinRevokedRecipient =
    typeof query.pinRevokedRecipient === "string" ? query.pinRevokedRecipient : null;
  const pinRevokedAt = typeof query.pinRevokedAt === "string" ? query.pinRevokedAt : null;
  const pinRevokedAlready = query.pinRevokedAlready === "1";
  const intakeNotesSaved = query.intakeNotesSaved === "1";
  const panelHref = (panel: CasePanel) => `/admin/cases/${caseItem.id}?panel=${panel}`;
  const redirectTo = panelHref(activePanel);
  const now = new Date();
  const activePins = formsPanelActive
    ? caseItem.formAccessPins.filter((pin) => !pin.revokedAt && pin.expiresAt > now)
    : [];
  const formPinExpiresDefault = operationalSettings?.defaultFormPinExpiresHours ?? 72;
  const formPinMaxAttemptsDefault = operationalSettings?.defaultFormPinMaxAttempts ?? 5;
  const defaultBlockWindows = defaultManualBlockWindows(
    operationalSettings?.defaultSpecialistStandardStartHour ?? 9,
    operationalSettings?.defaultSpecialistStandardEndHour ?? 18,
  );
  const intakeFieldRows = activePanel === "intake" ? flattenIntakeFields(caseItem.intakeFormData) : [];
  const intakeDisplayGroups =
    activePanel === "intake" ? buildIntakeDisplayGroups(intakeFieldRows) : [];
  const participantDisplayNames =
    activePanel === "intake"
      ? caseItem.participants.map(
          (participant) => `${participant.client.firstName} ${participant.client.lastName}`,
        )
      : [];
  const intakeProfileSnapshot =
    activePanel === "intake"
      ? buildIntakeProfileSnapshot(intakeFieldRows, participantDisplayNames)
      : null;
  const intakeGroupMap =
    activePanel === "intake" ? buildIntakeGroupMap(intakeDisplayGroups) : null;
  const intakeSnapshotRows = intakeGroupMap?.snapshot || [];
  const intakePresentingRows = intakeGroupMap?.presenting || [];
  const intakeAvailabilityRows = intakeGroupMap?.availability || [];
  const intakeParticipantRows = intakeGroupMap?.participants || [];
  const intakeContactRows = intakeGroupMap?.contact || [];
  const intakeConsentRows = intakeGroupMap?.consent || [];
  const intakeAdditionalRows = intakeGroupMap?.additional || [];

  // Split participants into primary / secondary for structured display
  const intakePrimaryRows = intakeParticipantRows.filter((r) => r.path.startsWith("primary."));
  const intakeSecondaryRows = intakeParticipantRows.filter((r) => r.path.startsWith("secondary."));

  // Split contact group into emergency / GP / contact preferences
  const intakeEmergencyRows = intakeContactRows.filter((r) => r.path.includes("emergency"));
  const intakeGpRows = intakeContactRows.filter((r) => r.path.includes("gp") || r.path.includes("Gp"));
  const intakeContactPrefRows = intakeContactRows.filter(
    (r) => r.path.includes("contactPreferences"),
  );

  // Split presenting into safeguarding vs non-safeguarding
  const intakeSafeguardingRows = intakePresentingRows.filter(
    (r) => r.path.includes("suicidal") || r.path.includes("attemptedSuicide"),
  );
  const intakePresentingNonSafeguardingRows = intakePresentingRows.filter(
    (r) => !r.path.includes("suicidal") && !r.path.includes("attemptedSuicide"),
  );
  const intakePayloadJson =
    activePanel === "intake" && caseItem.intakeFormData
      ? JSON.stringify(caseItem.intakeFormData, null, 2)
      : null;

  return (
    <AuthenticatedShell
      title={caseItem.reference}
      subtitle="Manage lifecycle state, required documents, provider booking references, and audit logs."
      userName={user.name}
      role={user.role}
      currentPath="/admin/cases"
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
        <p className="cg-alert cg-alert-error mb-4">{error}</p>
      ) : null}
      {pinIssued ? (
        <div className="cg-alert cg-alert-success mb-4">
          <p>
            PIN issued for <strong>{pinRecipient}</strong> ({pinFormType}).
          </p>
          {pinExpiresAt ? <p className="text-xs">Expires: {formatDateTime(pinExpiresAt)}</p> : null}
          {pinAccessUrl ? (
            <p className="mt-1 text-xs">
              Access page:{" "}
              <a href={pinAccessUrl} className="underline">
                {pinAccessUrl}
              </a>
            </p>
          ) : null}
          {pinEmailDelivered ? (
            <p className="mt-1 text-xs">PIN email was sent.</p>
          ) : (
            <p className="mt-1 text-xs">
              Email was not sent from the system. Share this PIN manually:{" "}
              <strong>{pinFallbackCode || "Unavailable"}</strong>
            </p>
          )}
          {pinEmailError ? <p className="mt-1 text-xs">Email error: {pinEmailError}</p> : null}
        </div>
      ) : null}
      {pinRevoked ? (
        <div className="cg-alert cg-alert-warning mb-4">
          <p>
            {pinRevokedAlready ? "PIN was already disabled" : "PIN disabled"} for{" "}
            <strong>{pinRevokedRecipient || "participant"}</strong>
            {pinRevokedFormType ? ` (${pinRevokedFormType})` : ""}.
          </p>
          {pinRevokedAt ? <p className="text-xs">Disabled: {formatDateTime(pinRevokedAt)}</p> : null}
        </div>
      ) : null}

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[color:var(--muted)]">Current status</p>
            <h2 data-testid="case-current-status" className="mt-1 flex items-center gap-2 text-xl font-semibold">
              <span
                className="cg-status-dot"
                style={{ background: `var(--cg-status-${statusColorKey(caseItem.status)})` }}
              />
              {formatStatus(caseItem.status)}
            </h2>
          </div>
          <div className="text-right text-sm text-[color:var(--muted)]">
            <p>Assigned counsellor</p>
            {caseItem.assignedSpecialist ? (
              <Link
                href={`/admin/specialists/${caseItem.assignedSpecialist.id}`}
                className="font-medium text-[color:var(--foreground)] underline"
              >
                {caseItem.assignedSpecialist.name}
              </Link>
            ) : (
              <p className="font-medium text-[color:var(--foreground)]">Unassigned</p>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Participants
            </h3>
            <ul className="mt-2 space-y-2 text-sm">
              {caseItem.participants.map((participant) => (
                <li key={participant.id}>
                  <p className="font-medium">
                    {participant.client.firstName} {participant.client.lastName}
                  </p>
                  <p className="text-[color:var(--muted)]">{participant.client.email}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Case Context
            </h3>
            <p className="mt-2 text-sm">{caseItem.notes || "No notes"}</p>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              Counselling type: {caseItem.counsellingType || "unspecified"} • Intake source:{" "}
              {caseItem.intakeSource}
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Workflow: {caseItem.caseWorkflowTemplate?.name || "Not assigned"}
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Flags
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {caseItem.flags.length > 0 ? (
                caseItem.flags.map((flag) => (
                  <span
                    key={flag}
                    className="rounded-full bg-[color:var(--accent-soft)] px-2.5 py-1 text-xs"
                  >
                    {flag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[color:var(--muted)]">No flags</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
        <div className="flex items-center justify-between px-4 pt-1">
          <nav className="cg-tab-bar flex-1">
            {CASE_PANELS.map((panel) => (
              <Link key={panel.id} href={panelHref(panel.id)} className={tabClassName(panel.id === activePanel)}>
                {panel.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/admin/cases"
            className="ml-3 flex-shrink-0 rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-[color:var(--accent-soft)]"
          >
            Back to case list
          </Link>
        </div>
      </section>

      {activePanel === "assignment" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-12">
          <form action={autoAllocateCaseAction} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-1 xl:col-span-3">
            <h3 className="text-sm font-semibold">Automatic allocation</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              {assignmentMode === "auto"
                ? "Runs matching rules, checks workflow blocking steps, filters by submitted participant-availability overlap, queries scheduling provider availability, and books the earliest returned slot."
                : "Auto allocation is disabled in manual assignment mode. Use manual override to assign a counsellor."}
            </p>
            <input type="hidden" name="caseId" value={caseItem.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button
              type="submit"
              disabled={assignmentMode !== "auto"}
              className="mt-3 rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Run auto allocation
            </button>
          </form>

          <form action={transitionCaseAction} className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-1 xl:col-span-3">
            <h3 className="text-sm font-semibold">Transition status</h3>
            <input type="hidden" name="caseId" value={caseItem.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />

            <label htmlFor="targetStatus" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
              Next status
            </label>
            <select
              id="targetStatus"
              name="targetStatus"
              required
              className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
            >
              <option value="">Select...</option>
              {transitionOptions.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </select>

            <label htmlFor="reason" className="mt-2 block text-xs font-medium text-[color:var(--muted)]">
              Reason (optional)
            </label>
            <input
              id="reason"
              name="reason"
              className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
            />

            <button
              type="submit"
              className="mt-3 rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
            >
              Apply transition
            </button>
          </form>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-3 xl:col-span-12">
            <h3 className="text-sm font-semibold">Workflow assignment</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Scheduling is blocked until all required blocking workflow steps are completed.
            </p>

            <form action={assignCaseWorkflowAction} className="mt-3 space-y-2">
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <label htmlFor="caseWorkflowTemplateId" className="block text-xs font-medium">
                Workflow template
              </label>
              <select
                id="caseWorkflowTemplateId"
                name="caseWorkflowTemplateId"
                defaultValue={caseItem.caseWorkflowTemplateId || ""}
                required
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Select workflow...</option>
                {workflowTemplates.map((caseWorkflowTemplate) => (
                  <option key={caseWorkflowTemplate.id} value={caseWorkflowTemplate.id}>
                    {caseWorkflowTemplate.name} ({caseWorkflowTemplate.counsellingType})
                    {caseWorkflowTemplate.isDefault ? " [default]" : ""}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Assign workflow
              </button>
            </form>

            <ul className="mt-3 max-h-[24rem] space-y-2 overflow-y-auto pr-1 text-xs">
              {caseItem.workflowStates
                .slice()
                .sort((a, b) => a.step.sortOrder - b.step.sortOrder)
                .map((state) => {
                  const metadata =
                    state.metadata && typeof state.metadata === "object"
                      ? (state.metadata as Record<string, unknown>)
                      : null;
                  const submittedBy = readStringMetadata(metadata, "participantIdentifier");
                  const submittedAt = readStringMetadata(metadata, "ingestedAt");
                  const printedName = readStringMetadata(metadata, "printedName");
                  const signedDate = readStringMetadata(metadata, "signedDate");
                  const signatureType = readStringMetadata(metadata, "signatureType");
                  const details = readStringMetadata(metadata, "details");

                  return (
                    <li key={state.id} className="rounded-md border border-[color:var(--border)] p-2">
                      <p className="font-medium">{state.step.name}</p>
                      <p className="text-[color:var(--muted)]">
                        {state.step.type}
                        {state.step.formType ? ` • ${state.step.formType}` : ""}
                        {state.step.blocksScheduling ? " • blocks scheduling" : ""}
                      </p>
                      <p className="mt-1">
                        {state.status === "COMPLETED" ? "Completed" : "Pending"}
                      </p>
                      {state.status === "COMPLETED" && (submittedBy || submittedAt) ? (
                        <p className="mt-1 text-[color:var(--muted)]">
                          {submittedBy ? `Submitted by: ${submittedBy}` : ""}
                          {submittedBy && submittedAt ? " • " : ""}
                          {submittedAt ? `At: ${formatDateTime(submittedAt)}` : ""}
                        </p>
                      ) : null}
                      {state.status === "COMPLETED" && (printedName || signedDate || signatureType) ? (
                        <p className="mt-1 text-[color:var(--muted)]">
                          {printedName ? `Printed name: ${printedName}` : ""}
                          {printedName && signedDate ? " • " : ""}
                          {signedDate ? `Signed date: ${signedDate}` : ""}
                          {(printedName || signedDate) && signatureType ? " • " : ""}
                          {signatureType ? `Signature: ${signatureType}` : ""}
                        </p>
                      ) : null}
                      {state.status === "COMPLETED" && details ? (
                        <p className="mt-1 text-[color:var(--muted)]">Details: {details}</p>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:order-2 xl:col-span-6">
            <h3 className="text-sm font-semibold">Counsellor Availability + Manual Override</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Review provider availability and override assignment from one panel.
            </p>

            <form action={overrideAssignmentAction} className="mt-3 space-y-2 rounded-lg border border-[color:var(--border)] p-3">
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />

              <label htmlFor="specialistId" className="block text-xs font-medium">
                Counsellor
              </label>
              <select
                id="specialistId"
                name="specialistId"
                defaultValue={caseItem.assignedSpecialistId || ""}
                required
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Select counsellor...</option>
                {specialists.map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>
                    {specialist.name}
                    {specialist.supportsCouples ? " (couples)" : ""}
                  </option>
                ))}
              </select>

              <label htmlFor="reasonOverride" className="block text-xs font-medium">
                Override reason
              </label>
              <textarea
                id="reasonOverride"
                name="reason"
                required
                rows={2}
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              />

              <label htmlFor="matchingRuleOverride" className="block text-xs font-medium">
                Matching rule override note
              </label>
              <input
                id="matchingRuleOverride"
                name="matchingRuleOverride"
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                placeholder="Example: urgent counsellor continuity request"
              />

              <label htmlFor="preferredTimeBlock" className="block text-xs font-medium">
                Preferred time block (optional)
              </label>
              <select
                id="preferredTimeBlock"
                name="preferredTimeBlock"
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
              >
                <option value="">Use client-selected availability</option>
                <option value="MORNING">
                  Morning ({formatBlockWindow(defaultBlockWindows.MORNING)})
                </option>
                <option value="AFTERNOON">
                  Afternoon ({formatBlockWindow(defaultBlockWindows.AFTERNOON)})
                </option>
                <option value="EVENING">
                  Evening ({formatBlockWindow(defaultBlockWindows.EVENING)})
                </option>
              </select>

              <button
                type="submit"
                className="w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                Apply override
              </button>
            </form>

            {assignmentMode === "auto" ? (
              <>
                <p className="mt-2 text-xs text-[color:var(--muted)]">
                  Client availability submissions:{" "}
                  {specialistAvailability!.clientAvailability.participantsSubmitted}/
                  {specialistAvailability!.clientAvailability.requiredParticipants} • Overlap windows:{" "}
                  {specialistAvailability!.clientAvailability.overlapWindowCount}
                </p>
                {!specialistAvailability!.clientAvailability.hasOverlap &&
                specialistAvailability!.clientAvailability.reason ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {specialistAvailability!.clientAvailability.reason}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-[color:var(--muted)]">Assignment mode: manual</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Client time preferences:{" "}
                  {specialistAvailability!.clientAvailability.timePreferences.length > 0
                    ? specialistAvailability!.clientAvailability.timePreferences.join(", ")
                    : "None provided"}
                </p>
                {specialistAvailability!.clientAvailability.reason ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {specialistAvailability!.clientAvailability.reason}
                  </p>
                ) : null}
              </>
            )}

            {specialistAvailability!.specialists.length === 0 ? (
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                No active counsellors available for this case type.
              </p>
            ) : (
              <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1 text-xs">
                {specialistAvailability!.specialists.map((entry) => (
                  <li key={entry.specialistId} className="rounded-md border border-[color:var(--border)] p-2">
                    <p className="font-medium">
                      <Link href={`/admin/specialists/${entry.specialistId}`} className="underline">
                        {entry.specialistName}
                      </Link>
                      {entry.supportsCouples ? " • couples" : ""}
                    </p>
                    <p className="text-[color:var(--muted)]">
                      Next provider slot:{" "}
                      {entry.nextProviderSlot ? formatDateTime(entry.nextProviderSlot) : "None returned"}
                    </p>
                    <p className="text-[color:var(--muted)]">
                      {assignmentMode === "auto"
                        ? "Earliest slot matching client availability:"
                        : "Earliest slot matching client preferences:"}{" "}
                      {entry.nextClientMatchedSlot
                        ? formatDateTime(entry.nextClientMatchedSlot)
                        : assignmentMode === "auto"
                          ? "No overlap match"
                          : "No preference match"}
                    </p>
                    {entry.error ? <p className="mt-1 text-[color:var(--danger)]">{entry.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {activePanel === "intake" ? (
        <section className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">Intake Review</h3>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                Quick review of presenting concerns, availability, and full intake responses.
              </p>
            </div>
            <p className="text-xs text-[color:var(--muted)]">
              Source: {caseItem.intakeSource}
              {caseItem.intakeExternalId ? ` • External ID: ${caseItem.intakeExternalId}` : ""}
              {caseItem.intakeReceivedAt ? ` • Received: ${formatDateTime(caseItem.intakeReceivedAt)}` : ""}
            </p>
          </div>

          {intakeNotesSaved ? (
            <p className="cg-alert cg-alert-success mt-3">
              Intake review notes saved.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs font-semibold">
              Application type: {intakeProfileSnapshot?.applicationType || "Not provided"}
            </span>
            <span className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs font-semibold">
              Requested support: {intakeProfileSnapshot?.requestedSupport || "Not specified"}
            </span>
            <span className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs font-semibold">
              Location: {intakeProfileSnapshot?.preferredLocation || "Not provided"}
            </span>
            <span className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs font-semibold">
              Online: {intakeProfileSnapshot?.onlinePreference || "Not provided"}
            </span>
            {(intakeProfileSnapshot?.timePreferences || []).map((timePreference) => (
              <span
                key={`time-preference-chip:${timePreference}`}
                className="rounded-full border border-[color:var(--border)] bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              >
                {timePreference}
              </span>
            ))}
            {(intakeProfileSnapshot?.riskSignals || []).map((riskSignal) => (
              <span
                key={`risk-chip:${riskSignal}`}
                className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900"
              >
                {riskSignal}
              </span>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <div className="rounded-lg border border-[color:var(--border)] bg-white px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Primary Participant */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        Primary Participant
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {intakePrimaryRows.length > 0 ? (
                          intakePrimaryRows.map((row, index) => (
                            <div key={`primary-row:${row.path}:${index}`}>
                              <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                              <p>{row.response}</p>
                            </div>
                          ))
                        ) : (
                          <p className="col-span-2 text-[color:var(--muted)]">No participant data.</p>
                        )}
                      </div>
                    </div>

                    {intakeContactPrefRows.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {intakeContactPrefRows.map((row, index) => (
                          <div key={`contact-pref-row:${row.path}:${index}`}>
                            <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                            <p>{row.response}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {intakeSnapshotRows.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {intakeSnapshotRows.map((row, index) => (
                          <div key={`snapshot-row:${row.path}:${index}`}>
                            <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                            <p>{row.response}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Emergency Contact & GP */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        Emergency Contact
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {intakeEmergencyRows.length > 0 ? (
                          intakeEmergencyRows.map((row, index) => (
                            <div key={`emergency-row:${row.path}:${index}`}>
                              <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                              <p>{row.response}</p>
                            </div>
                          ))
                        ) : (
                          <p className="col-span-2 text-[color:var(--muted)]">Not provided</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        GP / Doctor
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {intakeGpRows.length > 0 ? (
                          intakeGpRows.map((row, index) => (
                            <div key={`gp-row:${row.path}:${index}`}>
                              <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                              <p>{row.response}</p>
                            </div>
                          ))
                        ) : (
                          <p className="col-span-2 text-[color:var(--muted)]">Not provided</p>
                        )}
                      </div>
                    </div>

                    {/* Secondary Participant (couples) */}
                    {intakeSecondaryRows.length > 0 ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                          Secondary Participant
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                          {intakeSecondaryRows.map((row, index) => (
                            <div key={`secondary-row:${row.path}:${index}`}>
                              <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                              <p>{row.response}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Presenting Issues */}
                {intakePresentingNonSafeguardingRows.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                      Presenting Issues
                    </p>
                    <div className="mt-2 grid gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
                      {intakePresentingNonSafeguardingRows.map((row, index) => (
                        <div key={`presenting-row:${row.path}:${index}`}>
                          <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                          <p>{row.response}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Safeguarding Responses */}
                {intakeSafeguardingRows.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Safeguarding Responses
                    </p>
                    <div className="mt-2 grid gap-x-6 gap-y-2 text-sm lg:grid-cols-2">
                      {intakeSafeguardingRows.map((row, index) => (
                        <div key={`safeguarding-row:${row.path}:${index}`}>
                          <p className="text-[11px] text-amber-700">{row.label}</p>
                          <p className="font-medium">{row.response}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Availability Preferences & Consent */}
                <div className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
                  {intakeAvailabilityRows.length > 0 ? (
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        Availability Preferences
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {intakeAvailabilityRows.map((row, index) => (
                          <div key={`availability-row:${row.path}:${index}`}>
                            <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                            <p>{row.response}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {intakeConsentRows.length > 0 ? (
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        Consent
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {intakeConsentRows.map((row, index) => (
                          <div key={`consent-row:${row.path}:${index}`}>
                            <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                            <p>{row.response}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Additional responses (if any) */}
                {intakeAdditionalRows.length > 0 ? (
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    {intakeAdditionalRows.map((row, index) => (
                      <div key={`additional-row:${row.path}:${index}`}>
                        <p className="text-[11px] text-[color:var(--muted)]">{row.label}</p>
                        <p>{row.response}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <form
              action={updateCaseIntakeReviewNotesAction}
              className="self-start rounded-lg border border-[color:var(--border)] bg-white p-4 xl:col-span-4"
            >
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={panelHref("intake")} />
              <label
                htmlFor="intakeReviewNotes"
                className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]"
              >
                Intake Review Notes (Ops)
              </label>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                Internal notes for risk review and triage. Not shown to clients.
              </p>
              <textarea
                id="intakeReviewNotes"
                name="notes"
                defaultValue={caseItem.intakeReviewNotes || ""}
                rows={8}
                placeholder="Add review summary, risk observations, and next actions..."
                className="mt-2 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="mt-2 rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-[color:var(--accent-soft)]"
              >
                Save Intake Notes
              </button>
            </form>
          </div>

          {intakePayloadJson ? (
            <details className="mt-3 rounded-lg border border-[color:var(--border)] p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Technical Payload (JSON)
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">
                {intakePayloadJson}
              </pre>
            </details>
          ) : null}
        </section>
      ) : null}

      {activePanel === "forms" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-12">
          <div
            data-testid="document-workflow"
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm xl:col-span-6"
          >
            <h3 className="text-lg font-semibold">Document workflow</h3>
            <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {caseItem.documents.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border)] p-3"
                >
                  <div>
                    <p className="font-medium">{document.template.name}</p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Trigger: {formatStatus(document.template.triggerStatus)}
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Status: {formatStatus(document.status)}
                    </p>
                  </div>
                  {document.status === "SENT" ? (
                    <form action={completeDocumentAction}>
                      <input type="hidden" name="documentId" value={document.id} />
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <button
                        type="submit"
                        className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent-soft)]"
                      >
                        Mark complete
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-emerald-700">
                      Completed {document.completedAt ? formatDateTime(document.completedAt) : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:col-span-6">
            <h3 className="text-sm font-semibold">Send Form PIN</h3>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Generate a time-sensitive PIN and access link before client-facing forms.
            </p>
            <form action={issueFormPinAction} className="mt-3 space-y-2">
              <input type="hidden" name="caseId" value={caseItem.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />

              <label htmlFor="participantIdentifier" className="block text-xs font-medium">
                Participant
              </label>
              <select
                id="participantIdentifier"
                name="participantIdentifier"
                className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                required
              >
                {caseItem.participants.map((participant) => (
                  <option key={participant.id} value={participant.client.email}>
                    {participant.client.firstName} {participant.client.lastName} ({participant.client.email})
                  </option>
                ))}
              </select>

              <FormPinRoutingFields initialFormType="INTAKE_FORM" initialFormPath="/intake" />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="expiresInHoursPin" className="block text-xs font-medium">
                    Expires (hours)
                  </label>
                  <input
                    id="expiresInHoursPin"
                    name="expiresInHours"
                    type="number"
                    min={1}
                    max={336}
                    defaultValue={formPinExpiresDefault}
                    className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="maxAttemptsPin" className="block text-xs font-medium">
                    Max attempts
                  </label>
                  <input
                    id="maxAttemptsPin"
                    name="maxAttempts"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={formPinMaxAttemptsDefault}
                    className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="sendEmail" defaultChecked />
                Send PIN by email now
              </label>

              <button
                type="submit"
                className="w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Issue PIN
              </button>
            </form>

            <div className="mt-3 border-t border-[color:var(--border)] pt-3">
              <p className="text-xs font-medium text-[color:var(--muted)]">Active PINs</p>
              {activePins.length === 0 ? (
                <p className="mt-1 text-xs text-[color:var(--muted)]">No active PIN links.</p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                  {activePins.map((pin) => (
                    <li key={pin.id} className="rounded-md border border-[color:var(--border)] p-2">
                      <p className="font-medium">
                        {pin.client.firstName} {pin.client.lastName} ({pin.client.email})
                      </p>
                      <p>
                        {pin.formType} • Expires {formatDateTime(pin.expiresAt)}
                      </p>
                      <p className="break-all">
                        Access:{" "}
                        <a href={`/forms/access/${pin.accessKey}`} className="underline">
                          /forms/access/{pin.accessKey}
                        </a>
                      </p>
                      <p className="text-[color:var(--muted)]">
                        Attempts: {pin.attemptCount}/{pin.maxAttempts}
                      </p>
                      <form action={revokeFormPinAction} className="mt-2">
                        <input type="hidden" name="pinId" value={pin.id} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <input type="hidden" name="reason" value="Disabled by operations user" />
                        <button
                          type="submit"
                          className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200"
                        >
                          Disable PIN
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activePanel === "history" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-12">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm xl:col-span-4">
            <h3 className="text-sm font-semibold">Session timeline</h3>
            <ul className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto pr-1 text-sm">
              {caseItem.sessions.length === 0 ? (
                <li className="text-[color:var(--muted)]">No sessions scheduled.</li>
              ) : (
                caseItem.sessions.map((session) => (
                  <li key={session.id} className="rounded-md border border-[color:var(--border)] p-2">
                    <p className="font-medium">{formatDateTime(session.providerStartTime)}</p>
                    <p>
                      <Link href={`/admin/specialists/${session.specialist.id}`} className="underline">
                        {session.specialist.name}
                      </Link>
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                    <p className="text-xs text-[color:var(--muted)]">Booking: {session.providerBookingId}</p>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm xl:col-span-8">
            <h3 className="text-lg font-semibold">Audit log</h3>
            <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1 text-sm">
              {caseItem.auditLogs.map((log) => (
                <li key={log.id} className="rounded-md border border-[color:var(--border)] p-3">
                  <p className="font-medium">{log.action}</p>
                  <p className="text-xs text-[color:var(--muted)]">{formatDateTime(log.createdAt)}</p>
                  <p className="text-xs text-[color:var(--muted)]">
                    By: {log.user?.name || log.user?.email || "System"}
                  </p>
                  {log.details ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </AuthenticatedShell>
  );
}
