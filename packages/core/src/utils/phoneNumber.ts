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

/**
 * Whether a free-typed value LOOKS like a phone number — only digits,
 * spaces, dashes, and an optional leading "+". This is the gate before
 * anything runs {@link normalizeLineNumber} on a value: a product name
 * search or a non-numeric/EAN barcode must never be pushed through phone
 * normalisation. Defined once and reused by {@link normalizeLineNumber}
 * itself and by `InventoryService`'s phone-line search/lookup fallback
 * (rule 14 — one predicate, never a second copy that can drift).
 */
export function isPhoneShapedTerm(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[+\d\s-]+$/.test(value);
}

/**
 * Storage-facing normaliser for a RESOLD PHONE LINE's number (LIRA-207,
 * `docs/plans/ongoing_plans/OWNER_NOTES_REMAINING_BUILD.md` #13). Deliberately
 * separate from {@link normalizeLebanesePhone} above: that one is
 * comparison-only and its own doc comment forbids using it for storage — it
 * throws away the leading domestic "0" and the country code entirely, so two
 * DIFFERENT local numbers sharing the same 7-digit core (unlikely but not
 * impossible across area codes) would collide. This function instead
 * produces the CANONICAL STORED form so every everyday way of typing the
 * SAME number collapses to one string, letting an exact-match duplicate
 * check work with no fuzzy comparison at read time:
 *   "03 123 456"      -> "03123456"
 *   "03-123-456"       -> "03123456"
 *   "+961 3 123 456"   -> "03123456"
 *   "00961 3 123 456"  -> "03123456"
 *   "70 111 222"       -> "70111222"   (8-digit mobile prefix — no trunk 0)
 *   "+961 70 111 222"  -> "70111222"
 *
 * Rule (owner's own words, "keep the leading 0" — KEEP, never REMOVE one
 * that's there): strip whitespace and dashes, strip a leading "+961" or
 * "00961" international prefix (only those two literal forms — no bare
 * "961", no other country code). A "0" is then prepended whenever the
 * remaining local part is exactly 7 digits and doesn't already have one — a
 * landline/area-code number (e.g. "3123456") always carries a trunk zero in
 * its canonical stored form, WHETHER OR NOT the input actually went through
 * a stripped international prefix: "+961 3 123 456", "00961 3 123 456" and a
 * bare local "3 123 456" (no prefix at all) all collapse to the SAME
 * "03123456" — otherwise the same physical line could be listed twice, once
 * with the trunk zero and once without, which is exactly the collision this
 * function exists to prevent. An 8-digit local remainder (a mobile prefix —
 * 70/71/76/78/79/81 — which never carries a trunk zero) is left exactly as
 * produced: "+961 70 111 222" -> "70111222", NOT "070111222". A local-format
 * input that already starts with "0" is returned untouched past the
 * whitespace/dash strip — this function never removes a leading 0.
 *
 * Scope: call this ONLY where the value is known to be a phone-line number
 * — {@link isPhoneLineCategoryName} is the gate `InventoryService` uses
 * before calling it on a product's `barcode`, and every caller MUST also
 * gate on {@link isPhoneShapedTerm} first. As a second line of defence this
 * function itself refuses to touch anything whose stripped-of-formatting
 * length isn't a real phone-line local length (7 or 8 digits) — a real
 * EAN-13 barcode that happens to be all-digit and coincidentally lives in a
 * matched category is returned UNCHANGED rather than mangled, and so is a
 * bare "961..." with no "+"/"00" access code (out of the owner's spec) or
 * an incomplete fragment like "+961" alone, which normalises to "" so a
 * blank-barcode caller can fall through to its own "no barcode typed"
 * handling instead of storing a truncated garbage string (rule 29 leaf
 * module — pure string manipulation only, safe for `browser.ts`).
 */
export function normalizeLineNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!isPhoneShapedTerm(raw)) return raw;

  let s = raw.replace(/[\s-]/g, "");
  if (s.length === 0) return "";

  if (s.startsWith("+961")) {
    s = s.slice(4);
  } else if (s.startsWith("00961")) {
    s = s.slice(5);
  }

  // Anything longer than a real phone-line local number (8 digits, at most)
  // once formatting/prefix are gone is more likely a genuine barcode (EAN,
  // etc.) that merely happens to be all-digit — never mangle it. Shorter
  // fragments (including "" from a bare "+961"/"00961") fall straight
  // through unchanged below.
  if (s.length > 8) {
    return raw;
  }

  // Canonicalize the trunk zero regardless of whether an international
  // prefix was actually present — a bare local "3 123 456" (7 digits, no
  // prefix at all) must land on the SAME stored form as "+961 3 123 456",
  // or the two collide-in-fact but not-in-string and the same line gets
  // listed twice (see the doc comment above).
  if (s.length === 7 && !s.startsWith("0")) {
    s = `0${s}`;
  }

  return s;
}

/**
 * Heuristic classification of a `product_categories.name` as a resold
 * PHONE LINES category (LIRA-207). No schema flag was authorized for this
 * build (owner decision, `OWNER_NOTES_REMAINING_BUILD.md` #13 — "no new
 * money code", and the owner may create the category from Settings with no
 * code change), so this is name-based: case-insensitive, matches when the
 * trimmed name contains the WHOLE WORD "line"/"lines" ("Phone Lines", "MTC
 * Lines", "Lines", … — see the word-boundary note below for what does NOT
 * match).
 *
 * This IS a heuristic, not a hard classification, and callers must treat it
 * that way: a category the owner names something that doesn't contain
 * "line" (e.g. "Numbers") silently gets neither the "Number" field label
 * nor the duplicate-number guard. If that turns out to matter in practice,
 * the durable fix is a `product_categories` column — not a longer word
 * list here (rule 14: one predicate, reused by both the backend guard and
 * the frontend label, never two separate name checks that can drift).
 *
 * Matches on the WHOLE word "line"/"lines" (word-boundaried), not a bare
 * substring: "Phone Lines"/"MTC Lines"/"Lines" match, but "Online Cards",
 * "Offline", "Airline", "Guidelines" and "Linen" do NOT — a substring match
 * would silently pull those categories' real EAN barcodes through
 * {@link normalizeLineNumber} on every create/update and mangle them.
 */
export function isPhoneLineCategoryName(
  name: string | null | undefined,
): boolean {
  if (!name) return false;
  return /\blines?\b/i.test(name.trim());
}
