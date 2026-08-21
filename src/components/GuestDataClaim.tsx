"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isCloudBackend } from "@/lib/storage";
import { useToast } from "@/components/ui/Toast";

/**
 * Moves work done as a guest into the account, the first time someone signs in
 * on this device.
 *
 * Mounted app-wide rather than on the sign-in page, because the account may
 * also arrive via a redirect or a session restored in another tab — and the
 * point at which someone commits to an account is the worst possible moment to
 * lose the week they just built.
 */
export default function GuestDataClaim() {
  const { user } = useAuth();
  const { show } = useToast();
  const claimedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !isCloudBackend() || claimedFor.current === user.uid) return;
    claimedFor.current = user.uid;

    void (async () => {
      const { claimGuestData } = await import("@/lib/storage/claim");
      const moved = await claimGuestData(user.uid);
      if (moved.plans > 0 || moved.dishes > 0) {
        show("We saved the week you built to your account.");
      }
    })().catch((cause) => {
      // The guest copy is only cleared after a successful write, so nothing is
      // lost here — it will be retried on the next sign-in.
      console.error("Could not claim guest data:", cause);
      claimedFor.current = null;
    });
  }, [user, show]);

  return null;
}
