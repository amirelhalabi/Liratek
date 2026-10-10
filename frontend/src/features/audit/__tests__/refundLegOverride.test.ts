/**
 * LIRA-078 — refund tender-selection modal, pure logic (RefundMethodModal's
 * prefill/default-detection/validation core, extracted so it is unit
 * testable without rendering the page/modal — same pattern as
 * cashFlow.ts/formatPaymentLegs.test.ts).
 */
import { REFUND_LEG_AMOUNT_EPSILON } from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";

import {
  netByCurrency,
  buildDefaultRefundLines,
  linesMatchDefault,
  validateRefundLines,
  validateRefundValue,
  buildUnitExtras,
  toRefundLegs,
  type RefundLegOverride,
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
  const defaults: RefundLegOverride[] = [
    { method: "CASH", currencyCode: "USD", amount: 100 },
  ];

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

  // LIRA-232 round-2 review (finding 5) once widened ONLY the frontend
  // EPSILON.LBP to 100 to tolerate a session-item refund's `defaultLegs`,
  // while the server-side check
  // (`TransactionRepository.validateRefundLegOverrideAmounts`) kept
  // `LBP: 1` — a rule-14 drift where the form accepted an amount (a 2 LBP
  // gap) the server then rejected. Core now rounds every LBP remainder and
  // default leg to whole LBP (`SESSION_ITEM_REFUND_PLAN.md` §3), so an
  // untouched session-item default sums EXACTLY to the remainder — no
  // naive-subtraction gap survives — and both sides now import the SAME
  // `REFUND_LEG_AMOUNT_EPSILON` from `@liratek/core`
  // (`packages/core/src/constants/refundTolerance.ts`), so there is nothing
  // left for the two copies to disagree about.
  it("accepts whole-LBP defaults that sum EXACTLY to the remainder", () => {
    expect(
      validateRefundLines(
        [{ method: "CASH", currencyCode: "LBP", amount: 900_000 }],
        { LBP: 900_000 },
      ),
    ).toBeNull();
  });

  // A gap above the shared tolerance must still be rejected, matching the
  // server's own check — this is the exact case the widened 100-LBP frontend
  // copy used to let through (899,998 vs 900,000, a 2 LBP gap) while the
  // server's `LBP: 1` copy hard-rejected it.
  it("rejects an LBP gap above the shared tolerance — matches the server's own check", () => {
    const overTolerance = REFUND_LEG_AMOUNT_EPSILON.LBP + 1;
    const err = validateRefundLines(
      [
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 900_000 - overTolerance,
        },
      ],
      { LBP: 900_000 },
    );
    expect(err).toMatch(/LBP/);
  });
});

// LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — value-based matching at the
// popup's CURRENT rate, replacing validateRefundLines' per-currency equality
// inside RefundMethodModal. NOT proven failing-first (the function landed in
// the same pass as this describe block — MEMORY/rule 17): `validateRefundValue`
// did not exist before this ticket, so there was no "unfixed code" to run
// these against first.
describe("validateRefundValue", () => {
  it("null when a same-currency line matches exactly (mirrors validateRefundLines for the trivial case)", () => {
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        { USD: 100 },
        89000,
      ),
    ).toBeNull();
  });

  it("accepts a FULL cross-currency swap: a $50 USD refund paid entirely in LBP at the shown rate", () => {
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "LBP", amount: 4_450_000 }],
        { USD: 50 },
        89000,
      ),
    ).toBeNull();
  });

  it("accepts a MIXED currency split whose total value matches: $20 cash + the rest in LBP", () => {
    // $50 owed, rate 89000. $20 USD + (50-20)*89000 LBP = $20 + 2,670,000 LBP.
    expect(
      validateRefundValue(
        [
          { method: "CASH", currencyCode: "USD", amount: 20 },
          { method: "CASH", currencyCode: "LBP", amount: 2_670_000 },
        ],
        { USD: 50 },
        89000,
      ),
    ).toBeNull();
  });

  it("rejects a currency mix whose value falls short at the current rate", () => {
    const err = validateRefundValue(
      [{ method: "CASH", currencyCode: "LBP", amount: 4_000_000 }], // short of 4,450,000
      { USD: 50 },
      89000,
    );
    expect(err).toMatch(/\$50/);
    expect(err).toMatch(/\$44\.94|\$44\.9/); // 4,000,000 / 89000 ≈ 44.94
  });

  it("rejects a currency mix whose value overshoots at the current rate", () => {
    const err = validateRefundValue(
      [{ method: "CASH", currencyCode: "LBP", amount: 5_000_000 }], // over 4,450,000
      { USD: 50 },
      89000,
    );
    expect(err).not.toBeNull();
  });

  it("the SAME line-set flips from valid to invalid as the rate changes (proves the check is rate-driven, not a fixed per-currency snapshot)", () => {
    const lines: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "LBP", amount: 4_450_000 },
    ];
    const originalNet = { USD: 50 };
    expect(validateRefundValue(lines, originalNet, 89000)).toBeNull();
    // At a materially different rate the SAME 4,450,000 LBP no longer values
    // to $50 within tolerance.
    expect(validateRefundValue(lines, originalNet, 95000)).not.toBeNull();
  });

  it("a mixed-currency original (USD + LBP paid) still matches when reproduced in the SAME native currencies", () => {
    expect(
      validateRefundValue(
        [
          { method: "CASH", currencyCode: "USD", amount: 60 },
          { method: "CASH", currencyCode: "LBP", amount: 900_000 },
        ],
        { USD: 60, LBP: 900_000 },
        89000,
      ),
    ).toBeNull();
  });

  it("within the shared USD tolerance is accepted (floating-point safe)", () => {
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "USD", amount: 100.004 }],
        { USD: 100 },
        89000,
      ),
    ).toBeNull();
  });
});

