import Link from "next/link";
import { submitIntakeAction } from "@/app/actions";
import { BrandWordmark } from "@/components/brand-wordmark";

type IntakePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IntakePage({ searchParams }: IntakePageProps) {
  const params = await searchParams;
  const errorParam = params.error;
  const error = typeof errorParam === "string" ? errorParam : null;

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <header className="mx-auto w-full max-w-3xl p-7 text-white">
            <div className="rounded-[30px] bg-white p-6 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
              <BrandWordmark className="h-auto w-full" priority />
            </div>

            <p className="cg-nav-label mt-6 text-center text-white/85">Public Intake</p>
            <h1 className="mt-2 text-center">Start A New Engagement Request</h1>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm font-normal text-white/85">
              Clients submit intake details. The system creates a pending case for review, then
              operations can match a specialist once required workflow steps are complete.
            </p>
          </header>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <section className="cg-surface-card mx-auto w-full max-w-3xl p-6">
            {error ? (
              <p className="mb-4 rounded-2xl border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
                {error}
              </p>
            ) : null}

            <form action={submitIntakeAction} className="space-y-5">
              <fieldset>
                <legend className="text-sm font-medium">Participants</legend>
                <div className="mt-2 flex flex-wrap gap-5 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="participantType" value="single" defaultChecked />
                    Single client
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="participantType" value="couple" />
                    Couple
                  </label>
                </div>
              </fieldset>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="primaryFirstName" className="mb-1 block text-sm font-medium">
                    Primary first name
                  </label>
                  <input
                    id="primaryFirstName"
                    name="primaryFirstName"
                    required
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="primaryLastName" className="mb-1 block text-sm font-medium">
                    Primary last name
                  </label>
                  <input
                    id="primaryLastName"
                    name="primaryLastName"
                    required
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="primaryEmail" className="mb-1 block text-sm font-medium">
                    Primary email
                  </label>
                  <input
                    id="primaryEmail"
                    name="primaryEmail"
                    type="email"
                    required
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="primaryPhone" className="mb-1 block text-sm font-medium">
                    Primary phone (optional)
                  </label>
                  <input id="primaryPhone" name="primaryPhone" className="w-full px-3 py-2" />
                </div>
              </div>

              <div className="cg-muted-card p-4">
                <p className="mb-3 text-sm font-medium">Secondary participant (required for couple)</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="secondaryFirstName" className="mb-1 block text-sm font-medium">
                      Secondary first name
                    </label>
                    <input
                      id="secondaryFirstName"
                      name="secondaryFirstName"
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="secondaryLastName" className="mb-1 block text-sm font-medium">
                      Secondary last name
                    </label>
                    <input
                      id="secondaryLastName"
                      name="secondaryLastName"
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="secondaryEmail" className="mb-1 block text-sm font-medium">
                      Secondary email
                    </label>
                    <input
                      id="secondaryEmail"
                      name="secondaryEmail"
                      type="email"
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="secondaryPhone" className="mb-1 block text-sm font-medium">
                      Secondary phone (optional)
                    </label>
                    <input
                      id="secondaryPhone"
                      name="secondaryPhone"
                      className="w-full px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="notes" className="mb-1 block text-sm font-medium">
                  Case notes (optional)
                </label>
                <textarea id="notes" name="notes" rows={4} className="w-full px-3 py-2" />
              </div>

              <button type="submit" className="cg-cta-primary px-5 py-2.5 text-sm text-white">
                Submit intake
              </button>
            </form>
          </section>

          <footer className="mx-auto mt-5 w-full max-w-3xl text-sm text-[color:var(--muted)]">
            Operations and specialists can sign in at{" "}
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
