/**
 * binanceCart — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  netCashPayoutAgainstCharge,
  splitBasketCashSides,
} from "../binanceCart";
import { type CartItem } from "../../types/cart";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("binanceCart.exchangeLine (LIRA-380)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-380 — an exchange line in the checkout's charge/payout split.
   *
   * The side the customer gives is a charge; the side they receive is a
   * payout that is NEVER netted against the charge at the checkout rate
   * (owner 2026-11-11: the session rate must not re-price the exchange). The
   * split reads the ONE core rule (`sessionExchangeLineSides`), so the modal
   * and the server agree (rule 14).
   *
   * Rule 17: run against the unfixed split first.
   */

  const charger: CartItem = {
    id: "c",
    module: "custom_service",
    label: "Charger",
    amount: 20,
    currency: "USD",
    formData: {},
    ipcChannel: "custom-services:add",
  };

  function exchange(
    formData: Record<string, unknown>,
    amount: number,
    currency: "USD" | "LBP",
  ): CartItem {
    return {
      id: "x",
      module: "exchange",
      label: "Exchange",
      amount,
      currency,
      formData,
      ipcChannel: "exchange:add-transaction",
    };
  }

  const usdToLbp = exchange(
    {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_950_000,
    },
    100,
    "USD",
  );
  const lbpToUsd = exchange(
    {
      fromCurrency: "LBP",
      toCurrency: "USD",
      amountIn: 9_000_000,
      amountOut: 100,
    },
    9_000_000,
    "LBP",
  );

  describe("LIRA-380 — splitBasketCashSides with an exchange line", () => {
    it("charger + $100 → 8,950,000 LBP: $120 to collect, 8,950,000 LBP paid out gross", () => {
      const split = splitBasketCashSides([charger, usdToLbp]);
      expect(split.chargeUsd).toBe(120);
      expect(split.chargeLbp).toBe(0);
      expect(split.payoutLbp).toBe(8_950_000);
      expect(split.exchangePayoutLbp).toBe(8_950_000);
      expect(split.exchangePayoutUsd).toBe(0);
    });

    it("LBP → USD: 9,000,000 LBP to collect, $100 paid out gross", () => {
      const split = splitBasketCashSides([lbpToUsd]);
      expect(split.chargeLbp).toBe(9_000_000);
      expect(split.chargeUsd).toBe(0);
      expect(split.payoutUsd).toBe(100);
      expect(split.exchangePayoutUsd).toBe(100);
    });

    it("the exchange payout is excluded from what nets against the charge, so the checkout rate never changes what is collected", () => {
      const split = splitBasketCashSides([charger, usdToLbp]);
      const generalNettable =
        split.payoutLbp - split.systemPayoutLbp - split.exchangePayoutLbp;
      for (const rate of [89_500, 89_000]) {
        const net = netCashPayoutAgainstCharge({
          chargeUsd: split.chargeUsd,
          chargeLbp: split.chargeLbp,
          cashPayoutUsd: 0,
          cashPayoutLbp: generalNettable,
          rate,
        });
        expect(net.netChargeUsd).toBe(120);
      }
    });
  });
});

