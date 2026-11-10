/**
 * LIRA-377 restore picker time helpers. The picker shows the BROWSER's local
 * wall clock; the server gets a UTC instant plus the browser's offset, never
 * a local string it would read in its own (UTC, Fly) zone — rule 27.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A UTC ISO instant as a `datetime-local` value in this browser's zone
 * (`YYYY-MM-DDTHH:mm`). `roundUp` moves a moment with seconds to the next
 * whole minute, so the earliest pickable minute is never before `earliest`.
 */
export function isoToLocalInput(iso: string, roundUp = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (roundUp && (d.getSeconds() !== 0 || d.getMilliseconds() !== 0)) {
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
  }
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** A `datetime-local` value (local wall clock) as a UTC ISO instant `…Z`,
 * or null when it is not a valid date and time. */
export function localInputToUtcIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  // ECMAScript reads a date-time without an offset as LOCAL time.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** This browser's UTC offset in minutes, east positive (Beirut summer = 180). */
export function browserTzOffsetMin(): number {
  const offset = -new Date().getTimezoneOffset();
  return offset === 0 ? 0 : offset; // never -0
}
