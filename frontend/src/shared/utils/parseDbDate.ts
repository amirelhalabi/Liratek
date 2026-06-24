/**
 * Parse a database timestamp into a Date.
 *
 * SQLite `CURRENT_TIMESTAMP` (and `datetime('now')`) values arrive as UTC
 * formatted "YYYY-MM-DD HH:MM:SS" with no timezone marker. The JS `Date`
 * constructor interprets a marker-less string as *local* time, which makes
 * fresh records look hours off (e.g. 3h behind in Beirut, UTC+3). When no
 * timezone info is present we pin the value to UTC so the subsequent
 * `toLocaleString` / `Intl` conversion lands on the correct local time.
 */
export function parseDbDate(iso: string): Date {
  // Already carries a timezone designator (trailing Z or ±hh:mm offset).
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) return new Date(iso);
  // SQLite space-separated form (or bare ISO) → pin to UTC.
  return new Date(`${iso.replace(" ", "T")}Z`);
}