describe("binanceCart.forPartner", () => {
  beforeAll(resetBetweenFiles);

  /**
   * A For-Partner (FOR) transfer in a customer-session basket is not the walk-in
   * customer's to pay (FEATURE_GUIDE §8.1.0: obligations only — the partner owes
   * the shop, no drawer moves). The Services page carts it with the customer
   * total as `amount`, so the Session Checkout modal used to ask the customer for
   * it on top of the partner's own debt.
   *
   * Cart items below are exactly what Services/index.tsx adds for a FOR-partner
   * OMT INTRA SEND of $100 + $5 fee (amount 105) and RECEIVE of $100
   * (amount −100), next to a $20 walk-in service.
   */

  type Item = Pick<CartItem, "module" | "amount" | "currency" | "formData">;

  const walkIn: Item = {
    module: "custom_service",
    amount: 20,
    currency: "USD",
    formData: { description: "Screen protector", price_usd: 20 },
  };

  const forSend: Item = {
    module: "omt_system",
    amount: 105,
    currency: "USD",
    formData: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      omtServiceType: "INTRA",
      omtFee: 5,
      includingFees: false,
      payments: [],
      paymentMethodFee: 0,
      partnerId: 7,
      partnerMode: "FOR",
    },
  };

  const forReceive: Item = {
    module: "whish_system",
    amount: -100,
    currency: "USD",
    formData: {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      whishFee: 3,
      includingFees: false,
      payments: [],
      partnerId: 7,
      partnerMode: "FOR",
      cashoutMethod: "CASH",
    },
  };

  describe("splitBasketCashSides — FOR-partner items cost the walk-in customer nothing", () => {
    it("a FOR-partner SEND adds nothing to the amount due", () => {
      const r = splitBasketCashSides([walkIn, forSend]);
      expect(r.chargeUsd).toBe(20);
      expect(r.systemChargeUsd).toBe(0);
    });

    it("a FOR-partner RECEIVE is neither paid out to the customer nor collects a fee from them", () => {
      const r = splitBasketCashSides([walkIn, forReceive]);
      expect(r.chargeUsd).toBe(20);
      expect(r.payoutUsd).toBe(0);
      expect(r.systemPayoutUsd).toBe(0);
      expect(r.systemChargeUsd).toBe(0);
    });

    it("a walk-in system item is still charged as before", () => {
      const walkInSend: Item = {
        ...forSend,
        formData: {
          ...forSend.formData,
          partnerId: undefined,
          partnerMode: undefined,
        },
      };
      const r = splitBasketCashSides([walkIn, walkInSend]);
      expect(r.chargeUsd).toBe(125);
      expect(r.systemChargeUsd).toBe(105);
    });
  });
});

