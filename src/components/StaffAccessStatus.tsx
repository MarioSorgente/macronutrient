"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiError, callApi, getApi } from "@/lib/api";
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

export default function StaffAccessStatus() {
  const { user, actualRole } = useAuth();
  const [requestState, setRequestState] = useState<RequestState>({ status: "loading" });
  const [mutationState, setMutationState] = useState<MutationState>({ status: "idle" });

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
    if (!user || actualRole !== "client") return;
    void loadRequest();
  }, [actualRole, loadRequest, user]);

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

  if (!user || actualRole !== "client") return null;
  const busy = requestState.status === "loading" || mutationState.status === "submitting";

  return (
    <Card className="mt-5 border-gold/50 bg-gold/10 p-4">
      <p className="text-sm font-700 text-charcoal">Restaurant access</p>

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

      {requestState.status === "loaded" && requestState.request === null && (
        <div>
          <p className="mt-1 text-xs text-charcoal-soft">Not requested</p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void requestAccess()}>
            Request staff access
          </Button>
        </div>
      )}

      {requestState.status === "loaded" && requestState.request?.status === "pending" && (
        <div>
          <p className="mt-1 text-sm font-700 text-charcoal">Pending approval</p>
          <p className="mt-1 text-xs text-charcoal-soft">
            A restaurant owner still needs to approve your staff access. You can still use the app as a customer while you wait.
          </p>
        </div>
      )}

      {requestState.status === "loaded" && requestState.request?.status === "rejected" && (
        <div>
          <p className="mt-1 text-sm font-700 text-charcoal">Request rejected</p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void requestAccess()}>
            Request staff access again
          </Button>
        </div>
      )}

      {mutationState.status === "error" && (
        <p role="alert" className="mt-3 text-xs text-tomato-dark">{mutationState.message}</p>
      )}
    </Card>
  );
}
