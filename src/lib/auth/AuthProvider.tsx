"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import { RESTAURANT_ID, isFirebaseConfigured } from "@/lib/firebaseEnv";
import { ApiError } from "@/lib/api";
import { takeCredentialSignIn } from "@/lib/auth/signInMark";
import type { Role } from "@/lib/storage/types";

export interface AuthState {
  /** null when signed out, and while the first auth check is in flight. */
  user: User | null;
  /**
   * The role the UI should render for. Equals `actualRole` unless an admin is
   * previewing the app as someone else.
   */
  role: Role | null;
  /** The real custom claim. Never affected by "view as". */
  actualRole: Role | null;
  /** Set while an admin is previewing another role; null otherwise. */
  viewAs: Role | null;
  /**
   * Preview the app as another role. Admins only — anyone else is ignored.
   * Pass null to stop previewing.
   */
  setViewAs: (role: Role | null) => void;
  restaurantId: string;
  /** True until Firebase has reported the initial auth state. */
  loading: boolean;
  /**
   * True once this account's role is as good as it is going to get.
   *
   * A brand-new account's ID token is minted before `/api/auth/sync` stamps the
   * claim, so for a second every new customer looks roleless. Without this, a
   * role gate would greet them with "your account has no role yet" — blaming
   * the account for a race. Signed out counts as settled, as does a token that
   * already carries a claim; otherwise it waits for the first reconciliation to
   * resolve, whether it succeeds or fails.
   */
  roleSettled: boolean;
  /**
   * False when the app has no Firebase config, so nobody can sign in.
   *
   * Since an account is required, this is no longer a degraded mode the app
   * runs in — it is a broken deployment, and the guard says so rather than
   * bouncing people at a sign-in form that cannot work.
   */
  enabled: boolean;
  /** Forces a token refresh, picking up a role granted since sign-in. */
  refreshRole: () => Promise<Role | null>;
  /**
   * Why the last sign-in reconciliation failed, or null if it did not.
   *
   * Signing in must not fail because the server is unreachable, so the error is
   * caught — but it used to be discarded, and that turned "the server is
   * returning 500" into a screen that simply said your role was `none`. The
   * one thing it looked like was the one thing it was not: an allowlist that
   * did not recognise you. Held here so `/account` can say what really broke.
   */
  syncError: string | null;
  /** Re-runs the reconciliation `/api/auth/sync` does at sign-in. */
  syncAccount: () => Promise<Role | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Tab-scoped, so a preview ends with the tab. */
const VIEW_AS_KEY = "mamma-calories:view-as";

/** The saved admin preview, if the tab holds one. Never throws. */
function readStoredViewAs(): Role | null {
  try {
    const saved = window.sessionStorage.getItem(VIEW_AS_KEY);
    return saved === "client" || saved === "restaurant" ? saved : null;
  } catch {
    // Private browsing can refuse sessionStorage. No preview, no problem.
    return null;
  }
}

/**
 * Runs the reconciliation again once before giving up.
 *
 * The failure this exists for is a single dropped request — a fetch cancelled
 * by a navigation made moments after signing up, or a connection reset. One
 * blip left `syncError` set for the rest of the session, and `/account` treats
 * that as a stuck deployment: a diner who happened to lose one request was
 * shown environment variable names and a Vercel checklist.
 *
 * Once, not until it works. A server that is genuinely down should be reported
 * rather than hidden behind an indefinite retry.
 */
async function withOneRetry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    // A 4xx is the server deciding, not the network failing. "This is the last
    // owner" and "that claim key is not allowed" are the same answer twice, and
    // asking again only doubles the work and the sign-in stamp.
    if (cause instanceof ApiError && cause.status < 500) throw cause;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return work();
  }
}

