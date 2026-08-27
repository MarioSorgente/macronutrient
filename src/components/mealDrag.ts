import type { DragEvent } from "react";

/**
 * Moving a planned meal from one slot to another by dragging it.
 *
 * Hand-rolled, like every other interaction in the app — a drag-and-drop
 * dependency would be a lot of bundle for one gesture on one screen.
 *
 * The gesture is deliberately not the only way to move a meal. HTML5 drag
 * events do not fire on touch at all, so the meal dialog carries a "Move to"
 * control that reaches the same function. That one is also what makes this
 * usable with a keyboard.
 */

/** A private MIME type, so a drag from elsewhere cannot be mistaken for ours. */
export const MEAL_DRAG_TYPE = "application/x-mamma-meal";

export interface MealDragPayload {
  assignmentId: string;
  fromDay: number;
  fromSlot: string;
}

export function startMealDrag(
  event: DragEvent<HTMLElement>,
  payload: MealDragPayload
): void {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(MEAL_DRAG_TYPE, JSON.stringify(payload));
  // Firefox refuses to start a drag unless text/plain is also set.
  event.dataTransfer.setData("text/plain", payload.assignmentId);
}

export function readMealDrag(event: DragEvent<HTMLElement>): MealDragPayload | null {
  const raw = event.dataTransfer.getData(MEAL_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MealDragPayload>;
    return typeof parsed.assignmentId === "string" &&
      typeof parsed.fromDay === "number" &&
      typeof parsed.fromSlot === "string"
      ? (parsed as MealDragPayload)
      : null;
  } catch {
    return null;
  }
}

/** Whether this drag is one of ours, without reading the payload. */
export function isMealDrag(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes(MEAL_DRAG_TYPE);
}

/** True when dropping here would not actually move anything. */
export function isSameSlot(
  payload: MealDragPayload,
  day: number,
  slot: string
): boolean {
  return payload.fromDay === day && payload.fromSlot === slot;
}
