"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  MAX_PROGRAM_WEEKS,
  type Client,
  type MacroTargets,
} from "@/lib/storage/types";
import { DEFAULT_TARGETS, TARGET_FIELDS } from "@/lib/clients";
import Modal from "@/components/ui/Modal";
import Field from "@/components/ui/Field";

/**
 * Client program settings: name, start date, program length, editable meal slot
 * names, and optional daily macro targets.
 */
export default function ClientSettings({
  client,
  onSave,
  onClose,
}: {
  client: Client;
  onSave: (next: Client) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [startDate, setStartDate] = useState(client.programStartDate);
  const [weekCount, setWeekCount] = useState(client.weekCount);
  const [slots, setSlots] = useState<string[]>([...client.mealSlots]);
  const [newSlot, setNewSlot] = useState("");
  const [targetsOn, setTargetsOn] = useState(Boolean(client.targets));
  const [targets, setTargets] = useState<MacroTargets>(
    client.targets ?? DEFAULT_TARGETS
  );

  function addSlot() {
    const trimmed = newSlot.trim();
    if (!trimmed || slots.includes(trimmed)) return;
    setSlots([...slots, trimmed]);
    setNewSlot("");
  }

  function renameSlot(index: number, value: string) {
    setSlots(slots.map((s, i) => (i === index ? value : s)));
  }

  function save() {
    const cleanSlots = slots.map((s) => s.trim()).filter(Boolean);
    onSave({
      ...client,
      name: name.trim() || client.name,
      notes: notes.trim() || undefined,
      programStartDate: startDate,
      weekCount,
      mealSlots: cleanSlots.length ? cleanSlots : client.mealSlots,
      targets: targetsOn ? targets : null,
    });
  }

  return (
    <Modal
      title="Plan settings"
      onClose={onClose}
      bodyClassName="space-y-4"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
          >
            Save settings
          </button>
        </>
      }
    >
        <Field label="Plan name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
          />
        </Field>

        <Field label="Notes" hint="Allergies, preferences, goals">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Program starts">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
            />
          </Field>
          <Field label="Weeks" hint={`Up to ${MAX_PROGRAM_WEEKS}`}>
            <select
              value={weekCount}
              onChange={(e) => setWeekCount(Number(e.target.value))}
              className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
            >
              {Array.from({ length: MAX_PROGRAM_WEEKS }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    {n} week{n === 1 ? "" : "s"}
                  </option>
                )
              )}
            </select>
          </Field>
        </div>

        {/* Meal slots */}
        <Field label="Meal slots" hint="Rename or add your own">
          <ul className="flex flex-col gap-1.5">
            {slots.map((slot, index) => (
              <li key={index} className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-charcoal-soft" />
                <input
                  value={slot}
                  onChange={(e) => renameSlot(index, e.target.value)}
                  className="flex-1 rounded-lg border border-cream-deep bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tomato-soft"
                />
                <button
                  type="button"
                  onClick={() => setSlots(slots.filter((_, i) => i !== index))}
                  disabled={slots.length === 1}
                  className="rounded-lg p-1.5 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark disabled:opacity-30"
                  aria-label={`Remove ${slot}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={newSlot}
              onChange={(e) => setNewSlot(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSlot();
                }
              }}
              placeholder="e.g. Pre-workout"
              className="flex-1 rounded-lg border border-cream-deep bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tomato-soft"
            />
            <button
              type="button"
              onClick={addSlot}
              className="flex items-center gap-1 rounded-lg bg-cream-deep px-2.5 py-1.5 text-xs font-600 text-charcoal hover:bg-tomato-soft/40"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </Field>

        {/* Targets */}
        <div className="rounded-xl border border-cream-deep bg-white p-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={targetsOn}
              onChange={(e) => setTargetsOn(e.target.checked)}
              className="h-4 w-4 accent-tomato"
            />
            <span className="text-sm font-600 text-charcoal">
              Track daily macro targets
            </span>
          </label>
          <p className="mt-1 text-xs text-charcoal-soft">
            Optional. When off, the planner just shows totals.
          </p>

          {targetsOn && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {TARGET_FIELDS.map((field) => (
                <label key={field.key} className="text-xs">
                  <span className="mb-1 block font-600 text-charcoal-soft">
                    {field.label} ({field.unit})
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={targets[field.key]}
                    onChange={(e) =>
                      setTargets({
                        ...targets,
                        [field.key]: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="no-spin w-full rounded-lg border border-cream-deep px-2 py-1.5 text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
    </Modal>
  );
}


