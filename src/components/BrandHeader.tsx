"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import AccountMenu from "@/components/AccountMenu";

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
  {
    href: "/plan",
    label: "Plan & Build",
    match: (p) => p === "/plan" || p.startsWith("/plan/") || p.startsWith("/report/"),
  },
];

/** Only rendered for accounts whose role actually grants them. */
const STAFF_LINKS: NavLink[] = [
  { href: "/admin/house-items", label: "House items", match: (p) => p.startsWith("/admin") },
];

export default function BrandHeader() {
  const pathname = usePathname() ?? "/";
  const { role } = useAuth();
  const links = isStaff(role) ? [...LINKS, ...STAFF_LINKS] : LINKS;

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

        <nav className="scroll-slim -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm font-600">
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
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}
