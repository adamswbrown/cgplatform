import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { WorkflowCompletionForm } from "@/components/forms/workflow-completion-form";
import { requireFormAccessOrRedirect } from "@/lib/form-access";

type ConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
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

  const nextPath = `/forms/consent?accessKey=${encodeURIComponent(accessKey)}`;
  const session = await requireFormAccessOrRedirect({
    accessKey,
    formType: "CONSENT_FORM",
    nextPath,
  });

  return (
    <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
      <div className="mx-auto max-w-[720px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
        <BrandWordmark className="mx-auto h-14 w-auto" />
        <h1 className="mt-6 text-3xl font-bold text-[color:var(--cg-ink)]">Consent Form</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Case: <strong>{session.caseReference}</strong>
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          Participant: <strong>{session.participantName}</strong> ({session.participantEmail})
        </p>

        <section className="mt-6 rounded-xl border border-[color:var(--border)] p-4 text-sm leading-6">
          <p>
            This secure consent form is PIN-protected. Replace this content with your full consent
            wording and required acknowledgements.
          </p>
        </section>

        <div className="mt-6">
          <WorkflowCompletionForm
            caseId={session.caseId}
            participantIdentifier={session.participantEmail}
            accessKey={accessKey}
            formType="CONSENT_FORM"
            confirmationLabel="I give informed consent for counselling in line with this policy."
            detailsLabel="Consent details (required)"
            detailsPlaceholder="Please include any consent limitations or preferences."
            requireDetails
            successMessage="Thank you. Your consent response has been recorded."
          />
        </div>
      </div>
    </main>
  );
}
