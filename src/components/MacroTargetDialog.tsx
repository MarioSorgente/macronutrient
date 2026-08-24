"use client";
import { useState } from "react";
import type { Plan } from "@/lib/storage/types";
import { resolveTarget, validateMacroTarget } from "@/lib/targetResolution";
import MacroTargetEditor, { type MacroTargetSelection } from "@/components/MacroTargetEditor";
import Modal from "@/components/ui/Modal";

export default function MacroTargetDialog({ plan, onSave, onClose }: { plan: Plan; onSave: (selection: MacroTargetSelection) => void | Promise<void>; onClose: () => void }) {
  const [selection, setSelection] = useState<MacroTargetSelection>(() => ({
    targets: resolveTarget({ targets: plan.targets, mode: plan.targetMode, preset: plan.targetPreset }).target,
    mode: plan.targetMode,
    preset: plan.targetMode === "preset" ? plan.targetPreset ?? "balanced" : undefined,
  }));
  const valid = validateMacroTarget(resolveTarget({ targets: selection.targets, mode: selection.mode, preset: selection.preset }).target).valid;
  return <Modal title={plan.targets ? "Edit daily targets" : "Set daily targets"} subtitle="Choose a preset or enter a calorie and macro goal that works for you." onClose={onClose} bodyClassName="space-y-4" footer={<>
    <button type="button" onClick={onClose} className="rounded-xl border border-cream-deep bg-white px-4 py-2 text-sm font-600">Cancel</button>
    <button type="button" disabled={!valid} onClick={() => void onSave(selection)} className="rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream disabled:opacity-50">Save targets</button>
  </>}><MacroTargetEditor value={selection} onChange={setSelection} /></Modal>;
}
