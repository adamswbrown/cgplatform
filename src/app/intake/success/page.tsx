import Link from "next/link";
import { CrisisSupportModal } from "@/components/intake/crisis-support-modal";
import { getIntakeFormContent } from "@/lib/intake-settings";

type IntakeSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntakeSuccessPage({ searchParams }: IntakeSuccessPageProps) {
  const params = await searchParams;
  const caseReference = typeof params.case === "string" ? params.case : "Unknown";
  const caseId = typeof params.caseId === "string" ? params.caseId : "";
  const allocationMessage = typeof params.allocation === "string" ? params.allocation : null;
  const content = await getIntakeFormContent();

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-shell-hero cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <div className="mx-auto w-full max-w-3xl">
            <p className="cg-nav-label text-white/85">Submission Complete</p>
            <h1 className="mt-1 text-[clamp(2rem,4.4vw,3.2rem)]">Intake submitted</h1>
          </div>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <div className="cg-surface-card mx-auto w-full max-w-2xl p-6">
            <p className="text-sm font-semibold text-[color:var(--muted)]">
              Thank you. Your submission has been received.
            </p>
            <p className="mt-3 text-sm text-[color:var(--muted)]">
              Case <span className="font-medium">{caseReference}</span> has been created.
            </p>
            <p className="mt-3 text-sm">
              Our Counselling Coordinator will allocate you to a Counsellor as soon as one becomes
              available.
            </p>
            <p className="mt-3 text-sm font-semibold italic">
              Please be aware that we are experiencing extremely high demand for our services at
              present and it may be quite a number of weeks before you will be allocated to a
              Counsellor.
            </p>

            {allocationMessage ? (
              <p className="mt-4 cg-alert cg-alert-warning">
                Scheduling is still blocked: {allocationMessage}
              </p>
            ) : (
              <p className="mt-4 cg-alert cg-alert-success">
                The case is in pending review. Once required workflow forms are completed, ops can
                match and schedule.
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

            <div className="mt-6 rounded-2xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/35 p-4">
              <p className="text-sm">{content.crisisModal.intro}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {content.crisisModal.contacts.map((contact) => (
                  <li key={`${contact.label}-${contact.phone}`}>
                    <span className="font-semibold">{contact.label}</span>
                    {contact.phone ? ` - ${contact.phone}` : ""}
                  </li>
                ))}
              </ul>
            </div>

            <CrisisSupportModal content={content.crisisModal} />
          </div>
        </div>
      </section>
    </div>
  );
}
