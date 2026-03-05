import Link from "next/link";
import { db } from "@/lib/db";
import { BrandWordmark } from "@/components/brand-wordmark";
import { SessionTimeConfirmation } from "@/components/client/session-time-confirmation";

type ConfirmSessionPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConfirmSessionPage({ searchParams }: ConfirmSessionPageProps) {
  const params = await searchParams;
  const proposalId = typeof params.proposalId === "string" ? params.proposalId : null;
  const token = typeof params.token === "string" ? params.token : null;

  if (!proposalId || !token) {
    return (
      <div className="min-h-screen">
        <section className="cg-section cg-shell-hero cg-theme-dark-bold">
          <div className="cg-container cg-gutters">
            <header className="mx-auto w-full max-w-4xl py-2 text-white">
              <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
                <BrandWordmark className="h-auto w-full" priority />
              </div>

              <p className="cg-nav-label mt-3 text-center text-white/85">Session Confirmation</p>
              <h1 className="mt-1 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
                Invalid Link
              </h1>
              <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
                This confirmation link is missing required information. Please use the link from your
                email.
              </p>
            </header>
          </div>
        </section>

        <section className="cg-section cg-theme-light">
          <div className="cg-container cg-gutters">
            <section className="cg-surface-card mx-auto w-full max-w-2xl p-6 text-center">
              <p className="text-sm text-[color:var(--muted)]">
                If you continue to have trouble, please contact the operations team for assistance.
              </p>
            </section>
          </div>
        </section>
      </div>
    );
  }

  const proposal = await db.sessionTimeProposal.findUnique({
    where: { id: proposalId },
    include: {
      case: true,
      specialist: true,
    },
  });

  // Validate the cryptographic token against the stored value
  if (!proposal || !proposal.confirmToken || proposal.confirmToken !== token) {
    return (
      <div className="min-h-screen">
        <section className="cg-section cg-shell-hero cg-theme-dark-bold">
          <div className="cg-container cg-gutters">
            <header className="mx-auto w-full max-w-4xl py-2 text-white">
              <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
                <BrandWordmark className="h-auto w-full" priority />
              </div>

              <p className="cg-nav-label mt-3 text-center text-white/85">Session Confirmation</p>
              <h1 className="mt-1 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
                Invalid Link
              </h1>
              <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
                This confirmation link is not valid. Please use the link from your email.
              </p>
            </header>
          </div>
        </section>

        <section className="cg-section cg-theme-light">
          <div className="cg-container cg-gutters">
            <section className="cg-surface-card mx-auto w-full max-w-2xl p-6 text-center">
              <p className="text-sm text-[color:var(--muted)]">
                If you continue to have trouble, please contact the operations team for assistance.
              </p>
            </section>
          </div>
        </section>
      </div>
    );
  }

  if (
    proposal.status !== "SPECIALIST_ACCEPTED" ||
    proposal.case.status !== "SLOT_CONFIRMED"
  ) {
    return (
      <div className="min-h-screen">
        <section className="cg-section cg-shell-hero cg-theme-dark-bold">
          <div className="cg-container cg-gutters">
            <header className="mx-auto w-full max-w-4xl py-2 text-white">
              <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
                <BrandWordmark className="h-auto w-full" priority />
              </div>

              <p className="cg-nav-label mt-3 text-center text-white/85">Session Confirmation</p>
              <h1 className="mt-1 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
                Session Already Confirmed
              </h1>
              <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
                This session time has already been confirmed or the link has expired. No further
                action is needed.
              </p>
            </header>
          </div>
        </section>

        <section className="cg-section cg-theme-light">
          <div className="cg-container cg-gutters">
            <section className="cg-surface-card mx-auto w-full max-w-2xl p-6 text-center">
              <p className="text-sm text-[color:var(--muted)]">
                If you believe this is an error, please contact the operations team for assistance.
              </p>
            </section>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-shell-hero cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <header className="mx-auto w-full max-w-4xl py-2 text-white">
            <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
              <BrandWordmark className="h-auto w-full" priority />
            </div>

            <p className="cg-nav-label mt-3 text-center text-white/85">Session Confirmation</p>
            <h1 className="mt-1 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
              Confirm Your Session
            </h1>
            <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
              Case Reference: {proposal.case.reference}
            </p>
          </header>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <section className="cg-surface-card mx-auto w-full max-w-2xl p-6">
            <SessionTimeConfirmation
              proposalId={proposal.id}
              token={token}
              specialistName={proposal.specialist.name}
              startTime={proposal.proposedStartTime.toISOString()}
              endTime={proposal.proposedEndTime.toISOString()}
              caseReference={proposal.case.reference}
            />
          </section>

          <footer className="mx-auto mt-5 w-full max-w-2xl text-sm text-[color:var(--muted)]">
            If you have any questions, please contact the operations team.
          </footer>
        </div>
      </section>
    </div>
  );
}
