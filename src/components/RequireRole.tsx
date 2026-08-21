"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Role } from "@/lib/storage/types";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Client-side gate for staff areas.
 *
 * This is presentation, not protection. It exists so a client never sees the
 * kitchen board flash before being redirected — the actual boundary is the
 * Firestore security rules, which deny the underlying reads regardless of what
 * this component renders.
 */
export default function RequireRole({
  allow,
  children,
}: {
  allow: Role[];
  children: ReactNode;
}) {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = role !== null && allow.includes(role);

  useEffect(() => {
    if (loading || user) return;
    router.replace(`/login?next=${encodeURIComponent(pathname ?? "/")}`);
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Checking your access…</p>
      </main>
    );
  }

  if (!user) return null; // redirecting

  if (!allowed) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title="This area is for Negrita staff"
          hint="Your account does not have access. If that looks wrong, ask the restaurant to update your role."
        />
      </main>
    );
  }

  return <>{children}</>;
}
