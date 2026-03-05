import { UserRole } from "@prisma/client";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime, formatStatus } from "@/lib/format";
import { getPendingProposalsForSpecialist, getPendingSlotProposalsForSpecialist } from "@/lib/case-service";
import { RespondToCaseProposalForm } from "./respond-form";
import { RespondToSlotForm } from "./slot-respond-form";

const SPECIALIST_NAV = [
  { href: "/specialist/sessions", label: "My Sessions" },
  { href: "/specialist/reviews", label: "Pending Reviews" },
  { href: "/specialist/clients", label: "My Clients" },
  { href: "/specialist/availability", label: "My Availability" },
];

export default async function SpecialistReviewsPage() {
  const user = await requirePageUser([UserRole.SPECIALIST]);

  if (!user.specialistId) {
    return (
      <AuthenticatedShell
        title="Pending Reviews"
        subtitle="No counsellor profile linked to your account."
        userName={user.name}
        role={user.role}
        currentPath="/specialist/reviews"
        navItems={SPECIALIST_NAV}
      >
        <p className="cg-alert cg-alert-error">
          Contact operations to link your account to a counsellor profile.
        </p>
      </AuthenticatedShell>
    );
  }

  const [caseProposals, slotProposals] = await Promise.all([
    getPendingProposalsForSpecialist(user.specialistId),
    getPendingSlotProposalsForSpecialist(user.specialistId),
  ]);

  return (
    <AuthenticatedShell
      title="Pending Reviews"
      subtitle="Cases and time slots waiting for your response."
      userName={user.name}
      role={user.role}
      currentPath="/specialist/reviews"
      navItems={SPECIALIST_NAV}
    >
      <div className="space-y-6">
        {/* Case Proposals */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Case Proposals ({caseProposals.length})
          </h2>

          {caseProposals.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-center shadow-sm">
              <p className="text-sm text-[color:var(--muted)]">No pending case proposals.</p>
            </div>
          ) : (
            <div className="mt-3 grid gap-4">
              {caseProposals.map((proposal) => {
                const participants = proposal.case.participants;
                const participantNames = participants
                  .map((p) => `${p.client.firstName} ${p.client.lastName}`)
                  .join(", ");

                return (
                  <div
                    key={proposal.id}
                    className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-base font-semibold">
                          Case {proposal.case.reference}
                        </h3>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">
                          {proposal.case.counsellingType
                            ? formatStatus(proposal.case.counsellingType)
                            : "Counselling"}{" "}
                          &middot; {participants.length} participant{participants.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        Pending
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                          Participants
                        </p>
                        <p className="mt-1 text-sm">{participantNames}</p>
                      </div>
                      {proposal.case.flags.length > 0 ? (
                        <div className="rounded-lg border border-[color:var(--border)] p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                            Flags
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {proposal.case.flags.map((flag) => (
                              <span
                                key={flag}
                                className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {proposal.proposalNote ? (
                      <div className="mt-3 rounded-lg bg-[color:var(--accent-soft)] p-3">
                        <p className="text-xs font-semibold text-[color:var(--muted)]">Note from operations</p>
                        <p className="mt-1 text-sm">{proposal.proposalNote}</p>
                      </div>
                    ) : null}

                    <div className="mt-3 text-xs text-[color:var(--muted)]">
                      Proposed {formatDateTime(proposal.createdAt)}
                      {proposal.proposedBy ? <> by {proposal.proposedBy.name}</> : null}
                    </div>

                    <RespondToCaseProposalForm caseId={proposal.case.id} />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Slot Proposals */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Slot Proposals ({slotProposals.length})
          </h2>

          {slotProposals.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-center shadow-sm">
              <p className="text-sm text-[color:var(--muted)]">No pending slot proposals.</p>
            </div>
          ) : (
            <div className="mt-3 grid gap-4">
              {slotProposals.map((slot) => (
                <div
                  key={slot.id}
                  className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-semibold">
                        Case {slot.case.reference}
                      </h3>
                      <p className="mt-1 text-sm text-[color:var(--muted)]">
                        {slot.case.counsellingType
                          ? formatStatus(slot.case.counsellingType)
                          : "Counselling"}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      Awaiting response
                    </span>
                  </div>

                  <div className="mt-3 rounded-lg border border-[color:var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                      Proposed time
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {formatDateTime(slot.proposedStartTime)} &ndash; {formatDateTime(slot.proposedEndTime)}
                    </p>
                  </div>

                  {slot.proposalNote ? (
                    <div className="mt-3 rounded-lg bg-[color:var(--accent-soft)] p-3">
                      <p className="text-xs font-semibold text-[color:var(--muted)]">Note</p>
                      <p className="mt-1 text-sm">{slot.proposalNote}</p>
                    </div>
                  ) : null}

                  <RespondToSlotForm caseId={slot.case.id} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AuthenticatedShell>
  );
}
