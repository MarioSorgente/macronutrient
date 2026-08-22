"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import { isFirebaseConfigured } from "@/lib/firebaseEnv";
import { isCloudBackend } from "@/lib/storage";
import { authErrorMessage } from "@/lib/auth/errors";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import RoleBadge from "@/components/RoleBadge";
import AccountProfile from "@/components/AccountProfile";
import { useToast } from "@/components/ui/Toast";

/**
 * What this account can actually do, and why.
 *
 * Every way role access can fail — an unconfigured build, an undeployed
 * function, a claim that was never stamped, a token issued before the grant —
 * previously looked identical from inside the app: a missing menu item. This
 * screen names which one it is.
 */
function Row({
  label,
  ok,
  value,
  hint,
}: {
  label: string;
  ok: boolean;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-cream-deep py-2.5 last:border-0">
      <span className={ok ? "mt-0.5 text-basil" : "mt-0.5 text-tomato-dark"}>
        {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-600 text-charcoal">{label}</p>
        {hint && <p className="text-xs text-charcoal-soft">{hint}</p>}
      </div>
      <span className="shrink-0 text-sm tabular-nums text-charcoal-soft">
        {value}
      </span>
    </div>
  );
}

export default function AccountAccess() {
  const {
    user,
    role,
    actualRole,
    viewAs,
    restaurantId,
    enabled,
    loading,
    refreshRole,
  } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const next = await refreshRole();
      show(
        next
          ? `Your role is "${next}".`
          : "Still no role on this account. The claim has never been set."
      );
    } catch (cause) {
      show(authErrorMessage(cause), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Checking your access…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
        Account &amp; access
      </h1>
      <p className="mt-1 text-sm text-charcoal-soft">
        What this deployment thinks you can do, and where to look if it is wrong.
      </p>

      {!enabled && (
        <Card className="mt-5 border-gold/40 bg-gold/10 p-4">
          <h2 className="flex items-center gap-2 font-600 text-charcoal">
            <ShieldAlert size={16} className="text-gold" /> Accounts are switched
            off in this build
          </h2>
          <p className="mt-1 text-sm text-charcoal-soft">
            The <code>NEXT_PUBLIC_FIREBASE_*</code> variables were not present
            when this bundle was built. They are inlined at build time, so
            setting them in Vercel is not enough on its own —{" "}
            <b className="text-charcoal">you have to redeploy afterwards</b>.
          </p>
        </Card>
      )}

      <Card className="mt-5 p-4">
        <h2 className="mb-1 font-display text-lg font-700 text-charcoal">
          This deployment
        </h2>
        <Row
          label="Firebase configured"
          ok={isFirebaseConfigured()}
          value={isFirebaseConfigured() ? "yes" : "no"}
          hint="NEXT_PUBLIC_FIREBASE_API_KEY, PROJECT_ID and APP_ID"
        />
        <Row
          label="Cloud storage backend"
          ok={isCloudBackend()}
          value={isCloudBackend() ? "firebase" : "local"}
          hint="NEXT_PUBLIC_STORAGE_BACKEND — the kitchen and dashboard need this"
        />
        <Row
          label="Restaurant"
          ok={Boolean(restaurantId)}
          value={restaurantId || "—"}
          hint="NEXT_PUBLIC_RESTAURANT_ID"
        />
      </Card>

      <Card className="mt-5 p-4">
        <h2 className="mb-1 font-display text-lg font-700 text-charcoal">
          This account
        </h2>

        {!user ? (
          <EmptyState
            className="mt-3"
            title="Not signed in"
            hint="Sign in to see what your account can do."
            action={
              <Link
                href="/login?next=/account"
                className="inline-flex rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
              >
                Sign in
              </Link>
            }
          />
        ) : (
          <>
            <Row label="Signed in as" ok value={user.email ?? user.uid} />
            <Row
              label="Role on your token"
              ok={actualRole !== null}
              value={actualRole ?? "none"}
              hint={
                actualRole === null
                  ? "Nothing has ever stamped a role on this account"
                  : "Read from the ID token custom claim"
              }
            />
            {viewAs && (
              <Row
                label="Currently viewing as"
                ok
                value={viewAs}
                hint="Preview only — your real access is unchanged"
              />
            )}
            <Row
              label="Staff areas"
              ok={isStaff(role)}
              value={isStaff(role) ? "unlocked" : "locked"}
              hint="Kitchen board and, for admins, the dashboard"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={refresh}
                disabled={busy}
                icon={<RefreshCw size={15} />}
              >
                {busy ? "Refreshing…" : "Refresh my access"}
              </Button>
              <RoleBadge role={actualRole} />
            </div>
            <p className="mt-2 text-xs text-charcoal-soft">
              Forces a new ID token. Use this if someone has just granted you a
              role — a token issued before the grant does not carry it.
            </p>
          </>
        )}
      </Card>

      {/* Editing your own details, and the way out. */}
      <AccountProfile />

      {user && actualRole === null && (
        <Card className="mt-5 p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            No role? Check these, in order
          </h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-charcoal-soft">
            <li>
              The Cloud Functions are deployed —{" "}
              <code>firebase deploy --only functions</code>. The trigger that
              stamps roles is the only thing that can create the first admin.
            </li>
            <li>
              <code>ADMIN_EMAILS</code> is set in Secret Manager and contains{" "}
              <b className="text-charcoal">{user.email}</b> exactly.
            </li>
            <li>
              Your account was created <i>after</i> both of those. The trigger
              runs on sign-up only and never backfills — if this account is
              older, delete it and sign up again, or set the claim directly in
              the Firebase console.
            </li>
          </ol>
        </Card>
      )}
    </main>
  );
}
