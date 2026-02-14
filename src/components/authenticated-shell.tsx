import Link from "next/link";
import { UserRole } from "@prisma/client";
import { logoutAction } from "@/app/actions";
import { BrandWordmark } from "@/components/brand-wordmark";

type NavItem = {
  href: string;
  label: string;
};

type AuthenticatedShellProps = {
  title: string;
  subtitle: string;
  userName: string;
  role: UserRole;
  navItems: NavItem[];
  children: React.ReactNode;
};

export function AuthenticatedShell({
  title,
  subtitle,
  userName,
  role,
  navItems,
  children,
}: AuthenticatedShellProps) {
  return (
    <div className="min-h-screen">
      <section className="cg-section cg-theme-black-bold">
        <header className="cg-container cg-gutters">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <Link
                href="/intake"
                className="inline-flex w-fit rounded-2xl bg-white p-3 shadow-[0_10px_24px_rgba(5,46,30,0.15)]"
              >
                <BrandWordmark className="h-8 w-auto" />
              </Link>
              <p className="cg-nav-label mt-4">{role}</p>
              <h1 className="mt-2">{title}</h1>
              <p className="mt-3 text-sm font-normal text-white/80">{subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="cg-nav-label text-white/80">{userName}</span>
              <form action={logoutAction}>
                <button type="submit" className="cg-cta-secondary px-4 py-2 text-xs text-white">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav className="mt-6 flex flex-wrap gap-2">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="cg-nav-pill">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
      </section>

      <section className="cg-section cg-theme-light">
        <main className="cg-container cg-gutters">
          <div className="cg-main-stack">{children}</div>
        </main>
      </section>
    </div>
  );
}
