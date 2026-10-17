/**
 * LIRA-332 — owner trial-action schemas. Not proven failing-first (new
 * contract).
 */

import {
  activateSubscriptionSchema,
  extendTrialSchema,
} from "../subscription.js";

describe("activateSubscriptionSchema", () => {
  it("accepts an open-ended activation (until: null)", () => {
    expect(activateSubscriptionSchema.parse({ until: null })).toEqual({
      until: null,
    });
  });

  it("accepts a real date and strips extra keys", () => {
    expect(
      activateSubscriptionSchema.parse({ until: "2027-10-31", tenantId: 9 }),
    ).toEqual({ until: "2027-10-31" });
  });

  it("rejects an impossible date, a bad shape and a missing key", () => {
    const bad = (v: unknown) =>
      activateSubscriptionSchema.safeParse(v).success;
    expect(bad({ until: "2026-02-30" })).toBe(false);
    expect(bad({ until: "31/10/2027" })).toBe(false);
    expect(bad({})).toBe(false);
  });
});

describe("extendTrialSchema", () => {
  it("accepts a real date and strips extra keys", () => {
    expect(extendTrialSchema.parse({ lastDay: "2026-11-15", x: 1 })).toEqual({
      lastDay: "2026-11-15",
    });
  });

  it("rejects 2026-02-30, null and a timestamp", () => {
    const ok = (v: unknown) => extendTrialSchema.safeParse(v).success;
    expect(ok({ lastDay: "2026-02-30" })).toBe(false);
    expect(ok({ lastDay: null })).toBe(false);
    expect(ok({ lastDay: "2026-11-15T00:00:00Z" })).toBe(false);
  });
});
