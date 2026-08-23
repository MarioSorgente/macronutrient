"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import { isFirebaseConfigured } from "@/lib/firebaseEnv";
import { isCloudBackend } from "@/lib/storage";
import { authErrorMessage } from "@/lib/auth/errors";
import { ApiError } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SignInPrompt from "@/components/SignInPrompt";
import RoleBadge from "@/components/RoleBadge";
import AccountProfile from "@/components/AccountProfile";
import ViewAsSwitch from "@/components/ViewAsSwitch";
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
    syncError,
    syncAccount,
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
   * Re-runs the reconciliation, then re-reads the token.
   *
   * The order matters: `/api/auth/sync` is what actually stamps the claim —
   * including granting owner access to an allowlisted address — and refreshing
   * a token first would only re-read the absence of one.
   *
   * This called the `claimAdminAccess` Cloud Function until now, and swallowed
   * the failure. That function no longer exists: the server moved into the Next
   * app, so the call could only ever fail, and the swallow meant the button
   * still reported "no role" as though the allowlist had rejected you. Errors
   * are shown now, for the same reason.
   */
  async function refresh() {
    setBusy(true);
    setTriedRefresh(true);
    try {
      const synced = isCloudBackend() ? await syncAccount() : null;
      const next = (await refreshRole()) ?? synced;
      show(
        next
          ? `Your role is "${next}".`
          : "Still no role on this account. The claim has never been set."
      );
    } catch (cause) {
      // An ApiError already carries the server's own wording; anything else is
      // a Firebase error and needs translating.
      show(
        cause instanceof ApiError ? cause.message : authErrorMessage(cause),
        "error"
      );
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
   * A diner has no use for environment variable names or Vercel settings, and
   * showing them is needless detail about how access is gated.
   *
   * "No role yet" is deliberately not enough to qualify. A brand-new account's
   * ID token is minted before /api/auth/sync stamps the claim, so every
   * customer is briefly roleless and would otherwise be shown the developer
   * panel for the few seconds until their token refreshes. Asking for a refresh
   * and still coming back with nothing is the real signal that someone is
   * stuck — as is a reconciliation that failed outright.
   */
  const stuck = Boolean(user) && actualRole === null && triedRefresh;
  // A failed reconciliation is a server fault, not a missing role, so it counts
  // as being stuck on its own — without it the panel below never appears and
  // the screen just says your role is "none".
  const showDiagnostics = isStaff(actualRole) || stuck || Boolean(syncError);

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

      {user && syncError && (
        <Card className="mt-5 border-tomato/40 bg-tomato/5 p-4">
          <h2 className="flex items-center gap-2 font-600 text-charcoal">
            <AlertTriangle size={16} className="text-tomato-dark" /> The server
            could not check your access
          </h2>
          <p className="mt-1 text-sm text-charcoal-soft">{syncError}</p>
          <p className="mt-2 text-sm text-charcoal-soft">
            Your role is decided by the server, so until this succeeds it stays
            as it is — whatever <code>ADMIN_EMAILS</code> says. This is a
            deployment problem, not a problem with your account.
          </p>
        </Card>
      )}

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
          <SignInPrompt
            className="mt-3"
            title="Not signed in"
            hint="Sign in to see what your account can do."
            next="/account"
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

            {/* Next to the real role it is previewing, rather than only inside
                the avatar menu, which is where people looked and did not find it. */}
            <ViewAsSwitch className="mt-4 rounded-xl border border-cream-deep bg-white p-3" />
            <p className="mt-2 text-xs text-charcoal-soft">
              Forces a new ID token. Use this if someone has just granted you a
              role — a token issued before the grant does not carry it.
            </p>
          </>
        )}
      </Card>

      {/* Editing your own details, and the way out. */}
      <AccountProfile />

      {(stuck || syncError) && user && (
        <Card className="mt-5 p-4">
          <h2 className="font-display text-lg font-700 text-charcoal">
            No role? Check these, in order
          </h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-charcoal-soft">
            <li>
              <code>ADMIN_EMAILS</code> and <code>FIREBASE_SERVICE_ACCOUNT</code>{" "}
              are set in <b className="text-charcoal">Vercel → Settings →
              Environment Variables</b>, and the allowlist contains{" "}
              <b className="text-charcoal">{user.email}</b> exactly.
            </li>
            <li>
              You have <b className="text-charcoal">redeployed since</b> setting
              them. An existing deployment does not pick up new variables.
            </li>
            <li>
              <code>/api/health</code> answers <code>200</code>. A 500 there
              means the server itself is not running, and no amount of
              configuration will grant a role until it is.
            </li>
            <li>
              Your email is confirmed. Owner access is only ever granted to a
              confirmed address, so that nobody who merely knows it can claim
              the restaurant.
            </li>
            <li>
              Then press <b className="text-charcoal">Refresh my access</b>{" "}
              above, or simply sign in again — the check runs on every sign-in.
            </li>
            <li>
              Still nothing? Grant it directly, from a machine with project
              access: <code>node scripts/grant-role.mjs {user.email} admin</code>
              . The Firebase console has no editor for custom claims, so this
              cannot be done by hand in a browser.
            </li>
          </ol>
        </Card>
      )}
    </main>
  );
}
