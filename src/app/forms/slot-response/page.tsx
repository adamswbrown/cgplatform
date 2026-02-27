import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { db } from "@/lib/db";
import { requireFormAccessOrRedirect } from "@/lib/form-access";
import { formatDateTime } from "@/lib/format";
import { SlotResponseForm } from "./slot-response-form";

type SlotResponsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SlotResponsePage({ searchParams }: SlotResponsePageProps) {
  const query = await searchParams;
  const accessKey = typeof query.accessKey === "string" ? query.accessKey : "";

  if (!accessKey) {
    return (
      <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
        <div className="mx-auto max-w-[520px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
          <BrandWordmark className="mx-auto h-14 w-auto" />
          <h1 className="mt-6 text-2xl font-bold text-[color:var(--cg-ink)]">
            Access key required
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            This secure form can only be opened from your emailed access link.
          </p>
          <p className="mt-4 text-xs">
            <Link href="/intake" className="underline">
              Back to intake
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const nextPath = `/forms/slot-response?accessKey=${encodeURIComponent(accessKey)}`;
  const session = await requireFormAccessOrRedirect({
    accessKey,
    formType: "SLOT_RESPONSE",
    nextPath,
  });

  // Find the active slot proposal
  const slot = await db.slotProposal.findFirst({
    where: {
      caseId: session.caseId,
      status: "PENDING_CLIENT",
    },
    include: {
      specialist: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!slot) {
    return (
      <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
        <div className="mx-auto max-w-[520px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
          <BrandWordmark className="mx-auto h-14 w-auto" />
          <h1 className="mt-6 text-2xl font-bold text-[color:var(--cg-ink)]">
            No pending appointment
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            There is no appointment currently awaiting your response. If you believe this is an error, please contact the office.
          </p>
        </div>
      </main>
    );
  }

  const counsellorFirstName = slot.specialist.name.split(" ")[0];

  return (
    <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
      <div className="mx-auto max-w-[600px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
        <BrandWordmark className="mx-auto h-14 w-auto" />
        <h1 className="mt-6 text-2xl font-bold text-[color:var(--cg-ink)]">
          Your Counselling Appointment
        </h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Case: <strong>{session.caseReference}</strong>
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          {session.participantName}
        </p>

        <div className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--cg-light-accent)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Proposed appointment
          </p>
          <p className="mt-2 text-lg font-semibold">
            {formatDateTime(slot.proposedStartTime)}
          </p>
          <p className="text-sm text-[color:var(--muted)]">
            to {formatDateTime(slot.proposedEndTime)}
          </p>
          <p className="mt-2 text-sm">
            With counsellor: <strong>{counsellorFirstName}</strong>
          </p>
        </div>

        <SlotResponseForm
          caseId={session.caseId}
          accessKey={accessKey}
          proposedStartTime={slot.proposedStartTime.toISOString()}
          proposedEndTime={slot.proposedEndTime.toISOString()}
        />
      </div>
    </main>
  );
}
