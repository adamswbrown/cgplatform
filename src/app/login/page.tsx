import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { BrandWordmark } from "@/components/brand-wordmark";
import { destinationForUserRole, getCurrentUser } from "@/lib/auth";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUser();
  if (user) {
    redirect(destinationForUserRole(user.role));
  }

  const params = await searchParams;
  const errorParam = params.error;
  const error = typeof errorParam === "string" ? errorParam : null;

  return (
    <div className="min-h-screen cg-theme-black-bold">
      <section className="cg-section cg-shell-hero">
        <div className="cg-container cg-gutters">
          <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <div className="pt-1">
              <div className="mb-4 w-full max-w-xl rounded-2xl bg-white p-4 shadow-[0_12px_28px_rgba(5,46,30,0.16)]">
                <BrandWordmark className="h-auto w-full" priority />
              </div>
              <p className="cg-nav-label text-white/85">Secure Access</p>
              <h1 className="mt-1 max-w-2xl text-[clamp(2.05rem,4.8vw,3.55rem)]">
                Operations, admin, and counsellor login
              </h1>
              <p className="mt-2 max-w-xl text-sm font-normal text-white/82">
                Sign in to manage case workflow, counsellor assignment, scheduling references, and
                session briefing.
              </p>
            </div>

            <div className="cg-surface-card w-full bg-white p-6 text-[color:var(--foreground)] lg:mt-1">
              <h2>Sign in</h2>
              <p className="mt-1 text-sm text-[color:var(--muted)]">
                Use your operations, admin, or counsellor account credentials.
              </p>

              {error ? (
                <p className="mt-4 cg-alert cg-alert-error">
                  {error}
                </p>
              ) : null}

              <form action={loginAction} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm font-medium">
                    Email
                  </label>
                  <input id="email" name="email" type="email" required className="w-full px-3 py-2" />
                </div>

                <div>
                  <label htmlFor="password" className="mb-1 block text-sm font-medium">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    className="w-full px-3 py-2"
                  />
                </div>

                <button type="submit" className="cg-cta-primary w-full px-3 py-2 text-sm text-white">
                  Sign in
                </button>
              </form>

              <div className="cg-muted-card mt-5 p-3 text-sm text-[color:var(--muted)]">
                <p className="font-medium">Demo accounts:</p>
                <p>ops@demo.local / password123</p>
                <p>admin@demo.local / password123</p>
                <p>avery.specialist@demo.local / password123</p>
                <p>jordan.specialist@demo.local / password123</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
