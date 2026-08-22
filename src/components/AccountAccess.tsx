"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import { isFirebaseConfigured } from "@/lib/firebaseEnv";
import { isCloudBackend } from "@/lib/storage";
import type { Role } from "@/lib/storage/types";
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
    setViewAs,
    restaurantId,
    enabled,
    loading,
    refreshRole,
  } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  /** Set once the viewer has asked for a refresh and still come back empty. */
  const [triedRefresh, setTriedRefresh] = useState(false);
  const [verifying, setVerifying] = useState(false);

  /**
   * Owner access requires a confirmed address, so an unverified one is the
   * quiet reason a person on the allowlist is still a customer. The client
   * already knows its own verification state, so saying this reveals nothing
   * the server would not: it is not a hint about who is on the allowlist.
   */
  const unverified = Boolean(user) && user?.emailVerified === false;

  async function sendVerification() {
    if (!user) return;
    setVerifying(true);
    try {
      const { sendEmailVerification } = await import("firebase/auth");
      await sendEmailVerification(user);
      show("Verification email sent. Open the link, then sign in again.");
    } catch (cause) {
      show(authErrorMessage(cause), "error");
    } finally {
      setVerifying(false);
    }
  }

  /**
   * Refreshes the token, and first gives the owner bootstrap a chance to run.
   *
   * claimAdminAccess grants admin only to an address on the server-side
   * ADMIN_EMAILS allowlist, so calling it for everyone is safe — a customer
   * simply gets permission-denied, which is the expected answer and not worth
   * showing them. Without this the button could only ever report the deadlock:
   * onUserCreate never backfills, and setUserRole needs an admin to already
   * exist.
   */
  async function refresh() {
    setBusy(true);
    setTriedRefresh(true);
    try {
      if (isCloudBackend()) {
        try {
          const [{ getFunctionsClient }, { httpsCallable }] = await Promise.all([
            import("@/lib/storage/firebaseFunctions"),
            import("firebase/functions"),
          ]);
          await httpsCallable(getFunctionsClient(), "claimAdminAccess")({});
        } catch {
          // Not on the allowlist, or the functions are not deployed. Either
          // way the refresh below still reports the truth.
        }
      }
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

  /**
   * Deployment internals are for whoever can act on them.
   *
   * A diner has no use for environment variable names, Secret Manager or a
   * deploy command, and showing them is needless detail about how access is
   * gated.
   *
   * "No role yet" is deliberately not enough to qualify. A brand-new account's
   * ID token is minted before onUserCreate stamps the claim, so every customer
   * is briefly roleless and would otherwise be shown the developer panel for
   * the few seconds until their token refreshes. Asking for a refresh and
   * still coming back with nothing is the real signal that someone is stuck.
   */
  const stuck = Boolean(user) && actualRole === null && triedRefresh;
  const showDiagnostics = isStaff(actualRole) || stuck;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
        Account &amp; access
      </h1>
      <p className="mt-1 text-sm text-charcoal-soft">
        {showDiagnostics
          ? "What this deployment thinks you can do, and where to look if it is wrong."
          : "Your details, what this account can do, and how to sign out."}
      </p>

      {!enabled && showDiagnostics && (
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

      {showDiagnostics && (
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
      )}

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
            {unverified && (
              <Row
                label="Email confirmed"
                ok={false}
                value="no"
                hint="Owner access is only granted to a confirmed address"
              />
            )}

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
              {unverified && (
                <Button onClick={sendVerification} disabled={verifying}>
                  {verifying ? "Sending…" : "Confirm my email"}
                </Button>
              )}
            </div>
            {unverified && actualRole !== "admin" && (
              <p className="mt-2 text-xs text-charcoal-soft">
                If you are the owner, confirm your email first — owner access is
                only granted to a confirmed address, so that nobody who merely
                knows it can claim the restaurant. It is applied automatically
                the next time you sign in.
              </p>
            )}

            {/* Previewing another role, next to the real one it is previewing
                instead of only inside the avatar menu, which is where people
                looked for it and did not find it. */}
            {actualRole === "admin" && (
              <div className="mt-4 rounded-xl border border-cream-deep bg-white p-3">
                <p className="flex items-center gap-1.5 text-sm font-600 text-charcoal">
                  <Eye size={15} className="text-charcoal-soft" /> View as
                </p>
                <p className="mt-0.5 text-xs text-charcoal-soft">
                  See the app as another role. This changes what you see, not
                  what you can read — your own access is unchanged.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(["client", "restaurant", "admin"] as Role[]).map((option) => {
                    const active =
                      option === "admin" ? viewAs === null : viewAs === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setViewAs(option === "admin" ? null : option)}
                        className={
                          "rounded-lg px-3 py-1.5 text-xs font-600 capitalize transition-colors " +
                          (active
                            ? "bg-tomato text-cream"
                            : "border border-cream-deep bg-white text-charcoal-soft hover:text-charcoal")
                        }
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-charcoal-soft">
              Forces a new ID token. Use this if someone has just granted you a
              role — a token issued before the grant does not carry it.
            </p>
          </>
        )}
      </Card>

      {/* Editing your own details, and the way out. */}
      <AccountProfile />

      {stuck && user && (
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
              Then press <b className="text-charcoal">Refresh my access</b>{" "}
              above. The sign-up trigger never backfills, so an account older
              than the deploy needs this to claim the role.
            </li>
            <li>
              Still nothing? Grant it directly, from a machine with project
              access:{" "}
              <code>node functions/scripts/grant-role.mjs {user.email} admin</code>
              . The Firebase console has no editor for custom claims, so this
              cannot be done by hand in a browser.
            </li>
          </ol>
        </Card>
      )}
    </main>
  );
}
