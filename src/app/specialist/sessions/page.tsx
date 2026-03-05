import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatRelativeTime, formatStatus, isToday, isWithin24Hours } from "@/lib/format";
import { getUpcomingSessionsForSpecialist, getPendingProposalsForSpecialist } from "@/lib/case-service";
import { ProposalResponse } from "@/components/specialist/proposal-response";
import { SessionTimeResponse } from "@/components/specialist/session-time-response";

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
          { href: "/specialist/clients", label: "My Clients" },
          { href: "/specialist/availability", label: "My Availability" },
        ]}
      >
        <p className="cg-alert cg-alert-error">
          Contact operations to link your account to a counsellor profile.
        </p>
      </AuthenticatedShell>
    );
  }

  const sessions = await getUpcomingSessionsForSpecialist(user.specialistId);
  const proposals = await getPendingProposalsForSpecialist(user.specialistId);

  const pendingTimeProposals = await db.sessionTimeProposal.findMany({
    where: { specialistId: user.specialistId, status: "PENDING" },
    include: {
      case: {
        select: {
          id: true,
          reference: true,
          counsellingType: true,
          participants: {
            select: {
              client: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      },
    },
    orderBy: { proposedStartTime: "asc" },
  });

  // Group time proposals by caseId
  const timeProposalsByCase = new Map<
    string,
    {
      caseId: string;
      caseReference: string;
      counsellingType: string | null;
      participantNames: string;
      proposals: typeof pendingTimeProposals;
    }
  >();
  for (const proposal of pendingTimeProposals) {
    const existing = timeProposalsByCase.get(proposal.caseId);
    if (existing) {
      existing.proposals.push(proposal);
    } else {
      const names = proposal.case.participants
        .map((p) => `${p.client.firstName} ${p.client.lastName}`)
        .join(" & ");
      timeProposalsByCase.set(proposal.caseId, {
        caseId: proposal.caseId,
        caseReference: proposal.case.reference,
        counsellingType: proposal.case.counsellingType,
        participantNames: names,
        proposals: [proposal],
      });
    }
  }

  return (
    <AuthenticatedShell
      title="My Upcoming Sessions"
      subtitle="Briefing view with participants, submitted docs, flags, and session history."
      userName={user.name}
      role={user.role}
      currentPath="/specialist/sessions"
      navItems={[
        { href: "/specialist/sessions", label: "My Sessions" },
        { href: "/specialist/clients", label: "My Clients" },
        { href: "/specialist/availability", label: "My Availability" },
      ]}
    >
      <div className="grid gap-4">
        {proposals.length > 0 && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-amber-900">
              Pending Case Proposals ({proposals.length})
            </h2>
            <p className="mt-1 text-xs text-amber-700">
              These cases have been proposed to you. Please review and respond.
            </p>
            <div className="mt-4 space-y-4">
              {proposals.map((proposal) => {
                const participantNames = proposal.case.participants
                  .map((p) => `${p.client.firstName} ${p.client.lastName}`)
                  .join(" & ");

                return (
                  <div
                    key={proposal.id}
                    className="rounded-xl border border-amber-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                          {proposal.case.reference}
                        </p>
                        <p className="mt-1 font-medium">{participantNames}</p>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">
                          {proposal.case.counsellingType || "Individual"} counselling
                        </p>
                      </div>
                      <div className="text-right text-xs text-[color:var(--muted)]">
                        <p>Proposed by {proposal.proposedBy?.name || "Operations"}</p>
                        <p>{formatDateTime(proposal.createdAt)}</p>
                      </div>
                    </div>

                    {proposal.proposalNote && (
                      <div className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-3">
                        <p className="text-xs font-semibold text-[color:var(--muted)]">Note from operations</p>
                        <p className="mt-1 text-sm">{proposal.proposalNote}</p>
                      </div>
                    )}

                    {proposal.case.notes && (
                      <p className="mt-2 text-sm text-[color:var(--muted)]">
                        Case notes: {proposal.case.notes}
                      </p>
                    )}

                    {proposal.case.flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {proposal.case.flags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}

                    <ProposalResponse
                      proposalId={proposal.id}
                      redirectTo="/specialist/sessions"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {timeProposalsByCase.size > 0 && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-amber-900">
              Pending Session Time Proposals ({pendingTimeProposals.length})
            </h2>
            <p className="mt-1 text-xs text-amber-700">
              Operations has proposed session times for the following cases. Please review and respond.
            </p>
            <div className="mt-4 space-y-4">
              {Array.from(timeProposalsByCase.values()).map((group) => (
                <div
                  key={group.caseId}
                  className="rounded-xl border border-amber-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                        {group.caseReference}
                      </p>
                      <p className="mt-1 font-medium">{group.participantNames}</p>
                      <p className="mt-1 text-sm text-[color:var(--muted)]">
                        {group.counsellingType || "Individual"} counselling
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {group.proposals.length} slot{group.proposals.length !== 1 ? "s" : ""} proposed
                    </span>
                  </div>

                  <SessionTimeResponse
                    proposals={group.proposals}
                    caseReference={group.caseReference}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {sessions.length === 0 ? (
          <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
            <div className="cg-empty-state py-12">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
              <p className="text-sm font-medium">No upcoming sessions</p>
              <p className="mt-1 text-xs">When sessions are scheduled for you, they will appear here.</p>
              <Link
                href="/specialist/availability"
                className="mt-3 rounded-full border border-[color:var(--border)] px-4 py-1.5 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
              >
                Check your availability
              </Link>
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
