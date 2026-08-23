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
  /** False when the app has no Firebase config — guest-only mode. */
  enabled: boolean;
  /** Forces a token refresh, picking up a role granted since sign-in. */
  refreshRole: () => Promise<Role | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Tab-scoped, so a preview ends with the tab. */
const VIEW_AS_KEY = "mamma-calories:view-as";

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
  const [viewAs, setViewAsState] = useState<Role | null>(null);
  const [loading, setLoading] = useState(enabled);

  // Guards the sync so a token refresh does not count as a new sign-in.
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const teardown: Array<() => void> = [];

    async function readRole(current: User | null) {
      if (!current) {
        setActualRole(null);
        return;
      }
      const token = await current.getIdTokenResult();
      if (!disposed) {
        setActualRole((token.claims.role as Role | undefined) ?? null);
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
          setUser(current);
          await readRole(current);
          if (!disposed) setLoading(false);
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
  useEffect(() => {
    if (!user || syncedFor.current === user.uid) return;
    syncedFor.current = user.uid;

    void (async () => {
      const { callApi } = await import("@/lib/api");
      const { role, changed } = await callApi<{ role: Role; changed: boolean }>(
        "/api/auth/sync"
      );
      if (changed) {
        // The claim is on the account but not yet on this token.
        await user.getIdTokenResult(true);
      }
      setActualRole(role);
    })().catch(() => {
      // An unreachable server must never block signing in — the app still
      // works as a guest would. Retried on the next load.
      syncedFor.current = null;
    });
  }, [user]);

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

  // Restore a preview after a reload, once we know the viewer really is admin.
  useEffect(() => {
    if (actualRole !== "admin") {
      setViewAsState(null);
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(VIEW_AS_KEY) as Role | null;
      if (saved === "client" || saved === "restaurant") setViewAsState(saved);
    } catch {
      // Nothing to restore.
    }
  }, [actualRole]);

  const signOut = useCallback(async () => {
    if (!enabled) return;
    syncedFor.current = null;
    setViewAsState(null);
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
      enabled,
      refreshRole,
      signOut,
    }),
    [user, actualRole, viewAs, setViewAs, loading, enabled, refreshRole, signOut]
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
      enabled: false,
      refreshRole: async () => null,
      signOut: async () => {},
    }
  );
}

/** Convenience: does this viewer have staff-level access? */
export function isStaff(role: Role | null): boolean {
  return role === "restaurant" || role === "admin";
}
