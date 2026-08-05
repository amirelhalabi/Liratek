/**
 * LIRA-072 follow-up — iPick mtc groups renamed to CARD FACE VALUE.
 *
 * Owner decision 2026-07-03 (A1): Katsh/WHISH_APP mtc+alfa Prepaid items were
 * renamed from their USD-sell-price label (e.g. "8.65") to the value printed
 * on the physical card (e.g. "7.58") — see migrations v117/v118. iPick's mtc
 * Prepaid group was not touched in that pass and kept verbose labels like
 * "10 days 3.79$" / "credit only 1$", which — cross-checked against
 * Katsh/WHISH_APP's already-confirmed face values — already embed the SAME
 * real face value inside the descriptive text. This 2026-07-19 follow-up
 * strips the day-count/"credit only" descriptor, leaving the bare face value
 * (matching the Katsh/WHISH_APP convention). Costs/sells are untouched.
 *
 * iPick mtc Credits and Validity are intentionally LEFT UNCHANGED — see
 * the dated comments at their definitions in mobileServices.ts. This test
 * pins them too, so a future "finish the job" edit doesn't rename them
 * without an owner decision.
 */

import mobileServices from "@/data/mobileServices";
import type { ItemPricing } from "@/data/mobileServices";

function prepaid(): Record<string, ItemPricing> {
  const catalog = mobileServices.iPick as Record<
    string,
    Record<string, Record<string, ItemPricing>>
  >;
  return catalog.mtc.Prepaid;
}

function credits(): Record<string, ItemPricing> {
  const catalog = mobileServices.iPick as Record<
    string,
    Record<string, Record<string, ItemPricing>>
  >;
  return catalog.mtc.Credits;
}

function validity(): Record<string, ItemPricing> {
  const catalog = mobileServices.iPick as Record<
    string,
    Record<string, Record<string, ItemPricing>>
  >;
  return catalog.mtc.Validity;
}

describe("mobileServices — iPick mtc Prepaid (LIRA-072 A1 follow-up)", () => {
  it("is named by card face value, not the verbose day/credit descriptor", () => {
    const items = prepaid();

    // LIRA W6.b: the OLD verbose labels encoded validity/credit information
    // ("10 days 3.79$" -> 10-day validity, "credit only 1$" -> $1 credit)
    // that the card-face-value rename above strips. validity_days/credits
    // preserve that information in structured form (same values migration
    // v135 backfills for upgraded shops from the same old labels).
    //
    // TELECOM_DAYS_COST_PLAN.md §1.2/§6 step 2: `credits` (= the label's face
    // value) was added alongside `validity_days` on these 7 cards — the two
    // fields are independent, not mutually exclusive (see ItemPricing), and
    // an Only-Days candidate needs both set on the same item.
    const RENAMED: Record<string, ItemPricing> = {
      "1": { cost: "120000", sell: "150000", credits: 1 },
      "1.67": { cost: "186000", sell: "220000", credits: 1.67 },
      "3.79": {
        cost: "379000",
        sell: "430000",
        validity_days: 10,
        credits: 3.79,
      },
      "4.5": {
        cost: "450000",
        sell: "520000",
        validity_days: 30,
        credits: 4.5,
      },
      "7.58": {
        cost: "758000",
        sell: "850000",
        validity_days: 30,
        credits: 7.58,
      },
      "10": {
        cost: "1000000",
        sell: "1100000",
        validity_days: 30,
        credits: 10,
      },
      "15.15": {
        cost: "1526000",
        sell: "1650000",
        validity_days: 60,
        credits: 15.15,
      },
      "22.73": {
        cost: "2273000",
        sell: "2450000",
        validity_days: 90,
        credits: 22.73,
      },
      "77.28": {
        cost: "7728000",
        sell: "8200000",
        validity_days: 365,
        credits: 77.28,
      },
      start: { cost: "450000", sell: "520000" },
    };

    // Exact key set — no extra, no missing.
    expect(Object.keys(items).sort()).toEqual(Object.keys(RENAMED).sort());

    // cost/sell are byte-identical to the pre-rename values (rule: "costs
    // /sells unchanged" — only the label/key changes).
    for (const [label, pricing] of Object.entries(RENAMED)) {
      expect(items[label]).toEqual(pricing);
    }
  });

  it("no longer carries the old verbose day-count / credit-descriptor labels", () => {
    const items = prepaid();
    const OLD_LABELS = [
      "credit only 1$",
      "credit only 1.67$",
      "10 days 3.79$",
      "30 days 4.5$",
      "30 days 7.58$",
      "30 days 10$",
      "60 days 15.15$",
      "90 days 22.73$",
      "365 days 77.28$",
      "start 4.5$",
    ];
    for (const old of OLD_LABELS) {
      // Array form — `toHaveProperty` otherwise parses a dotted string like
      // "10 days 3.79$" as a nested keypath instead of one literal key.
      expect(items).not.toHaveProperty([old]);
    }
  });

  it("matches the face values already confirmed for Katsh/WHISH_APP mtc Prepaid", () => {
    // Cross-check against the values migrations v117/v118 renamed Katsh/
    // WHISH_APP rows TO (packages/core/src/db/migrations/index.ts).
    const CONFIRMED_FACE_VALUES = [
      "1",
      "1.67",
      "3.79",
      "4.5",
      "7.58",
      "10",
      "15.15",
      "22.73",
      "77.28",
    ];
    const items = prepaid();
    for (const face of CONFIRMED_FACE_VALUES) {
      // Array form for the same reason ("1.67", "3.79" contain dots).
      expect(items).toHaveProperty([face]);
    }
  });
});

