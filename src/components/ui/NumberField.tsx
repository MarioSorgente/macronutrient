"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";

/**
 * A number you can actually type into.
 *
 * A controlled `<input type="number">` bound straight to a number cannot be
 * emptied: clearing it parses to `NaN`, the usual `|| 0` turns that into zero,
 * and the field refills under the cursor. Changing 2,000 kcal to 2,500 then
 * means selecting the whole value first, and one stray keystroke leaves a
 * target of 0. The same three lines were written out at five call sites, so all
 * five behaved that way.
 *
 * So the field keeps what you typed while you are typing, and reconciles when
 * you leave. An empty or half-written value is a normal thing to be holding
 * mid-edit, not a zero — and if you leave it that way it goes back to what it
 * was rather than inventing a number.
 *
 * The wheel is deliberately ignored. A focused number input treats a scroll as
 * an increment, so scrolling a dialog with the pointer resting over a target
 * quietly rewrote it.
 */
export default function NumberField({
  value,
  onChange,
  min = 0,
  max,
  step,
  decimals = false,
  className,
  ...rest
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Whether a fractional value is meaningful here. */
  decimals?: boolean;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "min" | "max" | "step" | "type"
>) {
  const [draft, setDraft] = useState(() => String(value));
  const editing = useRef(false);

  // While the field has focus its own text wins; anything else that moves the
  // value — a preset, a stepper, a reset — shows up as soon as it does not.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  const clamp = (amount: number): number => {
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, amount));
    return decimals ? bounded : Math.round(bounded);
  };

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    // Nothing usable typed: put back what was there rather than guessing.
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <input
      {...rest}
      type="number"
      inputMode={decimals ? "decimal" : "numeric"}
      min={min}
      max={max}
      step={step ?? (decimals ? "any" : 1)}
      value={draft}
      onFocus={(event) => {
        editing.current = true;
        rest.onFocus?.(event);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        // Live where it can be: a complete number updates whatever is watching
        // straight away, and a half-typed one simply waits.
        const parsed = Number.parseFloat(event.target.value);
        if (Number.isFinite(parsed) && String(clamp(parsed)) === event.target.value) {
          if (clamp(parsed) !== value) onChange(clamp(parsed));
        }
      }}
      onBlur={(event) => {
        editing.current = false;
        commit(event.target.value);
        rest.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        rest.onKeyDown?.(event);
      }}
      onWheel={(event) => event.currentTarget.blur()}
      className={cn("no-spin", className)}
    />
  );
}
