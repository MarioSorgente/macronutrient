"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  listUsers,
  loadRestaurantConfig,
  saveRestaurantConfig,
} from "@/lib/storage/orders";
import { authErrorMessage } from "@/lib/auth/errors";
import { BALI_LABEL } from "@/lib/format";
import { DAY_NAMES } from "@/lib/clients";
import type { RestaurantConfig, Role, UserProfile } from "@/lib/storage/types";
import type { StaffAccessRequest } from "@/lib/storage/types";
import { roleLabel } from "@/lib/roles";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import Input, { Select } from "@/components/ui/Input";
import Button, { IconButton } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const ROLES: Role[] = ["client", "restaurant", "admin"];

/** Restaurant settings and who can see what. Owner only. */
export default function AdminSettings() {
  const { role, user } = useAuth();
  const { show } = useToast();

  const [config, setConfig] = useState<RestaurantConfig | null>(null);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [staffRequests, setStaffRequests] = useState<StaffAccessRequest[]>([]);
  const [staffRequestsLoading, setStaffRequestsLoading] = useState(true);
  const [staffRequestsError, setStaffRequestsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState("");
  const [zoneFee, setZoneFee] = useState("");

  const refreshPeople = useCallback(async () => {
    try {
      setPeople(await listUsers());
    } catch (cause) {
      setError(authErrorMessage(cause));
    }
  }, []);

  const refreshRequests = useCallback(async () => {
    setStaffRequestsLoading(true);
    setStaffRequestsError(false);
    try {
      const { getApi } = await import("@/lib/api");
      const result = await getApi<{ requests: StaffAccessRequest[] }>("/api/admin/staff/requests");
      setStaffRequests(result.requests);
    } catch {
      setStaffRequestsError(true);
    } finally {
      setStaffRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshRequests();
    Promise.all([loadRestaurantConfig(), listUsers().catch(() => [])])
      .then(([loadedConfig, loadedPeople]) => {
        if (!active) return;
        setConfig(loadedConfig);
        setPeople(loadedPeople);
      })
      .catch((cause) => active && setError(authErrorMessage(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refreshRequests]);

  function patch(next: Partial<RestaurantConfig>) {
    setConfig((current) => (current ? { ...current, ...next } : current));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await saveRestaurantConfig(config);
      show("Settings saved.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(uid: string, next: Role) {
    try {
      const { callApi } = await import("@/lib/api");
      await callApi("/api/admin/set-role", { uid, role: next });
      show(`Access updated to ${roleLabel(next)}. It applies on their next token refresh.`);
      await refreshPeople();
    } catch (cause) {
      setError(authErrorMessage(cause));
    }
  }

  async function reviewRequest(uid: string, action: "approve" | "reject") {
    setError(null);
    try {
      const { callApi } = await import("@/lib/api");
      await callApi(`/api/admin/staff/${action}`, { uid });
      show(action === "approve" ? "Staff access approved." : "Staff request rejected.");
      await Promise.all([refreshRequests(), refreshPeople()]);
    } catch (cause) { setError(authErrorMessage(cause)); }
  }

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title="Owner access only"
          hint="Settings decide who can see the kitchen and the revenue, so only the owner can change them."
        />
      </main>
    );
  }

  if (loading || !config) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-sm text-charcoal-soft">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-700 text-charcoal sm:text-3xl">
        Restaurant settings
      </h1>
      <p className="mt-1 text-sm text-charcoal-soft">
        All times are {BALI_LABEL}.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-tomato-dark/30 bg-tomato-soft/20 px-3 py-2 text-sm font-600 text-tomato-dark"
        >
          {error}
        </p>
      )}

      <Card className="mt-5 border-gold/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-700 text-charcoal">Staff requests</h2>
          {!staffRequestsLoading && !staffRequestsError && staffRequests.length > 0 && (
            <span className="rounded-full bg-gold/20 px-2 py-1 text-xs font-700 text-charcoal">
              {staffRequests.length} pending
            </span>
          )}
        </div>
        {staffRequestsLoading ? (
          <p className="mt-2 text-sm text-charcoal-soft">Loading staff requests…</p>
        ) : staffRequestsError ? (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-tomato-dark">Could not load staff requests.</p>
            <Button size="sm" onClick={() => void refreshRequests()}>
              Retry
            </Button>
          </div>
        ) : staffRequests.length === 0 ? (
          <p className="mt-2 text-sm text-charcoal-soft">No pending staff requests.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {staffRequests.map((request) => (
              <li key={request.uid} className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-700 text-charcoal">{request.displayName || request.email}</p>
                  <p className="truncate text-xs text-charcoal-soft">{request.email}</p>
                  <p className={`mt-1 text-xs font-600 ${request.emailVerified ? "text-basil" : "text-tomato-dark"}`}>{request.emailVerified ? "Email verified" : "Email not verified"}</p>
                </div>
                <Button variant="danger" onClick={() => reviewRequest(request.uid, "reject")}>Reject</Button>
                <Button variant="primary" disabled={!request.emailVerified} title={!request.emailVerified ? "Email must be verified first" : undefined} onClick={() => reviewRequest(request.uid, "approve")}>Approve</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Orders */}
      <Card className="mt-5 space-y-4 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">Orders</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.acceptingOrders}
            onChange={(e) => patch({ acceptingOrders: e.target.checked })}
            className="h-4 w-4 accent-tomato"
          />
          <span className="font-600 text-charcoal">Accepting orders</span>
          <span className="text-charcoal-soft">
            — turn off to close the kitchen without deleting anything
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Orders close on"
            hint="In the week before the one being ordered"
          >
            {(id) => (
              <Select
                id={id}
                value={config.cutoffDay}
                onChange={(e) => patch({ cutoffDay: Number(e.target.value) })}
              >
                {DAY_NAMES.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="At" hint={BALI_LABEL}>
            {(id) => (
              <Input
                id={id}
                type="time"
                value={config.cutoffTime}
                onChange={(e) => patch({ cutoffTime: e.target.value })}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service opens">
            {(id) => (
              <Input
                id={id}
                type="time"
                value={config.serviceOpen}
                onChange={(e) => patch({ serviceOpen: e.target.value })}
              />
            )}
          </Field>
          <Field label="Service closes">
            {(id) => (
              <Input
                id={id}
                type="time"
                value={config.serviceClose}
                onChange={(e) => patch({ serviceClose: e.target.value })}
              />
            )}
          </Field>
        </div>

        <Field
          label="Mark-up"
          hint="Percentage added to component cost to reach the menu price"
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={config.markupPct}
              onChange={(e) =>
                patch({ markupPct: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-32"
            />
          )}
        </Field>
      </Card>

      {/* Delivery zones */}
      <Card className="mt-5 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">
          Delivery zones
        </h2>
        <p className="mt-0.5 text-xs text-charcoal-soft">
          Optional. Recorded for reference; fees are not yet added to orders.
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {config.deliveryZones.map((zone, index) => (
            <li
              key={`${zone.name}-${index}`}
              className="flex items-center gap-2 rounded-xl border border-cream-deep bg-white px-3 py-2"
            >
              <span className="flex-1 text-sm text-charcoal">{zone.name}</span>
              <span className="text-sm tabular-nums text-charcoal-soft">
                Rp {zone.feeIdr.toLocaleString("de-DE")}
              </span>
              <IconButton
                variant="danger"
                aria-label={`Remove ${zone.name}`}
                onClick={() =>
                  patch({
                    deliveryZones: config.deliveryZones.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Zone" className="flex-1">
            {(id) => (
              <Input
                id={id}
                value={zoneName}
                placeholder="Canggu"
                onChange={(e) => setZoneName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Fee (IDR)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={zoneFee}
                onChange={(e) => setZoneFee(e.target.value)}
                className="w-32"
              />
            )}
          </Field>
          <Button
            icon={<Plus size={15} />}
            disabled={!zoneName.trim()}
            onClick={() => {
              patch({
                deliveryZones: [
                  ...config.deliveryZones,
                  { name: zoneName.trim(), feeIdr: Number(zoneFee) || 0 },
                ],
              });
              setZoneName("");
              setZoneFee("");
            }}
          >
            Add
          </Button>
        </div>
      </Card>

      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>

      {/* People */}
      <Card className="mt-6 p-4">
        <h2 className="font-display text-lg font-700 text-charcoal">
          People and access
        </h2>
        <p className="mt-0.5 text-xs text-charcoal-soft">
          A role change takes effect on that person&apos;s next token refresh —
          usually within seconds, since the app watches for it.
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {people.map((person) => (
            <li
              key={person.uid}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-cream-deep bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-600 text-charcoal">
                  {person.displayName || person.email}
                </p>
                <p className="truncate text-[11px] text-charcoal-soft">
                  {person.email}
                </p>
              </div>
              <Select
                aria-label={`Role for ${person.displayName || person.email}`}
                value={person.role ?? "client"}
                disabled={person.uid === user?.uid}
                onChange={(e) => changeRole(person.uid, e.target.value as Role)}
                className="w-40"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
        {people.length === 0 && (
          <p className="mt-3 text-sm text-charcoal-soft">
            No accounts yet.
          </p>
        )}
      </Card>
    </main>
  );
}
