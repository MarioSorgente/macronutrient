"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";

/**
 * "You need an account for this" — the three screens that say it, saying it
 * the same way.
 *
 * The button was written out three times, each hand-building its own
 * `?next=` link, so the destination could be wrong in one place and right in
 * the others. Passing the path once is also what makes it hard to forget:
 * without `next`, signing in drops you on the planner instead of back where
 * you were.
 */
export default function SignInPrompt({
  title,
  hint,
  icon,
  /** Where to return after signing in. */
  next,
  className,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  next: string;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      icon={icon}
      title={title}
      hint={hint}
      action={
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
        >
          Sign in
        </Link>
      }
    />
  );
}
