/**
 * LIRA-331 (FR-017): `sanitizeDecimal` is the one place every DecimalInput
 * amount field cleans what was typed. Arabic-Indic digits must become the
 * same Western number, never be stripped (today they are dropped as
 * "letters", so ١٢٣ became an empty amount).
 */
import { sanitizeDecimal } from "../number";

describe("sanitizeDecimal with Arabic-Indic digits", () => {
  it("keeps the typed amount", () => {
    expect(sanitizeDecimal("١٢٣٫٥")).toBe("123.5");
    expect(sanitizeDecimal("۱۲۳")).toBe("123");
    expect(sanitizeDecimal("١٬٢٣٤")).toBe("1234");
  });

  it("still honours the decimals cap and negatives", () => {
    expect(sanitizeDecimal("١٫٢٣٤", { decimals: 2 })).toBe("1.23");
    expect(sanitizeDecimal("-٥", { allowNegative: true })).toBe("-5");
  });

  it("Western input is unchanged", () => {
    expect(sanitizeDecimal("1,234.50")).toBe("1234.50");
  });
});
