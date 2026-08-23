"use client";

import { Eye } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Role } from "@/lib/storage/types";
import { cn } from "@/components/ui/cn";
import { roleLabel } from "@/lib/roles";

const OPTIONS: Role[] = ["client", "restaurant", "admin"];

/**
 * Previewing the app as another role.
 *
 * Rendered in two places — the account menu and the Account & access page —
 * because people look for it in both. The buttons and the wording live here
 * once so those two can never drift into disagreeing about what previewing
 * does.
 *
 * Admins only, and it is presentation: every read still goes out with the real
 * claim, because the security rules read the token. An admin already passes
 * the staff checks, so the kitchen genuinely works while previewing.
 */
export default function ViewAsSwitch({ className }: { className?: string }) {
  const { actualRole, viewAs, setViewAs } = useAuth();
  if (actualRole !== "admin") return null;

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 text-sm font-600 text-charcoal">
        <Eye size={15} className="text-charcoal-soft" /> View as
      </p>
      <p className="mt-0.5 text-xs leading-snug text-charcoal-soft">
        Changes what you see, not what you can read.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {OPTIONS.map((option) => {
          // "admin" is the absence of a preview rather than a preview of one.
          const active = option === "admin" ? viewAs === null : viewAs === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setViewAs(option === "admin" ? null : option)}
              aria-pressed={active}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-xs font-600 capitalize transition-colors",
                active
                  ? "bg-tomato text-cream"
                  : "border border-cream-deep bg-white text-charcoal-soft hover:text-charcoal"
              )}
            >
              {roleLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
