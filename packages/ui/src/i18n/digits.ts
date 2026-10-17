/**
 * LIRA-331 (FR-017, research R13): a cashier may type Arabic-Indic digits.
 * They are turned into Western digits BEFORE the value is parsed or saved, so
 * the stored amount is identical whichever digits were typed (rule 14: one
 * normaliser). Pure leaf.
 *
 * - U+0660–0669 (Arabic-Indic) and U+06F0–06F9 (Persian) → 0–9
 * - `٫` (U+066B, Arabic decimal separator) → `.`
 * - `٬` (U+066C, Arabic thousands separator) → removed
 */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (ch === "٫") {
      out += ".";
    } else if (ch === "٬") {
      // thousands separator: dropped
    } else {
      out += ch;
    }
  }
  return out;
}
