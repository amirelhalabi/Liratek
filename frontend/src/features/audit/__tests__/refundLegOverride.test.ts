/**
 * LIRA-078 — refund tender-selection modal, pure logic (RefundMethodModal's
 * prefill/default-detection/validation core, extracted so it is unit
 * testable without rendering the page/modal — same pattern as
 * cashFlow.ts/formatPaymentLegs.test.ts).
 */
import {
  netByCurrency,
  buildDefaultRefundLines,
  linesMatchDefault,
  validateRefundLines,
  buildUnitExtras,
  type UnitFlagState,
} from "../refundLegOverride";
import type { TransactionPaymentLeg } from "../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
  method = "CASH",
): TransactionPaymentLeg => ({
  direction,
  amount,
  signed_amount: direction === "out" ? -amount : amount,
  currency_code,
  method,
});

describe("netByCurrency", () => {
  it("sums IN legs positive, OUT legs negative, per currency", () => {
    const legs = [leg("in", 110, "USD", "CASH"), leg("out", 10, "USD", "CASH")];
    expect(netByCurrency(legs)).toEqual({ USD: 100 });
  });

  it("keeps currencies separate", () => {
    const legs = [leg("in", 50, "USD"), leg("in", 900_000, "LBP")];
    expect(netByCurrency(legs)).toEqual({ USD: 50, LBP: 900_000 });
  });

  it("returns {} for undefined/empty legs", () => {
    expect(netByCurrency(undefined)).toEqual({});
    expect(netByCurrency([])).toEqual({});
  });
});

describe("buildDefaultRefundLines", () => {
  // Every plain call below passes the modal's full selectable list, so these
  // cases exercise ONLY the largest-magnitude-leg-wins logic, not the
  // not-selectable fallback (covered separately below).
  const SELECTABLE = ["CASH", "WHISH", "OMT"];

  it("builds ONE line per currency, method from the LARGEST leg for that currency", () => {
    const legs = [
      leg("in", 60, "USD", "CASH"),
      leg("in", 40, "USD", "WHISH"),
      leg("in", 900_000, "LBP", "CASH"),
    ];
    const lines = buildDefaultRefundLines(legs, SELECTABLE);
    expect(lines).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 }, // 60 > 40 → CASH
      { method: "CASH", currencyCode: "LBP", amount: 900_000 },
    ]);
  });

  it("drops a currency whose net rounds to 0 (fully offset by change)", () => {
    const legs = [
      leg("in", 100, "USD", "CASH"),
      leg("out", 100, "USD", "CASH"),
    ];
    expect(buildDefaultRefundLines(legs, SELECTABLE)).toEqual([]);
  });

  it("single-method single-currency case mirrors today's plain reversal shape", () => {
    const legs = [leg("in", 100, "USD", "OMT")];
    expect(buildDefaultRefundLines(legs, SELECTABLE)).toEqual([
      { method: "OMT", currencyCode: "USD", amount: 100 },
    ]);
  });

  it("ties (equal magnitude) keep the FIRST leg seen for that currency", () => {
    const legs = [leg("in", 50, "USD", "WHISH"), leg("in", 50, "USD", "CASH")];
    expect(buildDefaultRefundLines(legs, SELECTABLE)).toEqual([
      { method: "WHISH", currencyCode: "USD", amount: 100 },
    ]);
  });

  // ── BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B (plan §2 bug 4) ───────────
  // FAILING-FIRST: on the pre-Phase-B code (method from the FIRST leg in
  // array order, no selectable-list guard), both cases below defaulted to
  // the FEE leg's method — "WHISH" in the first case (wrong: smaller leg,
  // and the operator likely wants the payout's method back), and the
  // literal "FEE" string in the second (worse: not even a method the modal
  // can render/select, and one the backend hard-rejects as not-an-active
  // payment method).

  it("fee-on-top RECEIVE: fee leg inserted FIRST but smaller — default is the PAYOUT's method, not the fee's", () => {
    const legs = [
      leg("in", 5, "USD", "WHISH"), // customer-paid fee, booked first
      leg("out", 100, "USD", "CASH"), // payout, booked second — larger
    ];
    // net = 5 - 100 = -95 (a fee-on-top RECEIVE's overridable legs always
    // net negative — the payout always exceeds the fee).
    const lines = buildDefaultRefundLines(legs, SELECTABLE);
    expect(lines).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 95 },
    ]);
  });

  it('legacy fee leg still carrying the retired "FEE" literal is never chosen — falls back to CASH', () => {
    const legs = [
      leg("in", 5, "USD", "FEE"), // legacy row: fee leg's method is literally "FEE"
      leg("out", 100, "USD", "CASH"),
    ];
    // "FEE" is not in the modal's selectable list at all, so even though the
    // fee leg is smaller, prove the fallback triggers on it directly too.
    const feeOnlyLegs = [leg("in", 5, "USD", "FEE")];
    expect(buildDefaultRefundLines(feeOnlyLegs, SELECTABLE)[0]?.method).toBe(
      "CASH",
    );

    const lines = buildDefaultRefundLines(legs, SELECTABLE);
    expect(lines).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 95 },
    ]);
  });

  it("a not-selectable largest-magnitude method falls back to CASH even when it isn't a fee leg", () => {
    const legs = [leg("in", 100, "USD", "RETIRED_METHOD")];
    expect(buildDefaultRefundLines(legs, SELECTABLE)).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 },
    ]);
  });
});