// LIRA-236 round-2/final review, finding F1 (BLOCKER) — `validateRefundValue`
// used to compare Math.abs'd per-currency totals, which STACKS an IN leg and
// an OUT leg in different currencies instead of netting them against each
// other. Written failing-first against the pre-fix (abs-based) function —
// every assertion below was confirmed failing before the signed-net rewrite
// (see REFUND_EXCHANGE_RATE_PLAN.md and
// TransactionRepository.validateRefundLegOverrideAmounts, the server-side
// twin of this same rule, rule 14).
describe("validateRefundValue — LIRA-236 F1 signed-net fix", () => {
  it("a sale paid $100 cash with 895,000 LBP change given back nets to $90 — $90 matches, $110 (the old abs-sum) does not", () => {
    const originalNet = { USD: 100, LBP: -895_000 }; // IN $100, OUT 895,000 LBP change
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "USD", amount: 90 }],
        originalNet,
        89_500,
      ),
    ).toBeNull();
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "USD", amount: 110 }],
        originalNet,
        89_500,
      ),
    ).not.toBeNull();
  });

  it("a fee-on-top payout (RECEIVE shape): a currency the original net never touched inherits the CORRECT (negative) direction from the overall value, not a bare positive magnitude", () => {
    // $5 fee IN (USD), $100 payout OUT (as 8,900,000 LBP @ 89000) — net
    // value is -$95 (a net payout), NOT the abs sum $105 the old rule required.
    const originalNet = { USD: 5, LBP: -8_900_000 };
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "LBP", amount: 8_455_000 }], // $95 worth, correct direction
        originalNet,
        89_000,
      ),
    ).toBeNull();
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "LBP", amount: 9_345_000 }], // $105 worth — the old abs-sum
        originalNet,
        89_000,
      ),
    ).not.toBeNull();
  });

  it("a wash exchange ($100 USD in, 8,900,000 LBP out at the SAME rate) nets to $0 — a $200 'refund' (the old abs sum) no longer validates", () => {
    const originalNet = { USD: 100, LBP: -8_900_000 };
    expect(
      validateRefundValue(
        [{ method: "CASH", currencyCode: "USD", amount: 200 }],
        originalNet,
        89_000,
      ),
    ).not.toBeNull();
    expect(validateRefundValue([], originalNet, 89_000)).toBeNull();
  });

  // Mirrors the SERVER's own value formula exactly
  // (`TransactionRepository.validateRefundLegOverrideAmounts`'s `exchangeRate`
  // branch, packages/core): the override side is a plain sum of POSITIVE
  // magnitudes (never signed per-currency), compared against `Math.abs` of
  // the SIGNED original net — NOT "each override leg inherits its own
  // currency's sign". Those two formulas agree everywhere a single override
  // currency is used, but DIVERGE on a split across two currencies whose own
  // original nets point opposite ways: a per-currency-signed formula would
  // let the two legs CANCEL each other (net 0 == net 0, wrongly "valid");
  // the server never lets an override leg subtract from another — it only
  // ever adds magnitude. A frontend hint that accepted this would enable
  // Confirm and then have the server reject the exact same payload.
  it("a same-value split across BOTH wash-exchange currencies does NOT self-cancel (matches the server's magnitude-sum formula, not a per-leg-signed one)", () => {
    const originalNet = { USD: 100, LBP: -8_900_000 }; // net $0 (wash exchange)
    const err = validateRefundValue(
      [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "CASH", currencyCode: "LBP", amount: 4_450_000 }, // $50 worth
      ],
      originalNet,
      89_000,
    );
    expect(err).not.toBeNull();
  });
});

