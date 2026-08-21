"use client";

import { useEffect, useRef, useState } from "react";
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
  timeoutMs = 4000,
  className,
}: {
  onConfirm: () => void;
  /** Accessible name for the armed state, e.g. "Delete Chicken bowl". */
  label: string;
  confirmLabel?: string;
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

  return (
    <IconButton
      variant="danger"
      aria-label={label}
      onClick={() => setArmed(true)}
      className={className}
    >
      <Trash2 size={16} />
    </IconButton>
  );
}