/**
 * Holds the signed-in user and their role.
 *
 * Three things are deliberate here.
 *
 * The role comes from the ID token's custom claim rather than a Firestore
 * document, because a document is something a user could try to write.
 *
 * Custom claims only refresh when the token does, so promoting someone would
 * otherwise take up to an hour to take effect. The provider watches
 * `roleUpdatedAt` on the user's own document and forces a refresh.
 *
 * The Firebase SDK is imported dynamically, not at module scope. This provider
 * sits in the root layout, and a static import would put ~120 kB of SDK into
 * the first load of every page — including the public landing page, which never
 * touches Firebase at all.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isFirebaseConfigured();

  const [user, setUser] = useState<User | null>(null);
  const [actualRole, setActualRole] = useState<Role | null>(null);
  /**
   * Read at mount rather than restored by an effect.
   *
   * The effect version could not win the race it needed to. It only ran once
   * `actualRole` had landed, and it lives on the provider, so React flushed
   * RouteGuard below it first — which saw an admin on a customer-only page,
   * redirected to /admin, and only then was the preview restored, on a page the
   * admin had just been bounced off. Refreshing while previewing as a customer
   * therefore always threw the preview away.
   *
   * Reading it here is safe without knowing the role yet: `role` and `viewAs`
   * below both ignore this value unless `actualRole` is "admin", so a non-admin
   * with a stale key gets nothing from it. That is also what keeps hydration
   * clean -- `actualRole` is null on the server and on the first client render
   * alike, so nothing this value feeds reaches the DOM before they agree.
   */
  const [viewAs, setViewAsState] = useState<Role | null>(readStoredViewAs);
  const [loading, setLoading] = useState(enabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** Whether the first reconciliation for the current account has finished. */
  const [syncSettled, setSyncSettled] = useState(false);

  // Guards the sync so a token refresh does not count as a new sign-in.
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const teardown: Array<() => void> = [];

    /**
     * Reads the role off the token, and never throws.
     *
     * This is awaited inside the auth observer, immediately before `loading` is
     * cleared. An unguarded rejection here — offline, a revoked refresh token,
     * clock skew — threw straight out of the observer, so `loading` stayed true
     * and every protected route rendered "Checking your access..." for the rest
     * of the session. There is no recovery from that except a reload, and it
     * looks exactly like a hung app.
     *
     * Failing quietly is right: the reconciliation below asks the server for the
     * role anyway, and it reports its own errors on /account.
     */
    async function readRole(current: User | null) {
      if (!current) {
        setActualRole(null);
        return;
      }
      try {
        const token = await current.getIdTokenResult();
        if (!disposed) {
          setActualRole((token.claims.role as Role | undefined) ?? null);
        }
      } catch (cause) {
        console.error("Could not read the role from the ID token:", cause);
      }
    }

    void (async () => {
      const [{ getAuthClient }, { onAuthStateChanged, onIdTokenChanged }] =
        await Promise.all([
          import("@/lib/storage/firebaseAuth"),
          import("firebase/auth"),
        ]);
      if (disposed) return;

      const auth = getAuthClient();

      teardown.push(
        onAuthStateChanged(auth, async (current) => {
          if (disposed) return;

          if (!current) {
            // `signOut()` is not the only way a session can end. Firebase can
            // report a remote revocation, another tab signing out, or an
            // account deletion here, so session-scoped state must be cleared
            // at the auth boundary rather than only in our sign-out button.
            // In particular, releasing this guard lets the same UID reconcile
            // again if it subsequently signs in as a genuinely new session.
            syncedFor.current = null;
            setSyncSettled(false);
            setSyncError(null);
            setActualRole(null);
            setViewAsState(null);
            try {
              window.sessionStorage.removeItem(VIEW_AS_KEY);
            } catch {
              // Nothing to clear.
            }
          }

          setUser(current);
          try {
            await readRole(current);
          } finally {
            if (!disposed) setLoading(false);
          }
        })
      );

      // Fires on refresh as well as sign-in, which is how a newly granted role
      // reaches the UI without a reload.
      teardown.push(
        onIdTokenChanged(auth, (current) => {
          if (current && !disposed) void readRole(current);
        })
      );
    })();

    return () => {
      disposed = true;
      teardown.forEach((off) => off());
    };
  }, [enabled]);

  /**
   * Reconciles the account on every sign-in.
   *
   * One call now does what an auth trigger and a separate bootstrap callable
   * used to: it creates or refreshes the profile document, records the sign-in
   * for the owner dashboard, and stamps the role — including granting owner
   * access to an allowlisted address.
   *
   * Running on every sign-in rather than once at sign-up is the whole point.
   * The trigger it replaces never backfilled, so an account created before the
   * server was deployed could never become an admin at all.
   */
  const runSync = useCallback(async (current: User): Promise<Role | null> => {
    const { callApi } = await import("@/lib/api");
    const { role, changed } = await callApi<{ role: Role; changed: boolean }>(
      "/api/auth/sync",
      // Reconciliation runs on every page load, so it is not evidence of a
      // sign-in. It only reports one when a credential handler left the mark.
      { signIn: takeCredentialSignIn() }
    );

    /**
     * Refresh when the token cannot prove the role, not only when the server
     * just changed one.
     *
     * `changed` means the server wrote something on this call. It says nothing
     * about what this token carries. An owner granted admin on a previous call,
     * whose next page load raced the refresh, got `changed: false` and a role of
     * "admin" set from the server's word alone -- while `getIdToken()` still
     * handed out a token claiming "client". Every admin request then 403ed while
     * the UI showed the owner their own dashboard: "Could not load staff
     * requests", from a screen that had already decided they were the owner.
     *
     * Comparing against the claim on the token closes that gap for good, and
     * costs one cached read when they already agree.
     */
    const onToken = (await current.getIdTokenResult()).claims.role as Role | undefined;
    if (changed || (onToken ?? null) !== role) {
      await current.getIdTokenResult(true);
    }
    setActualRole(role);
    setSyncError(null);
    return role;
  }, []);

  useEffect(() => {
    if (!user || syncedFor.current === user.uid) return;
    syncedFor.current = user.uid;
    setSyncSettled(false);

    void withOneRetry(() => runSync(user))
      .catch((cause: unknown) => {
        // An unreachable server must never block signing in. Retried on the
        // next load, and, unlike before, reported on /account instead of
        // looking like an unrecognised address.
        syncedFor.current = null;
        setSyncError(
          cause instanceof Error ? cause.message : "Could not reach the server."
        );
      })
      // A failed reconciliation still settles the question: waiting longer will
      // not produce a role, so the gate must stop saying "checking" and start
      // saying what went wrong.
      .finally(() => setSyncSettled(true));
  }, [user, runSync]);

  /**
   * Runs the same reconciliation on demand, for the "Refresh my access" button.
   *
   * Throws rather than swallowing, because the button's whole job is to report
   * what it found — including a server that answered with an error.
   */
  const syncAccount = useCallback(async (): Promise<Role | null> => {
    if (!user) return null;
    try {
      return await runSync(user);
    } catch (cause) {
      setSyncError(
        cause instanceof Error ? cause.message : "Could not reach the server."
      );
      throw cause;
    }
  }, [user, runSync]);

  /**
   * Picks up a role granted since this token was issued.
   *
   * Compared against the token's own `authTime` rather than against a
   * previously-seen value. An earlier version only refreshed when it saw
   * `roleUpdatedAt` *change* while watching, which meant the very first
   * snapshot never triggered one — so a role granted while the user was signed
   * out stayed invisible until Firebase's hourly rotation. That is the "I am
   * the admin but there is no Admin link" case.
   */
  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      const [{ getDb }, { doc, onSnapshot }] = await Promise.all([
        import("@/lib/storage/firebaseClient"),
        import("firebase/firestore"),
      ]);
      if (disposed) return;

      unsubscribe = onSnapshot(
        doc(getDb(), "users", user.uid),
        (snap) => {
          const grantedAt = snap.data()?.roleUpdatedAt as string | undefined;
          if (!grantedAt || disposed) return;

          void (async () => {
            const token = await user.getIdTokenResult();
            const issuedAt = Date.parse(token.authTime);
            const granted = Date.parse(grantedAt);
            // A grant newer than the token means this token predates the role.
            if (Number.isFinite(granted) && granted > issuedAt) {
              const fresh = await user.getIdTokenResult(true);
              if (!disposed) {
                setActualRole((fresh.claims.role as Role | undefined) ?? null);
              }
            }
          })().catch(() => {
            // A refresh failure leaves the old claim in place; the user can
            // still force one from /account.
          });
        },
        (cause) => {
          // Previously swallowed: a denied read here looked like "no role".
          console.error("Could not watch for role changes:", cause);
        }
      );
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [user]);

  /** Forces a token refresh and returns the claim it found. */
  const refreshRole = useCallback(async (): Promise<Role | null> => {
    if (!user) return null;
    const token = await user.getIdTokenResult(true);
    const next = (token.claims.role as Role | undefined) ?? null;
    setActualRole(next);
    return next;
  }, [user]);

  /**
   * Only an admin may preview another role, and never while signed out.
   *
   * Kept in sessionStorage rather than in memory alone: a preview that silently
   * vanished on refresh would leave you wondering why the Admin link came back.
   * Session scope means it still ends when the tab does, so it cannot be
   * forgotten about indefinitely.
   */
  const setViewAs = useCallback(
    (next: Role | null) => {
      if (actualRole !== "admin") return;
      setViewAsState(next);
      try {
        if (next) window.sessionStorage.setItem(VIEW_AS_KEY, next);
        else window.sessionStorage.removeItem(VIEW_AS_KEY);
      } catch {
        // Private browsing can refuse sessionStorage; the preview still works
        // for this page, it just will not survive a reload.
      }
    },
    [actualRole]
  );

  /**
   * Drop a preview the viewer turns out not to be entitled to.
   *
   * The restore half of this used to live here too, and racing RouteGuard is why
   * it does not. `null` is deliberately not a demotion: it is also what the role
   * is for the first frames of every page load, and clearing on it threw the
   * preview away before the role had a chance to arrive -- which is the very
   * thing reading sessionStorage at mount was meant to stop. Signing out clears
   * the preview at the auth boundary, so nothing depends on this to do it.
   */
  useEffect(() => {
    if (actualRole !== null && actualRole !== "admin") setViewAsState(null);
  }, [actualRole]);

  const signOut = useCallback(async () => {
    if (!enabled) return;
    syncedFor.current = null;
    setViewAsState(null);
    setSyncError(null);
    try {
      window.sessionStorage.removeItem(VIEW_AS_KEY);
    } catch {
      // Nothing to clear.
    }
    const [{ getAuthClient }, { signOut: fbSignOut }] = await Promise.all([
      import("@/lib/storage/firebaseAuth"),
      import("firebase/auth"),
    ]);
    await fbSignOut(getAuthClient());
  }, [enabled]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      // Previewing only changes what is rendered; every read still goes out
      // with the real claim, because the security rules read the token.
      role: actualRole === "admin" && viewAs ? viewAs : actualRole,
      actualRole,
      viewAs: actualRole === "admin" ? viewAs : null,
      setViewAs,
      restaurantId: RESTAURANT_ID,
      loading,
      // Signed out settles it, and so does a token that already carries a
      // claim — a returning staff member must not be shown a loading screen
      // while a reconciliation they do not need finishes.
      roleSettled: !user || actualRole !== null || syncSettled,
      enabled,
      refreshRole,
      syncError,
      syncAccount,
      signOut,
    }),
    [
      user,
      actualRole,
      viewAs,
      setViewAs,
      loading,
      syncSettled,
      enabled,
      refreshRole,
      syncError,
      syncAccount,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Auth state for the current user.
 *
 * Safe to call anywhere: without a provider (or without Firebase configured)
 * it reports a signed-out, non-loading guest, which is exactly how the app
 * behaves before anyone logs in.
 */
export function useAuth(): AuthState {
  return (
    useContext(AuthContext) ?? {
      user: null,
      role: null,
      actualRole: null,
      viewAs: null,
      setViewAs: () => {},
      restaurantId: RESTAURANT_ID,
      loading: false,
      roleSettled: true,
      enabled: false,
      refreshRole: async () => null,
      syncError: null,
      syncAccount: async () => null,
      signOut: async () => {},
    }
  );
}

/** Convenience: does this viewer have staff-level access? */
export function isStaff(role: Role | null): boolean {
  return role === "restaurant" || role === "admin";
}
