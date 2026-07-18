import { capSettlementDiscount } from "../settlementDiscount";

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
