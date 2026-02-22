import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { getSessionBriefingForSpecialist } from "@/lib/case-service";
import { formatDateTime, formatStatus } from "@/lib/format";

type SessionBriefingPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionBriefingPage({ params }: SessionBriefingPageProps) {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    notFound();
  }

  const { id } = await params;
  const session = await getSessionBriefingForSpecialist(id, user.specialistId);

  if (!session) {
    notFound();
  }

  const previousSessions = session.case.sessions.filter(
    (item) => item.id !== session.id && item.providerStartTime < session.providerStartTime,
  );

  return (
    <AuthenticatedShell
      title={`Session Briefing: ${session.case.reference}`}
      subtitle="Detailed pre-session packet for counsellor execution."
      userName={user.name}
      role={user.role}
      currentPath="/specialist/sessions"
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/clients", label: "My Clients" },
        { href: "/specialist/availability", label: "My Availability" },
      ]}
    >
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[color:var(--muted)]">Scheduled time</p>
            <h2 className="text-2xl font-semibold">{formatDateTime(session.providerStartTime)}</h2>
            <p className="text-sm text-[color:var(--muted)]">{formatStatus(session.status)}</p>
            <p className="text-xs text-[color:var(--muted)]">Booking: {session.providerBookingId}</p>
          </div>
          <Link
            href="/specialist/sessions"
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
          >
            Back to sessions
          </Link>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Participants
            </h3>
            <ul className="mt-2 space-y-2 text-sm">
              {session.case.participants.map((participant) => (
                <li key={participant.id} className="rounded-md border border-[color:var(--border)] p-3">
                  <p className="font-medium">
                    {participant.client.firstName} {participant.client.lastName}
                  </p>
                  <p className="text-[color:var(--muted)]">{participant.client.email}</p>
                  {participant.client.phone ? (
                    <p className="text-[color:var(--muted)]">{participant.client.phone}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Case notes and flags
            </h3>
            <p className="mt-2 text-sm">{session.case.notes || "No notes provided."}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {session.case.flags.length > 0 ? (
                session.case.flags.map((flag) => (
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

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Document status
            </h3>
            <ul className="mt-2 space-y-2 text-sm">
              {session.case.documents.map((document) => (
                <li key={document.id} className="rounded-md border border-[color:var(--border)] p-3">
                  <p className="font-medium">{document.template.name}</p>
                  <p className="text-[color:var(--muted)]">{formatStatus(document.status)}</p>
                  {document.completedAt ? (
                    <p className="text-[color:var(--muted)]">
                      Completed: {formatDateTime(document.completedAt)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Previous sessions
            </h3>
            {previousSessions.length === 0 ? (
              <p className="mt-2 text-sm text-[color:var(--muted)]">No prior sessions for this case.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {previousSessions.map((prior) => (
                  <li key={prior.id} className="rounded-md border border-[color:var(--border)] p-3">
                    <p className="font-medium">{formatDateTime(prior.providerStartTime)}</p>
                    <p className="text-[color:var(--muted)]">{prior.specialist.name}</p>
                    <p className="text-[color:var(--muted)]">{formatStatus(prior.status)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </AuthenticatedShell>
  );
}
