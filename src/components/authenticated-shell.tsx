import Link from "next/link";
import { UserRole } from "@prisma/client";
import { logoutAction } from "@/app/actions";
import { BrandWordmark } from "@/components/brand-wordmark";

type NavItem = {
  href: string;
  label: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type AuthenticatedShellProps = {
  title: string;
  subtitle: string;
  userName: string;
  role: UserRole;
  navItems: NavItem[];
  children: React.ReactNode;
};

const OPS_NAV_PRIORITY: string[] = [
  "/admin/cases",
  "/admin/assignments",
  "/admin/clients",
  "/admin/specialists",
  "/admin/workflows",
  "/intake",
];

const SPECIALIST_NAV_PRIORITY: string[] = [
  "/specialist/sessions",
  "/specialist/clients",
  "/specialist/availability",
];

function isSettingsNavItem(item: NavItem) {
  return item.href.includes("/settings") || item.label.toLowerCase().includes("settings");
}

function navPriority(role: UserRole, href: string) {
  const priorities = role === UserRole.OPS ? OPS_NAV_PRIORITY : SPECIALIST_NAV_PRIORITY;
  const index = priorities.findIndex((prefix) => href.startsWith(prefix));
  return index === -1 ? 999 : index;
}

function normalizeNavItemsByRole(role: UserRole, navItems: NavItem[]) {
  return [...navItems].sort((a, b) => {
    const priorityDelta = navPriority(role, a.href) - navPriority(role, b.href);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return a.label.localeCompare(b.label);
  });
}

function dedupeNavItems(items: NavItem[]) {
  const seen = new Set<string>();
  const deduped: NavItem[] = [];

  for (const item of items) {
    if (seen.has(item.href)) {
      continue;
    }
    seen.add(item.href);
    deduped.push(item);
  }

  return deduped;
}

function defaultSettingsNavItems(role: UserRole): NavItem[] {
  if (role !== UserRole.OPS) {
    return [];
  }

  return [
    { href: "/admin/settings", label: "Settings" },
    { href: "/admin/settings/operations", label: "Operational Settings" },
    { href: "/admin/settings/intake", label: "Intake Settings" },
  ];
}

function navGroupLabel(role: UserRole, href: string) {
  if (role === UserRole.OPS) {
    if (href.startsWith("/intake")) {
      return "Intake";
    }
    if (href.startsWith("/admin")) {
      return "Operations";
    }
    return "Other";
  }

  if (role === UserRole.SPECIALIST) {
    if (href.startsWith("/specialist")) {
      return "Counsellor";
    }
    return "Other";
  }

  return "Navigation";
}

function navGroupPriority(role: UserRole, groupLabel: string) {
  if (role === UserRole.OPS) {
    if (groupLabel === "Operations") {
      return 0;
    }
    if (groupLabel === "Intake") {
      return 1;
    }
    return 99;
  }

  if (role === UserRole.SPECIALIST) {
    if (groupLabel === "Counsellor") {
      return 0;
    }
    return 99;
  }

  return 99;
}

function groupNavItems(role: UserRole, navItems: NavItem[]): NavGroup[] {
  const groups = new Map<string, NavItem[]>();

  for (const item of navItems) {
    const label = navGroupLabel(role, item.href);
    const groupItems = groups.get(label) ?? [];
    groupItems.push(item);
    groups.set(label, groupItems);
  }

  return [...groups.entries()]
    .sort((a, b) => {
      const priorityDelta = navGroupPriority(role, a[0]) - navGroupPriority(role, b[0]);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([label, items]) => ({ label, items }));
}

function roleLabel(role: UserRole) {
  if (role === UserRole.OPS) {
    return "Ops Manager";
  }
  if (role === UserRole.SPECIALIST) {
    return "Counsellor";
  }
  return role;
}

export function AuthenticatedShell({
  title,
  subtitle,
  userName,
  role,
  navItems,
  children,
}: AuthenticatedShellProps) {
  const orderedNav = normalizeNavItemsByRole(role, navItems);
  const settingsNavItems = dedupeNavItems([
    ...orderedNav.filter(isSettingsNavItem),
    ...defaultSettingsNavItems(role),
  ]);
  const primaryNavItems = orderedNav.filter((item) => !isSettingsNavItem(item));
  const primaryNavGroups = groupNavItems(role, primaryNavItems);

  return (
    <div className="min-h-screen">
      <section className="cg-section cg-shell-hero cg-theme-black-bold">
        <header className="cg-container cg-gutters">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-start gap-3">
                <Link
                  href={role === UserRole.OPS ? "/admin/cases" : "/specialist/sessions"}
                  className="inline-flex w-fit rounded-2xl bg-white p-2.5 shadow-[0_10px_24px_rgba(5,46,30,0.15)]"
                >
                  <BrandWordmark className="h-7 w-auto" />
                </Link>
              </div>
              <p className="cg-nav-label mt-3">{roleLabel(role)}</p>
              <h1 className="mt-1 text-[clamp(2.1rem,4.2vw,3.35rem)]">{title}</h1>
              <p className="mt-2 text-sm font-normal text-white/80">{subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <details className="group relative">
                <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-xl border border-white/30 bg-white/10 text-white transition hover:bg-white/20 [&::-webkit-details-marker]:hidden">
                  <span className="sr-only">Open settings menu</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.25 2.25h1.5l.63 2.07a7.78 7.78 0 0 1 1.9.79l1.94-1.05 1.06 1.06-1.05 1.94a7.8 7.8 0 0 1 .79 1.9l2.07.63v1.5l-2.07.63a7.8 7.8 0 0 1-.79 1.9l1.05 1.94-1.06 1.06-1.94-1.05a7.78 7.78 0 0 1-1.9.79l-.63 2.07h-1.5l-.63-2.07a7.79 7.79 0 0 1-1.9-.79l-1.94 1.05-1.06-1.06 1.05-1.94a7.8 7.8 0 0 1-.79-1.9l-2.07-.63v-1.5l2.07-.63a7.8 7.8 0 0 1 .79-1.9L4.7 5.12l1.06-1.06 1.94 1.05c.6-.35 1.24-.62 1.9-.79l.63-2.07Z"
                    />
                    <circle cx="12" cy="12" r="3.1" />
                  </svg>
                </summary>
                <div className="absolute right-0 top-[3rem] z-20 w-64 rounded-xl border border-[color:var(--border)] bg-white p-3 text-sm text-[color:var(--foreground)] shadow-[0_16px_32px_rgba(5,46,30,0.18)]">
                  <p className="cg-nav-label text-[color:var(--muted)]">Settings</p>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    {role === UserRole.OPS ? "Operations controls" : "Counsellor controls"}
                  </p>

                  <div className="mt-3 space-y-1">
                    {settingsNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block rounded-md px-2 py-1.5 text-sm hover:bg-[color:var(--accent-soft)]"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </details>
              <span className="cg-nav-label text-white/80">{userName}</span>
              <form action={logoutAction}>
                <button type="submit" className="cg-cta-secondary px-4 py-2 text-xs text-white">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav className="mt-4 border-t border-white/20 pt-2">
            <div className="flex flex-wrap gap-4">
              {primaryNavGroups.map((group) => (
                <section key={group.label} aria-label={`${group.label} navigation`}>
                  <p className="cg-nav-label text-white/60">{group.label}</p>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="cg-nav-label border-b border-transparent pb-0.5 text-white/85 transition hover:border-white/70 hover:text-white"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
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
