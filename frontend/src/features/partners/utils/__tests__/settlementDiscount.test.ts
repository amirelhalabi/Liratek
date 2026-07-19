import {
  capSettlementDiscount,
  discountRoomAfterSettlement,
  isDiscountClippedBySettlement,
} from "../settlementDiscount";

describe("capSettlementDiscount", () => {
  it("caps the discount at what's left after the settlement amount", () => {
    // Balance 100, settling 70 → at most 30 left to forgive.
    expect(capSettlementDiscount(100, 70, 30)).toBe(30);
    expect(capSettlementDiscount(100, 70, 50)).toBe(30);
  });

  it("zero discount stays zero", () => {
    expect(capSettlementDiscount(100, 50, 0)).toBe(0);
  });

  it("negative (malformed) discount input is treated as zero", () => {
    expect(capSettlementDiscount(100, 50, -10)).toBe(0);
  });

  // Regression for the exact bug this helper fixes: settle=100 + discount=30
  // against a balance of only 100 previously posted 130 of reduction (the
  // SettleModal computed `parsedDiscount` independently, capped only at the
  // FULL balance, not the balance minus the settlement amount already
  // entered). Proven against the buggy shape first (rule 17).
  it("BUGGY shape (documented, not the fixed one): capping the discount at the full balance alone lets settle+discount overshoot it", () => {
    const balance = 100;
    const settlementAmount = 100;
    const requestedDiscount = 30;
    // The bug: cap discount at balance alone, ignoring the settlement amount.
    const buggyDiscount = Math.min(Math.max(0, requestedDiscount), balance);
    expect(settlementAmount + buggyDiscount).toBeGreaterThan(balance); // 130 > 100 — overshoot
  });

  it("FIXED: settlement + capped discount never exceeds the balance", () => {
    const balance = 100;
    const settlementAmount = 100;
    const capped = capSettlementDiscount(balance, settlementAmount, 30);
    expect(capped).toBe(0);
    expect(settlementAmount + capped).toBeLessThanOrEqual(balance);
  });

  it("FIXED: partial settlement still allows a bounded discount, nets exactly to the balance", () => {
    const balance = 100;
    const settlementAmount = 70;
    const capped = capSettlementDiscount(balance, settlementAmount, 30);
    expect(settlementAmount + capped).toBe(balance);
  });

  it("a settlement amount that already exceeds the balance leaves zero room for a discount", () => {
    expect(capSettlementDiscount(100, 150, 10)).toBe(0);
  });

  it("treats a negative/zero balance as nothing left to forgive", () => {
    expect(capSettlementDiscount(0, 0, 10)).toBe(0);
    expect(capSettlementDiscount(-5, 0, 10)).toBe(0);
  });
});

// SettleModal UX fix (COUNTERPARTY_CONSOLIDATION_PLAN follow-up): the
// settlement leg auto-fills to the full balance, so a discount typed before
// the operator manually shrinks that leg gets capped straight to 0 with no
// explanation. discountRoomAfterSettlement/isDiscountClippedBySettlement
// drive the modal's "lower the payment amount" hint instead of a silent cap.
describe("discountRoomAfterSettlement", () => {
  it("matches the room capSettlementDiscount caps against", () => {
    // Same balance/settlement pairs as the capSettlementDiscount cases above
    // — the two must never drift apart (shared helper, rule 14).
    expect(discountRoomAfterSettlement(100, 70)).toBe(30);
    expect(discountRoomAfterSettlement(100, 100)).toBe(0);
    expect(discountRoomAfterSettlement(100, 150)).toBe(0);
  });

  it("treats a negative/zero balance as nothing left to forgive", () => {
    expect(discountRoomAfterSettlement(0, 0)).toBe(0);
    expect(discountRoomAfterSettlement(-5, 0)).toBe(0);
  });
});

describe("isDiscountClippedBySettlement", () => {
  it("is false when the requested discount fits inside the room left", () => {
    // Balance 100, settling 70 → 30 of room; a 30 request fits exactly.
    expect(isDiscountClippedBySettlement(100, 70, 30)).toBe(false);
    expect(isDiscountClippedBySettlement(100, 70, 0)).toBe(false);
  });

  it("is true the moment the settlement leg still covers the full balance (the reported bug)", () => {
    // The exact scenario from the owner report: MultiPaymentInput
    // auto-fills the leg to the full 100 balance, then the operator types a
    // 30 discount before touching the leg — zero room left, so it's
    // clipped straight to 0 with no explanation unless this flags it.
    expect(isDiscountClippedBySettlement(100, 100, 30)).toBe(true);
  });

  it("is true when the requested discount exceeds a partial room", () => {
    expect(isDiscountClippedBySettlement(100, 70, 50)).toBe(true);
  });

  it("is false for a zero/negative request regardless of room", () => {
    expect(isDiscountClippedBySettlement(100, 100, 0)).toBe(false);
    expect(isDiscountClippedBySettlement(100, 100, -10)).toBe(false);
  });
});
