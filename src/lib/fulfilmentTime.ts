/** A fulfilment time paired with the calendar date shown to the customer. */
export interface DatedFulfilmentTime {
  date: string;
  time: string;
}

export interface ServiceWindow {
  serviceOpen: string;
  serviceClose: string;
}

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function wallClockMinutes(value: string): number | null {
  const match = WALL_TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Validates ready-by choices using wall-clock time only.
 *
 * Both endpoints are inclusive. A close earlier than open explicitly means an
 * overnight window (for example 18:00–02:00); equal endpoints are rejected as
 * malformed rather than being interpreted as either zero hours or 24 hours.
 */
export function serviceTimeProblems(
  choices: DatedFulfilmentTime[],
  window: ServiceWindow
): string[] {
  const open = wallClockMinutes(window.serviceOpen);
  const close = wallClockMinutes(window.serviceClose);
  if (open === null || close === null || open === close) {
    return ["Restaurant service hours are invalid. Please contact the restaurant."];
  }

  const overnight = close < open;
  const problems: string[] = [];
  for (const choice of choices) {
    const requested = wallClockMinutes(choice.time);
    if (requested === null) {
      problems.push(`${choice.date}: pick a valid time.`);
      continue;
    }
    const inHours = overnight
      ? requested >= open || requested <= close
      : requested >= open && requested <= close;
    if (!inHours) {
      problems.push(
        `${choice.date}: choose a time between ${window.serviceOpen} and ${window.serviceClose}.`
      );
    }
  }
  return problems;
}
