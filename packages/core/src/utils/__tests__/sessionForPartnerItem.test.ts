import {
  isForPartnerBasketItem,
  sessionBasketCustomerAmount,
} from "../sessionForPartnerItem";
import { sessionPooledReceiveFee } from "../sessionFeeOnTop";

describe("sessionForPartnerItem — a FOR item costs the walk-in customer nothing", () => {
  it("zeroes a top-level For-Partner item, either sign", () => {
    const fd = {
      provider: "OMT",
      serviceType: "SEND",
      partnerMode: "FOR",
      partnerId: 1,
    };
    expect(sessionBasketCustomerAmount({ amount: 105, formData: fd })).toBe(0);
    expect(sessionBasketCustomerAmount({ amount: -100, formData: fd })).toBe(0);
  });

  it("keeps a walk-in or THROUGH item's amount", () => {
    expect(
      sessionBasketCustomerAmount({
        amount: 105,
        formData: { provider: "OMT" },
      }),
    ).toBe(105);
    expect(
      sessionBasketCustomerAmount({
        amount: 105,
        formData: { provider: "WHISH", partnerMode: "THROUGH", partnerId: 1 },
      }),
    ).toBe(105);
    expect(sessionBasketCustomerAmount({ amount: 20 })).toBe(20);
  });

  it("a batch is FOR only when every sub-item is FOR", () => {
    const forSub = { partnerMode: "FOR", partnerId: 1 };
    expect(
      isForPartnerBasketItem({ _batch: true, items: [forSub, forSub] }),
    ).toBe(true);
    expect(isForPartnerBasketItem({ _batch: true, items: [forSub, {}] })).toBe(
      false,
    );
    expect(isForPartnerBasketItem({ _batch: true, items: [] })).toBe(false);
  });

  it("the pooled fee-on-top rule never collects a For-Partner RECEIVE's fee", () => {
    const fd = {
      provider: "WHISH",
      serviceType: "RECEIVE",
      whishFee: 3,
      includingFees: false,
    };
    expect(sessionPooledReceiveFee(fd)).toBe(3);
    expect(
      sessionPooledReceiveFee({ ...fd, partnerMode: "FOR", partnerId: 1 }),
    ).toBe(0);
  });
});
