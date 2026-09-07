/**
 * `seedMaxReturnedCreditsUsd` — the fresh-install source for the per-card
 * max-returned override.
 *
 * **The bug this exists for.** v160 backfills the override with an
 * `UPDATE ... WHERE credits = 77.28`. On a fresh database that runs against an
 * EMPTY `mobile_service_items` table: migrations execute at startup, but the
 * catalog is seeded later by `MobileServiceItemsContext`, which is gated on
 * `isAuthenticated` and only fires once someone logs in. The update matched
 * nothing, the catalog then seeded with NULL, and no card on any new install
 * ever carried an override — the whole feature inert, with the column sitting
 * right there looking correct. Found on a real install: column present,
 * `max_returned_credits_usd IS NOT NULL` on **0 of 411** rows, v160 recorded as
 * applied.
 *
 * `sell_days_lbp` never had this problem because `parseCatalogToSeedData`
 * computes it at seed time; its migration is a backstop, not the source. These
 * tests pin the same arrangement for the override.
 *
 * Rule 17 — this file fails on the pre-fix code trivially:
 * `seedMaxReturnedCreditsUsd` did not exist, so every test errors at import.
 * The meaningful failing-first evidence is the sibling seeder test
 * (`parseCatalogToSeedData.test.ts`), which asserts the field reaches the
 * seeded row and fails with `undefined` before the seeder was wired.
 */

import {
  SEEDED_MAX_RETURNED_OVERRIDES,
  isValidMaxReturnedOverride,
  maxReturnableCredits,
  seedMaxReturnedCreditsUsd,
} from "../telecomCredit.js";

describe("SEEDED_MAX_RETURNED_OVERRIDES", () => {
  it("is a narrow, verified list — not every card that could gain half a dollar", () => {
    // Every catalog card sits within one transfer step of another half-dollar,
    // so a formula would cover all twelve. The owner scoped this to the one
    // card with counter experience; widening it here silently changes what the
    // shop books on cards nobody has checked at the till.
    expect(SEEDED_MAX_RETURNED_OVERRIDES).toHaveLength(1);
    expect(SEEDED_MAX_RETURNED_OVERRIDES[0]).toEqual({
      creditsUsd: 77.28,
      validityDays: 365,
      maxReturnedUsd: 73.5,
    });
  });

  it("only holds values the write guard would accept", () => {
    // A seeded row must be editable in Settings without the operator first
    // having to clear an invalid number they never typed.
    for (const o of SEEDED_MAX_RETURNED_OVERRIDES) {
      expect(isValidMaxReturnedOverride(o.maxReturnedUsd, o.creditsUsd)).toBe(
        true,
      );
    }
  });

  it("only holds values ABOVE the bare-card computation — else it is a no-op", () => {
    for (const o of SEEDED_MAX_RETURNED_OVERRIDES) {
      expect(o.maxReturnedUsd).toBeGreaterThan(
        maxReturnableCredits(o.creditsUsd),
      );
    }
  });
});

describe("seedMaxReturnedCreditsUsd", () => {
  it("gives the 77.28 / 365-day card its 73.5", () => {
    expect(seedMaxReturnedCreditsUsd(77.28, 365)).toBe(73.5);
  });

  it("gives every other card null — they compute bare until verified", () => {
    // All of these WOULD gain half a dollar from a small customer balance.
    // None is on the verified list, so none may be seeded.
    expect(seedMaxReturnedCreditsUsd(22.73, 90)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(15.15, 60)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(10, 30)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(3.79, 10)).toBeNull();
  });

  it("matches on the CARD, so the same face value at another duration is null", () => {
    expect(seedMaxReturnedCreditsUsd(77.28, 30)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(77.28, null)).toBeNull();
  });

  it("matches on the card, so a different face value at 365 days is null", () => {
    expect(seedMaxReturnedCreditsUsd(50, 365)).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(seedMaxReturnedCreditsUsd(null, 365)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(undefined, undefined)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(NaN, 365)).toBeNull();
    expect(seedMaxReturnedCreditsUsd(77.28, NaN)).toBeNull();
  });

  it("is provider-agnostic — the same card sits on six shelves", () => {
    // iPick / Katsh / WHISH_APP x alfa / mtc all carry 77.28. Recovery is a
    // property of the card, not of who sells it, so one call covers all six.
    expect(seedMaxReturnedCreditsUsd(77.28, 365)).toBe(73.5);
  });
});
