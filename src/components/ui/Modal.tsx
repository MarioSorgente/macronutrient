"use client";

import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/Button";
import { useBackdropClose } from "@/components/ui/useBackdropClose";
import { useDialogBehaviour } from "@/components/ui/useDialogBehaviour";

const SIZES = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
} as const;

/**
 * The dialog shell every modal in the app shares: a bottom sheet on phones that
 * becomes a centred card from `sm` up.
 *
 * The six hand-rolled copies this replaces all missed the same things — Escape
 * to close, a focus trap, a scroll lock, restoring focus on close, and a label
 * association — so those live here and every dialog gets them at once.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  size = "lg",
  subheader,
  footer,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  subtitle?: string;
  onClose: () => void;
  size?: keyof typeof SIZES;
  /** Pinned below the header and above the scroll area, e.g. a search field. */
  subheader?: ReactNode;
  /** Sticky action bar. Omit for dialogs that commit on each interaction. */
  footer?: ReactNode;
  /** Extra classes for the scroll area, e.g. `space-y-4` for a stacked form. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Escape, the scroll lock, the focus trap and handing focus back — shared
  // with the planner's hand-rolled dialog so the two cannot drift apart.
  const { panelRef, onKeyDown } = useDialogBehaviour(onClose, bodyRef);

  // Only a press that starts and ends on the backdrop is a click away from the
  // panel; a drag out of an input is not.
  const backdrop = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      {...backdrop}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-xl2 bg-cream shadow-card outline-none sm:rounded-xl2",
          SIZES[size]
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-cream-deep px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 font-display text-lg font-700 text-charcoal">
              {title}
            </h2>
            {subtitle && (
              <p className="truncate text-xs text-charcoal-soft">{subtitle}</p>
            )}
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>

        {subheader && (
          <div className="border-b border-cream-deep px-4 py-3">{subheader}</div>
        )}

        <div
          ref={bodyRef}
          className={cn("scroll-slim flex-1 overflow-y-auto px-4 py-3", bodyClassName)}
        >
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-cream-deep px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
