"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { policyFor } from "@/lib/auth/routePolicy";

/**
 * Gets a restored preview off a page its effective role cannot use.
 *
 * The switch handles deliberate changes, but it is not necessarily mounted
 * when sessionStorage is restored after a refresh. Keeping this beside the
 * root route guard means the redirect also happens with the account menu
 * closed, before an admin URL can strand a customer preview at an access gate.
 */
export default function PreviewNavigation() {
  const { actualRole, role, viewAs, loading } = useAuth();
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  useEffect(() => {
    if (loading || actualRole !== "admin" || !viewAs || !role) return;

    const policy = policyFor(pathname);
    const unavailable = policy.kind === "role" && !policy.allow.includes(role);
    // Owner-only admin screens perform a stricter check inside the page, so a
    // restored staff preview should leave those too (house items is shared).
    const ownerOnly =
      viewAs === "restaurant" &&
      (pathname === "/admin" || pathname.startsWith("/admin/settings"));

    if (unavailable || ownerOnly) {
      router.replace(viewAs === "client" ? "/plan" : "/kitchen");
    }
  }, [actualRole, loading, pathname, role, router, viewAs]);

  return null;
}
