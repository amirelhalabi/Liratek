/**
 * moneyPosting.ts — reconcileLegs (Payment-Legs Integrity plan, S2 seed of
 * CQ-3's moneyPosting.ts shared helper)
 *
 * Pure unit tests for the hard-reject reconciliation math, isolated from any
 * repository/DB. See FinancialServiceRepository/RechargeRepository wiring
 * tests for the integration-level "rejected atomically" proof.
 */

import {
  reconcileLegs,
  expectedTotalIn,
  LEG_RECONCILIATION_EPSILON_USD,
  type ReconciliationLeg,
} from "../moneyPosting";

const RATE = 90000; // 90,000 LBP per USD

function leg(
  currencyCode: "USD" | "LBP",
  amount: number,
  extra: Partial<ReconciliationLeg> = {},
): ReconciliationLeg {
  return { method: "CASH", currencyCode, amount, ...extra };
}

describe("reconcileLegs", () => {
  describe("no legs → bypass (legacy/scripted callers unaffected)", () => {
    it("does nothing when inLegs is undefined", () => {
      expect(() =>
        reconcileLegs({
          inLegs: undefined,
          expectedTotals: expectedTotalIn(999, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("does nothing when inLegs is an empty array", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [],
          expectedTotals: expectedTotalIn(999, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("does nothing when inLegs is null", () => {
      expect(() =>
        reconcileLegs({
          inLegs: null,
          expectedTotals: expectedTotalIn(50, "LBP"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("exact match", () => {
    it("passes on an exact single-currency USD match", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on an exact single-currency LBP match", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 900000)],
          expectedTotals: expectedTotalIn(900000, "LBP"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on a cross-currency single leg converted at the stamped rate", () => {
      // $10 owed, tendered entirely as 900,000 LBP at rate 90,000.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 900000)],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on mixed-currency legs summing exactly to the expected total", () => {
      // $52 owed: $30 cash + 1,980,000 LBP (=$22 at rate 90,000).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 30), leg("LBP", 1_980_000)],
          expectedTotals: expectedTotalIn(52, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("epsilon edges ($0.05 USD-equivalent)", () => {
    it("passes at exactly $0.049 under", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 99.951)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes at exactly $0.049 over", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100.049)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws at exactly $0.051 under", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 99.949)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("throws at exactly $0.051 over", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100.051)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("epsilon constant is exactly 0.05", () => {
      expect(LEG_RECONCILIATION_EPSILON_USD).toBe(0.05);
    });
  });

  describe("OUT (change) legs subtract from the total", () => {
    it("passes when IN minus OUT nets to the expected total", () => {
      // Owes $102; customer hands $110, gets $8 change.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 110)],
          outLegs: [leg("USD", 8, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(102, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws when change was recorded but not enough to net to the total", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 110)],
          outLegs: [leg("USD", 2, { direction: "OUT" })], // should have been 8
          expectedTotals: expectedTotalIn(102, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("subtracts a cross-currency OUT leg at the stamped rate", () => {
      // Owes $10; customer hands 1,000,000 LBP (~$11.11), gets 100,000 LBP change back (~$1.11).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 1_000_000)],
          outLegs: [leg("LBP", 100_000, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("kept_change reduces what the IN legs need to cover", () => {
    it("passes when the uncovered surplus is justified by kept_change_usd", () => {
      // Owes $100; customer hands $105; shop keeps the $5 instead of
      // returning it (no OUT leg) — kept_change must justify the gap.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 105)],
          keptChange: { usd: 5 },
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws when the surplus is UNjustified (no kept_change, no OUT leg)", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 105)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("kept_change_lbp is converted at the stamped rate", () => {
      // Owes $100; customer hands $100 + 90,000 LBP (~$1 extra), shop keeps
      // the LBP as profit (kept_change_lbp), no OUT leg.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100), leg("LBP", 90_000)],
          keptChange: { lbp: 90_000 },
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("CUSTOMER_ACCOUNT legs count toward the total (S2 owner decision)", () => {
    it("a CUSTOMER_ACCOUNT leg covering the remainder reconciles", () => {
      // $100 total: $60 cash + $40 on account.
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 60),
            leg("USD", 40, { method: "CUSTOMER_ACCOUNT" }),
          ],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("a mixed-currency CUSTOMER_ACCOUNT split (USD + LBP) reconciles at the stamped rate", () => {
      // $10 total: $5 on-account (USD) + 450,000 LBP on-account (=$5 at rate 90,000).
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 5, { method: "CUSTOMER_ACCOUNT" }),
            leg("LBP", 450_000, { method: "CUSTOMER_ACCOUNT" }),
          ],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("walk-in (no CUSTOMER_ACCOUNT leg): full payment required, overage must come back as OUT", () => {
      // Owes $50, walk-in hands $60 cash with no account leg and no change
      // leg recorded — must reject (payment-in-full rule, enforced by the
      // SAME equation, no special-casing).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 60)],
          expectedTotals: expectedTotalIn(50, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });
  });

  describe("mismatch error message", () => {
    it("names expected vs. got per currency", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 40)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "WHISH_APP SEND",
        }),
      ).toThrow(
        /WHISH_APP SEND: payment legs do not reconcile — expected \$100\.00.*got \$40\.00/,
      );
    });
  });

  describe("unsupported leg currency", () => {
    it("throws a clear error for a non-USD/LBP leg currency", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 10),
            { method: "CASH", currencyCode: "EUR", amount: 5 },
          ],
          expectedTotals: expectedTotalIn(15, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/not USD or LBP/);
    });
  });

  describe("expectedTotalIn", () => {
    it("buckets a USD amount into { usd, lbp: 0 }", () => {
      expect(expectedTotalIn(25, "USD")).toEqual({ usd: 25, lbp: 0 });
    });

    it("buckets an LBP amount into { usd: 0, lbp }", () => {
      expect(expectedTotalIn(2_250_000, "LBP")).toEqual({
        usd: 0,
        lbp: 2_250_000,
      });
    });

    it("treats a non-LBP currency (e.g. USDT) as the USD bucket", () => {
      expect(expectedTotalIn(20, "USDT")).toEqual({ usd: 20, lbp: 0 });
    });
  });
});
