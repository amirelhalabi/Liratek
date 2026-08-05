/**
 * TELECOM_DAYS_COST_PLAN.md §4.3/§4.4 — fresh-install `days_cost_lbp` seeding.
 *
 * `parseCatalogToSeedData` is the ONLY place a fresh install computes
 * `days_cost_lbp` (existing installs get it from a migration backfill,
 * out of scope here). This guards two things at once:
 *
 * 1. All 43 Only-Days candidates (plan §1) get a positive `days_cost_lbp`,
 *    matching the plan's §4.5 worked values exactly.
 * 2. The mtc Prepaid `1`/`1.67` credit-only cards (plan §1.3 — explicitly
 *    OUT of scope, "nothing to sell as 'days'") do NOT get a `days_cost_lbp`,
 *    even though they carry `credits`. Without this exclusion they would
 *    silently flip `isTelecomSplitComplete` to true and route their sales
 *    through the Only-Days netting path for a card that has no day
 *    component at all — a real money-affecting bug, not a cosmetic one.
 */

// parseCatalogToSeedData imports `deriveDaysCostLbp` from "@liratek/core",
// which (unmocked) pulls in the full core index — including Node-only DB
// modules that don't resolve under jsdom (same issue KatchForm's tests hit).
// Mock just the two symbols needed, sourced from the REAL pure-function file
// (never re-implement the formula in test code — rule 14).
jest.mock("@liratek/core", () => {
  const actual = jest.requireActual(
    "../../../../../../packages/core/src/utils/telecomCredit",
  );
  return {
    deriveDaysCostLbp: actual.deriveDaysCostLbp,
    TELECOM_CREDIT_COST_RATE_LBP: actual.TELECOM_CREDIT_COST_RATE_LBP,
  };
});

import { parseCatalogToSeedData } from "../parseCatalogToSeedData";

function findItem(
  items: ReturnType<typeof parseCatalogToSeedData>,
  provider: string,
  category: string,
  subcategory: string,
  label: string,
) {
  return items.find(
    (i) =>
      i.provider === provider &&
      i.category === category &&
      i.subcategory === subcategory &&
      i.label === label,
  );
}

describe("parseCatalogToSeedData — days_cost_lbp (TELECOM_DAYS_COST_PLAN.md §4)", () => {
  const items = parseCatalogToSeedData();

  it("computes days_cost_lbp for alfa Prepaid combo cards (both credits and validity_days present)", () => {
    // At R = 85,000 (owner-confirmed 2026-08-05, TELECOM_CREDIT_RATE_PLAN.md):
    // iPick alfa 77.28 → 7,728,000 − 77.28 × 85,000 = 1,159,200.
    // validity_days owner-confirmed 2026-08-04 (12 months on the 77.28 card).
    const item = findItem(items, "iPick", "alfa", "Prepaid", "77.28");
    expect(item).toBeDefined();
    expect(item?.credits).toBe(77.28);
    expect(item?.validity_days).toBe(365);
    expect(item?.days_cost_lbp).toBe(1159200);
  });

  it("alfa day counts differ from the mtc card of the same face value", () => {
    // Owner 2026-08-04. Not a typo: alfa 4.5 grants 10 days where mtc 4.5
    // grants 30. Only 15.15 matches mtc (60). Pinned so a future "cleanup"
    // doesn't harmonise them.
    const alfa45 = findItem(items, "Katsh", "alfa", "Prepaid", "4.5");
    const mtc45 = findItem(items, "Katsh", "mtc", "Prepaid", "4.5");
    expect(alfa45?.validity_days).toBe(10);
    expect(mtc45?.validity_days).toBe(30);

    const alfa1515 = findItem(items, "Katsh", "alfa", "Prepaid", "15.15");
    const mtc1515 = findItem(items, "Katsh", "mtc", "Prepaid", "15.15");
    expect(alfa1515?.validity_days).toBe(60);
    expect(mtc1515?.validity_days).toBe(60);
  });

  it("computes days_cost_lbp for mtc Prepaid combo cards (both credits and validity_days present)", () => {
    // At R = 85,000: iPick mtc 3.79 → 56,850, the smallest of the 39
    // Only-Days candidates. (The smallest across ALL 43 credit-bearing items
    // is iPick alfa 1.22 at 36,300, but that card is credit-only and not a
    // candidate — see the exclusion test below.)
    const item = findItem(items, "iPick", "mtc", "Prepaid", "3.79");
    expect(item).toBeDefined();
    expect(item?.credits).toBe(3.79);
    expect(item?.validity_days).toBe(10);
    expect(item?.days_cost_lbp).toBe(56850);

    // At R = 85,000: iPick mtc 4.5 → 67,500.
    const item2 = findItem(items, "iPick", "mtc", "Prepaid", "4.5");
    expect(item2?.days_cost_lbp).toBe(67500);
  });

  it("does NOT compute days_cost_lbp for mtc Prepaid credit-only cards (1, 1.67 — plan §1.3, out of scope)", () => {
    for (const provider of ["iPick", "Katsh", "WHISH_APP"]) {
      for (const label of ["1", "1.67"]) {
        const item = findItem(items, provider, "mtc", "Prepaid", label);
        expect(item).toBeDefined();
        // These DO carry credits (pre-existing, LIRA-090) — the exclusion
        // must key off the missing validity_days, not the missing credits.
        expect(item?.credits).toBeDefined();
        expect(item?.validity_days).toBeUndefined();
        expect(item?.days_cost_lbp).toBeUndefined();
      }
    }
  });

  it("does not compute days_cost_lbp for iPick mtc Credits (direct top-up, no card/days concept)", () => {
    const item = findItem(items, "iPick", "mtc", "Credits", "3$");
    expect(item).toBeDefined();
    expect(item?.credits).toBeUndefined();
    expect(item?.days_cost_lbp).toBeUndefined();
  });

  it("every one of the 39 Only-Days candidates gets a positive days_cost_lbp strictly less than cost_lbp", () => {
    // Owner 2026-08-04: alfa `1.22` and `3.03` have NO confirmed day count, so
    // they are credit-only and OUT of Only-Days (plan §1.3) — the alfa
    // equivalent of mtc `1`/`1.67`. That drops the candidate count 43 -> 39.
    // Their exclusion is pinned by its own test below; do not add them here.
    const alfaFaces = ["4.5", "7.58", "10", "15.15", "22.73", "77.28"];
    const mtcFaces = ["3.79", "4.5", "7.58", "10", "15.15", "22.73", "77.28"];
    const providers = ["iPick", "Katsh", "WHISH_APP"];

    let checked = 0;
    for (const provider of providers) {
      for (const label of alfaFaces) {
        const item = findItem(items, provider, "alfa", "Prepaid", label);
        expect(item).toBeDefined();
        expect(item?.days_cost_lbp).toBeDefined();
        expect(item?.days_cost_lbp as number).toBeGreaterThan(0);
        expect(item?.days_cost_lbp as number).toBeLessThan(
          item?.cost_lbp as number,
        );
        checked++;
      }
      for (const label of mtcFaces) {
        const item = findItem(items, provider, "mtc", "Prepaid", label);
        expect(item).toBeDefined();
        expect(item?.days_cost_lbp).toBeDefined();
        expect(item?.days_cost_lbp as number).toBeGreaterThan(0);
        expect(item?.days_cost_lbp as number).toBeLessThan(
          item?.cost_lbp as number,
        );
        checked++;
      }
    }

    // Plan §1: 18 alfa Prepaid (6 faces x 3 providers) + 21 mtc Prepaid
    // (7 faces x 3 providers) = 39 candidates.
    expect(checked).toBe(39);
  });

  it("alfa 1.22 and 3.03 are credit-only: credits but NO validity_days and NO days_cost_lbp", () => {
    // Pins the owner's 2026-08-04 decision. If someone later gives these two a
    // validity_days, this test fails LOUDLY rather than letting them silently
    // flip isTelecomSplitComplete and start routing sales through the
    // Only-Days credit-return path.
    for (const provider of ["iPick", "Katsh", "WHISH_APP"]) {
      for (const label of ["1.22", "3.03"]) {
        const item = findItem(items, provider, "alfa", "Prepaid", label);
        if (!item) continue; // 1.22 is iPick-only
        expect(item.credits).toBeGreaterThan(0);
        expect(item.validity_days).toBeUndefined();
        expect(item.days_cost_lbp).toBeUndefined();
      }
    }
  });
});

