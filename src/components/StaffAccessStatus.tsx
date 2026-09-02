"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth/AuthProvider";
import { ApiError, callApi, getApi } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth/errors";
import { STAFF_DESTINATION } from "@/lib/auth/staffIntent";
import type { StaffAccessRequest } from "@/lib/storage/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

type RequestState =
  | { status: "loading" }
  | { status: "loaded"; request: StaffAccessRequest | null }
  | { status: "error" };

type MutationState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

const LOAD_ERROR = "We couldn't check your restaurant access. Please try again.";

/** Keep API wording useful without displaying markup, control characters, or an unbounded response. */
function mutationErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "We couldn't request staff access. Please try again.";
  const message = cause.message
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return message || "We couldn't request staff access. Please try again.";
}

/**
 * Where a non-staff account stands on restaurant access, and what to do next.
 *
 * One component, two mount points: the card on `/account`, and the whole page
 * somebody sees when they open `/kitchen` without staff access. They were always
 * going to say the same four things, and the version on `/kitchen` used to say
 * none of them — it was a flat "This area is for Negrita staff" with no way
 * forward.
 *
 * The approved-but-stale case is the one that mattered most. Custom claims only
 * reach a browser when the token rotates, so for up to an hour after an owner
 * clicks Approve the app still believes you are a customer. The provider watches
 * for that and refreshes on its own; this offers the button for when it cannot,
 * so nobody has to understand Firebase tokens to start their shift.
 */
