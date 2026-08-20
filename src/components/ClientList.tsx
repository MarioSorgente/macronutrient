"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus, Target, Trash2, Users } from "lucide-react";
import { getClientRepository, isCloudBackend } from "@/lib/storage";
import { DEFAULT_MEAL_SLOTS, type Client } from "@/lib/storage/types";
import { formatDate, round0 } from "@/lib/format";

function todayIso(): string {
  const d = new Date();
  // Snap to the Monday of the current week so plans line up with calendar weeks.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function ClientList() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setClients(await getClientRepository().list());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const client: Client = {
      id: crypto.randomUUID(),
      name: trimmed,
      targets: null,
      mealSlots: [...DEFAULT_MEAL_SLOTS],
      programStartDate: todayIso(),
      weekCount: 4,
      plan: [],
      createdAt: now,
      updatedAt: now,
    };
    await getClientRepository().save(client);
    setName("");
    refresh();
  }

  async function remove(id: string) {
    await getClientRepository().remove(id);
    setPendingDelete(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <form
        onSubmit={createClient}
        className="flex flex-col gap-2 rounded-xl2 border border-cream-deep bg-white/60 p-4 shadow-card sm:flex-row"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New client name…"
          className="flex-1 rounded-xl border border-cream-deep bg-cream px-3 py-2.5 text-sm outline-none focus:border-tomato-soft focus:ring-2 focus:ring-tomato-soft/40"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-tomato px-4 py-2.5 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
        >
          <Plus size={16} /> Add client
        </button>
      </form>

      {!isCloudBackend() && (
        <p className="rounded-lg bg-cream-deep px-3 py-2 text-xs text-charcoal-soft">
          Clients are saved on this device (browser storage). Connect Firebase to
          share them across devices.
        </p>
      )}

      {clients === null ? (
        <p className="text-sm text-charcoal-soft">Loading clients…</p>
      ) : clients.length === 0 ? (
        <div className="rounded-xl2 border border-dashed border-cream-deep bg-white/50 px-6 py-16 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl2 bg-cream-deep text-tomato">
            <Users size={22} />
          </div>
          <p className="font-display text-lg font-700 text-charcoal">
            No clients yet
          </p>
          <p className="mt-1 text-sm text-charcoal-soft">
            Add a client above to start planning their weeks.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <li
              key={client.id}
              className="flex flex-col rounded-xl2 border border-cream-deep bg-white/70 p-4 shadow-card"
            >
              <div className="flex-1">
                <h3 className="font-display text-lg font-700 text-charcoal">
                  {client.name}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal-soft">
                  <span className="flex items-center gap-1">
                    <CalendarDays size={13} />
                    {client.weekCount} week{client.weekCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    {client.plan.length} meal
                    {client.plan.length === 1 ? "" : "s"} planned
                  </span>
                  {client.targets && (
                    <span className="flex items-center gap-1 text-basil">
                      <Target size={13} />
                      {round0(client.targets.energy_kcal)} kcal/day
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-charcoal-soft">
                  Updated {formatDate(client.updatedAt)}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Link
                  href={`/clients/${client.id}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-tomato px-3 py-2 text-sm font-600 text-cream hover:bg-tomato-dark"
                >
                  Open planner
                </Link>
                {pendingDelete === client.id ? (
                  <button
                    type="button"
                    onClick={() => remove(client.id)}
                    className="rounded-lg bg-tomato-dark px-2.5 py-2 text-xs font-700 text-cream"
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(client.id)}
                    className="rounded-lg p-2 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark"
                    aria-label={`Delete ${client.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
