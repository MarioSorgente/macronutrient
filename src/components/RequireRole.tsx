"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
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
    // A missing claim and a wrong claim used to show the same message, which
    // blamed the account when the real cause was often that the role had never
    // been stamped at all. They need different advice.
    const noClaim = role === null;
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title={
            noClaim
              ? "Your account has no role yet"
              : "This area is for Negrita staff"
          }
          hint={
            noClaim
              ? "Nothing has granted this account a role. If you are the owner, check that the Cloud Functions are deployed and that ADMIN_EMAILS matches your email — then sign out and back in."
              : "Your account is signed in as a Customer. Staff access must be approved by a restaurant owner."
          }
          action={
            <Link
              href="/account"
              className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              Check my access
            </Link>
          }
        />
      </main>
    );
  }

  return <>{children}</>;
}
