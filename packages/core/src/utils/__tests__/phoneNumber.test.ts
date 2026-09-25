/**
 * normalizeLebanesePhone / isSameLebanesePhone — CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 6. Format list is the plan's own: "03 123456", "+96103123456",
 * "96103123456", and an international-access-code variant ("00...").
 *
 * normalizeLineNumber / isPhoneLineCategoryName / isPhoneShapedTerm —
 * LIRA-207, OWNER_NOTES_REMAINING_BUILD.md #13. NOT RUN — proven at the
 * end-of-batch gate (owner process rule for this build batch).
 *
 * Fix-round regression coverage (reviewer findings N13-1/N13-4): the
 * "keeps the leading 0" wording in the owner's note means KEEP, never ADD
 * one that wasn't there — an 8-digit mobile-prefix number (70/71/76/78/79/
 * 81) carries no trunk zero and must round-trip unchanged. Proven against
 * the pre-fix code (rule 17): reverting `normalizeLineNumber` to
 * unconditionally prepend "0" to any prefix-less result makes the new
 * "8-digit mobile prefix" cases below fail (they'd get "0"+digits instead
 * of the digits alone), and reverting `isPhoneLineCategoryName` to a bare
 * `.includes("line")` makes the new "Online Cards"/"Guidelines" negative
 * cases fail (both currently match the bare substring).
 */
import {
  normalizeLebanesePhone,
  isSameLebanesePhone,
  normalizeLineNumber,
  isPhoneLineCategoryName,
  isPhoneShapedTerm,
} from "../phoneNumber";

describe("normalizeLebanesePhone", () => {
  it("returns the same core for every equivalent format the plan lists", () => {
    const formats = [
      "03 123456",
      "+96103123456",
      "96103123456",
      "0096103123456", // international access code + country code
      "003123456", // international access code, no country code
    ];
    const cores = formats.map(normalizeLebanesePhone);
    for (const core of cores) {
      expect(core).toBe(cores[0]);
    }
    expect(cores[0]).toBe("3123456");
  });

  it("strips spaces, dashes, and parentheses", () => {
    expect(normalizeLebanesePhone("03-123-456")).toBe("3123456");
    expect(normalizeLebanesePhone("(03) 123 456")).toBe("3123456");
  });

  it("does not strip a leading 0 off a number too short to be a local trunk-prefixed one", () => {
    // A short/garbage string shorter than the 7-digit floor is left as-is —
    // guards against eating a real digit off something that isn't a full
    // local number.
    expect(normalizeLebanesePhone("012345")).toBe("012345");
  });

  it("returns '' for null/undefined/empty/non-numeric input", () => {
    expect(normalizeLebanesePhone(null)).toBe("");
    expect(normalizeLebanesePhone(undefined)).toBe("");
    expect(normalizeLebanesePhone("")).toBe("");
    expect(normalizeLebanesePhone("abc")).toBe("");
  });

  it("a number with no country code and no leading 0 (e.g. a mobile prefix like 70) round-trips unchanged", () => {
    expect(normalizeLebanesePhone("70123456")).toBe("70123456");
    expect(normalizeLebanesePhone("+96170123456")).toBe("70123456");
  });
});

describe("isSameLebanesePhone", () => {
  it("matches across every equivalent format", () => {
    expect(isSameLebanesePhone("03 123456", "+96103123456")).toBe(true);
    expect(isSameLebanesePhone("96103123456", "003123456")).toBe(true);
  });

  it("does not match a genuinely different number", () => {
    expect(isSameLebanesePhone("03 123456", "70999999")).toBe(false);
  });

  it("never matches when either side is empty — an empty core is not a wildcard", () => {
    expect(isSameLebanesePhone("", "")).toBe(false);
    expect(isSameLebanesePhone(null, null)).toBe(false);
    expect(isSameLebanesePhone("03 123456", "")).toBe(false);
    expect(isSameLebanesePhone("", "03 123456")).toBe(false);
  });
});

