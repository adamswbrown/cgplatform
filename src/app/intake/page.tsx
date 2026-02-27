import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { IntakeMultiStepForm } from "@/components/intake/intake-multi-step-form";
import { requireIntakeAccessOrRedirect } from "@/lib/form-access";
import { getIntakeFormContent } from "@/lib/intake-settings";
import { getSchedulingAssignmentMode } from "@/lib/scheduling/config";

type IntakePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntakePage({ searchParams }: IntakePageProps) {
  const params = await searchParams;
  const errorParam = params.error;
  const error = typeof errorParam === "string" ? errorParam : null;
  const accessKey = typeof params.accessKey === "string" ? params.accessKey : "";
  const content = await getIntakeFormContent();
  const assignmentMode = await getSchedulingAssignmentMode();

  if (!accessKey) {
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
                Secure Access Required
              </h1>
              <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
                This intake form is not public. Please use the secure link and PIN code sent to you by
                email.
              </p>
            </header>
          </div>
        </section>

        <section className="cg-section cg-theme-light">
          <div className="cg-container cg-gutters">
            <section className="cg-surface-card mx-auto w-full max-w-2xl p-6 text-center">
              <p className="text-sm text-[color:var(--muted)]">
                If you have your secure link, open it directly. It will take you to the PIN entry
                screen before the intake form.
              </p>
              <p className="mt-3 text-sm">
                Alternatively, you can{" "}
                <Link href="/apply" className="font-medium underline">
                  apply directly here
                </Link>
                .
              </p>
              <p className="mt-3 text-xs text-[color:var(--muted)]">
                Staff can issue intake links from the operations dashboard.
              </p>
              <p className="mt-4 text-sm">
                <Link href="/login" className="underline">
                  Staff login
                </Link>
              </p>
            </section>
          </div>
        </section>
      </div>
    );
  }

  await requireIntakeAccessOrRedirect({
    accessKey,
    nextPath: `/intake?accessKey=${encodeURIComponent(accessKey)}`,
  });

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
              Application for Counselling
            </h1>
            <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
              Please complete each step. Operations will review your application, then match and
              allocate a counsellor as soon as one becomes available.
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
              accessKey={accessKey}
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
