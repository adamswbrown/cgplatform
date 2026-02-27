import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { IntakeMultiStepForm } from "@/components/intake/intake-multi-step-form";
import { getIntakeFormContent } from "@/lib/intake-settings";
import { getSchedulingAssignmentMode } from "@/lib/scheduling/config";

type ApplyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ApplyPage({ searchParams }: ApplyPageProps) {
  const params = await searchParams;
  const errorParam = params.error;
  const error = typeof errorParam === "string" ? errorParam : null;
  const content = await getIntakeFormContent();
  const assignmentMode = await getSchedulingAssignmentMode();

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-shell-hero cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <header className="mx-auto w-full max-w-4xl py-2 text-white">
            <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
              <BrandWordmark className="h-auto w-full" priority />
            </div>

            <p className="cg-nav-label mt-3 text-center text-white/85">Application For Counselling</p>
            <h1 className="mt-1 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
              Apply for Counselling
            </h1>
            <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
              Please complete each step below. Our operations team will review your application
              and match you with a counsellor as soon as one becomes available.
            </p>
          </header>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <section className="cg-surface-card mx-auto w-full max-w-4xl p-6">
            <IntakeMultiStepForm
              content={content}
              initialError={error}
              accessKey={null}
              assignmentMode={assignmentMode}
            />
          </section>

          <footer className="mx-auto mt-5 w-full max-w-4xl text-sm text-[color:var(--muted)]">
            Operations and counsellors can sign in at{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
            .
          </footer>
        </div>
      </section>
    </div>
  );
}