/**
 * Full-catalog scan guards (as opposed to the hardcoded-label checks above).
 * These iterate the ACTUAL parsed output rather than a maintained list of
 * labels, so they keep catching the plan's §4.4 guard even if the catalog
 * grows a new Only-Days candidate later.
 */
describe("parseCatalogToSeedData — days_cost_lbp full-catalog guard (plan §4.4)", () => {
  const items = parseCatalogToSeedData();

  it("every seeded item that carries a days_cost_lbp also carries a positive credits value", () => {
    // The converse — "every item with credits gets a days_cost_lbp" — is
    // FALSE by design: the credit-only cards (mtc 1/1.67, alfa 1.22/3.03)
    // carry credits but are explicitly excluded (see the exclusion tests
    // above and plan §1.3). This is the direction that always holds.
    const withDaysCost = items.filter((i) => i.days_cost_lbp !== undefined);
    for (const item of withDaysCost) {
      expect(item.credits).toBeDefined();
      expect(item.credits as number).toBeGreaterThan(0);
      // Every candidate carries days too — that IS the candidate rule now.
      expect(item.validity_days).toBeDefined();
    }
    // Cross-check against the hardcoded-list count above, derived instead by
    // filtering the real parsed array.
    expect(withDaysCost.length).toBe(39);
  });

  it("days_cost_lbp is always strictly between 0 and cost_lbp for every seeded item (plan §4.4 hard guard)", () => {
    for (const item of items) {
      if (item.days_cost_lbp === undefined) continue;
      expect(item.days_cost_lbp).toBeGreaterThan(0);
      expect(item.days_cost_lbp).toBeLessThan(item.cost_lbp);
    }
  });

  it("items without credits never carry a days_cost_lbp", () => {
    const withoutCredits = items.filter((i) => i.credits === undefined);
    expect(withoutCredits.length).toBeGreaterThan(0); // sanity: not vacuous
    for (const item of withoutCredits) {
      expect(item.days_cost_lbp).toBeUndefined();
    }
  });

  it("spot-check: iPick alfa 77.28 -> 515,200 and iPick mtc 4.5 -> 30,000 (plan §4.5)", () => {
    const alfa7728 = items.find(
      (i) =>
        i.provider === "iPick" &&
        i.category === "alfa" &&
        i.subcategory === "Prepaid" &&
        i.label === "77.28",
    );
    expect(alfa7728?.days_cost_lbp).toBe(1159200);

    const mtc45 = items.find(
      (i) =>
        i.provider === "iPick" &&
        i.category === "mtc" &&
        i.subcategory === "Prepaid" &&
        i.label === "4.5",
    );
    expect(mtc45?.days_cost_lbp).toBe(67500);
  });
});
