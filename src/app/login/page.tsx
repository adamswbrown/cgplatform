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
    <div className="min-h-screen">
      <section className="cg-section cg-theme-black-bold">
        <div className="cg-container cg-gutters">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-5 w-full max-w-xl rounded-2xl bg-white p-4 shadow-[0_12px_28px_rgba(5,46,30,0.16)]">
              <BrandWordmark className="h-auto w-full" priority />
            </div>
            <p className="cg-nav-label text-white/85">Secure Access</p>
            <h1 className="mt-2">Operations And Counsellor Login</h1>
            <p className="mt-3 max-w-2xl text-sm font-normal text-white/80">
              Sign in to manage case workflow, counsellor assignment, scheduling references, and
              session briefing.
            </p>
          </div>
        </div>
      </section>

      <section className="cg-section cg-theme-white-bold">
        <div className="cg-container cg-gutters">
          <div className="cg-surface-card mx-auto w-full max-w-md p-6">
            <h2>Sign in</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Use your operations or counsellor account credentials.
            </p>

            {error ? (
              <p className="mt-4 rounded-2xl border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
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

            <div className="cg-muted-card mt-6 p-3 text-sm text-[color:var(--muted)]">
              <p className="font-medium">Demo accounts:</p>
              <p>`ops@demo.local / password123`</p>
              <p>`avery.specialist@demo.local / password123`</p>
              <p>`jordan.specialist@demo.local / password123`</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
