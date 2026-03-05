export function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type StatusColorKey = "new" | "review" | "matched" | "scheduled" | "active" | "complete" | "blocked";

export function statusColorKey(caseStatus: string): StatusColorKey {
  switch (caseStatus) {
    case "NEW":
      return "new";
    case "AWAITING_REVIEW":
    case "COUNSELLOR_PROPOSED":
    case "SLOT_PROPOSED":
      return "review";
    case "MATCHED":
    case "COUNSELLOR_ACCEPTED":
    case "SLOT_CONFIRMED":
    case "AGREEMENT_PENDING":
    case "READY_TO_SCHEDULE":
      return "matched";
    case "SCHEDULED":
      return "scheduled";
    case "IN_SESSION":
      return "active";
    case "COMPLETED":
    case "CLOSED":
      return "complete";
    default:
      return "new";
  }
}

export function statusDotColor(caseStatus: string): string {
  const key = statusColorKey(caseStatus);
  return `var(--cg-status-${key})`;
}

export function statusBgColor(caseStatus: string): string {
  const key = statusColorKey(caseStatus);
  return `var(--cg-status-${key}-bg)`;
}

export function statusBorderColor(caseStatus: string): string {
  const key = statusColorKey(caseStatus);
  return `var(--cg-status-${key}-border)`;
}

export type StatusFilterGroup = "all" | "needs_review" | "in_progress" | "scheduled" | "completed";

export function statusFilterGroup(caseStatus: string): StatusFilterGroup {
  switch (caseStatus) {
    case "NEW":
    case "AWAITING_REVIEW":
      return "needs_review";
    case "MATCHED":
    case "COUNSELLOR_PROPOSED":
    case "COUNSELLOR_ACCEPTED":
    case "SLOT_PROPOSED":
    case "SLOT_CONFIRMED":
    case "AGREEMENT_PENDING":
    case "READY_TO_SCHEDULE":
      return "in_progress";
    case "SCHEDULED":
    case "IN_SESSION":
      return "scheduled";
    case "COMPLETED":
    case "CLOSED":
      return "completed";
    default:
      return "needs_review";
  }
}

export function formatRelativeTime(date: Date | string): string {
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMinutes < 0) {
    return "past";
  }

  if (diffMinutes < 60) {
    return `in ${diffMinutes}m`;
  }

  if (diffHours < 24) {
    return `in ${diffHours}h`;
  }

  if (diffDays === 1) {
    return "tomorrow";
  }

  return `in ${diffDays}d`;
}

export function isToday(date: Date | string): boolean {
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  );
}

export function isWithin24Hours(date: Date | string): boolean {
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  return diffMs > 0 && diffMs < 86400000;
}
