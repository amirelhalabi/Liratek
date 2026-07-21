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
    const RENAMED: Record<string, ItemPricing> = {
      "1": { cost: "120000", sell: "150000", credits: 1 },
      "1.67": { cost: "186000", sell: "220000", credits: 1.67 },
      "3.79": { cost: "379000", sell: "430000", validity_days: 10 },
      "4.5": { cost: "450000", sell: "520000", validity_days: 30 },
      "7.58": { cost: "758000", sell: "850000", validity_days: 30 },
      "10": { cost: "1000000", sell: "1100000", validity_days: 30 },
      "15.15": { cost: "1526000", sell: "1650000", validity_days: 60 },
      "22.73": { cost: "2273000", sell: "2450000", validity_days: 90 },
      "77.28": { cost: "7728000", sell: "8200000", validity_days: 365 },
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
