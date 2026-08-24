"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  RefreshCw,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type {
  Plan,
  ClientPreferences,
  Dish,
  MacroStyle,
  MacroTargets,
  ProteinSource,
} from "@/lib/storage/types";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import { TARGET_FIELDS, DAY_SHORT } from "@/lib/clients";
import {
  MACRO_STYLES,
  PROTEIN_SOURCES,
  targetsFromStyle,
} from "@/lib/preferences";
import { getIngredient } from "@/lib/database";
import { generatePlanWithTargets, type GeneratedPlan } from "@/lib/mealPlanner";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { round0, round1 } from "@/lib/format";
import { resolveTarget } from "@/lib/targetResolution";
import IngredientTypeahead from "@/components/IngredientTypeahead";
import Modal from "@/components/ui/Modal";
import TargetAdherence from "@/components/TargetAdherence";

/**
 * Two steps: say what you like, then produce and
 * review a week. Split so neither screen becomes a wall of controls.
 */
export default function GeneratePlanDialog({
  plan,
  week,
  savedDishes,
  onApply,
  onClose,
}: {
  plan: Plan;
  week: number;
  savedDishes: Dish[];
  onApply: (
    days: GeneratedPlan["days"],
    replace: boolean,
    preferences: ClientPreferences,
    /** The target generation actually used, so the plan can remember it. */
    resolvedTarget: MacroTargets
  ) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);

  const [preferences, setPreferences] = useState<ClientPreferences>(
    plan.preferences ?? DEFAULT_PREFERENCES
  );
  const initialResolution = resolveTarget({
    targets: plan.targets,
    style: plan.preferences?.macroStyle,
  });
  const [targets, setTargets] = useState<MacroTargets>(initialResolution.target);
  const [targetsExplicit, setTargetsExplicit] = useState(Boolean(plan.targets));

  const [includeMenu, setIncludeMenu] = useState(true);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [budgetOn, setBudgetOn] = useState(false);
  const [budget, setBudget] = useState(400000);
  const [replace, setReplace] = useState(true);
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<GeneratedPlan | null>(null);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);

  /** Picking a style restates the targets; the numbers stay editable after. */
  function chooseStyle(macroStyle: MacroStyle) {
    setPreferences({ ...preferences, macroStyle });
    setTargets(targetsFromStyle(targets.energy_kcal, macroStyle));
    setTargetsExplicit(false);
    setPreview(null);
  }

  function toggleLean(source: ProteinSource) {
    const has = preferences.proteinLean.includes(source);
    setPreferences({
      ...preferences,
      proteinLean: has
        ? preferences.proteinLean.filter((s) => s !== source)
        : [...preferences.proteinLean, source],
    });
    setPreview(null);
  }


  const targetResolution = resolveTarget({
    targets: targetsExplicit ? targets : { energy_kcal: targets.energy_kcal },
    style: preferences.macroStyle,
  });

  function run(nextSeed: number) {
    setSeed(nextSeed);
    setPreview(
      generatePlanWithTargets({
        targets: targetResolution.target,
        targetStyle: preferences.macroStyle,
        slots: plan.mealSlots,
        includeMenuDishes: includeMenu,
        includeSavedDishes: includeSaved,
        savedDishes,
        preferences,
        dailyBudgetIdr: budgetOn ? budget : null,
        days,
        seed: nextSeed,
      })
    );
  }

  const previewDays = preview?.days ?? [];
  const weekCost = previewDays.reduce((s, d) => s + d.price.totalIdr, 0);
  const avgKcal = previewDays.length
    ? previewDays.reduce((s, d) => s + d.macros.energy_kcal, 0) / previewDays.length
    : 0;
  const avgProtein = previewDays.length
    ? previewDays.reduce((s, d) => s + d.macros.protein_g, 0) / previewDays.length
    : 0;

  return (
    <Modal
      title={
        <>
          <Sparkles size={18} className="text-tomato" />
          {step === 1 ? "What do you like?" : `Week ${week} plan`}
        </>
      }
      subtitle={`Step ${step} of 2 · ${
        step === 1
          ? "Tastes shape the mix, not the maths"
          : "Targets, sources, then review"
      }`}
      onClose={onClose}
      size="2xl"
      footer={
        <>
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-600 text-charcoal-soft hover:text-charcoal"
            >
              <ArrowLeft size={15} /> Preferences
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600 text-charcoal"
          >
            Cancel
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-1.5 rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              Next <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              disabled={!preview}
              onClick={() =>
                preview &&
                onApply(preview.days, replace, preferences, preview.resolvedTarget)
              }
              className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
            >
              Apply to week {week}
            </button>
          )}
        </>
      }
    >
          {step === 1 ? (
            <>
              {/* Macro style */}
              <h4 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                Macro style
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {MACRO_STYLES.map((style) => {
                  const active = preferences.macroStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => chooseStyle(style.id)}
                      className={
                        "rounded-xl border px-3 py-2 text-left transition-colors " +
                        (active
                          ? "border-tomato bg-tomato/5"
                          : "border-cream-deep bg-white hover:border-tomato-soft")
                      }
                    >
                      <div className="text-sm font-700 text-charcoal">
                        {style.label}
                      </div>
                      <div className="text-[11px] text-charcoal-soft">
                        {style.description}
                      </div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-charcoal-soft">
                        P {Math.round(style.split.protein * 100)}% · C{" "}
                        {Math.round(style.split.carbs * 100)}% · F{" "}
                        {Math.round(style.split.fat * 100)}%
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Protein lean */}
              <h4 className="mb-1 mt-5 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                More of…
              </h4>
              <p className="mb-2 text-[11px] text-charcoal-soft">
                A leaning, not a restriction — everything else still appears, just
                less often. Leave empty for no preference.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PROTEIN_SOURCES.map((source) => {
                  const active = preferences.proteinLean.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => toggleLean(source.id)}
                      className={
                        "rounded-full px-3 py-1.5 text-xs font-600 transition-colors " +
                        (active
                          ? "bg-charcoal text-cream"
                          : "bg-cream-deep text-charcoal-soft hover:text-charcoal")
                      }
                    >
                      {source.label}
                    </button>
                  );
                })}
              </div>

              {/* Avoid */}
              <h4 className="mb-1 mt-5 flex items-center gap-1.5 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                <Ban size={12} /> Never include
              </h4>
              <p className="mb-2 text-[11px] text-charcoal-soft">
                Allergies and hard dislikes. These are excluded from every meal.
              </p>

              {preferences.avoidIngredientIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {preferences.avoidIngredientIds.map((avoidId) => (
                    <button
                      key={avoidId}
                      type="button"
                      onClick={() => {
                        setPreferences({
                          ...preferences,
                          avoidIngredientIds:
                            preferences.avoidIngredientIds.filter(
                              (x) => x !== avoidId
                            ),
                        });
                        setPreview(null);
                      }}
                      className="flex items-center gap-1 rounded-full bg-tomato-soft/30 px-2.5 py-1 text-xs font-600 text-tomato-dark"
                    >
                      {getIngredient(avoidId)?.name ?? avoidId}
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}

              <IngredientTypeahead
                placeholder="Search an ingredient to exclude…"
                excludeIds={preferences.avoidIngredientIds}
                limit={5}
                onSelect={(ingredient) => {
                  setPreferences({
                    ...preferences,
                    avoidIngredientIds: [
                      ...preferences.avoidIngredientIds,
                      ingredient.ingredient_id,
                    ],
                  });
                  setPreview(null);
                }}
              />
            </>
          ) : (
            <>
              {/* Targets */}
              <h4 className="mb-2 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                Daily targets
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TARGET_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs">
                    <span className="mb-1 block font-600 text-charcoal-soft">
                      {field.label} ({field.unit})
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={targetResolution.target[field.key]}
                      onChange={(e) => {
                        const value = Math.max(0, Number(e.target.value) || 0);
                        // Changing calories restates the split; changing a macro
                        // is taken as a deliberate override and left alone.
                        setTargetsExplicit(field.key !== "energy_kcal");
                        setTargets(
                          field.key === "energy_kcal"
                            ? targetsFromStyle(value, preferences.macroStyle)
                            : { ...targets, [field.key]: value }
                        );
                        setPreview(null);
                      }}
                      className="no-spin w-full rounded-lg border border-cream-deep bg-white px-2 py-1.5 text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                    />
                  </label>
                ))}
              </div>
              <div
                className="mt-2 rounded-xl border border-cream-deep bg-cream/50 px-3 py-2 text-xs text-charcoal-soft"
                data-testid="resolved-target"
              >
                <div className="font-700 text-charcoal">
                  Resolved target · {targetResolution.source === "explicit"
                    ? "Explicit"
                    : `Derived · ${targetResolution.selectedStyle === "Balanced" && !preferences.macroStyle ? "Auto → Balanced" : targetResolution.selectedStyle}`}
                </div>
                <div className="mt-0.5 tabular-nums">
                  {round0(targetResolution.target.energy_kcal)} kcal · P{" "}
                  {round1(targetResolution.target.protein_g)} g · C{" "}
                  {round1(targetResolution.target.carbs_g)} g · F{" "}
                  {round1(targetResolution.target.fat_g)} g
                </div>
                <p className="mt-1">{targetResolution.explanation}</p>
              </div>

              {/* Sources */}
              <h4 className="mb-2 mt-4 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                Build meals from
              </h4>
              <div className="space-y-2 rounded-xl border border-cream-deep bg-white p-3">
                <p className="text-xs text-charcoal-soft">
                  Ingredient combinations are always used. Add whole dishes too:
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeMenu}
                    onChange={(e) => {
                      setIncludeMenu(e.target.checked);
                      setPreview(null);
                    }}
                    className="h-4 w-4 accent-tomato"
                  />
                  <span className="font-600 text-charcoal">
                    Negrita menu dishes
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSaved}
                    onChange={(e) => {
                      setIncludeSaved(e.target.checked);
                      setPreview(null);
                    }}
                    className="h-4 w-4 accent-tomato"
                  />
                  <span className="font-600 text-charcoal">
                    Saved &amp; custom dishes
                  </span>
                  <span className="text-xs text-charcoal-soft">
                    ({savedDishes.length})
                  </span>
                </label>

                <label className="flex flex-wrap items-center gap-2 border-t border-cream-deep pt-2 text-sm">
                  <input
                    type="checkbox"
                    checked={budgetOn}
                    onChange={(e) => {
                      setBudgetOn(e.target.checked);
                      setPreview(null);
                    }}
                    className="h-4 w-4 accent-tomato"
                  />
                  <span className="flex items-center gap-1.5 font-600 text-charcoal">
                    <Wallet size={14} /> Daily budget
                  </span>
                  {budgetOn && (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={budget}
                        onChange={(e) => {
                          setBudget(Number(e.target.value) || 0);
                          setPreview(null);
                        }}
                        className="no-spin w-28 rounded-lg border border-cream-deep px-2 py-1 text-right text-sm font-600 tabular-nums outline-none focus:border-tomato-soft"
                      />
                      <span className="text-xs text-charcoal-soft">
                        {formatIdr(budget)}
                      </span>
                    </span>
                  )}
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                    className="h-4 w-4 accent-tomato"
                  />
                  <span className="font-600 text-charcoal">
                    Replace what is already planned this week
                  </span>
                </label>
              </div>

              {/* Generate */}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => run(seed)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-tomato px-4 py-2.5 font-700 text-cream hover:bg-tomato-dark"
                >
                  <Sparkles size={16} /> {preview ? "Regenerate" : "Generate"}
                </button>
                {preview && (
                  <button
                    type="button"
                    onClick={() => run(seed + 1)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-cream-deep bg-white px-4 py-2.5 font-600 text-charcoal hover:border-tomato-soft"
                  >
                    <RefreshCw size={15} /> Shuffle
                  </button>
                )}
              </div>

              {/* Preview */}
              {preview && (
                <div className="mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
                      Preview
                    </h4>
                    <div className="flex flex-wrap gap-3 text-xs tabular-nums text-charcoal-soft">
                      <span>
                        avg <b className="text-charcoal">{round0(avgKcal)}</b> kcal
                      </span>
                      <span>
                        avg <b className="text-charcoal">{round1(avgProtein)}</b> g P
                      </span>
                      <span className="font-700 text-tomato">
                        {formatIdr(weekCost)} / week
                      </span>
                    </div>
                  </div>

                  {previewDays.some((d) => d.unfilledSlots.length > 0) && (
                    <p className="mb-2 rounded-lg bg-gold/10 px-3 py-2 text-xs text-charcoal">
                      Some slots could not be filled without going far off target
                      {budgetOn ? " within this budget" : ""}, so they were left
                      empty rather than padded.
                    </p>
                  )}

                  <ul className="flex flex-col gap-2">
                    {previewDays.map((day) => (
                      <li
                        key={day.day}
                        className="rounded-xl border border-cream-deep bg-white p-3"
                      >
                        <div className="mb-2 flex items-baseline justify-between">
                          <span className="font-display text-sm font-700 text-charcoal">
                            {DAY_SHORT[day.day]}
                          </span>
                          <span className="text-xs tabular-nums text-charcoal-soft">
                            <b className="text-tomato">
                              {round0(day.macros.energy_kcal)}
                            </b>{" "}
                            kcal · P {round1(day.macros.protein_g)} ·{" "}
                            <b className="text-charcoal">
                              {formatPrice(day.price)}
                            </b>
                          </span>
                        </div>
                        <TargetAdherence
                          actual={day.macros}
                          targets={preview.resolvedTarget}
                          diagnostics={day.adherence}
                          targetSource={preview.targetSource === "explicit" ? "Explicit" : `Derived · ${preview.targetStyle}`}
                          compact
                        />
                        <ul className="space-y-0.5">
                          {day.meals.map((meal, i) => (
                            <li
                              key={`${day.day}-${i}`}
                              className="flex items-baseline justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0">
                                <span className="mr-1.5 text-[10px] font-700 uppercase tracking-wide text-charcoal-soft">
                                  {meal.slot}
                                </span>
                                <span className="text-charcoal">{meal.name}</span>
                              </span>
                              <span className="shrink-0 tabular-nums text-charcoal-soft">
                                {round0(meal.macros.energy_kcal)} kcal · P {round1(meal.macros.protein_g)} · C {round1(meal.macros.carbs_g)} · F {round1(meal.macros.fat_g)}
                              </span>
                            </li>
                          ))}
                          {day.unfilledSlots.length > 0 && (
                            <li className="pt-0.5 text-[11px] text-gold">
                              Could not fill {day.unfilledSlots.join(", ")}
                            </li>
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
    </Modal>
  );
}
