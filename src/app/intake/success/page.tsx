import Link from "next/link";

type IntakeSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntakeSuccessPage({ searchParams }: IntakeSuccessPageProps) {
  const params = await searchParams;
  const caseReference = typeof params.case === "string" ? params.case : "Unknown";
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  const allocationMessage = typeof params.allocation === "string" ? params.allocation : null;

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <div className="mx-auto w-full max-w-3xl">
            <p className="cg-nav-label text-white/85">Submission Complete</p>
            <h1 className="mt-2">Intake submitted</h1>
          </div>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <div className="cg-surface-card mx-auto w-full max-w-2xl p-6">
            <p className="text-sm text-[color:var(--muted)]">
              Case <span className="font-medium">{caseReference}</span> has been created.
            </p>

            {allocationMessage ? (
              <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Automatic allocation was attempted but could not complete: {allocationMessage}
              </p>
            ) : (
              <p className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Specialist assignment and calendar scheduling were applied automatically.
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/intake"
                className="cg-cta-secondary inline-flex items-center px-5 py-2 text-xs"
              >
                Submit another intake
              </Link>
              <Link
                href={caseId ? `/admin/cases/${caseId}` : "/login"}
                className="cg-cta-primary inline-flex items-center px-5 py-2 text-xs text-white"
              >
                View case in ops portal
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
