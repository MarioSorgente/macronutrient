"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  MAX_PROGRAM_WEEKS,
  type Plan,
} from "@/lib/storage/types";
import Modal from "@/components/ui/Modal";
import Field from "@/components/ui/Field";

/**
 * Plan program settings: name, start date, program length, editable meal slot
 * names, while daily targets live in their dedicated editor.
 */
export default function PlanSettings({
  plan,
  onSave,
  onClose,
}: {
  plan: Plan;
  onSave: (next: Plan) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(plan.title);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [startDate, setStartDate] = useState(plan.programStartDate);
  const [weekCount, setWeekCount] = useState(plan.weekCount);
  const [slots, setSlots] = useState<string[]>([...plan.mealSlots]);
  const [newSlot, setNewSlot] = useState("");


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
      ...plan,
      title: name.trim() || plan.title,
      notes: notes.trim() || undefined,
      programStartDate: startDate,
      weekCount,
      mealSlots: cleanSlots.length ? cleanSlots : plan.mealSlots,
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
            className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
          >
            Save settings
          </button>
        </>
      }
    >
        <Field label="Plan name">
          {(id) => (
          <input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
          />
          )}
        </Field>

        <Field label="Notes" hint="Allergies, preferences, goals">
          {(id) => (
          <textarea
            id={id}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
          />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Program starts">
            {(id) => (
            <input
              id={id}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
            />
            )}
          </Field>
          <Field label="Weeks" hint={`Up to ${MAX_PROGRAM_WEEKS}`}>
            {(id) => (
            <select
              id={id}
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
            )}
          </Field>
        </div>

        {/* Meal slots */}
        {/* Not a Field: this labels a list of controls, not one control, so a
            <label for> would have nothing to point at. */}
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-600 text-charcoal">Meal slots</span>
            <span className="text-[11px] text-charcoal-soft">
              Rename or add your own
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {slots.map((slot, index) => (
              <li key={index} className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-charcoal-soft" />
                <input
                  value={slot}
                  aria-label={`Meal slot ${index + 1}`}
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
              aria-label="New meal slot"
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
        </div>

    </Modal>
  );
}