export default function StaffAccessStatus({
  variant = "account",
}: {
  variant?: "account" | "gate";
}) {
  const { user, actualRole, roleSettled, viewAs, setViewAs, syncAccount, refreshRole } =
    useAuth();
  const router = useRouter();
  // Read once on mount instead of through useSearchParams, which would drag a
  // Suspense boundary along wherever this is mounted — including the guard.
  const [justRequested, setJustRequested] = useState(false);

  const [requestState, setRequestState] = useState<RequestState>({ status: "loading" });
  const [mutationState, setMutationState] = useState<MutationState>({ status: "idle" });
  const [activating, setActivating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** So an approved request is only auto-activated once per mount. */
  const autoActivated = useRef(false);

  const staff = isStaff(actualRole);
  /**
   * An owner or cook looking at the gate through an admin preview.
   *
   * RouteGuard decides what to render from the *effective* role, so previewing
   * as a customer sends a real admin here; this component decides from the
   * *actual* role, and used to bail out with `null` on the way in. Two answers
   * to "who am I" one render apart, and the visible result was an entirely blank
   * /kitchen. It is a preview, not a denial, so say that instead.
   */
  const previewingGate = variant === "gate" && staff;

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setJustRequested(search.get("staff-requested") === "1");
  }, []);

  const loadRequest = useCallback(async () => {
    setRequestState({ status: "loading" });
    try {
      const result = await getApi<{ request: StaffAccessRequest | null }>(
        "/api/staff/request-access"
      );
      setRequestState({ status: "loaded", request: result.request });
    } catch {
      setRequestState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    // `actualRole` is null for the first frames of a fresh sign-up, which made
    // every new account fire this request and then unmount the body that wanted
    // it. Waiting for the role to settle costs nothing and saves the round trip.
    if (!user || staff || !roleSettled) return;
    void loadRequest();
  }, [loadRequest, roleSettled, staff, user]);

  /**
   * Pulls a granted role onto this token.
   *
   * Sync before refresh, for the same reason `/account` does it in that order:
   * the server is what stamps the claim, and refreshing a token first would only
   * re-read the absence of one.
   */
  const activate = useCallback(
    async (navigate: boolean) => {
      setActivating(true);
      setMutationState({ status: "idle" });
      try {
        const synced = await syncAccount();
        const role = (await refreshRole()) ?? synced;
        if (role === "restaurant" || role === "admin") {
          if (navigate) router.push(STAFF_DESTINATION);
          return;
        }
        setMutationState({
          status: "error",
          message: "Your access is not active yet. Ask the owner to approve the request.",
        });
      } catch (cause) {
        setMutationState({
          status: "error",
          message:
            cause instanceof ApiError
              ? cause.message
              : "We couldn't activate staff access. Please try again.",
        });
      } finally {
        setActivating(false);
      }
    },
    [refreshRole, router, syncAccount]
  );

  // An approved request alongside a customer claim means the token simply
  // predates the grant. Fix it without making anyone press anything.
  useEffect(() => {
    if (autoActivated.current || staff) return;
    if (requestState.status !== "loaded") return;
    if (requestState.request?.status !== "approved") return;
    autoActivated.current = true;
    void activate(false);
  }, [activate, requestState, staff]);

  async function requestAccess() {
    setMutationState({ status: "submitting" });
    try {
      await callApi("/api/staff/request-access");
      setMutationState({ status: "idle" });
      await loadRequest();
    } catch (cause) {
      setMutationState({ status: "error", message: mutationErrorMessage(cause) });
    }
  }

  async function sendVerification() {
    if (!user) return;
    setVerifying(true);
    try {
      const { sendEmailVerification } = await import("firebase/auth");
      await sendEmailVerification(user);
      setNotice("Verification email sent. Open the link, then come back here.");
    } catch (cause) {
      setMutationState({ status: "error", message: authErrorMessage(cause) });
    } finally {
      setVerifying(false);
    }
  }

  if (!user) return null;

  if (previewingGate) {
    return (
      <Shell>
        <p className="mt-1 text-sm text-charcoal-soft">
          You are previewing Mamma Calories as a{" "}
          {viewAs === "restaurant" ? "staff member" : "customer"}, and this area
          needs staff access. Your own account still has it.
        </p>
        <Button className="mt-3" size="sm" onClick={() => setViewAs(null)}>
          Leave preview
        </Button>
      </Shell>
    );
  }

  if (staff) return null;

  const busy =
    requestState.status === "loading" ||
    mutationState.status === "submitting" ||
    activating;
  const request = requestState.status === "loaded" ? requestState.request : null;
  // Verification blocks approval, so it is only worth raising while approval is
  // still the thing being waited on.
  const verificationBlocks =
    requestState.status === "loaded" &&
    user.emailVerified === false &&
    (request === null || request.status === "pending");

  const body = (
    <>
      {variant === "gate" && (
        <p className="mt-1 text-sm text-charcoal-soft">
          The kitchen board and restaurant tools are for Negrita staff. This
          account is signed in as a Customer.
        </p>
      )}

      {justRequested && variant === "account" && (
        <p className="mt-1 text-xs text-charcoal-soft">
          Thanks — your request is with the restaurant owner.
        </p>
      )}

      {requestState.status === "loading" && (
        <p className="mt-1 text-xs text-charcoal-soft">Checking access…</p>
      )}

      {requestState.status === "error" && (
        <div>
          <p role="alert" className="mt-1 text-xs text-tomato-dark">{LOAD_ERROR}</p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void loadRequest()}>
            Retry
          </Button>
        </div>
      )}

      {requestState.status === "loaded" && request === null && (
        <div>
          <p className="mt-1 text-xs text-charcoal-soft">Not requested</p>
          <p className="mt-1 text-sm text-charcoal-soft">
            Restaurant staff access is required, and a restaurant owner has to
            approve it.
          </p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void requestAccess()}>
            Request staff access
          </Button>
        </div>
      )}

      {request?.status === "pending" && (
        <div>
          <p className="mt-1 text-sm font-700 text-charcoal">Waiting for owner approval</p>
          <p className="mt-1 text-xs text-charcoal-soft">
            A restaurant owner still needs to approve your staff access. You can
            keep using the app as a customer while you wait.
          </p>
        </div>
      )}

      {request?.status === "rejected" && (
        <div>
          <p className="mt-1 text-sm font-700 text-charcoal">
            Your previous request was not approved
          </p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void requestAccess()}>
            Request again
          </Button>
        </div>
      )}

      {request?.status === "approved" && (
        <div>
          <p className="mt-1 text-sm font-700 text-charcoal">Staff access approved</p>
          <p className="mt-1 text-xs text-charcoal-soft">
            This sign-in still carries your old access. Activating picks up the
            new one.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void activate(true)}
          >
            {activating ? "Activating…" : "Activate staff access"}
          </Button>
        </div>
      )}

      {verificationBlocks && (
        <div className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-3">
          <p className="text-sm font-700 text-charcoal">
            Confirm your email before the restaurant owner can approve your access
          </p>
          <p className="mt-1 text-xs text-charcoal-soft">
            We sent a link to {user.email}. Owner approval is only ever given to a
            confirmed address.
          </p>
          <Button
            className="mt-3"
            size="sm"
            disabled={verifying}
            onClick={() => void sendVerification()}
          >
            {verifying ? "Sending…" : "Send verification email again"}
          </Button>
        </div>
      )}

      {notice && <p className="mt-3 text-xs text-basil">{notice}</p>}

      {mutationState.status === "error" && (
        <p role="alert" className="mt-3 text-xs text-tomato-dark">{mutationState.message}</p>
      )}
    </>
  );

  if (variant === "gate") return <Shell>{body}</Shell>;

  return (
    <Card className="mt-5 border-gold/50 bg-gold/10 p-4">
      <p className="text-sm font-700 text-charcoal">Restaurant access</p>
      {body}
    </Card>
  );
}

/**
 * The full-page frame the gate wears.
 *
 * Extracted so every reason this page can be reached wears the same frame. The
 * one that was missing it rendered nothing at all.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <Card className="border-gold/50 bg-gold/10 p-5">
        <h1 className="flex items-center gap-2 font-display text-xl font-700 text-charcoal">
          <ShieldAlert size={20} className="text-gold" />
          Restaurant staff access is required
        </h1>
        {children}
        <p className="mt-5 text-xs text-charcoal-soft">
          Meanwhile,{" "}
          <Link href="/plan" className="font-600 text-tomato hover:underline">
            plan your own week
          </Link>{" "}
          or open{" "}
          <Link href="/account" className="font-600 text-tomato hover:underline">
            Account &amp; access
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}
