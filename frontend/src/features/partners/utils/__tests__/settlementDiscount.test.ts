/**
 * LIRA-372 — rule 24 rewrite. The partner settle discount used to be capped
 * at "what is left AFTER the payment" (CQ-10 `capSettlementDiscount`). The
 * owner's LIRA-372 rule replaced that: the room is min($5 / 450,000 LBP,
 * what is owed) measured BEFORE the payment, the payment line follows the
 * discount, and Confirm is blocked when payment + discount exceeds what is
 * owed. The CQ-10 over-reduction guard (settle 100 + discount 30 on a 100
 * balance) survives as the `partnerDiscountOverpaid` cases below.
 */
import {
  capPartnerDiscount,
  partnerDiscountOverpaid,
  partnerDiscountRoom,
} from "../settlementDiscount";

describe("partnerDiscountRoom (LIRA-372)", () => {
  it("is min($5, owed) for USD and min(450,000, owed) for LBP", () => {
    expect(partnerDiscountRoom("USD", 100)).toBe(5);
    expect(partnerDiscountRoom("USD", 3)).toBe(3);
    expect(partnerDiscountRoom("LBP", 900_000)).toBe(450_000);
    expect(partnerDiscountRoom("USD", -5)).toBe(0);
  });
});

describe("capPartnerDiscount (LIRA-372)", () => {
  it("caps a typed amount at the room; negative input is 0", () => {
    expect(capPartnerDiscount("USD", 500, 6)).toBe(5);
    expect(capPartnerDiscount("USD", 500, 2.5)).toBe(2.5);
    expect(capPartnerDiscount("USD", 500, -10)).toBe(0);
  });
});

// The CQ-10 over-reduction guard (settle 100 + discount 30 on a 100 balance
// posted 130 of reduction) now lives here: Confirm is blocked.
describe("partnerDiscountOverpaid (LIRA-372)", () => {
  it("settle 100 + discount 5 on a 100 balance overshoots it", () => {
    expect(partnerDiscountOverpaid("USD", 100, 100, 5)).toBe(true);
  });
  it("settle 95 + discount 5 on a 100 balance fits", () => {
    expect(partnerDiscountOverpaid("USD", 100, 95, 5)).toBe(false);
  });
  it("no discount never blocks (an overpay is change or account credit)", () => {
    expect(partnerDiscountOverpaid("USD", 100, 150, 0)).toBe(false);
  });
});
