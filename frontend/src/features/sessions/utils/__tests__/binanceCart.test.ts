/**
 * splitBasketCashSides — GROSS charge/payout split (the point-3 "un-net" fix).
 *
 * The Debts page must list a $10 charge AND a $20 cash-out in full (a $10 debt
 * plus a $20 credit, net −$10), never collapsed into one −$10 line. This guards
 * that charges and cash-out payouts are accumulated into SEPARATE buckets and
 * are NOT netted against each other.
 *
 * Rule 17: proven to FAIL on a netted implementation — temporarily returning
 * `chargeUsd = charge − payout` (net) makes the first test's
 * `payoutUsd` collapse to 0 and `chargeUsd` go negative; revert to pass.
 */

import { splitBasketCashSides } from "../binanceCart";
import type { CartItem } from "../../types/cart";

type Split = Pick<CartItem, "module" | "amount" | "currency">;

const charge = (amount: number, currency: "USD" | "LBP"): Split => ({
  module: "custom_service",
  amount,
  currency,
});

const binanceReceive = (cashUsd: number): Split => ({
  // a Binance RECEIVE: the customer is paid out, so the cash side is negative;
  // currency "USDT" is a mechanical tag folded into the USD cash side.
  module: "binance_receive",
  amount: -cashUsd,
  currency: "USDT",
});

const binanceSend = (cashUsd: number): Split => ({
  module: "binance_send",
  amount: cashUsd,
  currency: "USDT",
});

describe("splitBasketCashSides", () => {
  it("keeps a same-currency charge and cash-out SEPARATE — never nets them", () => {
    // The exact point-3 scenario: $10 of items + a $20 Binance cash-out, same
    // currency. A netted split would report −$10 (or charge $10 / payout $0)
    // and the $20 credit would vanish from the Debts page.
    const result = splitBasketCashSides([
      charge(10, "USD"),
      binanceReceive(20),
    ]);

    expect(result.chargeUsd).toBe(10);
    expect(result.payoutUsd).toBe(20);
    expect(result.chargeLbp).toBe(0);
    expect(result.payoutLbp).toBe(0);
    // Both survive in full: their net is −$10, but neither is collapsed away.
    expect(result.chargeUsd - result.payoutUsd).toBe(-10);
  });

  it("tracks charges and payouts per currency independently", () => {
    const result = splitBasketCashSides([
      charge(500_000, "LBP"),
      binanceReceive(40),
    ]);

    expect(result.chargeLbp).toBe(500_000);
    expect(result.payoutUsd).toBe(40);
    expect(result.chargeUsd).toBe(0);
    expect(result.payoutLbp).toBe(0);
  });

  it("treats a Binance SEND as a charge (positive cash side)", () => {
    const result = splitBasketCashSides([binanceSend(30)]);

    expect(result.chargeUsd).toBe(30);
    expect(result.payoutUsd).toBe(0);
  });

  it("accumulates multiple items of each kind", () => {
    const result = splitBasketCashSides([
      charge(5, "USD"),
      charge(15, "USD"),
      charge(100_000, "LBP"),
      binanceReceive(10),
      binanceReceive(20),
    ]);

    expect(result.chargeUsd).toBe(20);
    expect(result.chargeLbp).toBe(100_000);
    expect(result.payoutUsd).toBe(30);
    expect(result.payoutLbp).toBe(0);
  });

  it("returns all-zero for an empty basket", () => {
    expect(splitBasketCashSides([])).toEqual({
      chargeUsd: 0,
      chargeLbp: 0,
      payoutUsd: 0,
      payoutLbp: 0,
    });
  });
});

describe("splitBasketCashSides — system RECEIVE fee-on-top (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5 Phase F)", () => {
  // Pre-Phase-F, a session RECEIVE's fee was zeroed out before it ever
  // reached the cart (§2 bug 1) and this function had no fee-awareness at
  // all — every case below returned chargeUsd/chargeLbp = 0 regardless of
  // formData.omtFee/whishFee. Proven failing-first (rule 17): reverting the
  // fee-bucketing block in binanceCart.ts back out reproduces that — these
  // assertions fail with "Expected 5, Received 0" (etc.) against the
  // pre-fix function.
  const systemReceive = (
    module: "omt_system" | "whish_system",
    payout: number,
    currency: "USD" | "LBP",
    formData: Record<string, unknown>,
  ): Pick<CartItem, "module" | "amount" | "currency" | "formData"> => ({
    module,
    amount: -payout,
    currency,
    formData,
  });

  it("adds an OMT RECEIVE fee-on-top to the CHARGE bucket, alongside the full payout", () => {
    const result = splitBasketCashSides([
      systemReceive("omt_system", 100, "USD", {
        omtFee: 5,
        includingFees: false,
      }),
    ]);

    expect(result.chargeUsd).toBe(5);
    expect(result.payoutUsd).toBe(100);
  });

  it("adds a WHISH RECEIVE fee-on-top to the CHARGE bucket", () => {
    const result = splitBasketCashSides([
      systemReceive("whish_system", 200, "USD", {
        whishFee: 8,
        includingFees: false,
      }),
    ]);

    expect(result.chargeUsd).toBe(8);
    expect(result.payoutUsd).toBe(200);
  });

  it("does NOT add the fee when includingFees is true — it's already netted into the (smaller) payout", () => {
    // Requested $100, fee $5 deducted: the item's own amount already carries
    // the netted $95 payout. Adding the fee again here would double-book it.
    const result = splitBasketCashSides([
      systemReceive("whish_system", 95, "USD", {
        whishFee: 5,
        includingFees: true,
      }),
    ]);

    expect(result.chargeUsd).toBe(0);
    expect(result.payoutUsd).toBe(95);
  });

  it("keys the fee off the item's OWN currency (LBP), independent of the payout bucket", () => {
    const result = splitBasketCashSides([
      systemReceive("omt_system", 1_000_000, "LBP", {
        omtFee: 50_000,
        includingFees: false,
      }),
    ]);

    expect(result.chargeLbp).toBe(50_000);
    expect(result.payoutLbp).toBe(1_000_000);
    expect(result.chargeUsd).toBe(0);
    expect(result.payoutUsd).toBe(0);
  });

  it("never adds a fee for a SEND item (positive amount) — the fee is already baked into it", () => {
    // A SEND's `amount` already includes the fee-on-top per Services/index.tsx
    // (`customerTotal = sentAmount + resolvedFee + finalPmFee`); this function
    // must not add it a second time just because formData.omtFee is present.
    const result = splitBasketCashSides([
      {
        module: "omt_system",
        amount: 105,
        currency: "USD",
        formData: { omtFee: 5, includingFees: false },
      },
    ]);

    expect(result.chargeUsd).toBe(105);
    expect(result.payoutUsd).toBe(0);
  });

  it("ignores a non-financial RECEIVE-shaped item even if formData carries a fee-like key", () => {
    // Only omt_system/whish_system carry a real provider fee — a loto prize
    // or Binance cash-out must never pick one up from stray formData.
    const result = splitBasketCashSides([
      {
        module: "loto_prize",
        amount: -20,
        currency: "USD",
        formData: { omtFee: 5, includingFees: false },
      },
    ]);

    expect(result.chargeUsd).toBe(0);
    expect(result.payoutUsd).toBe(20);
  });
});