describe("binanceCart", () => {
  beforeAll(resetBetweenFiles);

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
        systemPayoutUsd: 0,
        systemPayoutLbp: 0,
        // Fix-round finding (2026-09-24, this batch): systemChargeUsd/Lbp
        // (fix-round finding #3's netting-base fields) are part of the same
        // return object — omitting them here would fail this `toEqual` against
        // the real implementation, which always returns all 8 keys.
        systemChargeUsd: 0,
        systemChargeLbp: 0,
        // LIRA-380: the exchange lines' never-netted payout.
        exchangePayoutUsd: 0,
        exchangePayoutLbp: 0,
      });
    });
  });

  describe("splitBasketCashSides — systemPayoutUsd/systemPayoutLbp (owner decision #11-A)", () => {
    const omtSystemReceive = (
      payout: number,
      currency: "USD" | "LBP",
    ): Split => ({
      module: "omt_system",
      amount: -payout,
      currency,
    });
    const whishSystemReceive = (
      payout: number,
      currency: "USD" | "LBP",
    ): Split => ({
      module: "whish_system",
      amount: -payout,
      currency,
    });
    const lotoPrize = (payout: number): Split => ({
      module: "loto_prize",
      amount: -payout,
      currency: "LBP",
    });

    it("tags an OMT/Whish SYSTEM RECEIVE's payout as systemPayout — never a loto prize or Binance cash-out", () => {
      const result = splitBasketCashSides([
        omtSystemReceive(100, "USD"),
        binanceReceive(20),
        lotoPrize(400_000),
      ]);

      expect(result.payoutUsd).toBe(120);
      expect(result.systemPayoutUsd).toBe(100);
      expect(result.payoutLbp).toBe(400_000);
      expect(result.systemPayoutLbp).toBe(0);
    });

    it("sums multiple system-payout items and keeps WHISH separate by currency", () => {
      const result = splitBasketCashSides([
        omtSystemReceive(50, "USD"),
        whishSystemReceive(1_000_000, "LBP"),
      ]);

      expect(result.systemPayoutUsd).toBe(50);
      expect(result.systemPayoutLbp).toBe(1_000_000);
      expect(result.payoutUsd).toBe(50);
      expect(result.payoutLbp).toBe(1_000_000);
    });

    it("a charge (positive) SYSTEM item never contributes to systemPayout", () => {
      const result = splitBasketCashSides([
        { module: "omt_system", amount: 100, currency: "USD" },
      ]);

      expect(result.systemPayoutUsd).toBe(0);
      expect(result.payoutUsd).toBe(0);
    });
  });

  describe("netCashPayoutAgainstCharge (owner decision #11-A — netted session checkout)", () => {
    // Rule 17: proven to FAIL on the pre-#11-A GROSS behavior — a caller that
    // simply sends chargeLbp (1,280,000) as the total-to-collect and the full
    // 400,000 LBP prize as a separate OUT leg records a 400,000 LBP drawer
    // debit that never physically happened (only 10,000 LBP + $40 physically
    // left the drawer as change on a $50 tender) — the exact 390,000 LBP gap
    // this function exists to close. Reverting the caller to that GROSS
    // behavior (skip this function, keep the old two-bucket construction) is
    // what fails the owner's arithmetic below.
    it("owner's worked example: 1,280,000 LBP charge netted against a 400,000 LBP prize leaves 880,000 LBP owed, no excess payout", () => {
      const result = netCashPayoutAgainstCharge({
        chargeUsd: 0,
        chargeLbp: 1_280_000,
        cashPayoutUsd: 0,
        cashPayoutLbp: 400_000,
        rate: 89_000,
      });

      expect(result.netChargeUsd).toBe(0);
      expect(result.netChargeLbp).toBe(880_000);
      expect(result.excessPayoutUsd).toBe(0);
      expect(result.excessPayoutLbp).toBe(0);
    });

    it("a payout bigger than the charge leaves the excess as a real payout, never a negative charge", () => {
      // $30 charge, $50 CASH payout (e.g. a Binance cash-out bigger than the
      // basket) -> $20 excess still has to leave the drawer as a real leg.
      const result = netCashPayoutAgainstCharge({
        chargeUsd: 30,
        chargeLbp: 0,
        cashPayoutUsd: 50,
        cashPayoutLbp: 0,
        rate: 89_000,
      });

      expect(result.netChargeUsd).toBe(0);
      expect(result.excessPayoutUsd).toBe(20);
    });

    it("no netting-eligible payout passes the charge straight through unchanged", () => {
      const result = netCashPayoutAgainstCharge({
        chargeUsd: 10,
        chargeLbp: 500_000,
        cashPayoutUsd: 0,
        cashPayoutLbp: 0,
        rate: 89_000,
      });

      expect(result.netChargeUsd).toBe(10);
      expect(result.netChargeLbp).toBe(500_000);
      expect(result.excessPayoutUsd).toBe(0);
      expect(result.excessPayoutLbp).toBe(0);
    });

    it("cross-currency: a payout in one currency nets against a charge in the other, via the rate", () => {
      // No USD charge, but a $10 USD payout and an LBP charge -> the USD
      // payout's value converts into the LBP charge via spillover.
      const result = netCashPayoutAgainstCharge({
        chargeUsd: 0,
        chargeLbp: 1_000_000,
        cashPayoutUsd: 10,
        cashPayoutLbp: 0,
        rate: 89_000,
      });

      // $10 -> 890,000 LBP; remaining LBP charge = 1,000,000 - 890,000 = 110,000.
      expect(result.netChargeUsd).toBe(0);
      expect(result.netChargeLbp).toBe(110_000);
      expect(result.excessPayoutUsd).toBe(0);
      expect(result.excessPayoutLbp).toBe(0);
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

    // LIRA-271: this case used to expect chargeUsd 5 — the modal asked the
    // customer to pay an OMT RECEIVE's fee while the server (D1) never counted
    // it, so an honest kept claim was refused. Rewritten to the shared rule:
    // an OMT RECEIVE's omtFee is informational only.
    it("does NOT add an OMT RECEIVE's fee — OMT never takes a fee on RECEIVE (D1)", () => {
      const result = splitBasketCashSides([
        systemReceive("omt_system", 100, "USD", {
          provider: "OMT",
          serviceType: "RECEIVE",
          omtFee: 5,
          includingFees: false,
        }),
      ]);

      expect(result.chargeUsd).toBe(0);
      expect(result.payoutUsd).toBe(100);
    });

    it("adds a WHISH RECEIVE fee-on-top to the CHARGE bucket", () => {
      const result = splitBasketCashSides([
        systemReceive("whish_system", 200, "USD", {
          provider: "WHISH",
          serviceType: "RECEIVE",
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
          provider: "WHISH",
          serviceType: "RECEIVE",
          whishFee: 5,
          includingFees: true,
        }),
      ]);

      expect(result.chargeUsd).toBe(0);
      expect(result.payoutUsd).toBe(95);
    });

    it("keys the fee off the item's OWN currency (LBP), independent of the payout bucket", () => {
      const result = splitBasketCashSides([
        systemReceive("whish_system", 1_000_000, "LBP", {
          provider: "WHISH",
          serviceType: "RECEIVE",
          whishFee: 50_000,
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
          formData: {
            provider: "OMT",
            serviceType: "SEND",
            omtFee: 5,
            includingFees: false,
          },
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
          formData: { whishFee: 5, includingFees: false },
        },
      ]);

      expect(result.chargeUsd).toBe(0);
      expect(result.payoutUsd).toBe(20);
    });
  });

  describe("splitBasketCashSides — LIRA-271: ONE fee-on-top rule shared with the server", () => {
    // The modal and the server must agree on which RECEIVE fee the pooled
    // basket payment collects, or the server refuses an honest kept claim.
    // The shared rule (FEATURE_GUIDE §8.1 / D1): only a WHISH system RECEIVE
    // with the fee on top — read from the item's own formData, top level or a
    // batch sub-item. An OMT RECEIVE never takes a fee from the customer; an
    // app-wallet RECEIVE's fee arrives in the wallet, not over the counter.
    it("an OMT system RECEIVE's fee is NOT collected (D1 — informational only)", () => {
      const result = splitBasketCashSides([
        {
          module: "omt_system",
          amount: -100,
          currency: "USD",
          formData: {
            provider: "OMT",
            serviceType: "RECEIVE",
            omtFee: 1,
            includingFees: false,
          },
        },
      ]);

      expect(result.chargeUsd).toBe(0);
      expect(result.systemChargeUsd).toBe(0);
      expect(result.payoutUsd).toBe(100);
    });

    it("a WHISH system RECEIVE's fee on top IS collected (unchanged)", () => {
      const result = splitBasketCashSides([
        {
          module: "whish_system",
          amount: -200,
          currency: "USD",
          formData: {
            provider: "WHISH",
            serviceType: "RECEIVE",
            whishFee: 8,
            includingFees: false,
          },
        },
      ]);

      expect(result.chargeUsd).toBe(8);
      expect(result.systemChargeUsd).toBe(8);
      expect(result.payoutUsd).toBe(200);
    });

    it("a Whish App RECEIVE's fee is NOT collected — it arrives in the wallet", () => {
      const result = splitBasketCashSides([
        {
          module: "whish_app",
          amount: -40,
          currency: "USD",
          formData: {
            provider: "WHISH_APP",
            serviceType: "RECEIVE",
            whishFee: 1,
            includingFees: false,
          },
        },
      ]);

      expect(result.chargeUsd).toBe(0);
      expect(result.payoutUsd).toBe(40);
    });

    it("a WHISH RECEIVE inside a batch has its fee on top collected, like the server", () => {
      const result = splitBasketCashSides([
        {
          module: "whish_system",
          amount: -100,
          currency: "USD",
          formData: {
            _batch: true,
            items: [
              {
                provider: "WHISH",
                serviceType: "RECEIVE",
                amount: 100,
                currency: "USD",
                whishFee: 2,
              },
            ],
          },
        },
      ]);

      expect(result.chargeUsd).toBe(2);
      expect(result.systemChargeUsd).toBe(2);
      expect(result.payoutUsd).toBe(100);
    });
  });
});
