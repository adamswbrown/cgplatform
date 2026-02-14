import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime, formatStatus } from "@/lib/format";
import { getUpcomingSessionsForSpecialist } from "@/lib/case-service";

export default async function SpecialistSessionsPage() {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    return (
      <AuthenticatedShell
        title="Specialist Dashboard"
        subtitle="No specialist profile linked to your account."
        userName={user.name}
        role={user.role}
        navItems={[
          { href: "/specialist/sessions", label: "My Sessions" },
          { href: "/specialist/clients", label: "My Clients" },
        ]}
      >
        <p className="rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          Contact operations to link your account to a specialist profile.
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
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/clients", label: "My Clients" },
      ]}
    >
      <div className="grid gap-4">
        {sessions.length === 0 ? (
          <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--muted)]">No upcoming sessions.</p>
          </section>
        ) : (
          sessions.map((session) => {
            const submittedDocs = session.case.documents.filter(
              (document) => document.status === "COMPLETED",
            );
            const previousSessions = session.case.sessions.filter(
              (item) => item.providerStartTime < session.providerStartTime,
            );

            return (
              <section
                key={session.id}
                className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      {session.case.reference}
                    </p>
                    <h2 className="text-xl font-semibold">{formatDateTime(session.providerStartTime)}</h2>
                    <p className="text-sm text-[color:var(--muted)]">{formatStatus(session.status)}</p>
                  </div>
                  <Link
                    href={`/specialist/sessions/${session.id}`}
                    className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
                  >
                    Open briefing
                  </Link>
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
                    <p className="mt-2 text-sm">{session.case.notes || "No notes provided."}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Submitted documents</h3>
                    {submittedDocs.length === 0 ? (
                      <p className="mt-2 text-sm text-[color:var(--muted)]">None yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {submittedDocs.map((doc) => (
                          <li key={doc.id}>{doc.template.name}</li>
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
