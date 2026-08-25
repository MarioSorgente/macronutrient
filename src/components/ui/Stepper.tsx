"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * −/N/+ numeric control.
 *
 * Keeps the app's draft-then-commit behaviour: the field holds a raw string
 * while it is being typed and only parses on blur or Enter, then snaps back to
 * the value that was actually stored — so a rejected input is visibly
 * corrected rather than silently kept.
 */
export default function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  integerOnly,
  label,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integerOnly?: boolean;
  /** Accessible name, e.g. "Amount of Chicken breast". */
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function clamp(n: number): number {
    const bounded = Math.max(min, max === undefined ? n : Math.min(max, n));
    return integerOnly ? Math.round(bounded) : bounded;
  }

  function commit(raw: string) {
    const parsed = Number.parseFloat(raw);
    onChange(Number.isFinite(parsed) ? clamp(parsed) : value);
    setDraft(String(Number.isFinite(parsed) ? clamp(parsed) : value));
  }

  return (
    <div className={cn("flex items-center rounded-lg border border-cream-deep bg-white", className)}>
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className="grid h-8 w-8 place-items-center rounded-l-lg text-charcoal-soft hover:bg-cream-deep disabled:opacity-40"
        aria-label={`Decrease ${label}`}
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        // A focused number input treats a scroll as an increment, so scrolling
        // the page over one silently retyped it.
        onWheel={(e) => e.currentTarget.blur()}
        aria-label={label}
        className="no-spin w-14 border-x border-cream-deep bg-white py-1 text-center text-sm font-600 tabular-nums text-charcoal outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={max !== undefined && value >= max}
        className="grid h-8 w-8 place-items-center rounded-r-lg text-charcoal-soft hover:bg-cream-deep disabled:opacity-40"
        aria-label={`Increase ${label}`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
