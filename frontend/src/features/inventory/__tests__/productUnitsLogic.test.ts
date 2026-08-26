/**
 * LIRA-143 Phase 6b — pure logic for the inventory Units/IMEIs UI: the
 * intake-vs-stock_quantity drift predicate (owner decision #6, warn-never-
 * block) and the walk-in-lookup heuristic (decision #7). Same pattern as
 * features/audit/cashFlow.test.ts. (The scan-friendly batch parser that used
 * to live here, `parseImeiBatch`, was removed in the owner-requested UI
 * rework that replaced the multi-line textarea with `ImeiAddRow`'s one-
 * IMEI-at-a-time input.)
 */
import { computeUnitDrift, looksLikeImei } from "../productUnitsLogic";

describe("computeUnitDrift", () => {
  it("matches when in-stock count equals stock_quantity", () => {
    expect(computeUnitDrift(5, 5)).toEqual({ matches: true, delta: 0 });
  });

  it("flags a positive drift — more units registered than stock says", () => {
    expect(computeUnitDrift(7, 5)).toEqual({ matches: false, delta: 2 });
  });

  it("flags a negative drift — fewer units registered than stock says", () => {
    expect(computeUnitDrift(3, 5)).toEqual({ matches: false, delta: -2 });
  });

  it("matches at zero/zero (nothing registered yet, no stock either)", () => {
    expect(computeUnitDrift(0, 0)).toEqual({ matches: true, delta: 0 });
  });

  it("never blocks — it only reports a boolean/delta, no throw, no error field", () => {
    const result = computeUnitDrift(100, 1);
    expect(result.matches).toBe(false);
    expect(() => computeUnitDrift(100, 1)).not.toThrow();
  });
});

describe("looksLikeImei", () => {
  it("matches a full 15-digit IMEI", () => {
    expect(looksLikeImei("356938035643809")).toBe(true);
  });

  it("matches a shorter digits-only token (>= 6 chars, permissive per the ticket)", () => {
    expect(looksLikeImei("123456")).toBe(true);
  });

  it("rejects a token shorter than 6 digits", () => {
    expect(looksLikeImei("12345")).toBe(false);
  });

  it("rejects a token with any non-digit characters", () => {
    expect(looksLikeImei("12345a")).toBe(false);
    expect(looksLikeImei("iPhone 13")).toBe(false);
    expect(looksLikeImei("LT-0825-12345")).toBe(false);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(looksLikeImei("  356938035643809  ")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(looksLikeImei("")).toBe(false);
    expect(looksLikeImei("   ")).toBe(false);
  });
});
