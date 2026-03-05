import { formatDateTime } from "@/lib/format";

type IntakeParticipant = {
  role: string;
  client: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
};

type IntakeDataDisplayProps = {
  intakeFormData: Record<string, unknown> | null;
  intakeReceivedAt: Date | null;
  intakeSource: string;
  participants: IntakeParticipant[];
  notes: string | null;
  flags: string[];
};

function formatIntakeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "string") {
    // Detect ISO date strings
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      try {
        return formatDateTime(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatIntakeValue(item)).join(", ");
  }

  return JSON.stringify(value);
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];

  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${rawKey}` : rawKey;

    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    if (
      typeof rawValue === "object" &&
      !Array.isArray(rawValue) &&
      rawValue !== null
    ) {
      const nested = flattenObject(
        rawValue as Record<string, unknown>,
        fullKey,
      );
      rows.push(...nested);
    } else {
      const formatted = formatIntakeValue(rawValue);
      if (!formatted) {
        continue;
      }
      rows.push({
        key: fullKey,
        label: formatKeyLabel(fullKey),
        value: formatted,
      });
    }
  }

  return rows;
}

function formatKeyLabel(key: string): string {
  // Take the last segment of the dot path
  const segments = key.split(".");
  const last = segments[segments.length - 1];

  // Convert camelCase to spaced words and capitalise first letter
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!spaced) {
    return key;
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function sourceBadgeClasses(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes("online") || lower.includes("web") || lower.includes("form")) {
    return "border-emerald-300 bg-emerald-100 text-emerald-800";
  }
  if (lower.includes("phone") || lower.includes("call")) {
    return "border-blue-300 bg-blue-100 text-blue-800";
  }
  if (lower.includes("email")) {
    return "border-purple-300 bg-purple-100 text-purple-800";
  }
  if (lower.includes("referral") || lower.includes("partner")) {
    return "border-indigo-300 bg-indigo-100 text-indigo-800";
  }
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

export function IntakeDataDisplay({
  intakeFormData,
  intakeReceivedAt,
  intakeSource,
  participants,
  notes,
  flags,
}: IntakeDataDisplayProps) {
  const flatRows =
    intakeFormData && typeof intakeFormData === "object"
      ? flattenObject(intakeFormData as Record<string, unknown>)
      : [];

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold">Intake Submission</h3>

      {/* Meta: received at + source */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
        {intakeReceivedAt ? (
          <span>Received: {formatDateTime(intakeReceivedAt)}</span>
        ) : null}
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sourceBadgeClasses(intakeSource)}`}
        >
          {intakeSource}
        </span>
      </div>

      {/* Flags */}
      {flags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {flags.map((flag) => (
            <span
              key={flag}
              className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900"
            >
              {flag}
            </span>
          ))}
        </div>
      ) : null}

      {/* Participants */}
      {participants.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Participants
          </p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {participants.map((participant) => (
              <div
                key={`${participant.role}-${participant.client.email}`}
                className="rounded-lg border border-[color:var(--border)] bg-white p-2.5"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)]">
                  {participant.role}
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {participant.client.firstName} {participant.client.lastName}
                </p>
                <p className="text-xs text-[color:var(--muted)]">
                  {participant.client.email}
                </p>
                {participant.client.phone ? (
                  <p className="text-xs text-[color:var(--muted)]">
                    {participant.client.phone}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Notes */}
      {notes ? (
        <div className="mt-3 rounded-lg border border-[color:var(--border)] bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Case Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{notes}</p>
        </div>
      ) : null}

      {/* Intake Form Data */}
      {flatRows.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Submitted Responses
          </p>
          <div className="mt-1.5 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            {flatRows.map((row) => (
              <div key={row.key}>
                <p className="text-[11px] text-[color:var(--muted)]">
                  {row.label}
                </p>
                <p className="break-words">{row.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          No structured intake data available.
        </p>
      )}
    </div>
  );
}
