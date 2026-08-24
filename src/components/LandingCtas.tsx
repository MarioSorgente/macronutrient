"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { authUrl } from "@/lib/auth/next";

/**
 * The first decision a visitor makes: am I eating here, or do I work here?
 *
 * "Get started" used to lead straight into the planner, which quietly assumed
 * everybody was a diner and left staff onboarding reachable only by guessing
 * the `/signup` URL. Two named doors are the whole fix — and because the intent
 * travels in the query string, it survives the switch to Sign in, a refresh and
 * the Google popup.
 *
 * Someone already signed in is not sent through signup again. The staff CTA
 * always points at `/kitchen`: staff and owners land on the board, and a
 * customer lands on the staff-access panel the guard renders there, which is
 * the request flow rather than a locked door. A link click never files a
 * request on its own.
 */
export default function LandingCtas({ className }: { className?: string }) {
  const { user, loading } = useAuth();
  // While auth resolves, the signed-out links are the safe guess: a signed-in
  // visitor who follows one is bounced straight back out of /signup by AuthForm.
  const signedIn = Boolean(user) && !loading;

  const customerHref = signedIn
    ? "/plan"
    : authUrl("signup", { next: "/plan", intent: "customer" });
  const staffHref = signedIn
    ? "/kitchen"
    : authUrl("signup", { next: "/kitchen", intent: "staff" });

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={customerHref}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-tomato px-6 py-3 text-base font-700 text-cream shadow-card transition-colors hover:bg-tomato-dark"
        >
          Plan my meals <ArrowRight size={18} />
        </Link>
        <Link
          href={staffHref}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-cream-deep bg-white px-6 py-3 text-base font-600 text-charcoal transition-colors hover:border-tomato-soft"
        >
          I work at Negrita
        </Link>
      </div>
      {!signedIn && (
        <p className="mt-3 text-xs text-charcoal-soft">
          Create an account so your plan, orders and preferences stay with you.
        </p>
      )}
    </div>
  );
}
