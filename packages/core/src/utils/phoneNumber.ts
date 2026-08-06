/**
 * Lebanese phone number normalization (CARRIER_LINES_VALIDITY_PLAN.md Phase 6).
 *
 * Used ONLY to detect "is this the shop's own carrier line" — comparing the
 * number a customer/operator typed into the Telecom recharge form against an
 * active `carrier_lines.phone_number`. NEVER used for display, storage, or
 * general phone validation (`validators/common.ts`'s `phoneNumberSchema`
 * covers that, deliberately more permissive — see its own doc comment) — a
 * stored `phone_number` keeps whatever format the operator originally typed.
 *
 * Defined ONCE here (rule 14) and exported from `@liratek/core` so BOTH the
 * frontend's Credit-tab detection AND the backend re-validate the same way —
 * the REST route (`POST /api/recharge/process`) is directly callable, so the
 * backend cannot trust a client-computed "is this a buy-back" flag alone.
 *
 * Strategy: strip everything to a "core" digit string — no international
 * access code (`00`), no country code (`961`), no domestic trunk `0` — so two
 * numbers that are the SAME physical line but typed in different everyday
 * formats normalize to the identical core string:
 *   "03 123456"      -> "3123456"
 *   "+96103123456"   -> "3123456"
 *   "96103123456"    -> "3123456"
 *   "0096103123456"  -> "3123456"
 * Order matters: access code first (it only ever prefixes a country code),
 * then country code, then the domestic trunk zero — each strip re-reads the
 * ALREADY-stripped string, so a number that went through all three prefixes
 * lands on the same core as one that had none of them.
 */

/**
 * Reduce a free-typed phone number to its comparison-only "core" digit
 * string. Returns `""` for a null/empty/non-numeric input — callers MUST
 * treat an empty core as "does not match anything" (see
 * {@link isSameLebanesePhone}), never as a wildcard.
 */
export function normalizeLebanesePhone(raw: string | null | undefined): string {
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";

  // International access code ("00" + country code, e.g. "00961...").
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Country code ("961..."), only once whatever follows is still long
  // enough to plausibly be a local number on its own (8+ digits) — guards
  // against stripping "961" off a short number that merely happens to start
  // with those three digits.
  if (digits.startsWith("961") && digits.length > 8) {
    digits = digits.slice(3);
  }

  // Domestic trunk "0" (e.g. "03 123456" -> "3123456"), only once the
  // remainder is still long enough (7+ digits) to be a bare local number —
  // guards against eating a real leading digit off an already-short string.
  if (digits.startsWith("0") && digits.length > 7) {
    digits = digits.slice(1);
  }

  return digits;
}

/**
 * Whether two free-typed phone numbers refer to the SAME line, per
 * {@link normalizeLebanesePhone}. An empty core (either side) never matches
 * — a blank "Phone Number" field must never be treated as matching a carrier
 * line that also happens to have no number recorded.
 */
export function isSameLebanesePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeLebanesePhone(a);
  if (na.length === 0) return false;
  return na === normalizeLebanesePhone(b);
}
