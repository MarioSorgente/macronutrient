"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { UtensilsCrossed } from "lucide-react";
import { getAuthClient } from "@/lib/storage/firebaseAuth";
import { isFirebaseConfigured } from "@/lib/firebaseEnv";
import { authErrorMessage } from "@/lib/auth/errors";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";

export type AuthMode = "login" | "signup" | "reset";

const COPY: Record<AuthMode, { title: string; blurb: string; submit: string }> = {
  login: {
    title: "Welcome back",
    blurb: "Sign in to pick up your week where you left it.",
    submit: "Sign in",
  },
  signup: {
    title: "Create your account",
    blurb: "So your plan follows you between devices — and so the kitchen knows who to cook for.",
    submit: "Create account",
  },
  reset: {
    title: "Reset your password",
    blurb: "We will email you a link to set a new one.",
    submit: "Send reset link",
  },
};

/** Writes the chosen name over whatever the sign-in stamp guessed. */
async function saveDisplayName(uid: string, displayName: string) {
  const [{ getDb }, { doc, setDoc }] = await Promise.all([
    import("@/lib/storage/firebaseClient"),
    import("firebase/firestore"),
  ]);
  await setDoc(
    doc(getDb(), "users", uid),
    { displayName, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/** Google's brandmark, inlined — the app carries no image assets. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.4-4.6 7l7.6 5.9c4.4-4.1 6.7-10.750 6.7-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-3.7-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/**
 * One form for signing in, signing up and resetting a password.
 *
 * The three screens differ by a field and a verb, so they share a component
 * rather than existing as three near-identical files. Email verification is
 * sent on signup but nothing is gated on it — making someone check their inbox
 * before their first order is the surest way to lose them.
 */
export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next") || "/plan";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const configured = isFirebaseConfigured();
  const copy = COPY[mode];

  async function withBusy(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void withBusy(async () => {
      const auth = getAuthClient();

      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice("Check your inbox for the reset link.");
        return;
      }

      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (name.trim()) {
          await updateProfile(credential.user, { displayName: name.trim() });
          // The profile document is stamped the instant the account exists,
          // which is before updateProfile resolves — so without this the name
          // the person just typed is replaced by the local part of their email.
          await saveDisplayName(credential.user.uid, name.trim());
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      router.push(next);
    });
  }

  function google() {
    void withBusy(async () => {
      await signInWithPopup(getAuthClient(), new GoogleAuthProvider());
      router.push(next);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-3 self-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream shadow-card">
          <UtensilsCrossed size={20} strokeWidth={2.2} />
        </span>
        <span className="font-display text-xl font-700 text-charcoal">
          Mamma Calories
        </span>
      </Link>

      <Card className="p-6">
        <h1 className="font-display text-2xl font-700 text-charcoal">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-charcoal-soft">{copy.blurb}</p>

        {!configured && (
          <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-charcoal">
            Accounts are not switched on for this deployment yet. You can still
            plan your week as a guest — it is saved on this device.
          </p>
        )}

        {mode !== "reset" && (
          <>
            <Button
              variant="secondary"
              fullWidth
              className="mt-5"
              disabled={!configured || busy}
              onClick={google}
              icon={<GoogleMark />}
            >
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-cream-deep" />
              <span className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
                or
              </span>
              <span className="h-px flex-1 bg-cream-deep" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <Field label="Your name" hint="Shown to the kitchen on your order">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Mario"
                />
              )}
            </Field>
          )}

          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            )}
          </Field>

          {mode !== "reset" && (
            <Field
              label="Password"
              hint={mode === "signup" ? "At least 6 characters" : undefined}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                />
              )}
            </Field>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
            >
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-basil/30 bg-basil/10 px-3 py-2 text-sm font-600 text-basil">
              {notice}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={!configured || busy}
          >
            {busy ? "Working…" : copy.submit}
          </Button>
        </form>

        <div className="mt-5 flex flex-col gap-1 text-sm text-charcoal-soft">
          {mode === "login" && (
            <>
              <p>
                New here?{" "}
                <Link href="/signup" className="font-600 text-tomato hover:underline">
                  Create an account
                </Link>
              </p>
              <p>
                <Link href="/reset" className="font-600 text-tomato hover:underline">
                  Forgot your password?
                </Link>
              </p>
            </>
          )}
          {mode === "signup" && (
            <p>
              Already have an account?{" "}
              <Link href="/login" className="font-600 text-tomato hover:underline">
                Sign in
              </Link>
            </p>
          )}
          {mode === "reset" && (
            <p>
              <Link href="/login" className="font-600 text-tomato hover:underline">
                Back to sign in
              </Link>
            </p>
          )}
        </div>
      </Card>

      <p className="mt-6 text-center text-xs text-charcoal-soft">
        You can keep planning as a guest —{" "}
        <Link href="/plan" className="font-600 text-tomato hover:underline">
          skip for now
        </Link>
      </p>
    </main>
  );
}
