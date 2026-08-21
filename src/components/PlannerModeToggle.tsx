"use client";

import { Hand, Sparkles } from "lucide-react";
import type { PlannerMode } from "@/lib/coachMode";

/**
 * Switches the same client data between hands-on planning and the coach
 * workflow (targets in, plan out). Deliberately a mode rather than a separate
 * screen, so there is one plan and one source of truth.
 */
export default function PlannerModeToggle({
  mode,
  onChange,
}: {
  mode: PlannerMode;
  onChange: (mode: PlannerMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-cream-deep bg-white p-0.5"
      role="group"
      aria-label="Planner mode"
    >
      <Option
        active={mode === "manual"}
        onClick={() => onChange("manual")}
        icon={<Hand size={14} />}
        label="Manual"
      />
      <Option
        active={mode === "coach"}
        onClick={() => onChange("coach")}
        icon={<Sparkles size={14} />}
        label="Coach"
      />
    </div>
  );
}

function Option({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-600 transition-colors " +
        (active
          ? "bg-charcoal text-cream"
          : "text-charcoal-soft hover:text-charcoal")
      }
    >
      {icon}
      {label}
    </button>
  );
}
