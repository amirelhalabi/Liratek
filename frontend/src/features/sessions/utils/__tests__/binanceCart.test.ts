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
    const result = splitBasketCashSides([charge(10, "USD"), binanceReceive(20)]);

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
