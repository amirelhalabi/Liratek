/**
 * LIRA-333 (FR-014, FR-015) — the ONE rule that turns a typed phone number
 * into WhatsApp's international form (country code + number, digits only).
 * Used by the receipt's click-to-chat link and by `WhatsAppService`.
 *
 * PURE and import-free on purpose: `browser.ts` exports it, so it must stay a
 * leaf with no Node built-in at any depth (rule 29).
 *
 * Rules, in order (research R6):
 *   1. strip spaces, `-`, `.`, `(`, `)`;
 *   2. anything left that is not `^\+?\d+$` is refused;
 *   3. a leading `+` or `00` means the number is already international;
 *   4. international `961…`: a single `0` typed right after `961` is dropped;
 *   5. international with another country code: kept as is;
 *   6. national with a leading `0`: that `0` becomes `961`;
 *   7. no prefix, starts with `961`, 10–11 digits: already international;
 *   8. otherwise (national, no leading `0`): `961` is prefixed;
 *   9. the result must be 8–15 digits (E.164 maximum), else refused.
 */

export type WhatsAppNumberResult =
  | { ok: true; digits: string }
  | { ok: false; reason: "empty" | "invalid" };

const LEBANON = "961";

export function toWhatsAppNumber(
  raw: string | null | undefined,
): WhatsAppNumberResult {
  const cleaned = (raw ?? "").replace(/[\s\-.()]/g, "");
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (!/^\+?\d+$/.test(cleaned)) return { ok: false, reason: "invalid" };

  let digits: string;
  let international = false;
  if (cleaned.startsWith("+")) {
    digits = cleaned.slice(1);
    international = true;
  } else if (cleaned.startsWith("00")) {
    digits = cleaned.slice(2);
    international = true;
  } else {
    digits = cleaned;
  }

  if (international) {
    if (digits.startsWith(LEBANON + "0")) {
      digits = LEBANON + digits.slice(LEBANON.length + 1);
    }
  } else if (digits.startsWith("0")) {
    digits = LEBANON + digits.slice(1);
  } else if (
    digits.startsWith(LEBANON) &&
    digits.length >= 10 &&
    digits.length <= 11
  ) {
    // already international, typed without + or 00
  } else {
    digits = LEBANON + digits;
  }

  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, digits };
}
