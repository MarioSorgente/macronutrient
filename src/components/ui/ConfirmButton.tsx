"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

/**
 * Two-step destructive action: the icon arms, a second click commits.
 *
 * The app deliberately avoids `window.confirm()`, so this keeps that pattern
 * consistent — and adds the timeout the hand-rolled copies lacked, so a stray
 * click does not leave a delete button armed indefinitely.
 */
export default function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = "Confirm",
  text,
  icon,
  disabled,
  timeoutMs = 4000,
  className,
}: {
  onConfirm: () => void;
  /**
   * Accessible name for the icon-only form, e.g. "Delete Chicken bowl".
   *
   * Ignored when `text` is given: overriding a visible label with a different
   * accessible name breaks WCAG 2.5.3 (Label in Name) — someone using voice
   * control says what they can see, and "Cancel this week" would not match an
   * aria-label reading "Cancel this order".
   */
  label: string;
  confirmLabel?: string;
  /** Render a labelled button instead of the bare icon. */
  text?: string;
  icon?: ReactNode;
  disabled?: boolean;
  timeoutMs?: number;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer.current);
  }, [armed, timeoutMs]);

  if (armed) {
    return (
      <button
        type="button"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className={cn(
          "rounded-lg bg-tomato-dark px-2.5 py-2 text-xs font-700 text-cream hover:bg-tomato",
          className
        )}
      >
        {confirmLabel}
      </button>
    );
  }

  if (text) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border border-cream-deep bg-white px-3 py-2 text-sm font-600 text-charcoal-soft transition-colors",
          "hover:border-tomato-soft hover:text-tomato-dark disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        {icon ?? <Trash2 size={15} />}
        {text}
      </button>
    );
  }

  return (
    <IconButton
      variant="danger"
      aria-label={label}
      disabled={disabled}
      onClick={() => setArmed(true)}
      className={className}
    >
      <Trash2 size={16} />
    </IconButton>
  );
}
