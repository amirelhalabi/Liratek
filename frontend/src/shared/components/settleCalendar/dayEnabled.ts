import type { SettleDay } from "./types";

/**
 * Can this day be tapped? The one rule for both the circle's button and the
 * calendar hiding weeks with no tappable day (rule 14).
 */
export function isDayEnabled(day: SettleDay, isFuture: boolean): boolean {
  return !isFuture && day.state !== "NONE";
}
