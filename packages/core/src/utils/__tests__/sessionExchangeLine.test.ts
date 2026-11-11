/**
 * LIRA-380 — the ONE rule for an exchange line in a customer-session basket:
 * what the customer gives is a CHARGE in its own currency, what they receive
 * is a PAYOUT in its own currency, and the session link carries both signed
 * (given +, received −). A side in a currency other than USD/LBP is not part
 * of the basket's money (the exchange posts it itself at checkout).
 *
 * Shared by the checkout modal (`splitBasketCashSides`) and the server
 * (`SessionCheckoutService`'s link and totals) — rule 14.
 *
 * Rule 17: run against the one-sided stub first (charge only, no payout).
 */
import {
  EXCHANGE_CART_CHANNEL,
  isExchangeBasketLine,
  sessionExchangeCartAmount,
  sessionExchangeLineLink,
  sessionExchangeLineSides,
} from "../sessionExchangeLine";

const usdToLbp = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8_950_000,
  leg1Rate: 89_500,
};
const lbpToUsd = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 8_950_000,
  amountOut: 100,
  leg1Rate: 89_500,
};
const usdToEur = {
  fromCurrency: "USD",
  toCurrency: "EUR",
  amountIn: 110,
  amountOut: 100,
  leg1Rate: 1.1,
};
const eurToLbp = {
  fromCurrency: "EUR",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 9_700_000,
  leg1Rate: 1.08,
  leg2Rate: 89_800,
  viaCurrency: "USD",
};

describe("LIRA-380 — exchange basket line sides (one shared rule)", () => {
  it("recognises an exchange line by the channel the checkout replays it on", () => {
    expect(isExchangeBasketLine({ ipcChannel: EXCHANGE_CART_CHANNEL })).toBe(
      true,
    );
    expect(isExchangeBasketLine({ ipcChannel: "sales:process" })).toBe(false);
  });

  it("USD → LBP: the customer's $100 is a charge, the 8,950,000 LBP a payout", () => {
    expect(sessionExchangeLineSides(usdToLbp)).toEqual({
      charge: { currency: "USD", amount: 100 },
      payout: { currency: "LBP", amount: 8_950_000 },
    });
    expect(sessionExchangeLineLink(usdToLbp)).toEqual({
      amountUsd: 100,
      amountLbp: -8_950_000,
    });
    expect(sessionExchangeCartAmount(usdToLbp)).toEqual({
      amount: 100,
      currency: "USD",
    });
  });

  it("LBP → USD: the 8,950,000 LBP is a charge, the $100 a payout", () => {
    expect(sessionExchangeLineSides(lbpToUsd)).toEqual({
      charge: { currency: "LBP", amount: 8_950_000 },
      payout: { currency: "USD", amount: 100 },
    });
    expect(sessionExchangeLineLink(lbpToUsd)).toEqual({
      amountUsd: -100,
      amountLbp: 8_950_000,
    });
  });

  it("USD → EUR: only the $110 is basket money; the euros are paid out by the exchange itself", () => {
    expect(sessionExchangeLineSides(usdToEur)).toEqual({
      charge: { currency: "USD", amount: 110 },
      payout: null,
    });
    expect(sessionExchangeLineLink(usdToEur)).toEqual({
      amountUsd: 110,
      amountLbp: 0,
    });
  });

  it("EUR → LBP: no charge, the 9,700,000 LBP is the payout (the cart amount is negative)", () => {
    expect(sessionExchangeLineSides(eurToLbp)).toEqual({
      charge: null,
      payout: { currency: "LBP", amount: 9_700_000 },
    });
    expect(sessionExchangeLineLink(eurToLbp)).toEqual({
      amountUsd: 0,
      amountLbp: -9_700_000,
    });
    expect(sessionExchangeCartAmount(eurToLbp)).toEqual({
      amount: -9_700_000,
      currency: "LBP",
    });
  });

  it("a malformed line reads as nothing (never NaN)", () => {
    expect(sessionExchangeLineSides({})).toEqual({
      charge: null,
      payout: null,
    });
    expect(sessionExchangeLineLink(null)).toEqual({
      amountUsd: 0,
      amountLbp: 0,
    });
  });
});
