import type { Role } from "@/lib/storage/types";
import { cn } from "@/components/ui/cn";

/**
 * Says out loud which role the app is treating you as.
 *
 * Before this, the only place a role appeared was 11px grey text inside a
 * closed dropdown — so a restaurant account had no visible signal that it was
 * staff at all, and an admin whose claim had never been set looked exactly the
 * same as one whose claim was fine.
 */
const TONES: Record<Role, string> = {
  client: "border-cream-deep bg-white text-charcoal-soft",
  restaurant: "border-basil/40 bg-basil/10 text-basil",
  admin: "border-tomato/40 bg-tomato/10 text-tomato",
};

const LABELS: Record<Role, string> = {
  client: "Client",
  restaurant: "Restaurant",
  admin: "Admin",
};

export default function RoleBadge({
  role,
  className,
}: {
  role: Role | null;
  className?: string;
}) {
  if (!role) return null;
  return (
    <span
      title={`You are signed in as ${LABELS[role].toLowerCase()}`}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-700 uppercase tracking-wide",
        TONES[role],
        className
      )}
    >
      {LABELS[role]}
    </span>
  );
}
