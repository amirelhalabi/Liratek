/**
 * LIRA-332 — one seed for both provisioners. Not proven failing-first (new
 * contract).
 */

import {
  payingSubscriptionSeed,
  trialSubscriptionSeed,
} from "../subscriptionSeed.js";

describe("subscription seeds", () => {
  it("the paying seed is exactly the literal both provisioners hard-coded", () => {
    expect(payingSubscriptionSeed()).toEqual({
      plan: "standard",
      status: "active",
      current_period_end: null,
      entitled_modules: null,
    });
  });

  it("the trial seed adds a start and the 00:00-Beirut end after day 14", () => {
    const now = new Date("2026-10-17T07:00:00Z"); // 10:00 Beirut
    expect(trialSubscriptionSeed(now)).toEqual({
      plan: "standard",
      status: "active",
      current_period_end: null,
      entitled_modules: null,
      trial_started_at: "2026-10-17 07:00:00",
      trial_ends_at: "2026-10-30 22:00:00",
    });
  });
});
