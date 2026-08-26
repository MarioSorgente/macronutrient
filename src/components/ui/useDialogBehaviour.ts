"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The things every dialog has to do, in one place.
 *
 * Escape closes it, the page behind it stops scrolling, focus moves into it and
 * is handed back on the way out, and Tab cannot wander off into the page
 * underneath. `Modal` grew all of that; the planner's add-to-slot dialog is
 * hand-rolled — it owns its own scroll regions and a per-tab footer, which is
 * why it was never built on `Modal` — and so it had none of it. That is the
 * dialog people use most: Escape did nothing, the week scrolled behind it, and
 * closing it dropped focus onto `<body>`.
 *
 * Behaviour belongs to "being a dialog", not to one component's markup.
 */
export function useDialogBehaviour(
  onClose: () => void,
  /** Where to put focus first; the panel's first control by default. */
  preferredFocus?: RefObject<HTMLElement | null>
) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Remember what had focus so it can be handed back when the dialog closes —
  // otherwise focus falls to <body> and keyboard users lose their place.
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Prefer the first control in the body — landing on the close button
    // reads as "you probably want to leave", which is rarely the intent.
    const preferred = preferredFocus?.current?.querySelector<HTMLElement>(FOCUSABLE);
    const anywhere = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (preferred ?? anywhere ?? panelRef.current)?.focus();

    return () => {
      document.body.style.overflow = overflow;
      restoreTo.current?.focus?.();
    };
    // Refs only; the dialog mounts and unmounts as a whole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return { panelRef, onKeyDown };
}
