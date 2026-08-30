/**
 * v160 — the per-card "max returned credits" override.
 *
 * `maxReturnableCredits` models a BARE card: nothing on the line but the card's
 * own credit. The alfa 77.28 card returns $73.00 that way — 24 messages ×
 * $3.16 spends $75.84, leaves $1.44, and a final $1.50 message needs $1.66.
 * Real customers usually hold a little of their own credit, and $0.22 of it
 * buys the shop $73.50 back. These tests pin the override that expresses that,
 * and the cap that stops it becoming a way to book credit nobody received.
 *
 * The cap is the load-bearing part. An operator typing 83 where they meant
 * 73.5 would otherwise overstate recovery by $9.50 on EVERY sale of that card,
 * and nothing downstream would look wrong — the profit stamp, the drawer, and
 * the resale table would all agree with each other and all be wrong together.
 */

import {
  CREDIT_TRANSFER_STEP_USD,
  MAX_RETURNED_OVERRIDE_HEADROOM_USD,
  deriveItemEconomics,
  isValidMaxReturnedOverride,
  maxReturnableCredits,
  resolveMaxReturnedCredits,
  resolveReturnedCredits,
} from "../telecomCredit.js";

/** The owner's card: iPick alfa 77.28, 365 days, 7,728,000 LBP. */
const FACE = 77.28;
const COMPUTED = 73.0;
const OVERRIDE = 73.5;

describe("MAX_RETURNED_OVERRIDE_HEADROOM_USD", () => {
  it("is exactly one transfer step, not a hand-picked tolerance", () => {
    // If these ever diverge, the headroom has become a magic number and the
    // justification in the docblock (one more half-dollar in the final SMS)
    // no longer describes what the code does.
    expect(MAX_RETURNED_OVERRIDE_HEADROOM_USD).toBe(CREDIT_TRANSFER_STEP_USD);
  });
});