describe("mobileServices — iPick mtc Credits / Validity (left unchanged, needs-owner-confirmation)", () => {
  it("Credits keeps its original dollar-amount labels (no card-face-value precedent exists for this category)", () => {
    const items = credits();
    expect(Object.keys(items).sort()).toEqual(
      ["3$", "6$", "9$", "12$", "15$"].sort(),
    );
    expect(items["3$"]).toEqual({ cost: "280000", sell: "150000" });
    expect(items["15$"]).toEqual({ cost: "1400000", sell: "750000" });
  });

  it("Validity keeps its original day-count labels (matches the untouched 'Validity vouchers' precedent)", () => {
    const items = validity();
    expect(Object.keys(items).sort()).toEqual(
      [
        "10 days",
        "30 days",
        "60 days",
        "90 days",
        "180 days",
        "360 days",
      ].sort(),
    );
    expect(items["10 days"]).toEqual({ cost: "65000", sell: "100000" });
  });
});

/**
 * TELECOM_DAYS_COST_PLAN.md §1/§3.2 — the Only-Days `credits` seed guard.
 *
 * Retires-the-invariant guard: §3.2 removed the old "credits and
 * validity_days are mutually exclusive" doc claim from `ItemPricing`. These
 * tests are what stop someone "restoring" that invariant by pinning the exact
 * shape of the real data: alfa Prepaid cards carry credits alone (their
 * validity_days is a separate, not-yet-seeded step — plan §7b), mtc Prepaid's
 * combo cards (3.79 through 77.28) carry BOTH, and mtc's credit-only 1/1.67
 * cards deliberately carry credits WITHOUT validity_days (plan §1.3 — they
 * are explicitly out of the Only-Days split, not a bug to "fix" by adding
 * validity_days to them).
 */

interface CreditsLeaf {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  credits: number;
}

/**
 * Walks the whole catalog (same two-level shape parseCatalogToSeedData.ts
 * traverses: provider -> category -> subcategory -> items, with one optional
 * extra nesting level for grouped categories like "Alfa Go") and collects
 * every leaf item that carries a numeric `credits` field. Used to prove
 * "credits only lives in alfa/mtc Prepaid" and the exact total count without
 * hand-listing every category in the catalog.
 */
function collectCreditsLeaves(): CreditsLeaf[] {
  const leaves: CreditsLeaf[] = [];

  for (const [provider, catalog] of Object.entries(mobileServices)) {
    if (
      Array.isArray(catalog) ||
      typeof catalog !== "object" ||
      catalog === null
    ) {
      continue;
    }
    for (const [category, subcats] of Object.entries(
      catalog as Record<string, unknown>,
    )) {
      if (
        Array.isArray(subcats) ||
        typeof subcats !== "object" ||
        subcats === null
      ) {
        continue;
      }
      for (const [subcategory, itemsOrGroups] of Object.entries(
        subcats as Record<string, unknown>,
      )) {
        if (
          Array.isArray(itemsOrGroups) ||
          typeof itemsOrGroups !== "object" ||
          itemsOrGroups === null
        ) {
          continue;
        }
        for (const [label, value] of Object.entries(
          itemsOrGroups as Record<string, unknown>,
        )) {
          if (typeof value !== "object" || value === null) continue;
          const obj = value as Record<string, unknown>;

          if ("cost" in obj) {
            if (typeof obj.credits === "number") {
              leaves.push({
                provider,
                category,
                subcategory,
                label,
                credits: obj.credits,
              });
            }
          } else {
            // One level deeper — grouped categories (e.g. iPick > alfa >
            // "Alfa Go" > items). None of these carry `credits` today, but
            // walk them anyway so the count is derived, not assumed.
            for (const [deepLabel, deepValue] of Object.entries(obj)) {
              if (typeof deepValue !== "object" || deepValue === null) continue;
              const deepObj = deepValue as Record<string, unknown>;
              if ("cost" in deepObj && typeof deepObj.credits === "number") {
                leaves.push({
                  provider,
                  category,
                  subcategory: `${subcategory} / ${label}`,
                  label: deepLabel,
                  credits: deepObj.credits,
                });
              }
            }
          }
        }
      }
    }
  }

  return leaves;
}

