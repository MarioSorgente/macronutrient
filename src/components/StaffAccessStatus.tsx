"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getApi } from "@/lib/api";
import { roleLabel } from "@/lib/roles";
import type { StaffAccessRequest } from "@/lib/storage/types";
import Card from "@/components/ui/Card";

export default function StaffAccessStatus() {
  const { user, actualRole } = useAuth();
  const [request, setRequest] = useState<StaffAccessRequest | null>(null);
  useEffect(() => {
    if (!user) return;
    getApi<{ request: StaffAccessRequest | null }>("/api/staff/request-access")
      .then((result) => setRequest(result.request)).catch(() => undefined);
  }, [user]);
  if (!user || !actualRole) return null;
  return (
    <Card className="mt-5 p-4">
      <h2 className="font-display text-lg font-700 text-charcoal">Account type</h2>
      <p className="mt-1 text-sm font-700 text-charcoal">{roleLabel(actualRole)}</p>
      {actualRole === "client" && request?.status === "pending" && (
        <div className="mt-4 rounded-xl border border-gold/50 bg-gold/10 p-3">
          <p className="text-sm font-700 text-charcoal">Restaurant access — Pending approval</p>
          <p className="mt-1 text-xs text-charcoal-soft">A restaurant owner still needs to approve your staff access. You can still use the app as a customer while you wait.</p>
        </div>
      )}
    </Card>
  );
}
