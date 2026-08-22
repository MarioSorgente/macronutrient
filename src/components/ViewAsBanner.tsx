"use client";

import { Eye, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * A standing reminder that the app is not showing you your own account.
 *
 * Deliberately unmissable and always one click from off: previewing is a state
 * that is very easy to forget you are in, and being confused about why the
 * Admin link vanished is the exact problem this whole change set is fixing.
 */
export default function ViewAsBanner() {
  const { viewAs, setViewAs } = useAuth();
  if (!viewAs) return null;

  return (
    <div className="no-print flex items-center justify-center gap-2 bg-charcoal px-4 py-1.5 text-center text-xs font-600 text-cream">
      <Eye size={13} className="shrink-0" />
      <span>
        Viewing as <b className="font-700 capitalize">{viewAs}</b> — this changes
        what you see, not what you can read.
      </span>
      <button
        type="button"
        onClick={() => setViewAs(null)}
        className="ml-1 inline-flex items-center gap-1 rounded-md bg-cream/15 px-2 py-0.5 hover:bg-cream/25"
      >
        <X size={11} /> Back to admin
      </button>
    </div>
  );
}
