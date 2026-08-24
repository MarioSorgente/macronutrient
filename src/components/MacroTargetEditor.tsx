"use client";

import type { MacroStyle, MacroTargets, TargetMode } from "@/lib/storage/types";
import { TARGET_FIELDS } from "@/lib/clients";
import { MACRO_STYLES, targetsFromStyle } from "@/lib/preferences";
import { resolveTarget, validateMacroTarget } from "@/lib/targetResolution";
import { formatMacroGrams, round0, wholeNonNegative } from "@/lib/format";

export interface MacroTargetSelection {
  targets: MacroTargets;
  mode: TargetMode;
  preset?: MacroStyle;
}

export function TargetSummary({ selection }: { selection: MacroTargetSelection }) {
  const resolved = resolveTarget({ targets: selection.targets, mode: selection.mode, preset: selection.preset });
  return (
    <div data-testid="resolved-target">
      <div className="font-700 text-charcoal">
        {selection.mode === "custom" ? "Custom" : `Preset · ${resolved.selectedStyle}`}
      </div>
      <div className="mt-0.5 tabular-nums text-charcoal-soft">
        {round0(resolved.target.energy_kcal)} kcal · P {formatMacroGrams(resolved.target.protein_g)} g · C{" "}
        {formatMacroGrams(resolved.target.carbs_g)} g · F {formatMacroGrams(resolved.target.fat_g)} g
      </div>
    </div>
  );
}

/** The single target-mode editor used anywhere a plan's daily target can change. */
export default function MacroTargetEditor({ value, onChange }: {
  value: MacroTargetSelection;
  onChange: (next: MacroTargetSelection) => void;
}) {
  const resolved = resolveTarget({ targets: value.targets, mode: value.mode, preset: value.preset });
  const validation = validateMacroTarget(resolved.target);

  function choosePreset(preset: MacroStyle) {
    if (value.mode === "custom" && !window.confirm(
      "Use this preset? It will recalculate and replace all of your custom macro targets."
    )) return;
    onChange({ mode: "preset", preset, targets: targetsFromStyle(value.targets.energy_kcal, preset) });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Target mode">
        <button type="button" onClick={() => choosePreset(value.preset ?? "balanced")}
          className={"rounded-xl border px-3 py-2 text-sm font-700 " + (value.mode === "preset" ? "border-tomato bg-tomato/5" : "border-cream-deep bg-white text-charcoal-soft")}>Use a preset</button>
        <button type="button" onClick={() => onChange({ ...value, mode: "custom", preset: undefined })}
          className={"rounded-xl border px-3 py-2 text-sm font-700 " + (value.mode === "custom" ? "border-tomato bg-tomato/5" : "border-cream-deep bg-white text-charcoal-soft")}>Set my own macros</button>
      </div>
      {value.mode === "preset" && <div>
        <div className="grid grid-cols-2 gap-2">
          {MACRO_STYLES.map((style) => <button key={style.id} type="button" onClick={() => choosePreset(style.id)}
            className={"rounded-xl border px-3 py-2 text-left " + (value.preset === style.id ? "border-tomato bg-tomato/5" : "border-cream-deep bg-white")}>
            <div className="text-sm font-700">{style.label}</div>
            <div className="text-[11px] text-charcoal-soft">{style.description}</div>
            <div className="text-[10px] text-charcoal-soft">P {style.split.protein * 100}% · C {style.split.carbs * 100}% · F {style.split.fat * 100}%</div>
          </button>)}
        </div>
        <p className="mt-2 text-xs text-charcoal-soft">Choosing a preset recalculates every macro. Calories remain editable; preset grams are derived with 4/4/9 kcal per gram.</p>
      </div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TARGET_FIELDS.map((field) => <label key={field.key} className="text-xs">
          <span className="mb-1 block font-600 text-charcoal-soft">{field.label} ({field.unit})</span>
          <input type="number" min={0} step={1} inputMode="numeric"
            value={value.mode === "preset" && field.key !== "energy_kcal" ? Math.round(resolved.target[field.key]) : value.targets[field.key]}
            readOnly={value.mode === "preset" && field.key !== "energy_kcal"}
            onChange={(event) => {
              const amount = wholeNonNegative(Number(event.target.value));
              if (field.key === "energy_kcal" && value.mode === "preset") {
                onChange({ ...value, targets: targetsFromStyle(amount, value.preset ?? "balanced") });
              } else {
                onChange({ targets: { ...value.targets, [field.key]: amount }, mode: field.key === "energy_kcal" ? value.mode : "custom", preset: field.key === "energy_kcal" ? value.preset : undefined });
              }
            }}
            className="no-spin w-full rounded-lg border border-cream-deep bg-white px-2 py-1.5 text-sm font-600 tabular-nums outline-none focus:border-tomato-soft" />
        </label>)}
      </div>
      {!validation.valid && <p role="alert" className="rounded-lg bg-tomato-soft/30 px-3 py-2 text-xs font-600 text-tomato-dark">
        Macro grams represent {round0(validation.macroEnergyKcal)} kcal, not {round0(resolved.target.energy_kcal)} kcal. Adjust macros or calories before saving.
      </p>}
      <div className="rounded-xl border border-cream-deep bg-cream/50 px-3 py-2 text-xs"><TargetSummary selection={value} /><p className="mt-1 text-charcoal-soft">{resolved.explanation}</p></div>
    </div>
  );
}