describe("linesMatchDefault", () => {
  const defaults = [{ method: "CASH", currencyCode: "USD", amount: 100 }];

  it("true when unchanged", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        defaults,
      ),
    ).toBe(true);
  });

  it("false when the method changed", () => {
    expect(
      linesMatchDefault(
        [{ method: "OMT", currencyCode: "USD", amount: 100 }],
        defaults,
      ),
    ).toBe(false);
  });

  it("false when the amount changed", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 80 }],
        defaults,
      ),
    ).toBe(false);
  });

  it("false when a line was added (split)", () => {
    expect(
      linesMatchDefault(
        [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "OMT", currencyCode: "USD", amount: 40 },
        ],
        defaults,
      ),
    ).toBe(false);
  });

  it("true within floating-point epsilon", () => {
    expect(
      linesMatchDefault(
        [{ method: "CASH", currencyCode: "USD", amount: 100.004 }],
        defaults,
      ),
    ).toBe(true);
  });
});

describe("validateRefundLines", () => {
  it("null (valid) when totals match exactly", () => {
    expect(
      validateRefundLines(
        [{ method: "OMT", currencyCode: "USD", amount: 100 }],
        { USD: 100 },
      ),
    ).toBeNull();
  });

  it("null when a split sums to the same per-currency total", () => {
    expect(
      validateRefundLines(
        [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "OMT", currencyCode: "USD", amount: 40 },
        ],
        { USD: 100 },
      ),
    ).toBeNull();
  });

  it("rejects an under-total", () => {
    const err = validateRefundLines(
      [{ method: "OMT", currencyCode: "USD", amount: 60 }],
      { USD: 100 },
    );
    expect(err).toMatch(/USD/);
  });

  it("rejects an over-total", () => {
    const err = validateRefundLines(
      [{ method: "OMT", currencyCode: "USD", amount: 150 }],
      { USD: 100 },
    );
    expect(err).toMatch(/USD/);
  });

  it("rejects a currency the original never had, even when the covered currency matches", () => {
    const err = validateRefundLines(
      [
        { method: "OMT", currencyCode: "USD", amount: 100 },
        { method: "OMT", currencyCode: "LBP", amount: 9_000_000 },
      ],
      { USD: 100 },
    );
    expect(err).toMatch(/LBP/);
  });

  it("multi-currency: each currency validated independently", () => {
    expect(
      validateRefundLines(
        [
          { method: "OMT", currencyCode: "USD", amount: 50 },
          { method: "CASH", currencyCode: "LBP", amount: 900_000 },
        ],
        { USD: 50, LBP: 900_000 },
      ),
    ).toBeNull();

    const err = validateRefundLines(
      [
        { method: "OMT", currencyCode: "USD", amount: 50 },
        { method: "CASH", currencyCode: "LBP", amount: 800_000 },
      ],
      { USD: 50, LBP: 900_000 },
    );
    expect(err).toMatch(/LBP/);
  });
});

// LIRA-143 Phase 6b — the phone-refund UI's per-unit extras-emission logic.
describe("buildUnitExtras", () => {
  const untouched: UnitFlagState = { isDefective: false, warrantyUntil: "" };

  it("returns undefined (never []) when no unit was touched at all", () => {
    expect(buildUnitExtras([1, 2, 3], {})).toBeUndefined();
  });

  it("returns undefined when every unit's flag entry is at its untouched default", () => {
    expect(
      buildUnitExtras([1, 2], { 1: untouched, 2: { ...untouched } }),
    ).toBeUndefined();
  });

  it("includes only is_defective when the checkbox is checked and the date is blank", () => {
    expect(
      buildUnitExtras([1], {
        1: { isDefective: true, warrantyUntil: "" },
      }),
    ).toEqual([{ unit_id: 1, is_defective: true }]);
  });

  it("includes only warranty_override_until when only the date was set", () => {
    expect(
      buildUnitExtras([1], {
        1: { isDefective: false, warrantyUntil: "2027-01-15" },
      }),
    ).toEqual([{ unit_id: 1, warranty_override_until: "2027-01-15" }]);
  });

  it("includes both fields when both were set", () => {
    expect(
      buildUnitExtras([1], {
        1: { isDefective: true, warrantyUntil: "2027-01-15" },
      }),
    ).toEqual([
      { unit_id: 1, is_defective: true, warranty_override_until: "2027-01-15" },
    ]);
  });

  it("trims a whitespace-only date to blank (treated as not set)", () => {
    expect(
      buildUnitExtras([1], {
        1: { isDefective: false, warrantyUntil: "   " },
      }),
    ).toBeUndefined();
  });

  it("emits an entry only for the units actually touched, skipping untouched ones", () => {
    expect(
      buildUnitExtras([1, 2, 3], {
        1: untouched,
        2: { isDefective: true, warrantyUntil: "" },
        3: untouched,
      }),
    ).toEqual([{ unit_id: 2, is_defective: true }]);
  });

  it("ignores a unit id with no flags entry at all (never defaults it into the output)", () => {
    expect(
      buildUnitExtras([1, 2], {
        2: { isDefective: true, warrantyUntil: "" },
      }),
    ).toEqual([{ unit_id: 2, is_defective: true }]);
  });

  it("preserves the order of unitIds in the output", () => {
    expect(
      buildUnitExtras([3, 1, 2], {
        1: { isDefective: true, warrantyUntil: "" },
        2: { isDefective: true, warrantyUntil: "" },
        3: { isDefective: true, warrantyUntil: "" },
      }),
    ).toEqual([
      { unit_id: 3, is_defective: true },
      { unit_id: 1, is_defective: true },
      { unit_id: 2, is_defective: true },
    ]);
  });
});
