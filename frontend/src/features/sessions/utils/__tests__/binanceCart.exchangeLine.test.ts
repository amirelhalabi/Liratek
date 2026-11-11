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
import { netCashPayoutAgainstCharge, splitBasketCashSides } from "../binanceCart";
import type { CartItem } from "../../types/cart";

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
