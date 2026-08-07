/**
 * normalizeLebanesePhone / isSameLebanesePhone — CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 6. Format list is the plan's own: "03 123456", "+96103123456",
 * "96103123456", and an international-access-code variant ("00...").
 */
import { normalizeLebanesePhone, isSameLebanesePhone } from "../phoneNumber";

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
