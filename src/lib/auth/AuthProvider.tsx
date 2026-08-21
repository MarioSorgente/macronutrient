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
  /** Read from the ID token claim, not from any document. */
  role: Role | null;
  restaurantId: string;
  /** True until Firebase has reported the initial auth state. */
  loading: boolean;
  /** False when the app has no Firebase config — guest-only mode. */
  enabled: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

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
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(enabled);

  // Guards the login stamp so a token refresh does not count as a new sign-in.
  const stampedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const teardown: Array<() => void> = [];

    async function readRole(current: User | null) {
      if (!current) {
        setRole(null);
        return;
      }
      const token = await current.getIdTokenResult();
      if (!disposed) setRole((token.claims.role as Role | undefined) ?? null);
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

  // Record the sign-in. This is the only source of the "logins" and "active
  // users" figures on the owner dashboard — Firebase Auth does not surface
  // sign-in events to Firestore.
  useEffect(() => {
    if (!user || stampedFor.current === user.uid) return;
    stampedFor.current = user.uid;

    void (async () => {
      const [{ getDb }, { doc, increment, setDoc }] = await Promise.all([
        import("@/lib/storage/firebaseClient"),
        import("firebase/firestore"),
      ]);
      const now = new Date().toISOString();
      await setDoc(
        doc(getDb(), "users", user.uid),
        {
          uid: user.uid,
          email: user.email ?? "",
          displayName: user.displayName ?? user.email?.split("@")[0] ?? "",
          ...(user.photoURL ? { photoURL: user.photoURL } : {}),
          lastLoginAt: now,
          loginCount: increment(1),
          updatedAt: now,
        },
        { merge: true }
      );
    })().catch(() => {
      // A failed metrics write must never block signing in.
    });
  }, [user]);

  // A role change bumps `roleUpdatedAt`; refreshing the token picks up the new
  // claim in seconds instead of at the next hourly refresh.
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

      let lastSeen: string | undefined;
      unsubscribe = onSnapshot(doc(getDb(), "users", user.uid), (snap) => {
        const next = snap.data()?.roleUpdatedAt as string | undefined;
        if (next && lastSeen && next !== lastSeen) void user.getIdToken(true);
        lastSeen = next;
      });
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [user]);

  const signOut = useCallback(async () => {
    if (!enabled) return;
    stampedFor.current = null;
    const [{ getAuthClient }, { signOut: fbSignOut }] = await Promise.all([
      import("@/lib/storage/firebaseAuth"),
      import("firebase/auth"),
    ]);
    await fbSignOut(getAuthClient());
  }, [enabled]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      restaurantId: RESTAURANT_ID,
      loading,
      enabled,
      signOut,
    }),
    [user, role, loading, enabled, signOut]
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
      restaurantId: RESTAURANT_ID,
      loading: false,
      enabled: false,
      signOut: async () => {},
    }
  );
}

/** Convenience: does this viewer have staff-level access? */
export function isStaff(role: Role | null): boolean {
  return role === "restaurant" || role === "admin";
}
