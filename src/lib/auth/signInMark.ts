/**
 * A one-shot mark that a credential sign-in just happened in this tab.
 *
 * `/api/auth/sync` is reconciliation, not authentication, and four things call
 * it: the provider on every page load (its guard is a ref, so a refresh re-runs
 * it), the staff-intent hand-off the moment a sign-in resolves, the "Refresh my
 * access" button, and staff activation. Stamping a sign-in on all of them turned
 * `loginCount` into a page-load counter that the owner dashboard presented as
 * sign-ins, and a single staff sign-in counted twice.
 *
 * So the credential handlers mark, and whichever reconciliation runs first
 * claims the mark. Exactly one stamp per real sign-in, however many callers
 * reconcile afterwards.
 *
 * Module state rather than storage: the mark must not outlive the tab, and it
 * must not be readable by a later session. There is nothing to clean up.
 */
let pending = false;

/** Called immediately after Firebase accepts a credential. */
export function markCredentialSignIn(): void {
  pending = true;
}

/** Consumes the mark. True at most once per sign-in. */
export function takeCredentialSignIn(): boolean {
  const was = pending;
  pending = false;
  return was;
}
