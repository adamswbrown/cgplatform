import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime, formatRelativeTime, formatStatus, isToday, isWithin24Hours } from "@/lib/format";
import { getUpcomingSessionsForSpecialist } from "@/lib/case-service";

export default async function SpecialistSessionsPage() {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    return (
      <AuthenticatedShell
        title="Counsellor Dashboard"
        subtitle="No counsellor profile linked to your account."
        userName={user.name}
        role={user.role}
        currentPath="/specialist/sessions"
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

  const sessions = await getUpcomingSessionsForSpecialist(user.specialistId);

  return (
    <AuthenticatedShell
      title="My Upcoming Sessions"
      subtitle="Briefing view with participants, submitted docs, flags, and session history."
      userName={user.name}
      role={user.role}
      currentPath="/specialist/sessions"
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/reviews", label: "Pending Reviews" },
        { href: "/specialist/clients", label: "My Clients" },
      ]}
    >
      <div className="grid gap-4">
        {sessions.length === 0 ? (
          <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
            <div className="cg-empty-state py-12">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
              <p className="text-sm font-medium">No upcoming sessions</p>
              <p className="mt-1 text-xs">When sessions are scheduled for you, they will appear here.</p>
              <p className="mt-3 text-xs text-[color:var(--muted)]">
                Contact operations if you have questions about your schedule.
              </p>
            </div>
          </section>
        ) : (
          sessions.map((session) => {
            const submittedDocs = session.case.documents.filter(
              (document) => document.status === "COMPLETED",
            );
            const totalRequiredDocs = session.case.documents.filter((doc) => doc.required).length;
            const previousSessions = session.case.sessions.filter(
              (item) => item.providerStartTime < session.providerStartTime,
            );
            const sessionDate = new Date(session.providerStartTime);
            const imminent = isWithin24Hours(sessionDate);
            const today = isToday(sessionDate);
            const relativeTime = formatRelativeTime(sessionDate);
            const urgencyClass = imminent
              ? "cg-session-imminent"
              : today
                ? "cg-session-today"
                : "";

            return (
              <section
                key={session.id}
                className={`rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm ${urgencyClass}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                        {session.case.reference}
                      </p>
                      {today ? (
                        <span className="rounded-full bg-[color:var(--cg-dark-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          Today
                        </span>
                      ) : null}
                      {imminent && !today ? (
                        <span className="rounded-full bg-[color:var(--cg-status-review-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--cg-status-review)]">
                          {relativeTime}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="text-xl font-semibold">{formatDateTime(session.providerStartTime)}</h2>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-sm text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                      {!imminent && !today ? (
                        <span className="text-xs text-[color:var(--muted)]">{relativeTime}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Link
                      href={`/specialist/sessions/${session.id}`}
                      className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
                    >
                      Open briefing
                    </Link>
                    {totalRequiredDocs > 0 ? (
                      <span className={`text-xs font-medium ${submittedDocs.length >= totalRequiredDocs ? "text-[color:var(--cg-status-matched)]" : "text-[color:var(--cg-status-review)]"}`}>
                        {submittedDocs.length >= totalRequiredDocs ? "Docs complete" : `${submittedDocs.length}/${totalRequiredDocs} docs`}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold">Participants</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {session.case.participants.map((participant) => (
                        <li key={participant.id}>
                          {participant.client.firstName} {participant.client.lastName}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Case notes</h3>
                    <p className="mt-2 text-sm">{session.case.notes || <span className="text-[color:var(--muted)]">No notes provided.</span>}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Submitted documents</h3>
                    {submittedDocs.length === 0 ? (
                      <p className="mt-2 text-sm text-[color:var(--muted)]">None yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {submittedDocs.map((doc) => (
                          <li key={doc.id} className="flex items-center gap-1.5">
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-[color:var(--cg-status-matched)]"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                            {doc.template.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Flags & history</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {session.case.flags.length > 0 ? (
                        session.case.flags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded-full bg-[color:var(--accent-soft)] px-2 py-1 text-xs"
                          >
                            {flag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-[color:var(--muted)]">No flags</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-[color:var(--muted)]">
                      Previous sessions: {previousSessions.length}
                    </p>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </AuthenticatedShell>
  );
}
