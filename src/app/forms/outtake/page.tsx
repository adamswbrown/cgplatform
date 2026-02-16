import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { WorkflowCompletionForm } from "@/components/forms/workflow-completion-form";
import { requireFormAccessOrRedirect } from "@/lib/form-access";

type OuttakePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OuttakePage({ searchParams }: OuttakePageProps) {
  const query = await searchParams;
  const accessKey = typeof query.accessKey === "string" ? query.accessKey : "";

  if (!accessKey) {
    return (
      <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
        <div className="mx-auto max-w-[520px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
          <BrandWordmark className="mx-auto h-14 w-auto" />
          <h1 className="mt-6 text-2xl font-bold text-[color:var(--cg-ink)]">Access key required</h1>
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

  const nextPath = `/forms/outtake?accessKey=${encodeURIComponent(accessKey)}`;
  const session = await requireFormAccessOrRedirect({
    accessKey,
    formType: "OUTTAKE_FORM",
    nextPath,
  });

  return (
    <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
      <div className="mx-auto max-w-[720px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
        <BrandWordmark className="mx-auto h-14 w-auto" />
        <h1 className="mt-6 text-3xl font-bold text-[color:var(--cg-ink)]">Outtake Form</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Case: <strong>{session.caseReference}</strong>
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          Participant: <strong>{session.participantName}</strong> ({session.participantEmail})
        </p>

        <section className="mt-6 rounded-xl border border-[color:var(--border)] p-4 text-sm leading-6">
          <p>
            This secure outtake form is PIN-protected. Replace this scaffold with your completion
            questionnaire and feedback items.
          </p>
        </section>

        <div className="mt-6">
          <WorkflowCompletionForm
            caseId={session.caseId}
            participantIdentifier={session.participantEmail}
            accessKey={accessKey}
            formType="OUTTAKE_FORM"
            confirmationLabel="I confirm this feedback reflects my counselling experience."
            detailsLabel="Outtake feedback (required)"
            detailsPlaceholder="Please provide feedback summary."
            requireDetails
            successMessage="Thank you. Your outtake response has been recorded."
          />
        </div>
      </div>
    </main>
  );
}
