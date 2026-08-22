"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LogOut, Save, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isCloudBackend } from "@/lib/storage";
import { authErrorMessage } from "@/lib/auth/errors";
import { readStoredProfile } from "@/lib/auth/profile";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

/**
 * The details a person can actually change about themselves, and the way out.
 *
 * `phone` and `defaultAddress` were declared on UserProfile and read by
 * submitOrder — which copies the phone onto every order for the kitchen — but
 * nothing in the app had ever written either of them, so a delivery reached
 * the kitchen with no way to call the customer. `displayName` was settable
 * only during sign-up.
 *
 * The security rules already allow exactly these three fields: they are absent
 * from the `notTouching` lock list that protects role, rid, uid, createdAt and
 * roleUpdatedAt.
 */
export default function AccountProfile() {
  const { user, enabled, signOut } = useAuth();
  const router = useRouter();
  const { show } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultAddress, setDefaultAddress] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  /**
   * Seed from the profile document, falling back to the Auth record so the
   * field is never blank for someone who has a name but no document yet.
   */
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    if (!isCloudBackend()) {
      setLoaded(true);
      return;
    }
    let active = true;
    void (async () => {
      const profile = await readStoredProfile(user.uid);
      if (!active) return;
      if (profile?.displayName) setDisplayName(profile.displayName);
      setPhone(profile?.phone ?? "");
      setDefaultAddress(profile?.defaultAddress ?? "");
      setLoaded(true);
    })().catch(() => {
      // Leave the Auth-derived name in place and let the form be used.
      if (active) setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const name = displayName.trim();
      const [{ getDb }, { doc, setDoc }] = await Promise.all([
        import("@/lib/storage/firebaseClient"),
        import("firebase/firestore"),
      ]);
      await setDoc(
        doc(getDb(), "users", user.uid),
        {
          uid: user.uid,
          displayName: name,
          phone: phone.trim(),
          defaultAddress: defaultAddress.trim(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Mirror the name onto the Auth record too, so the header avatar and any
      // token-derived fallback agree with the profile.
      if (name && name !== user.displayName) {
        const { updateProfile } = await import("firebase/auth");
        await updateProfile(user, { displayName: name });
      }
      show("Your details are saved.");
    } catch (cause) {
      show(authErrorMessage(cause), "error");
    } finally {
      setSaving(false);
    }
  }

  /** Password accounts only — a Google account has no password here to change. */
  const hasPassword = user.providerData.some((p) => p.providerId === "password");

  async function sendReset() {
    if (!user?.email) return;
    setResetting(true);
    try {
      const [{ getAuthClient }, { sendPasswordResetEmail }] = await Promise.all([
        import("@/lib/storage/firebaseAuth"),
        import("firebase/auth"),
      ]);
      await sendPasswordResetEmail(getAuthClient(), user.email);
      show("Check your inbox for the reset link.");
    } catch (cause) {
      show(authErrorMessage(cause), "error");
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <Card className="mt-5 p-4">
        <h2 className="mb-1 font-display text-lg font-700 text-charcoal">
          Your details
        </h2>
        <p className="mb-3 text-sm text-charcoal-soft">
          The kitchen sees your name on every order, and needs a phone number to
          reach you about a delivery.
        </p>

        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Name" hint="Shown to the kitchen on your order">
            {(id) => (
              <Input
                id={id}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Mario"
                disabled={!loaded}
              />
            )}
          </Field>

          <Field label="Phone" hint="For deliveries">
            {(id) => (
              <Input
                id={id}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="+62 812 3456 7890"
                disabled={!loaded}
              />
            )}
          </Field>

          <Field
            label="Default delivery address"
            hint="Pre-fills the submit screen"
          >
            {(id) => (
              <Input
                id={id}
                value={defaultAddress}
                onChange={(e) => setDefaultAddress(e.target.value)}
                autoComplete="street-address"
                placeholder="Jl. Raya Canggu 1, Bali"
                disabled={!loaded}
              />
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !loaded}
              icon={<Save size={15} />}
            >
              {saving ? "Saving…" : "Save details"}
            </Button>
            {hasPassword && (
              <Button
                type="button"
                onClick={sendReset}
                disabled={resetting}
                icon={<KeyRound size={15} />}
              >
                {resetting ? "Sending…" : "Change password"}
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card className="mt-5 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">
          Sign out
        </h2>
        <p className="mt-1 text-sm text-charcoal-soft">
          Your plan stays in your account and follows you to your next sign-in.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={!enabled}
          icon={<LogOut size={15} />}
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
        >
          Sign out
        </Button>
      </Card>
    </>
  );
}