describe("normalizeLineNumber", () => {
  it("collapses every everyday format of the same number to the SAME canonical string", () => {
    const formats = [
      "03 123 456",
      "03-123-456",
      "03123456",
      "+961 3 123 456",
      "+9613123456",
      "00961 3 123 456",
      "009613123456",
    ];
    for (const raw of formats) {
      expect(normalizeLineNumber(raw)).toBe("03123456");
    }
  });

  it("keeps the leading 0 of an already-local number — never strips it", () => {
    expect(normalizeLineNumber("03123456")).toBe("03123456");
  });

  it("prepends a leading 0 to any 7-digit local remainder that lacks one", () => {
    expect(normalizeLineNumber("+9613123456")).toBe("03123456");
    expect(normalizeLineNumber("00961" + "3123456")).toBe("03123456");
  });

  // N13-R2-5 (fix round 2): the trunk zero must be canonical regardless of
  // whether the input actually carried an international prefix — a bare
  // local entry with no "+961"/"00961" at all is just as real a way to type
  // the same line, and skipping it let the SAME number be listed twice (once
  // via "+961 3 123 456" -> "03123456", once via "3 123 456" -> "3123456").
  it("prepends the leading 0 to a bare 7-digit local number with NO prefix at all", () => {
    expect(normalizeLineNumber("3 123 456")).toBe("03123456");
    expect(normalizeLineNumber("3123456")).toBe("03123456");
    // Same canonical form as the prefixed variants of the same line.
    expect(normalizeLineNumber("3123456")).toBe(
      normalizeLineNumber("+961 3 123 456"),
    );
  });

  it("does not touch a bare '961' with no + or 00 access code — out of the owner's spec", () => {
    // The owner's note names only "+961" and "00961" — a bare "961..." is a
    // number local numbers could coincidentally start with, so it is left
    // alone rather than guessed at. FIXED (N13-1): the pre-fix code
    // unconditionally prepended "0" to any prefix-less result, so this used
    // to assert "096103123456" — that was the bug, not the spec.
    expect(normalizeLineNumber("96103123456")).toBe("96103123456");
  });

  it("round-trips an 8-digit mobile-prefix number (70/71/76/78/79/81) unchanged — no trunk 0 to add", () => {
    // N13-1: Lebanese 8-digit mobiles have no trunk 0, so "keep the leading
    // 0" (the owner's words) must never become "ADD a leading 0".
    expect(normalizeLineNumber("70 111 222")).toBe("70111222");
    expect(normalizeLineNumber("+961 70 111 222")).toBe("70111222");
    expect(normalizeLineNumber("0096170111222")).toBe("70111222");
    expect(normalizeLineNumber("70111222")).toBe("70111222");
  });

  it("prepends 0 only for a 7-digit (landline/area-code) remainder, never an 8-digit (mobile) one", () => {
    expect(normalizeLineNumber("+9613123456")).toBe("03123456"); // 7-digit remainder -> +0
    expect(normalizeLineNumber("+96170111222")).toBe("70111222"); // 8-digit remainder -> unchanged
  });

  it("returns '' for null/undefined/empty input", () => {
    expect(normalizeLineNumber(null)).toBe("");
    expect(normalizeLineNumber(undefined)).toBe("");
    expect(normalizeLineNumber("")).toBe("");
    expect(normalizeLineNumber("   ")).toBe("");
  });

  it("normalizes an isolated international-prefix fragment to '' rather than a truncated string", () => {
    // So a caller's own blank-check (InventoryService.createProduct) falls
    // through to auto-generation instead of storing a garbage barcode.
    expect(normalizeLineNumber("+961")).toBe("");
    expect(normalizeLineNumber("00961")).toBe("");
  });

  it("strips whitespace and dashes anywhere in the string, not just at the edges", () => {
    expect(normalizeLineNumber(" 03 - 123 - 456 ")).toBe("03123456");
  });

  it("leaves a non-phone-shaped value (letters) untouched", () => {
    expect(normalizeLineNumber("ABC123")).toBe("ABC123");
  });

  it("leaves a real EAN-13-length all-digit barcode untouched — never mangled as if it were a phone number", () => {
    expect(normalizeLineNumber("5901234123457")).toBe("5901234123457");
    expect(normalizeLineNumber("00961234123457")).toBe("00961234123457");
  });
});

describe("isPhoneShapedTerm", () => {
  it("accepts digits, spaces, dashes, and a leading +", () => {
    expect(isPhoneShapedTerm("03 123 456")).toBe(true);
    expect(isPhoneShapedTerm("+961-70-111-222")).toBe(true);
    expect(isPhoneShapedTerm("03123456")).toBe(true);
  });

  it("rejects a value containing letters", () => {
    expect(isPhoneShapedTerm("Nokia 3310")).toBe(false);
    expect(isPhoneShapedTerm("ABC123")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isPhoneShapedTerm(null)).toBe(false);
    expect(isPhoneShapedTerm(undefined)).toBe(false);
    expect(isPhoneShapedTerm("")).toBe(false);
  });
});

describe("isPhoneLineCategoryName", () => {
  it("matches category names containing the WHOLE word 'line'/'lines', case-insensitively", () => {
    expect(isPhoneLineCategoryName("Phone Lines")).toBe(true);
    expect(isPhoneLineCategoryName("phone lines")).toBe(true);
    expect(isPhoneLineCategoryName("MTC Lines")).toBe(true);
    expect(isPhoneLineCategoryName("Lines")).toBe(true);
    expect(isPhoneLineCategoryName("  Lines  ")).toBe(true);
    expect(isPhoneLineCategoryName("Line")).toBe(true);
  });

  it("does not match an unrelated category name", () => {
    expect(isPhoneLineCategoryName("Phones")).toBe(false);
    expect(isPhoneLineCategoryName("Accessories")).toBe(false);
    expect(isPhoneLineCategoryName("Chargers")).toBe(false);
  });

  it("does NOT match a category name that merely CONTAINS 'line' as a substring (N13-4)", () => {
    // A bare-substring match used to pull these categories' real barcodes
    // through normalizeLineNumber on every create/update and mangle them.
    expect(isPhoneLineCategoryName("Online Cards")).toBe(false);
    expect(isPhoneLineCategoryName("Offline")).toBe(false);
    expect(isPhoneLineCategoryName("Airline")).toBe(false);
    expect(isPhoneLineCategoryName("Guidelines")).toBe(false);
    expect(isPhoneLineCategoryName("Linen")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isPhoneLineCategoryName(null)).toBe(false);
    expect(isPhoneLineCategoryName(undefined)).toBe(false);
    expect(isPhoneLineCategoryName("")).toBe(false);
  });
});
