/**
 * LIRA-143 Phase 6b — pure logic for the inventory Units/IMEIs UI: the
 * intake-vs-stock_quantity drift predicate (owner decision #6, warn-never-
 * block) and the walk-in-lookup heuristic (decision #7). Same pattern as
 * features/audit/cashFlow.test.ts. (The scan-friendly batch parser that used
 * to live here, `parseImeiBatch`, was removed in the owner-requested UI
 * rework that replaced the multi-line textarea with `ImeiAddRow`'s one-
 * IMEI-at-a-time input.)
 */
import {
  computeUnitDrift,
  looksLikeImei,
  warrantyBadgeInfo,
  warrantyDisplayBadge,
  type WarrantyStatus,
} from "../productUnitsLogic";

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

/**
 * The display fix for the owner's 2026-08-26 report: a 6-month model's fresh
 * stock read "No warranty" because the warranty clock only starts at the sale
 * (decision #4), so `computeWarrantyStatus` returns `NONE` for every unsold
 * unit. `warrantyDisplayBadge` re-labels exactly that one case and defers to
 * `warrantyBadgeInfo` for everything else — the cases below are the fence.
 */
describe("warrantyDisplayBadge", () => {
  const NONE: WarrantyStatus = { source: null, until: null, state: "NONE" };

  it("NONE + IN_STOCK + a model term -> the term, informative (not the emerald of real coverage)", () => {
    const badge = warrantyDisplayBadge({
      warranty: NONE,
      status: "IN_STOCK",
      productWarrantyMonths: 6,
    });
    expect(badge.label).toBe("6 mo — starts at sale");
    expect(badge.className).toMatch(/sky/);
    expect(badge.className).not.toMatch(/emerald/);
  });

  it("carries the model's own number, whatever it is", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 12,
      }).label,
    ).toBe("12 mo — starts at sale");
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 1,
      }).label,
    ).toBe("1 mo — starts at sale");
  });

  it("NONE + IN_STOCK + no model term -> No warranty, unchanged", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: null,
      }),
    ).toEqual(warrantyBadgeInfo(NONE));
  });

  it("treats a 0-month term as no term (the form's min is 0)", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 0,
      }).label,
    ).toBe("No warranty");
  });

  it("NEVER applies the term to a SOLD unit — decision #4 forbids retro-stamping", () => {
    // Sold before the model had a term: its sale line stamped nothing, so the
    // honest badge is still "No warranty".
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "SOLD",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("No warranty");
  });

  it("leaves every real verdict exactly as warrantyBadgeInfo renders it, term or not", () => {
    const verdicts: WarrantyStatus[] = [
      { source: "SALE", until: "2027-01-15", state: "COVERED" },
      { source: "SALE", until: "2025-06-01", state: "EXPIRED" },
      { source: "REFUND", until: null, state: "VOID" },
      { source: "OVERRIDE", until: "2027-03-01", state: "COVERED" },
    ];
    for (const warranty of verdicts) {
      for (const status of ["IN_STOCK", "SOLD"] as const) {
        expect(
          warrantyDisplayBadge({
            warranty,
            status,
            productWarrantyMonths: 6,
          }),
        ).toEqual(warrantyBadgeInfo(warranty));
      }
    }
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
