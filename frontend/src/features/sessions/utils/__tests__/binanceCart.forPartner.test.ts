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
import { splitBasketCashSides } from "../binanceCart";
import type { CartItem } from "../../types/cart";

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
