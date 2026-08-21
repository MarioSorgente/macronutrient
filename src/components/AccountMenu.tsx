"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChefHat, LogOut, ShieldCheck, User as UserIcon } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import { cn } from "@/components/ui/cn";

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

  // Nothing to offer when accounts are not configured for this deployment.
  if (!enabled) return null;

  if (loading) {
    return <span className="h-8 w-8 shrink-0 rounded-full bg-cream-deep" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="shrink-0 whitespace-nowrap rounded-lg bg-tomato px-3 py-1.5 text-sm font-600 text-cream transition-colors hover:bg-tomato-dark"
      >
        Sign in
      </Link>
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
              {role && role !== "client" ? ` · ${role}` : ""}
            </p>
          </div>

          <Link
            href="/plan"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
          >
            <UserIcon size={15} className="text-charcoal-soft" /> My week
          </Link>

          {isStaff(role) && (
            <Link
              href="/admin/house-items"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
            >
              <ChefHat size={15} className="text-charcoal-soft" /> House items
            </Link>
          )}

          {role === "admin" && (
            <Link
              href="/admin"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-charcoal hover:bg-cream"
            >
              <ShieldCheck size={15} className="text-charcoal-soft" /> Admin
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.push("/");
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
