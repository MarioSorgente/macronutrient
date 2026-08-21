"use client";

import { Hand, Sparkles } from "lucide-react";
import type { PlannerMode } from "@/lib/coachMode";
import SegmentedToggle from "@/components/SegmentedToggle";

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
    <SegmentedToggle
      ariaLabel="Planner mode"
      value={mode}
      onChange={onChange}
      options={[
        { value: "manual", label: "Manual", icon: <Hand size={14} /> },
        { value: "coach", label: "Coach", icon: <Sparkles size={14} /> },
      ]}
    />
  );
}