describe("mobileServices — Only-Days credits seed (TELECOM_DAYS_COST_PLAN.md §1/§3.2)", () => {
  it("every alfa Prepaid item across iPick/Katsh/WHISH_APP has credits equal to its numeric label", () => {
    const providers = ["iPick", "Katsh", "WHISH_APP"] as const;
    let checked = 0;
    for (const provider of providers) {
      const catalog = mobileServices[provider] as Record<
        string,
        Record<string, Record<string, ItemPricing>>
      >;
      const alfaPrepaid = catalog.alfa.Prepaid;
      for (const [label, pricing] of Object.entries(alfaPrepaid)) {
        expect(pricing.credits).toBe(Number(label));
        checked++;
      }
    }
    // Plan §1.1: 8 on iPick (incl. the iPick-only "1.22") + 7 on Katsh + 7 on
    // WHISH_APP = 22.
    expect(checked).toBe(22);
  });

  it("every mtc Prepaid combo card (the 7 face values that bundle validity days) carries BOTH credits and validity_days", () => {
    // Scoped to plan §1.2's 21 combo items — 3.79 through 77.28 across the 3
    // providers. Deliberately excludes "1"/"1.67": those carry credits but
    // are explicitly OUT of the Only-Days split (plan §1.3 — "credit-only, no
    // validity days, nothing to sell as days"). A blanket "every numeric mtc
    // item has both" assertion is FALSE against the real catalog for those
    // two labels; asserting it anyway (and "fixing" the data to match) would
    // silently route their sales through the Only-Days netting path for a
    // card with no day component — see the dedicated test below and
    // parseCatalogToSeedData.test.ts's exclusion test for the money-affecting
    // consequence this scoping guards against.
    const providers = ["iPick", "Katsh", "WHISH_APP"] as const;
    const comboFaces = ["3.79", "4.5", "7.58", "10", "15.15", "22.73", "77.28"];
    let checked = 0;
    for (const provider of providers) {
      const catalog = mobileServices[provider] as Record<
        string,
        Record<string, Record<string, ItemPricing>>
      >;
      const mtcPrepaid = catalog.mtc.Prepaid;
      for (const face of comboFaces) {
        const item = mtcPrepaid[face];
        expect(item).toBeDefined();
        expect(item.credits).toBe(Number(face));
        expect(item.validity_days).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBe(21); // plan §1.2: 7 faces x 3 providers
  });

  it("mtc Prepaid credit-only cards (1, 1.67) carry credits but NOT validity_days — they stay out of the combo set", () => {
    const providers = ["iPick", "Katsh", "WHISH_APP"] as const;
    let checked = 0;
    for (const provider of providers) {
      const catalog = mobileServices[provider] as Record<
        string,
        Record<string, Record<string, ItemPricing>>
      >;
      const mtcPrepaid = catalog.mtc.Prepaid;
      for (const label of ["1", "1.67"]) {
        const item = mtcPrepaid[label];
        expect(item).toBeDefined();
        expect(item.credits).toBe(Number(label));
        expect(item.validity_days).toBeUndefined();
        checked++;
      }
    }
    expect(checked).toBe(6); // 2 labels x 3 providers
  });

  it("named mtc plans without a face value ('start'/'startSOS'/'smart'/'super') carry no credits", () => {
    const NAMED_PLANS = ["start", "startSOS", "smart", "super"];
    const providers = ["iPick", "Katsh", "WHISH_APP"] as const;
    let checked = 0;
    for (const provider of providers) {
      const catalog = mobileServices[provider] as Record<
        string,
        Record<string, Record<string, ItemPricing>>
      >;
      const mtcPrepaid = catalog.mtc.Prepaid;
      for (const plan of NAMED_PLANS) {
        if (!(plan in mtcPrepaid)) continue; // iPick only carries 'start'
        expect(mtcPrepaid[plan].credits).toBeUndefined();
        checked++;
      }
    }
    // iPick: 'start' only (1). Katsh + WHISH_APP: all 4 each (4 + 4).
    expect(checked).toBe(9);
  });

  it("no item outside the alfa/mtc Prepaid subcategories carries a credits field", () => {
    const leaves = collectCreditsLeaves();
    expect(leaves.length).toBeGreaterThan(0); // sanity: the walk isn't vacuous
    for (const leaf of leaves) {
      expect(["alfa", "mtc"]).toContain(leaf.category);
      expect(leaf.subcategory).toBe("Prepaid");
    }
  });

  it("exactly 49 items in the whole catalog carry a credits field (22 alfa + 21 mtc combo + 6 pre-existing mtc 1/1.67)", () => {
    const leaves = collectCreditsLeaves();
    expect(leaves.length).toBe(49);
  });
});
