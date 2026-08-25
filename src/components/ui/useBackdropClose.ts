"use client";

import { useCallback, useRef } from "react";

/**
 * Closing a dialog by clicking away from it, without closing it by accident.
 *
 * A browser fires `click` on the nearest ancestor of where the press started
 * and where it ended, so selecting the text of a target and releasing a few
 * pixels outside the panel counts as a click on the backdrop. Every dialog here
 * closed on that: dragging across a calorie figure to retype it threw away the
 * whole generator, mid-edit. It reads as the window closing on its own, because
 * from the outside that is exactly what it is.
 *
 * A press that began inside the panel is part of working in the panel, whatever
 * it lands on. Only a press that starts *and* ends on the backdrop is someone
 * clicking away.
 */
export function useBackdropClose(onClose: () => void) {
  const pressedBackdrop = useRef(false);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    pressedBackdrop.current = event.target === event.currentTarget;
  }, []);

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      const away = event.target === event.currentTarget && pressedBackdrop.current;
      pressedBackdrop.current = false;
      if (away) onClose();
    },
    [onClose]
  );

  return { onMouseDown, onClick };
}
