"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { UtensilsCrossed } from "lucide-react";
import { getAuthClient } from "@/lib/storage/firebaseAuth";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isFirebaseConfigured } from "@/lib/firebaseEnv";
import { authErrorMessage } from "@/lib/auth/errors";
import {
  DEFAULT_NEXT,
  authUrl,
  readIntent,
  safeNext,
  type AuthIntent,
} from "@/lib/auth/next";
import { policyFor } from "@/lib/auth/routePolicy";
import { resolveStaffDestination } from "@/lib/auth/staffIntent";
import { markCredentialSignIn } from "@/lib/auth/signInMark";
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

/**
 * Writes the chosen name over whatever the sign-in stamp guessed.
 *
 * `uid` is included because this races the account-creation trigger: if it
 * lands first the merge is a *create*, and the security rules require a
 * document to name its own owner before they will accept one.
 */
async function saveDisplayName(uid: string, displayName: string) {
  const [{ getDb }, { doc, setDoc }] = await Promise.all([
    import("@/lib/storage/firebaseClient"),
    import("firebase/firestore"),
  ]);
  await setDoc(
    doc(getDb(), "users", uid),
    { uid, displayName, updatedAt: new Date().toISOString() },
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
 * sent on signup, and ordinary use is not gated on it — making someone check
 * their inbox before their first order is the surest way to lose them. Owner
 * access is the one exception: that requires a confirmed address, so that
 * nobody who merely knows an owner's email can register it and claim the
 * restaurant.
 */
export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  // Sanitised, because anyone can hand out a `/login?next=…` link and this
  // value is handed straight to the router. Empty when none was asked for,
  // which is different from "/plan": a staff sign-in with no destination of
  // its own belongs in the kitchen, not the planner.
  const requested = safeNext(params?.get("next"), "");
  const next = requested || DEFAULT_NEXT;
  /**
   * Which journey brought them here, carried in the URL.
   *
   * The URL is the only store it needs: it survives a refresh, it survives
   * the switch between Sign in and Create account, and `signInWithPopup`
   * never leaves the page, so it survives Google too.
   */
  const urlIntent = readIntent(params?.get("intent"));
  const { user, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupIntent, setSignupIntent] = useState<AuthIntent>(urlIntent ?? "customer");

  const configured = isFirebaseConfigured();
  const copy = COPY[mode];
  /**
   * Guards the send-onward against running twice.
   *
   * Two paths reach it: the submit handler, and the effect that notices somebody
   * is already signed in — and a successful sign-in triggers both. Once is
   * enough, and for staff intent it also keeps a single sign-in from asking the
   * request API twice.
   */
  const landed = useRef(false);
  // Login has no radio, so the URL is the only signal there.
  const intent: AuthIntent = mode === "signup" ? signupIntent : urlIntent ?? "customer";

  /**
   * Sends someone on once they are authenticated.
   *
   * Staff intent cannot be honoured by a plain redirect: the same click has to
   * work for an approved cook, for an existing customer, and for somebody who
   * was turned down last month. Pushing all three at `/kitchen` and letting
   * authorization fail is what made staff onboarding look broken.
   */
  const land = useCallback(
    async (how: "push" | "replace" = "push") => {
      if (landed.current) return;
      landed.current = true;
      try {
        // Someone who arrived on the staff CTA and then chose "For myself" has
        // changed their mind: `next` still says /kitchen, and honouring it would
        // land them on the staff-access panel they just declined.
        //
        // Only a *staff* destination is discarded. This used to drop any route
        // with a role policy, which was the same thing until the customer's own
        // screens became role routes — after which asking for /orders, /plan or
        // /report before signing in silently landed you on /plan instead.
        const nextPolicy = policyFor(next);
        const customerNext =
          nextPolicy.kind === "role" && nextPolicy.staffIntent ? DEFAULT_NEXT : next;
        const to =
          intent === "staff"
            ? await resolveStaffDestination(requested)
            : customerNext;
        if (how === "replace") router.replace(to);
        else router.push(to);
      } catch (cause) {
        // The latch exists to stop a double send-onward, not to make one
        // failure permanent. Left set, a single failed staff lookup meant every
        // later attempt returned at the first line: the form reported a
        // successful sign-in and then sat there, doing nothing, forever.
        landed.current = false;
        throw cause;
      }
    },
    [intent, next, requested, router]
  );

  /**
   * Someone already signed in has nothing to do on this screen. Showing them
   * the sign-in form again is a dead end: the form succeeds, and they are left
   * looking at it. Password reset is exempt — that is still a sensible thing to
   * ask for while signed in.
   *
   * Staff intent is resolved here too. An existing customer who clicks "I work
   * at Negrita" while already signed in must reach the request flow, not be
   * dropped at a kitchen they cannot open.
   */
  useEffect(() => {
    if (mode === "reset" || authLoading || !user) return;
    // Say so if the send-onward fails rather than leaving somebody signed in
    // and staring at a sign-in form. The latch is released either way, so the
    // next attempt is a real one.
    land("replace").catch((cause) => setError(authErrorMessage(cause)));
  }, [mode, authLoading, user, land]);

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
      const client = getAuthClient();

      if (mode === "reset") {
        await sendPasswordResetEmail(client, email.trim());
        setNotice("Check your inbox for the reset link.");
        return;
      }

      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(
          client,
          email.trim(),
          password
        );
        // Before anything else that awaits. Creating the account fires the auth
        // observer immediately, and the provider reconciles off the back of it —
        // a mark left after the profile writes would arrive too late to be
        // claimed, and the first sign-in of every new account would go uncounted.
        markCredentialSignIn();
        if (name.trim()) {
          await updateProfile(credential.user, { displayName: name.trim() });
          // The profile document is stamped the instant the account exists,
          // which is before updateProfile resolves — so without this the name
          // the person just typed is replaced by the local part of their email.
          await saveDisplayName(credential.user.uid, name.trim());
        }
        // This comment claimed verification was sent from the day the file was
        // written, and nothing ever sent it. Password accounts therefore stayed
        // unverified forever — and owner access is only granted to a confirmed
        // address, so an owner who signed up with a password could never become
        // admin no matter what ADMIN_EMAILS said.
        //
        // Not awaited into the failure path: a rate-limited or bounced
        // verification email must not fail an account that already exists.
        // /account offers "Confirm my email" for exactly that case.
        try {
          await sendEmailVerification(credential.user);
        } catch (cause) {
          console.error("Could not send the verification email:", cause);
        }
      } else {
        await signInWithEmailAndPassword(client, email.trim(), password);
        markCredentialSignIn();
      }
      await land();
    });
  }

  function google() {
    void withBusy(async () => {
      await signInWithPopup(getAuthClient(), new GoogleAuthProvider());
      markCredentialSignIn();
      await land();
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

        {intent === "staff" && mode !== "reset" && (
          <p className="mt-3 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-charcoal">
            Signing in to work at Negrita. We will check your access and, if you
            do not have it yet, ask the owner to approve you.
          </p>
        )}

        {!configured && (
          <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-charcoal">
            Accounts are not switched on for this deployment yet, and Mamma
            Calories needs one. The NEXT_PUBLIC_FIREBASE_ variables are inlined
            at build time, so the site has to be redeployed after they are set.
          </p>
        )}

        {mode === "signup" && (
          <fieldset className="mt-5">
            <legend className="text-sm font-700 text-charcoal">How will you use this account?</legend>
            <div className="mt-2 grid gap-2">
              <label className={`cursor-pointer rounded-xl border p-3 ${signupIntent === "customer" ? "border-tomato bg-tomato/5" : "border-cream-deep"}`}>
                <input className="sr-only" type="radio" name="intent" checked={signupIntent === "customer"} onChange={() => setSignupIntent("customer")} />
                <span className="block text-sm font-700 text-charcoal">For myself</span>
                <span className="block text-xs text-charcoal-soft">Plan meals, track macros and order food</span>
              </label>
              <label className={`cursor-pointer rounded-xl border p-3 ${signupIntent === "staff" ? "border-tomato bg-tomato/5" : "border-cream-deep"}`}>
                <input className="sr-only" type="radio" name="intent" checked={signupIntent === "staff"} onChange={() => setSignupIntent("staff")} />
                <span className="block text-sm font-700 text-charcoal">I work at the restaurant</span>
                <span className="block text-xs text-charcoal-soft">Access kitchen and restaurant tools</span>
                <span className="block text-xs font-600 text-tomato-dark">Requires approval from the restaurant owner</span>
              </label>
            </div>
          </fieldset>
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
                <Link href={authUrl("signup", { next, intent })} className="font-600 text-tomato hover:underline">
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
              <Link href={authUrl("login", { next, intent })} className="font-600 text-tomato hover:underline">
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
        Your plan, orders and preferences stay with your account, on every
        device you sign in on.
      </p>
    </main>
  );
}