// LIRA-143 Phase 6b — the phone-refund UI's per-unit extras-emission logic.
// LIRA-296 follow-up (owner decision 2026-10-10): the refund pop-up no
// longer takes a warranty date — a returned phone's warranty is chosen at the
// till when it is sold again. `buildUnitExtras` therefore NEVER emits
// `warranty_override_until`, even when handed a flag object of the old shape.
describe("buildUnitExtras", () => {
  const untouched: UnitFlagState = { isDefective: false };
  /** The pre-2026-10-10 flag shape, with the date the modal used to collect. */
  const legacyFlag = (isDefective: boolean, warrantyUntil: string) =>
    ({ isDefective, warrantyUntil }) as unknown as UnitFlagState;

  it("returns undefined (never []) when no unit was touched at all", () => {
    expect(buildUnitExtras([1, 2, 3], {})).toBeUndefined();
  });

  it("returns undefined when every unit's flag entry is at its untouched default", () => {
    expect(
      buildUnitExtras([1, 2], { 1: untouched, 2: { ...untouched } }),
    ).toBeUndefined();
  });

  it("includes only is_defective when the checkbox is checked", () => {
    expect(
      buildUnitExtras([1], { 1: { isDefective: true } }),
    ).toStrictEqual([{ unit_id: 1, is_defective: true }]);
  });

  it("never sends a warranty date: a date-only flag emits nothing", () => {
    expect(
      buildUnitExtras([1], { 1: legacyFlag(false, "2027-01-15") }),
    ).toBeUndefined();
  });

  it("never sends a warranty date alongside Defective either", () => {
    const extras = buildUnitExtras([1], {
      1: legacyFlag(true, "2027-01-15"),
    });
    expect(extras).toStrictEqual([{ unit_id: 1, is_defective: true }]);
    expect(extras?.[0]).not.toHaveProperty("warranty_override_until");
  });

  it("emits an entry only for the units actually touched, skipping untouched ones", () => {
    expect(
      buildUnitExtras([1, 2, 3], {
        1: untouched,
        2: { isDefective: true },
        3: untouched,
      }),
    ).toStrictEqual([{ unit_id: 2, is_defective: true }]);
  });

  it("ignores a unit id with no flags entry at all (never defaults it into the output)", () => {
    expect(
      buildUnitExtras([1, 2], { 2: { isDefective: true } }),
    ).toStrictEqual([{ unit_id: 2, is_defective: true }]);
  });

  it("preserves the order of unitIds in the output", () => {
    expect(
      buildUnitExtras([3, 1, 2], {
        1: { isDefective: true },
        2: { isDefective: true },
        3: { isDefective: true },
      }),
    ).toStrictEqual([
      { unit_id: 3, is_defective: true },
      { unit_id: 1, is_defective: true },
      { unit_id: 2, is_defective: true },
    ]);
  });
});

// Typing follow-up (rules 21/24) — `RefundLegOverride`/`RefundUnitExtraOverride`
// used to hand-type `currencyCode` as a loose `string` (core's own
// schema-derived `RefundLegInput` has always typed it `"USD" | "LBP"`).
// `toRefundLegs` is the new ONE boundary where a live `MultiPaymentInput`
// `PaymentLine[]` (loose currency, since that component is shared across
// every currency-configurable flow) narrows into typed refund legs,
// replacing three separate hand-rolled `currencyCode === "LBP" ? "LBP" :
// "USD"` ternaries (RefundMethodModal's own `toOverride`, SaleDetailModal's
// `toSchemaLegs`, useSessionItemRefund's inline map).
const line = (
  method: string,
  currencyCode: string,
  amount: number,
): PaymentLine => ({
  id: `${method}-${currencyCode}`,
  method,
  currencyCode,
  amount,
});

describe("toRefundLegs — the OLD ternary money bug, isolated and guarded", () => {
  // Written failing-first against the OLD pattern this helper replaces: that
  // pattern lived inline at each of the three call sites (never behind a
  // name of its own), so it can't be re-imported and re-run post-fix without
  // reverting finished code (rule 17 forbids that). Instead this pins down
  // EXACTLY what the old ternary did, as a bare expression, so the bug is
  // demonstrated mechanically rather than asserted from memory — then the
  // next test proves `toRefundLegs` does not reproduce it.
  it("documents the bug: the old `currencyCode === \"LBP\" ? \"LBP\" : \"USD\"` ternary silently turned a USDT line into a USD one", () => {
    const oldNarrow = (currencyCode: string): "USD" | "LBP" =>
      currencyCode === "LBP" ? "LBP" : "USD";
    expect(oldNarrow("USDT")).toBe("USD"); // the latent money bug
  });

  it("does NOT reproduce the bug — a USDT line is dropped, never coerced to USD", () => {
    expect(toRefundLegs([line("WHISH", "USDT", 50)])).toEqual([]);
  });

  it("drops a non-USD/LBP line even when mixed with valid USD/LBP lines, keeping only the valid ones", () => {
    expect(
      toRefundLegs([
        line("CASH", "USD", 100),
        line("WHISH", "USDT", 50),
        line("CASH", "LBP", 900_000),
      ]),
    ).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 },
      { method: "CASH", currencyCode: "LBP", amount: 900_000 },
    ]);
  });

  it("narrows valid USD/LBP lines to typed refund legs, dropping MultiPaymentInput-only fields (id/direction/voucherCode)", () => {
    const withExtras: PaymentLine = {
      id: "1",
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
      direction: "IN",
      voucherCode: "GIFT-1",
    };
    expect(toRefundLegs([withExtras])).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 },
    ]);
  });

  it("drops a zero/negative-amount line, same as the pre-existing behavior it replaces", () => {
    expect(
      toRefundLegs([line("CASH", "USD", 0), line("CASH", "USD", -5)]),
    ).toEqual([]);
  });

  it("returns [] for an empty input", () => {
    expect(toRefundLegs([])).toEqual([]);
  });
});
