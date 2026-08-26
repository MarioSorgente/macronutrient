"use client";

import { useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  MAX_PROGRAM_WEEKS,
  type Plan,
} from "@/lib/storage/types";
import { mealsPerSlot, withRenamedSlots } from "@/lib/planSlots";
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
  /**
   * Each row remembers the slot it started as, so a rename can carry its meals
   * with it. A row added here has no `was`, and a row removed takes its `was`
   * out of the list — which is how removal is told apart from renaming.
   */
  const [slots, setSlots] = useState<{ was?: string; name: string }[]>(
    () => plan.mealSlots.map((slot) => ({ was: slot, name: slot }))
  );
  const [newSlot, setNewSlot] = useState("");
  const mealCounts = useMemo(() => mealsPerSlot(plan), [plan]);
  /**
   * The last week that still holds meals. Shortening the program past it would
   * leave them stored but unreachable — the planner only ever shows weeks 1 to
   * `weekCount`, so they would vanish from the plan while still being in it.
   */
  const lastPlannedWeek = useMemo(
    () => plan.assignments.reduce((last, a) => Math.max(last, a.week), 0),
    [plan]
  );

  const trimmedNames = slots.map((slot) => slot.name.trim());
  const duplicate = trimmedNames.find((slot, index) =>
    slot && trimmedNames.indexOf(slot) !== index);

  function addSlot() {
    const trimmed = newSlot.trim();
    if (!trimmed || trimmedNames.includes(trimmed)) return;
    setSlots([...slots, { name: trimmed }]);
    setNewSlot("");
  }

  function renameSlot(index: number, value: string) {
    setSlots(slots.map((slot, i) => (i === index ? { ...slot, name: value } : slot)));
  }

  function save() {
    const kept = slots
      .map((slot) => ({ ...slot, name: slot.name.trim() }))
      .filter((slot) => slot.name);
    // Every name blanked out is not an instruction to have no meal slots; the
    // rest of the settings still save, against the slots the plan already has.
    const emptied = kept.length === 0;

    // Meals name their slot as a string, so a rename has to move them or they
    // are orphaned: invisible in the planner, and still charged for.
    const renames = emptied ? new Map<string, string>() : new Map(kept
      .filter((slot) => slot.was && slot.was !== slot.name)
      .map((slot) => [slot.was!, slot.name]));

    onSave({
      ...plan,
      title: name.trim() || plan.title,
      notes: notes.trim() || undefined,
      programStartDate: startDate,
      weekCount,
      mealSlots: emptied ? plan.mealSlots : kept.map((slot) => slot.name),
      assignments: withRenamedSlots(plan.assignments, renames),
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
            // Two slots of one name are indistinguishable to every screen that
            // finds meals by slot: the same meals would appear under both.
            disabled={Boolean(duplicate)}
            title={duplicate ? `There are two slots called "${duplicate}".` : undefined}
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
          <Field
            label="Weeks"
            hint={lastPlannedWeek > 1
              ? `Up to ${MAX_PROGRAM_WEEKS}. Week ${lastPlannedWeek} has meals in it, so the program cannot end before it.`
              : `Up to ${MAX_PROGRAM_WEEKS}`}
          >
            {(id) => (
            <select
              id={id}
              value={weekCount}
              onChange={(e) => setWeekCount(Number(e.target.value))}
              className="w-full rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm outline-none focus:border-tomato-soft"
            >
              {Array.from({ length: MAX_PROGRAM_WEEKS }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n} disabled={n < lastPlannedWeek}>
                    {n} week{n === 1 ? "" : "s"}
                    {n < lastPlannedWeek ? " — has meals" : ""}
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
            {slots.map((slot, index) => {
              // Meals live under the name this row started as, so that is what
              // decides whether removing it would strand any.
              const meals = slot.was ? mealCounts.get(slot.was) ?? 0 : 0;
              return (
                <li key={index} className="flex items-center gap-2">
                  <GripVertical size={14} className="shrink-0 text-charcoal-soft" />
                  <input
                    value={slot.name}
                    aria-label={`Meal slot ${index + 1}`}
                    onChange={(e) => renameSlot(index, e.target.value)}
                    className="flex-1 rounded-lg border border-cream-deep bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tomato-soft"
                  />
                  <button
                    type="button"
                    onClick={() => setSlots(slots.filter((_, i) => i !== index))}
                    disabled={slots.length === 1 || meals > 0}
                    className="rounded-lg p-1.5 text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark disabled:opacity-30"
                    aria-label={`Remove ${slot.name}`}
                    title={meals > 0
                      ? `${slot.was} still holds ${meals} meal${meals === 1 ? "" : "s"}. Remove them from the plan first.`
                      : undefined}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {duplicate && (
            <p role="alert" className="mt-1.5 text-[11px] font-600 text-tomato-dark">
              Two slots are called “{duplicate}”. Give them different names —
              meals are filed under the slot’s name, so the same ones would show
              up under both.
            </p>
          )}
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
