/**
 * Refund kept change (owner decision 2026-10-07) — the pure halves of the
 * refund popup's Confirm gate: `validateRefundValue`'s optional `kept`
 * argument (legs + kept must equal the refund value; only a shortfall is
 * ever kept) and `validateRefundKeptChange` (drawer money only — cash or
 * wallet — in the refund's own currency) — both mirror the server's `_resolveRefundKeptChange`.
 *
 * Rule 17 disclosure: written AFTER these two functions were changed, so
 * NOT proven failing-first. The modal-level test
 * (RefundMethodModal.keptChange.test.tsx) was written first and seen
 * failing.
 */
import {
  refundCanKeepChange,
  validateRefundKeptChange,
  validateRefundValue,
} from "../refundLegOverride";
import type { TransactionPaymentLeg } from "../cashFlow";

const RATE = 89_000;
const cash = (amount: number, currencyCode: "USD" | "LBP" = "USD") => ({
  method: "CASH",
  currencyCode,
  amount,
});

describe("validateRefundValue with kept change", () => {
  it("$20 handed back + $0.12 kept matches a $20.12 refund", () => {
    expect(
      validateRefundValue([cash(20)], { USD: 20.12 }, RATE, {
        usd: 0.12,
        lbp: 0,
      }),
    ).toBeNull();
  });

  it("without kept, $20 of $20.12 is still refused (unchanged)", () => {
    expect(validateRefundValue([cash(20)], { USD: 20.12 }, RATE)).toMatch(
      /must equal \$20\.12/,
    );
  });

  it("LBP: 1,750,000 handed back + 50,000 kept matches 1,800,000", () => {
    expect(
      validateRefundValue([cash(1_750_000, "LBP")], { LBP: 1_800_000 }, RATE, {
        usd: 0,
        lbp: 50_000,
      }),
    ).toBeNull();
  });
});

describe("validateRefundKeptChange", () => {
  // The refund popup's own selectable methods — drawer-affecting only
  // (`usePaymentMethods().drawerAffectingMethods`, the DB's affects_drawer
  // flag the server's `isDrawerAffectingMethod` also reads).
  const DRAWER_METHODS = ["CASH", "OMT", "WHISH"];

  it("nothing kept → no objection, whatever the lines", () => {
    expect(
      validateRefundKeptChange(
        [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 }],
        "USD",
        null,
        DRAWER_METHODS,
      ),
    ).toBeNull();
  });

  // Owner decision 2026-10-07: kept change may come from any drawer money —
  // cash OR wallet. This case used to assert a wallet line refuses (rule
  // 24: rewritten, not deleted).
  it("a wallet line (WHISH, $20 of $20.12) can keep change", () => {
    expect(
      validateRefundKeptChange(
        [{ method: "WHISH", currencyCode: "USD", amount: 20 }],
        "USD",
        { usd: 0.12, lbp: 0 },
        DRAWER_METHODS,
      ),
    ).toBeNull();
  });

  it.each(["CUSTOMER_ACCOUNT", "GIFT_CARD"])(
    "a %s line (moves no drawer) refuses kept change",
    (method) => {
      expect(
        validateRefundKeptChange(
          [{ method, currencyCode: "USD", amount: 20 }],
          "USD",
          { usd: 0.12, lbp: 0 },
          DRAWER_METHODS,
        ),
      ).toMatch(/cash or a wallet/);
    },
  );

  it("a line in another currency refuses kept change", () => {
    expect(
      validateRefundKeptChange(
        [cash(1_780_000, "LBP")],
        "USD",
        { usd: 0.12, lbp: 0 },
        DRAWER_METHODS,
      ),
    ).toMatch(/USD/);
  });

  it("all cash, same currency → allowed", () => {
    expect(
      validateRefundKeptChange(
        [cash(20)],
        "USD",
        { usd: 0.12, lbp: 0 },
        DRAWER_METHODS,
      ),
    ).toBeNull();
  });
});

/**
 * LIRA-272 — the Transactions page's whole-transaction refund popup offers
 * kept change only for a type the server allows AND a refund that hands
 * money OUT (the original took money IN). The shared list now includes
 * FINANCIAL_SERVICE, which also covers payout originals (an OMT RECEIVE):
 * refunding one takes money back FROM the customer, where the server refuses
 * kept change ("cannot keep change on a refund that takes money back").
 * Rule 17: written before `refundCanKeepChange` existed.
 */
describe("refundCanKeepChange (Transactions page refund popup)", () => {
  const leg = (
    signed: number,
    currency_code = "USD",
  ): TransactionPaymentLeg => ({
    direction: signed >= 0 ? "in" : "out",
    amount: Math.abs(signed),
    signed_amount: signed,
    currency_code,
    method: "CASH",
  });

  it.each([
    ["SALE", [leg(20.12)]],
    ["DEBT_REPAYMENT", [leg(20.12)]],
    ["FINANCIAL_SERVICE", [leg(105)]],
    ["RECHARGE", [leg(300_000, "LBP")]],
    ["CUSTOM_SERVICE", [leg(20.12)]],
    ["MAINTENANCE", [leg(50.5)]],
    ["LOTO", [leg(500_000, "LBP")]],
  ])("%s paid in by the customer: offered", (type, legs) => {
    expect(refundCanKeepChange(type, legs)).toBe(true);
  });

  it("an OMT RECEIVE (payout original): refund takes money back — not offered", () => {
    expect(refundCanKeepChange("FINANCIAL_SERVICE", [leg(-100)])).toBe(false);
  });

  it("a fee-on-top RECEIVE (fee in, payout out, net out): not offered", () => {
    expect(
      refundCanKeepChange("FINANCIAL_SERVICE", [leg(5), leg(-100)]),
    ).toBe(false);
  });

  it("a type outside the shared list (an expense): not offered", () => {
    expect(refundCanKeepChange("EXPENSE", [leg(20.12)])).toBe(false);
  });
});
