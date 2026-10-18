/**
 * LIRA-337 — the give-back planner. Figures are the owner-confirmed worked
 * example in specs/337-give-credit-back/spec.md (2026-10-18).
 */
import { planLineGiveBack } from "../lineGiveBack.js";

const base = {
  creditsBefore: 15,
  creditsKept: 9,
  creditSellPriceLbp: 100_000,
  creditCostRateLbp: 89_500,
  exchangeRate: 89_500,
};

describe("planLineGiveBack", () => {
  it("worked example: buyer keeps $9 of $15", () => {
    expect(planLineGiveBack(base)).toEqual({
      ok: true,
      creditsSent: 5.68,
      smsFeeUsd: 0.32,
      creditsAfter: 9,
      priceDropUsd: 6.7,
      costDropUsd: 5.68,
    });
  });

  it("price drop follows the typed credit selling price", () => {
    const plan = planLineGiveBack({ ...base, creditSellPriceLbp: 85_000 });
    expect(plan.ok && plan.priceDropUsd).toBe(5.7);
  });

  it("cost drop uses the credit cost rate, so the fee stays in the cost", () => {
    const plan = planLineGiveBack({ ...base, creditCostRateLbp: 85_000 });
    // 5.68 × 85,000 / 89,500 = 5.394…
    expect(plan.ok && plan.costDropUsd).toBe(5.39);
  });

  it("no exact split: the line keeps the nearest amount above what was asked", () => {
    const plan = planLineGiveBack({ ...base, creditsBefore: 10, creditsKept: 6.83 });
    expect(plan).toMatchObject({
      ok: true,
      creditsSent: 3,
      smsFeeUsd: 0.16,
      creditsAfter: 6.84,
    });
  });

  it("the price drop is for the credit that actually left the line", () => {
    const plan = planLineGiveBack({ ...base, creditsBefore: 10, creditsKept: 6.83 });
    // 3.16 × 100,000 / 89,500 = 3.530…
    expect(plan.ok && plan.priceDropUsd).toBe(3.53);
  });

  it("keeping nothing gives everything back", () => {
    const plan = planLineGiveBack({ ...base, creditsKept: 0 });
    // 15 = 4.84 + 0.16 + 3 × 3 + 3 × 0.16 → 5 messages: 14.2 + 0.8
    expect(plan).toMatchObject({ ok: true, creditsSent: 14.2, smsFeeUsd: 0.8, creditsAfter: 0 });
  });

  it("refuses when the buyer keeps all of it or more", () => {
    expect(planLineGiveBack({ ...base, creditsKept: 15 })).toEqual({
      ok: false,
      error: "The buyer must keep less credit than the line has.",
    });
  });

  it("refuses when the line has no credit", () => {
    expect(planLineGiveBack({ ...base, creditsBefore: 0, creditsKept: 0 })).toEqual({
      ok: false,
      error: "This line has no credit to give back.",
    });
  });

  it("refuses when the amount cannot cover one SMS fee", () => {
    expect(planLineGiveBack({ ...base, creditsKept: 14.84 })).toEqual({
      ok: false,
      error: "Too little credit to cover the SMS fee.",
    });
  });
});
