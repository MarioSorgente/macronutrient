/**
 * Firebase error codes turned into something a person can act on.
 *
 * The raw messages leak internals ("auth/invalid-credential") and are written
 * for developers. Anything unmapped falls through to a neutral line rather than
 * showing a code — but the original is logged so it is still debuggable.
 */
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That email address does not look right.",
  "auth/user-disabled": "This account has been disabled. Contact the restaurant.",
  "auth/user-not-found": "No account with that email. Try creating one.",
  "auth/wrong-password": "That password is not right.",
  "auth/invalid-credential": "That email and password do not match an account.",
  "auth/email-already-in-use": "There is already an account with that email — try signing in.",
  "auth/weak-password": "Use a password of at least 6 characters.",
  "auth/popup-closed-by-user": "The Google sign-in window closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and try again.",
  "auth/cancelled-popup-request": "Sign-in was cancelled.",
  "auth/account-exists-with-different-credential":
    "That email is already registered with a different sign-in method.",
  "auth/network-request-failed": "Could not reach the server. Check your connection.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/operation-not-allowed":
    "That sign-in method is not enabled for this project yet.",
  "auth/unauthorized-domain":
    "This domain is not authorised for sign-in. Add it in the Firebase console.",
  "permission-denied": "You do not have access to that.",
  unauthenticated: "Please sign in and try again.",
};

function codeOf(cause: unknown): string | null {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String((cause as { code: unknown }).code);
  }
  return null;
}

/**
 * Whether this is our own API refusing, rather than a library failing.
 *
 * `ApiError` carries the message the server chose to send — "Negrita is not
 * taking orders at the moment", "That plan does not exist" — which is the whole
 * reason the route bothered to write one. Matched by name rather than by
 * importing the class, so this stays a plain module the server can load too.
 */
function isServerRefusal(cause: unknown): cause is Error {
  return cause instanceof Error && cause.name === "ApiError" &&
    cause.message.trim().length > 0;
}

export function authErrorMessage(cause: unknown): string {
  const code = codeOf(cause);
  if (code && MESSAGES[code]) return MESSAGES[code];
  // Almost every caller of this hands it an API failure, not a Firebase one,
  // and the generic line below was throwing away the only sentence that
  // explained anything: a kitchen past its cutoff, a week already sent, an
  // order that no longer exists all read "Something went wrong. Please try
  // again." and left nothing to act on.
  if (isServerRefusal(cause)) return cause.message;
  if (code) console.error("Unmapped auth error:", code, cause);
  else console.error("Auth error:", cause);
  return "Something went wrong. Please try again.";
}

/**
 * Formats failures from a customer-facing Firestore order query.
 *
 * A failed precondition commonly means production has not finished building a
 * composite index. Keep that operational detail out of the customer message,
 * but make the console report specific enough to diagnose the deployment.
 */
export function ordersQueryErrorMessage(cause: unknown): string {
  if (codeOf(cause) === "failed-precondition") {
    console.error(
      "Orders query failed: a required Firestore composite index may be missing or still building.",
      cause
    );
    return "Orders are temporarily unavailable. Retry in a moment.";
  }

  return authErrorMessage(cause);
}
