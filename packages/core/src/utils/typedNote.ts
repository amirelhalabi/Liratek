/**
 * LIRA-366 — the cashier's typed note, browser-safe (reachable from
 * `browser.ts`; no Node imports, rule 29).
 */

/** Separator between the system part of a debt note and the typed note. */
export const TYPED_NOTE_SEPARATOR = " — ";

/** `"<systemNote> — <typed>"`, or `systemNote` when nothing was typed. */
export function withTypedNote(
  systemNote: string,
  typed: string | null | undefined,
): string {
  const t = typed?.trim();
  return t ? `${systemNote}${TYPED_NOTE_SEPARATOR}${t}` : systemNote;
}

/**
 * The note to show for a transaction's parsed `details`: `note`, or Hold's
 * `notes`. Trimmed; anything else (absent, not a string, blank) → null, so a
 * row with missing or odd metadata shows no mark.
 */
export function noteOfDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { note?: unknown; notes?: unknown };
  for (const v of [d.note, d.notes]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
