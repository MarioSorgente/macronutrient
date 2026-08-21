"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/Button";

const SIZES = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
} as const;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Remember what had focus so it can be handed back when the dialog closes —
  // otherwise focus falls to <body> and keyboard users lose their place.
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Prefer the first control in the body — landing on the close button
    // reads as "you probably want to leave", which is rarely the intent.
    const body = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    const anywhere = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (body ?? anywhere ?? panelRef.current)?.focus();

    return () => {
      document.body.style.overflow = overflow;
      restoreTo.current?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Trap Tab inside the panel by wrapping at either end.
      const nodes = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      ).filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
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
