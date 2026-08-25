"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  TargetMode,
  ProteinSource,
} from "@/lib/storage/types";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import { DAY_SHORT } from "@/lib/clients";
import {
  PROTEIN_SOURCES,
} from "@/lib/preferences";
import { getIngredient } from "@/lib/database";
import { generatePlanWithTargets, type GeneratedPlan } from "@/lib/mealPlanner";
import { searchShuffleAlternatives } from "@/lib/plannerShuffle";
import { formatIdr, formatPrice } from "@/lib/pricing";
import { formatMacroGrams, round0 } from "@/lib/format";
import { resolveTarget, validateMacroTarget } from "@/lib/targetResolution";
import MacroTargetEditor, { TargetSummary, type MacroTargetSelection } from "@/components/MacroTargetEditor";
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
  onTargetsSave,
  onClose,
}: {
  plan: Plan;
  week: number;
  savedDishes: Dish[];
  /**
   * Applies the week and resolves once it is actually saved. The dialog stays
   * open on failure, so a rejected write costs the generated week nothing.
   */
  onApply: (
    days: GeneratedPlan["days"],
    replace: boolean,
    preferences: ClientPreferences,
    /** The target generation actually used, plus its explicit selection mode. */
    resolvedTarget: MacroTargets,
    targetMode: TargetMode,
    targetPreset?: MacroStyle
  ) => Promise<boolean> | void;
  onTargetsSave: (selection: MacroTargetSelection) => void | Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);

  const [preferences, setPreferences] = useState<ClientPreferences>(
    plan.preferences ?? DEFAULT_PREFERENCES
  );
  const initialResolution = resolveTarget({
    targets: plan.targets,
    mode: plan.targetMode,
    preset: plan.targetPreset,
  });
  const [targets, setTargets] = useState<MacroTargets>(initialResolution.target);
  const [targetMode, setTargetMode] = useState<TargetMode>(plan.targetMode);
  const [targetPreset, setTargetPreset] = useState<MacroStyle | undefined>(
    plan.targetMode === "preset" ? plan.targetPreset ?? "balanced" : undefined
  );

  const [editingTargets, setEditingTargets] = useState(!plan.targets);
  const [includeMenu, setIncludeMenu] = useState(true);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [budgetOn, setBudgetOn] = useState(false);
  const [budget, setBudget] = useState(400000);
  const [replace, setReplace] = useState(true);
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<GeneratedPlan | null>(null);
  const [applying, setApplying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const nextRequestId = useRef(0);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);


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
    targets,
    mode: targetMode,
    preset: targetPreset,
  });
  const targetValidation = validateMacroTarget(targetResolution.target);

  const generationOptions = {
        targets: targetResolution.target,
        targetStyle: targetPreset,
        slots: plan.mealSlots,
        includeMenuDishes: includeMenu,
        includeSavedDishes: includeSaved,
        savedDishes,
        preferences,
        dailyBudgetIdr: budgetOn ? budget : null,
        days,
  };

  function cancelGeneration() {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setGenerating(false);
  }

  useEffect(() => () => requestRef.current?.controller.abort(), []);
  useEffect(() => {
    // A programmatic input update can still occur while controls are disabled.
    // Abort it just like a close so its obsolete result cannot replace preview.
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setGenerating(false);
  }, [targets, targetMode, targetPreset, includeMenu, includeSaved, budgetOn, budget, preferences, days]);

  async function run(nextSeed: number, shuffle = false) {
    cancelGeneration();
    const controller = new AbortController();
    const id = ++nextRequestId.current;
    requestRef.current = { id, controller };
    setGenerating(true);
    setGenerationMessage(shuffle ? "Searching for an equivalent, more varied week…" : "Generating your week…");
    try {
      // Yield before CPU-intensive planning so the loading state paints first.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (controller.signal.aborted) return;
      if (shuffle && preview) {
        const result = await searchShuffleAlternatives({
          current: preview, generation: generationOptions, firstSeed: nextSeed,
          generate: generatePlanWithTargets, signal: controller.signal,
        });
        if (controller.signal.aborted || requestRef.current?.id !== id) return;
        if (result.changed) {
          setPreview(result.plan); setSeed(result.seed);
          setGenerationMessage(`Found a meaningfully different week after checking ${result.evaluated} alternatives.`);
        } else {
          setGenerationMessage("No meaningfully different equivalent week was found. Your current preview was kept.");
        }
      } else {
        const result = generatePlanWithTargets({ ...generationOptions, seed: nextSeed });
        if (controller.signal.aborted || requestRef.current?.id !== id) return;
        setSeed(nextSeed); setPreview(result);
        setGenerationMessage("Week generated and ready to review.");
      }
    } finally {
      if (requestRef.current?.id === id) {
        requestRef.current = null;
        setGenerating(false);
      }
    }
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
      onClose={() => { cancelGeneration(); onClose(); }}
      size="2xl"
      footer={
        <>
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)} disabled={generating}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-600 text-charcoal-soft hover:text-charcoal"
            >
              <ArrowLeft size={15} /> Preferences
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => { cancelGeneration(); onClose(); }}
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
              disabled={!preview || applying || generating}
              onClick={async () => {
                if (!preview) return;
                setApplying(true);
                try {
                  await onApply(preview.days, replace, preferences,
                    preview.resolvedTarget, targetMode, targetPreset);
                } finally {
                  setApplying(false);
                }
              }}
              className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
            >
              {applying ? "Saving your week…" : `Apply to week ${week}`}
            </button>
          )}
        </>
      }
    >
          {step === 1 ? (
            <>
              {/* Protein lean */}
              <h4 className="mb-1 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">
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
              {/* The saved target stays visible in the generation flow; editing is an explicit action, not a hidden setup step. */}
              <div className="rounded-xl border border-basil/30 bg-basil/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="mb-1 text-[11px] font-700 uppercase tracking-wide text-charcoal-soft">Daily targets</div>
                    <TargetSummary selection={{ targets: targetResolution.target, mode: targetMode, preset: targetPreset }} />
                  </div>
                  <button type="button" disabled={generating} onClick={() => setEditingTargets(!editingTargets)} className="shrink-0 rounded-lg border border-cream-deep bg-white px-3 py-1.5 text-xs font-700 text-tomato-dark disabled:opacity-50">
                    {editingTargets ? "Done" : "Change targets"}
                  </button>
                </div>
              </div>
              {editingTargets && <div className="mt-3 rounded-xl border border-cream-deep bg-white p-3">
                <fieldset disabled={generating}><MacroTargetEditor value={{ targets, mode: targetMode, preset: targetPreset }} onChange={(next) => {
                  setTargets(next.targets); setTargetMode(next.mode); setTargetPreset(next.preset); setPreview(null);
                }} />
                <button type="button" disabled={!targetValidation.valid} onClick={async () => {
                  await onTargetsSave({ targets: targetResolution.target, mode: targetMode, preset: targetPreset });
                  setEditingTargets(false);
                }} className="mt-3 rounded-xl bg-tomato px-3 py-2 text-sm font-700 text-cream disabled:opacity-50">Save targets</button></fieldset>
              </div>}

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
                    disabled={generating}
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
                    disabled={generating}
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
                    disabled={generating}
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
                        disabled={generating}
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
                    disabled={generating}
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
                  onClick={() => void run(seed)}
                  disabled={!targetValidation.valid || generating}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-tomato px-4 py-2.5 font-700 text-cream hover:bg-tomato-dark disabled:opacity-50"
                >
                  <Sparkles size={16} /> {generating ? "Generating…" : preview ? "Regenerate" : "Generate"}
                </button>
                {preview && (
                  <button
                    type="button"
                    onClick={() => void run(seed + 1, true)}
                    disabled={generating}
                    className="flex items-center justify-center gap-2 rounded-xl border border-cream-deep bg-white px-4 py-2.5 font-600 text-charcoal hover:border-tomato-soft disabled:opacity-50"
                  >
                    <RefreshCw size={15} className={generating ? "animate-spin" : ""} /> Shuffle
                  </button>
                )}
              </div>
              <p className="mt-2 min-h-5 text-xs text-charcoal-soft" role="status" aria-live="polite">
                {generationMessage}
              </p>

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
                        avg <b className="text-charcoal">{formatMacroGrams(avgProtein)}</b> g P
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
                            kcal · P {formatMacroGrams(day.macros.protein_g)} ·{" "}
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
                                {round0(meal.macros.energy_kcal)} kcal · P {formatMacroGrams(meal.macros.protein_g)} · C {formatMacroGrams(meal.macros.carbs_g)} · F {formatMacroGrams(meal.macros.fat_g)}
                              </span>
                            </li>
                          ))}
                          {day.skippedSlots.length > 0 && (
                            <li className="pt-0.5 text-[11px] text-charcoal-soft">
                              No {day.skippedSlots.join(", ")} — this day reaches
                              its target without{" "}
                              {day.skippedSlots.length > 1 ? "them" : "one"}.
                            </li>
                          )}
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
