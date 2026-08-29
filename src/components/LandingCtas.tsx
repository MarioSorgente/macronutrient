"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { authUrl } from "@/lib/auth/next";

/**
 * Landing page CTAs for customers and restaurant staff.
 */
export default function LandingCtas({
  className,
}: {
  className?: string;
}) {
  const { user, loading } = useAuth();

  const signedIn = Boolean(user) && !loading;

  const customerHref = signedIn
    ? "/plan"
    : authUrl("signup", {
        next: "/plan",
        intent: "customer",
      });

  const staffHref = signedIn
    ? "/kitchen"
    : authUrl("signup", {
        next: "/kitchen",
        intent: "staff",
      });

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
          For Staff
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
