/**
 * LIRA-291 — the ONE password rule (`utils/passwordPolicy.ts`).
 *
 * The symbol part used to accept only `@$!%*?&`, so Chrome's generated
 * passwords (which use `-`, `_`, `.`, `:`) were refused. Any character that
 * is not a letter or a digit now counts as a symbol. The other parts of the
 * rule (length, upper, lower, digit) are unchanged.
 */
import { validatePasswordComplexity } from "../passwordPolicy";

const SYMBOL_MESSAGE =
  "Password must contain a symbol (for example - _ . @ ! #)";

describe("validatePasswordComplexity (LIRA-291)", () => {
  it.each([
    ["xY7-pq_Rt.9mZ"],
    ["Abcdefg1:"],
    ["Abcdefg1 x"],
    ["Abcdefg1!"],
    ["Abcdefg1@"],
  ])("accepts %j (any non-letter/non-digit is a symbol)", (pw) => {
    expect(validatePasswordComplexity(pw)).toEqual({ valid: true, errors: [] });
  });

  it("refuses a password with only letters and digits, with the new message", () => {
    const result = validatePasswordComplexity("Abcdefg1");
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([SYMBOL_MESSAGE]);
  });

  it("keeps the length rule", () => {
    expect(validatePasswordComplexity("Ab1-x").errors).toEqual([
      "Password must be at least 8 characters",
    ]);
  });

  it("keeps the uppercase rule", () => {
    expect(validatePasswordComplexity("abcdefg1-").errors).toEqual([
      "Password must contain an uppercase letter",
    ]);
  });

  it("keeps the lowercase rule", () => {
    expect(validatePasswordComplexity("ABCDEFG1-").errors).toEqual([
      "Password must contain a lowercase letter",
    ]);
  });

  it("keeps the digit rule", () => {
    expect(validatePasswordComplexity("Abcdefgh-").errors).toEqual([
      "Password must contain a number",
    ]);
  });
});
