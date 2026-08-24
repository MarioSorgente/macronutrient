"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { authUrl } from "@/lib/auth/next";
import { policyFor } from "@/lib/auth/routePolicy";
import StaffAccessStatus from "@/components/StaffAccessStatus";
import Card from "@/components/ui/Card";

/**
 * The one place the app decides whether you may see a screen.
 *
 * Mounted in the root layout, so protection is not something a new page has to
 * remember to opt into — which is how the planner, the whole product, ended up
 * usable with no account at all while the kitchen was carefully gated.
 *
 * This is presentation, not the boundary. `firestore.rules` denies the reads
 * regardless of what renders here, and every role-changing operation is a
 * server one. What this buys is that a signed-out visitor never sees a screen
 * they cannot use, and that a customer who wanders into `/kitchen` is offered
 * the way in rather than a locked door.
 *
 * The order of the checks below is the whole design. In particular auth state
 * is never read before `loading` clears: Firebase reports "signed out" for the
 * first frame of every page load, and acting on that would bounce a signed-in
 * person to the login screen every time they refreshed.
 */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { user, role, loading, roleSettled, enabled } = useAuth();

  const policy = policyFor(pathname);
  const isPublic = policy.kind === "public";
  const staffIntent = policy.kind === "role" && policy.staffIntent;

  useEffect(() => {
    if (isPublic || !enabled || loading || user) return;
    // Read from the DOM rather than useSearchParams: this component sits in
    // the root layout, and that hook would demand a Suspense boundary around
    // every page, static landing page included. The effect is client-only, so
    // window is always there.
    const query = window.location.search.slice(1);
    router.replace(
      authUrl("login", {
        // The query string is part of where somebody was: `/kitchen?date=…`
        // sent them back to an undated board before this.
        next: query ? `${pathname}?${query}` : pathname,
        intent: staffIntent ? "staff" : undefined,
      })
    );
  }, [enabled, isPublic, loading, pathname, router, staffIntent, user]);

  if (isPublic) return <>{children}</>;

  // Redirecting to /login would loop: without Firebase config the form cannot
  // sign anybody in either. Say what is actually wrong instead.
  if (!enabled) {
    return (
      <Notice title="Accounts are not available in this build">
        The <code>NEXT_PUBLIC_FIREBASE_*</code> variables were not present when
        this bundle was built, so nobody can sign in — and every part of Mamma
        Calories belongs to an account. They are inlined at build time, so
        setting them is not enough on its own:{" "}
        <b className="text-charcoal">the site has to be redeployed afterwards</b>.
      </Notice>
    );
  }

  if (loading) return <Checking />;
  if (!user) return null; // redirecting

  if (policy.kind === "role") {
    // A new account's token is minted before /api/auth/sync stamps its claim.
    // Denying during that gap would tell a cook who has just signed up that
    // their brand-new account was rejected.
    if (!roleSettled) return <Checking />;
    if (role === null || !policy.allow.includes(role)) {
      return <StaffAccessStatus variant="gate" />;
    }
  }

  return <>{children}</>;
}

function Checking() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16">
      <p className="text-sm text-charcoal-soft">Checking your access…</p>
    </main>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card className="border-gold/40 bg-gold/10 p-5">
        <h1 className="flex items-center gap-2 font-display text-xl font-700 text-charcoal">
          <ShieldAlert size={20} className="text-gold" />
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-charcoal-soft">{children}</p>
      </Card>
    </main>
  );
}
