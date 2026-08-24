"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import AccountMenu from "@/components/AccountMenu";
import RoleBadge from "@/components/RoleBadge";

/**
 * App shell header. "Mamma Calories" is the product brand; "For Negrita" is the
 * customer skin.
 *
 * There used to be five tabs, two of which ("Clients" and "For coaches") were
 * the same screen in different modes. Everything a diner does now lives under
 * one destination; staff-only areas appear only for the people who have them.
 */
type NavLink = { href: string; label: string; match: (path: string) => boolean };

const LINKS: NavLink[] = [
  { href: "/", label: "Home", match: (p) => p === "/" },
];

/**
 * The product itself, which now needs an account.
 *
 * Offering "Plan & Build" to a signed-out visitor advertised a destination
 * that only bounces them to the sign-in screen. The two CTAs on the landing
 * page are the way in.
 */
const PLANNER_LINKS: NavLink[] = [
  {
    href: "/plan",
    label: "Plan & Build",
    match: (p) => p === "/plan" || p.startsWith("/plan/") || p.startsWith("/report/"),
  },
];

/** Shown once someone has an account to have orders in. */
const ACCOUNT_LINKS: NavLink[] = [
  { href: "/orders", label: "My orders", match: (p) => p.startsWith("/orders") },
];

/**
 * Staff destinations, split by what the role can actually use.
 *
 * `restaurant` used to be offered an Admin link that led straight to "Owner
 * access only" — a dead end that also made the two staff roles look identical
 * until one of them failed.
 */
const KITCHEN_LINKS: NavLink[] = [
  { href: "/kitchen", label: "Kitchen", match: (p) => p.startsWith("/kitchen") },
  {
    href: "/admin/house-items",
    label: "House items",
    match: (p) => p.startsWith("/admin/house-items"),
  },
];

const ADMIN_LINKS: NavLink[] = [
  {
    href: "/admin",
    label: "Admin",
    match: (p) => p.startsWith("/admin") && !p.startsWith("/admin/house-items"),
  },
];

export default function BrandHeader() {
  const pathname = usePathname() ?? "/";
  const { user, role } = useAuth();
  const links = [
    ...LINKS,
    ...(user ? PLANNER_LINKS : []),
    ...(user ? ACCOUNT_LINKS : []),
    ...(isStaff(role) ? KITCHEN_LINKS : []),
    ...(role === "admin" ? ADMIN_LINKS : []),
  ];

  return (
    <header className="no-print sticky top-0 z-20 border-b border-cream-deep bg-cream/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream shadow-card">
            <UtensilsCrossed size={20} strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-xl font-700 text-charcoal">
              Mamma Calories
            </span>
            <span className="block text-[11px] font-600 uppercase tracking-[0.18em] text-tomato">
              For Negrita
            </span>
          </span>
        </Link>

        {/*
          The account menu is a sibling of the scrolling nav, not a child of it.
          `overflow-x: auto` forces the computed `overflow-y` to `auto` too, so
          the nav is a scroll container in both axes: an account dropdown inside
          it was clipped — document.elementFromPoint over the "Sign out" row
          returned the page behind it — and on a phone the avatar itself was
          laid out past the right edge of the viewport. Only the links scroll now.
        */}
        <div className="flex min-w-0 items-center gap-2">
          <nav className="scroll-slim -mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 text-sm font-600">
            {isStaff(role) && <RoleBadge role={role} />}
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.match(pathname) ? "page" : undefined}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 transition-colors",
                  link.match(pathname)
                    ? "bg-tomato text-cream"
                    : "text-charcoal-soft hover:bg-cream-deep hover:text-charcoal"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
