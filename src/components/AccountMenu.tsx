"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChefHat,
  LogOut,
  Receipt,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { canUseAdmin, canUseKitchen, roleLabel } from "@/lib/roles";
import { authUrl } from "@/lib/auth/next";
import { cn } from "@/components/ui/cn";
import ViewAsSwitch from "@/components/ViewAsSwitch";

/** Initials for the avatar, falling back to the email's first character. */
function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

/**
 * Signed-out: a Sign in link. Signed-in: an avatar opening account actions,
 * including the staff destinations the account's role unlocks.
 */
export default function AccountMenu() {
  const { user, role, loading, enabled, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close on navigation, so the menu never survives a route change.
  useEffect(() => setOpen(false), [pathname]);

  // Rendering nothing here made an unconfigured deployment indistinguishable
  // from a working signed-out one — there was no Sign in button and no
  // explanation, which is exactly how "I cannot find the admin page" starts.
  if (!enabled) {
    return (
      <span
        title="The NEXT_PUBLIC_FIREBASE_* variables are missing from this build. They are inlined at build time, so adding them needs a redeploy."
        className="shrink-0 whitespace-nowrap rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-600 text-charcoal"
      >
        Accounts off
      </span>
    );
  }

  if (loading) {
    return <span className="h-8 w-8 shrink-0 rounded-full bg-cream-deep" aria-hidden />;
  }

  // Both doors, not just one: an account is now required, so "Sign in" alone
  // left anybody without one guessing where to make one.
  if (!user) {
    // A public page is not somewhere to come back to after signing in.
    const back = pathname === "/" ? undefined : pathname;
    return (
      <span className="flex shrink-0 items-center gap-2">
        <Link
          href={authUrl("login", { next: back })}
          className="shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-600 text-charcoal-soft transition-colors hover:bg-cream-deep hover:text-charcoal"
        >
          Sign in
        </Link>
        <Link
          href={authUrl("signup", { next: back, intent: "customer" })}
          className="shrink-0 whitespace-nowrap rounded-lg bg-tomato px-3 py-1.5 text-sm font-600 text-cream transition-colors hover:bg-tomato-dark"
        >
          Create account
        </Link>
      </span>
    );
  }

  const label = user.displayName || user.email || "Account";

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-full text-xs font-700 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato-soft/60",
          open ? "bg-tomato text-cream" : "bg-cream-deep text-charcoal hover:bg-tomato-soft/40"
        )}
      >
        {initials(user.displayName ?? "", user.email ?? "")}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl2 border border-cream-deep bg-white shadow-card"
        >
          <div className="border-b border-cream-deep px-3 py-2.5">
            <p className="truncate text-sm font-600 text-charcoal">{label}</p>
            <p className="truncate text-[11px] text-charcoal-soft">
              {user.email}
              {role ? ` · ${roleLabel(role)}` : ""}
            </p>
          </div>

          {role === "client" && (
            <>
              <Link
                href="/plan"
                role="menuitem"
                className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
              >
                <UserIcon size={15} className="text-charcoal-soft" /> My week
              </Link>
              <Link
                href="/orders"
                role="menuitem"
                className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
              >
                <Receipt size={15} className="text-charcoal-soft" /> My orders
              </Link>
            </>
          )}

          {canUseKitchen(role) && (
            <Link
              href="/kitchen"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
            >
              <ChefHat size={15} className="text-charcoal-soft" /> Kitchen
            </Link>
          )}

          {canUseAdmin(role) && (
            <Link
              href="/admin"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
            >
              <ShieldCheck size={15} className="text-charcoal-soft" /> Admin
            </Link>
          )}

          <Link
            href="/account"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
          >
            <UserIcon size={15} className="text-charcoal-soft" /> Account & access
          </Link>

          {/* Only an admin can preview, and only their real role unlocks it. */}
          <ViewAsSwitch className="border-t border-cream-deep px-3 py-2" />

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              // Leave the protected page first. Signing out while still on
              // one hands the route guard a signed-out visitor on a page that
              // needs an account, and it bounces them to the sign-in form —
              // which is not where somebody who just chose to leave belongs.
              router.push("/");
              await signOut();
            }}
            className="flex w-full items-center gap-2 border-t border-cream-deep px-3 py-2 text-left text-sm text-charcoal hover:bg-cream"
          >
            <LogOut size={15} className="text-charcoal-soft" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