describe("isValidMaxReturnedOverride", () => {
  it("accepts the owner's 73.5 on the 77.28 card", () => {
    expect(isValidMaxReturnedOverride(OVERRIDE, FACE)).toBe(true);
  });

  it("accepts the computed value itself (a harmless no-op)", () => {
    expect(isValidMaxReturnedOverride(COMPUTED, FACE)).toBe(true);
  });

  it("rejects anything below computed — a short transfer is a per-sale fact", () => {
    // Encoding one failed transfer as a permanent property of the card would
    // under-book every later sale of it.
    expect(isValidMaxReturnedOverride(72.5, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(70, FACE)).toBe(false);
  });

  it("rejects more than one step above computed", () => {
    expect(isValidMaxReturnedOverride(74, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(77.28, FACE)).toBe(false);
  });

  it("rejects the 83-for-73.5 typo class", () => {
    expect(isValidMaxReturnedOverride(83, FACE)).toBe(false);
  });

  it("tolerates float noise on an exact boundary value", () => {
    // 73.5 arriving from JSON as 73.50000000000001 must not be rejected — the
    // comparison is in integer cents for exactly this reason.
    expect(isValidMaxReturnedOverride(73.50000000000001, FACE)).toBe(true);
  });

  it("rejects junk and un-boundable cards without throwing", () => {
    expect(isValidMaxReturnedOverride(NaN, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(Infinity, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(0, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(-1, FACE)).toBe(false);
    expect(isValidMaxReturnedOverride(73.5, null)).toBe(false);
    expect(isValidMaxReturnedOverride(73.5, 0)).toBe(false);
    expect(isValidMaxReturnedOverride(73.5, undefined)).toBe(false);
  });

  it("bounds every catalog card one step above its own computed value", () => {
    // The catalog-wide shortfall runs $0.03 to $0.49, so a single step covers
    // all of them — the property the cap's justification rests on.
    for (const face of [
      1.0, 1.22, 1.67, 3.03, 3.79, 4.5, 7.58, 10, 15.15, 22.73, 77.28,
    ]) {
      const computed = maxReturnableCredits(face);
      expect(isValidMaxReturnedOverride(computed + 0.5, face)).toBe(true);
      expect(isValidMaxReturnedOverride(computed + 1.0, face)).toBe(false);
    }
  });
});

describe("resolveMaxReturnedCredits", () => {
  it("returns the computed value when no override is configured", () => {
    expect(resolveMaxReturnedCredits(FACE)).toBe(COMPUTED);
    expect(resolveMaxReturnedCredits(FACE, null)).toBe(COMPUTED);
    expect(resolveMaxReturnedCredits(FACE, undefined)).toBe(COMPUTED);
  });

  it("returns the override when one is configured", () => {
    expect(resolveMaxReturnedCredits(FACE, OVERRIDE)).toBe(OVERRIDE);
  });

  it("IGNORES an out-of-range override rather than trusting or throwing", () => {
    // A stored override goes stale when someone edits `credits` underneath it.
    // The write path refuses that save; the read path must keep pricing sales
    // correctly in the meantime rather than booking 83.
    expect(resolveMaxReturnedCredits(FACE, 83)).toBe(COMPUTED);
    expect(resolveMaxReturnedCredits(FACE, 10)).toBe(COMPUTED);
  });

  it("returns 0 for a card with no usable face value", () => {
    expect(resolveMaxReturnedCredits(null, 73.5)).toBe(0);
    expect(resolveMaxReturnedCredits(0)).toBe(0);
    expect(resolveMaxReturnedCredits(undefined)).toBe(0);
  });
});

describe("resolveReturnedCredits — the sale-time default", () => {
  const item = {
    cost_lbp: 7_728_000,
    days_cost_lbp: 1_159_200,
    credits: FACE,
    category: "alfa",
  };

  it("defaults to the override when the card carries one", () => {
    expect(
      resolveReturnedCredits(
        {},
        { ...item, max_returned_credits_usd: OVERRIDE },
      ),
    ).toBe(OVERRIDE);
  });

  it("defaults to computed when it does not", () => {
    expect(resolveReturnedCredits({}, item)).toBe(COMPUTED);
  });

  it("still lets an explicit per-sale value win over the override", () => {
    // The short-transfer case: the operator types what actually came back.
    expect(
      resolveReturnedCredits(
        { returnedCreditsUsd: 73 },
        { ...item, max_returned_credits_usd: OVERRIDE },
      ),
    ).toBe(73);
  });

  it("honours an explicit 0 against an override", () => {
    expect(
      resolveReturnedCredits(
        { returnedCreditsUsd: 0 },
        { ...item, max_returned_credits_usd: OVERRIDE },
      ),
    ).toBe(0);
  });
});

describe("deriveItemEconomics — one number everywhere (owner, 2026-08-30)", () => {
  const base = {
    costLbp: 7_728_000,
    daysCostLbp: 1_159_200,
    creditsUsd: FACE,
  };

  it("reports the bare-card recovery with no override", () => {
    const e = deriveItemEconomics(base);
    expect(e.maxReturnedUsd).toBe(COMPUTED);
    // 6,568,800 / 73
    expect(Math.round(e.recoveredRateLbp as number)).toBe(89_984);
  });

  it("moves Recovered AND the rate when the override is set", () => {
    const e = deriveItemEconomics({
      ...base,
      maxReturnedOverrideUsd: OVERRIDE,
    });
    expect(e.maxReturnedUsd).toBe(OVERRIDE);
    // 6,568,800 / 73.5 — the whole resale table shifts with this.
    expect(Math.round(e.recoveredRateLbp as number)).toBe(89_371);
  });

  it("leaves the credit cost alone — days_cost is face-anchored", () => {
    // The override prices what comes back from a SALE; days_cost_lbp allocates
    // the PURCHASE before any sale exists. Different questions (telecomCredit
    // §4). If this ever changes, the split silently re-allocates every card.
    const withOverride = deriveItemEconomics({
      ...base,
      maxReturnedOverrideUsd: OVERRIDE,
    });
    expect(withOverride.creditCostLbp).toBe(
      deriveItemEconomics(base).creditCostLbp,
    );
    expect(withOverride.creditCostLbp).toBe(6_568_800);
  });

  it("ignores an out-of-range override, matching the resolver", () => {
    const e = deriveItemEconomics({ ...base, maxReturnedOverrideUsd: 83 });
    expect(e.maxReturnedUsd).toBe(COMPUTED);
  });
});
