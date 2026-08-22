/**
 * Reading `users/{uid}` for the purpose of filling in a form.
 *
 * This is not a plain getDoc, and it cannot be. AuthProvider stamps
 * `lastLoginAt`/`loginCount` on this same document on every sign-in, and while
 * that write is in flight Firestore answers a read with its latency-compensated
 * view: the pending mutation applied over whatever base the SDK holds, which on
 * a fresh page load is nothing. The caller gets a document containing only the
 * six fields the stamp wrote — no phone, no address — and a form seeded from it
 * renders empty over data that is sitting in Firestore untouched.
 *
 * `hasPendingWrites` is what distinguishes that view from the real thing, so we
 * wait for it to clear rather than trusting the first answer.
 */

export interface StoredProfile {
  displayName?: string;
  phone?: string;
  defaultAddress?: string;
}

const MAX_ATTEMPTS = 12;
const RETRY_MS = 150;

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * The stored profile, once no local write is pending over it.
 *
 * Falls back to the last view it managed to read rather than throwing: a
 * half-filled form is still usable, and the fields are re-read on the next
 * visit. Returns null only when the document does not exist.
 */
export async function readStoredProfile(
  uid: string
): Promise<StoredProfile | null> {
  const [{ getDb }, { doc, getDoc, getDocFromServer }] = await Promise.all([
    import("@/lib/storage/firebaseClient"),
    import("firebase/firestore"),
  ]);
  const ref = doc(getDb(), "users", uid);

  let last: Record<string, unknown> | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Offline, a server read throws; the cached copy beats nothing.
    const snap = await getDocFromServer(ref).catch(() => getDoc(ref));
    if (!snap.exists()) return null;
    last = snap.data() as Record<string, unknown>;
    if (!snap.metadata.hasPendingWrites) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }

  if (!last) return null;
  return {
    displayName: text(last.displayName),
    phone: text(last.phone),
    defaultAddress: text(last.defaultAddress),
  };
}
