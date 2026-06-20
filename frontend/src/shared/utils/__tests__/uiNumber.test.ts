/**
 * Unit tests for the shared decimal helpers in @liratek/ui (utils/number.ts).
 * These back the DecimalInput component used across the app.
 */
import {
  formatWithCommas,
  isPartialDecimal,
  sanitizeDecimal,
  parseDecimal,
  caretAfterFormat,
} from "@liratek/ui";

describe("formatWithCommas", () => {
  it("inserts thousands separators on the integer part only", () => {
    expect(formatWithCommas("1234567")).toBe("1,234,567");
    expect(formatWithCommas("1234567.89")).toBe("1,234,567.89");
  });

  it("preserves an in-progress decimal tail", () => {
    expect(formatWithCommas("0.")).toBe("0.");
    expect(formatWithCommas("1000.")).toBe("1,000.");
  });

  it("handles a leading minus sign", () => {
    expect(formatWithCommas("-1000")).toBe("-1,000");
    expect(formatWithCommas("-0.")).toBe("-0.");
  });

  it("returns empty/falsy input unchanged", () => {
    expect(formatWithCommas("")).toBe("");
  });
});

describe("sanitizeDecimal", () => {
  it("strips commas and non-numeric characters", () => {
    expect(sanitizeDecimal("1,234abc")).toBe("1234");
  });

  it("keeps only the first decimal point", () => {
    expect(sanitizeDecimal("1.2.3")).toBe("1.23");
  });

  it("preserves a trailing dot so '0.' survives mid-edit", () => {
    expect(sanitizeDecimal("0.")).toBe("0.");
  });

  it("drops the minus sign unless negatives are allowed", () => {
    expect(sanitizeDecimal("-5")).toBe("5");
    expect(sanitizeDecimal("-5", { allowNegative: true })).toBe("-5");
  });

  it("caps fraction digits when decimals is set", () => {
    expect(sanitizeDecimal("1.2345", { decimals: 2 })).toBe("1.23");
    expect(sanitizeDecimal("1.2345", { decimals: 0 })).toBe("1.");
  });
});

describe("parseDecimal", () => {
  it("parses normal decimals", () => {
    expect(parseDecimal("1234.5")).toBe(1234.5);
  });

  it("treats incomplete entries as 0", () => {
    expect(parseDecimal("")).toBe(0);
    expect(parseDecimal(".")).toBe(0);
    expect(parseDecimal("-")).toBe(0);
  });
});

describe("isPartialDecimal", () => {
  it("accepts in-progress entries", () => {
    ["", "4", "4.", "4.50"].forEach((v) =>
      expect(isPartialDecimal(v)).toBe(true),
    );
  });

  it("rejects negatives unless allowed and respects the decimal cap", () => {
    expect(isPartialDecimal("-4")).toBe(false);
    expect(isPartialDecimal("-4", { allowNegative: true })).toBe(true);
    expect(isPartialDecimal("4.555", { decimals: 2 })).toBe(false);
  });
});

describe("caretAfterFormat", () => {
  it("maps a significant-char count to its index past inserted commas", () => {
    // "1,234" with 2 significant chars to the left -> index 3 ("1,2|34")
    expect(caretAfterFormat("1,234", 2)).toBe(3);
    // start of string
    expect(caretAfterFormat("1,234", 0)).toBe(0);
    // beyond the end clamps to length
    expect(caretAfterFormat("1,234", 99)).toBe(5);
  });
});
