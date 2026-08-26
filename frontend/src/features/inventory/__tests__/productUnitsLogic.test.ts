/**
 * LIRA-143 Phase 6b — pure logic for the inventory Units/IMEIs UI: the
 * intake-vs-stock_quantity drift predicate (owner decision #6, warn-never-
 * block) and the walk-in-lookup heuristic (decision #7). Same pattern as
 * features/audit/cashFlow.test.ts. (The scan-friendly batch parser that used
 * to live here, `parseImeiBatch`, was removed in the owner-requested UI
 * rework that replaced the multi-line textarea with `ImeiAddRow`'s one-
 * IMEI-at-a-time input.)
 */
import {
  UNIT_DELETE_IMEI_PREVIEW_MAX,
  buildUnitDeleteWarning,
  computeUnitDrift,
  looksLikeImei,
  warrantyBadgeInfo,
  warrantyDisplayBadge,
  warrantyStoryBadge,
  type WarrantyStatus,
} from "../productUnitsLogic";

describe("computeUnitDrift", () => {
  it("matches when in-stock count equals stock_quantity", () => {
    expect(computeUnitDrift(5, 5)).toEqual({ matches: true, delta: 0 });
  });

  it("flags a positive drift — more units registered than stock says", () => {
    expect(computeUnitDrift(7, 5)).toEqual({ matches: false, delta: 2 });
  });

  it("flags a negative drift — fewer units registered than stock says", () => {
    expect(computeUnitDrift(3, 5)).toEqual({ matches: false, delta: -2 });
  });

  it("matches at zero/zero (nothing registered yet, no stock either)", () => {
    expect(computeUnitDrift(0, 0)).toEqual({ matches: true, delta: 0 });
  });

  it("never blocks — it only reports a boolean/delta, no throw, no error field", () => {
    const result = computeUnitDrift(100, 1);
    expect(result.matches).toBe(false);
    expect(() => computeUnitDrift(100, 1)).not.toThrow();
  });
});

/**
 * The display fix for the owner's 2026-08-26 report: a 6-month model's fresh
 * stock read "No warranty" because the warranty clock only starts at the sale
 * (decision #4), so `computeWarrantyStatus` returns `NONE` for every unsold
 * unit. `warrantyDisplayBadge` (the Phone Units TABLE cell) re-labels exactly
 * two verdict/status pairs — `NONE` + `IN_STOCK` and, per the owner decision
 * of 2026-08-27, `VOID` + `IN_STOCK` — and defers to `warrantyBadgeInfo` for
 * everything else. The cases below are the fence.
 */
describe("warrantyDisplayBadge — the Phone Units TABLE (forward-looking)", () => {
  const NONE: WarrantyStatus = { source: null, until: null, state: "NONE" };

  it("NONE + IN_STOCK + a model term -> the term, informative (not the emerald of real coverage)", () => {
    const badge = warrantyDisplayBadge({
      warranty: NONE,
      status: "IN_STOCK",
      productWarrantyMonths: 6,
    });
    expect(badge.label).toBe("6 mo — starts at sale");
    expect(badge.className).toMatch(/sky/);
    expect(badge.className).not.toMatch(/emerald/);
  });

  it("carries the model's own number, whatever it is", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 12,
      }).label,
    ).toBe("12 mo — starts at sale");
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 1,
      }).label,
    ).toBe("1 mo — starts at sale");
  });

  it("NONE + IN_STOCK + no model term -> No warranty, unchanged", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: null,
      }),
    ).toEqual(warrantyBadgeInfo(NONE));
  });

  it("treats a 0-month term as no term (the form's min is 0)", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 0,
      }).label,
    ).toBe("No warranty");
  });

  it("NEVER applies the term to a SOLD unit — decision #4 forbids retro-stamping", () => {
    // Sold before the model had a term: its sale line stamped nothing, so the
    // honest badge is still "No warranty".
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "SOLD",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("No warranty");
  });

  it("VOID + IN_STOCK + a model term -> the forward-looking term, not 'Void (refunded)'", () => {
    const badge = warrantyDisplayBadge({
      warranty: { source: "REFUND", until: null, state: "VOID" },
      status: "IN_STOCK",
      productWarrantyMonths: 6,
    });
    expect(badge.label).toBe("6 mo — starts at sale");
    expect(badge.className).toMatch(/sky/);
  });

  it("VOID + IN_STOCK + NO model term -> Void (refunded), unchanged", () => {
    const voided: WarrantyStatus = {
      source: "REFUND",
      until: null,
      state: "VOID",
    };
    expect(
      warrantyDisplayBadge({
        warranty: voided,
        status: "IN_STOCK",
        productWarrantyMonths: null,
      }),
    ).toEqual(warrantyBadgeInfo(voided));
    expect(
      warrantyDisplayBadge({
        warranty: voided,
        status: "IN_STOCK",
        productWarrantyMonths: 0,
      }).label,
    ).toBe("Void (refunded)");
  });

  it("NEVER applies the term to a SOLD VOID unit — the refunded sale keeps its verdict", () => {
    expect(
      warrantyDisplayBadge({
        warranty: { source: "REFUND", until: null, state: "VOID" },
        status: "SOLD",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("Void (refunded)");
  });

  it("an operator OVERRIDE on an in-stock unit outranks the model's term", () => {
    // COVERED/EXPIRED can only reach an IN_STOCK unit via
    // `warranty_override_until` — a deliberate statement about THIS unit.
    expect(
      warrantyDisplayBadge({
        warranty: { source: "OVERRIDE", until: "2027-03-01", state: "COVERED" },
        status: "IN_STOCK",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("Covered (until 2027-03-01)");
    expect(
      warrantyDisplayBadge({
        warranty: { source: "OVERRIDE", until: "2025-01-01", state: "EXPIRED" },
        status: "IN_STOCK",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("Expired (2025-01-01)");
  });

  it("leaves every real verdict exactly as warrantyBadgeInfo renders it, term or not", () => {
    const verdicts: WarrantyStatus[] = [
      { source: "SALE", until: "2027-01-15", state: "COVERED" },
      { source: "SALE", until: "2025-06-01", state: "EXPIRED" },
      { source: "REFUND", until: null, state: "VOID" },
      { source: "OVERRIDE", until: "2027-03-01", state: "COVERED" },
    ];
    for (const warranty of verdicts) {
      for (const status of ["IN_STOCK", "SOLD"] as const) {
        // VOID + IN_STOCK is the one pair the TABLE re-labels (see the test
        // above); every other verdict/status pair defers verbatim.
        if (warranty.state === "VOID" && status === "IN_STOCK") continue;
        expect(
          warrantyDisplayBadge({
            warranty,
            status,
            productWarrantyMonths: 6,
          }),
        ).toEqual(warrantyBadgeInfo(warranty));
      }
    }
  });
});

/**
 * The other half of the 2026-08-27 split: `ImeiStoryCard` is this unit's
 * provenance, so it keeps the TRUE (backward-looking) verdict — "Void
 * (refunded)" is the fact the card exists to report. The two mappings diverge
 * in exactly ONE verdict/status pair, and these tests pin both halves of that
 * claim so a future edit cannot quietly re-merge them.
 */
describe("warrantyStoryBadge — the ImeiStoryCard (backward-looking)", () => {
  const VOID: WarrantyStatus = { source: "REFUND", until: null, state: "VOID" };
  const NONE: WarrantyStatus = { source: null, until: null, state: "NONE" };

  it("VOID stays VOID on an in-stock unit, even when the model grants a term", () => {
    expect(
      warrantyStoryBadge({
        warranty: VOID,
        status: "IN_STOCK",
        productWarrantyMonths: 6,
      }),
    ).toEqual(warrantyBadgeInfo(VOID));
  });

  it("still shows the term for a never-sold unit of a model that grants one", () => {
    expect(
      warrantyStoryBadge({
        warranty: NONE,
        status: "IN_STOCK",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("6 mo — starts at sale");
  });

  it("never applies the term to a SOLD unit", () => {
    expect(
      warrantyStoryBadge({
        warranty: NONE,
        status: "SOLD",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("No warranty");
  });

  it("diverges from the table mapping in EXACTLY one verdict/status pair", () => {
    const verdicts: WarrantyStatus[] = [
      NONE,
      VOID,
      { source: "SALE", until: "2027-01-15", state: "COVERED" },
      { source: "SALE", until: "2025-06-01", state: "EXPIRED" },
      { source: "OVERRIDE", until: "2027-03-01", state: "COVERED" },
    ];
    const divergent: string[] = [];
    for (const warranty of verdicts) {
      for (const status of ["IN_STOCK", "SOLD"] as const) {
        for (const productWarrantyMonths of [null, 0, 6]) {
          const input = { warranty, status, productWarrantyMonths };
          const table = warrantyDisplayBadge(input);
          const story = warrantyStoryBadge(input);
          if (table.label !== story.label) {
            divergent.push(
              `${warranty.state}/${status}/${String(productWarrantyMonths)}`,
            );
          }
        }
      }
    }
    expect(divergent).toEqual(["VOID/IN_STOCK/6"]);
  });
});

/**
 * Owner item #7 — the product-delete confirm must DISCLOSE the in-stock IMEIs
 * the cascade will remove, and must leave a unit-free product's dialog exactly
 * as it was. It only informs; it never blocks (the delete call is unchanged).
 */
describe("buildUnitDeleteWarning", () => {
  it("returns null when nothing is registered — today's confirm stays unchanged", () => {
    expect(buildUnitDeleteWarning([{ name: "Milk 1L", imeis: [] }])).toBeNull();
    expect(buildUnitDeleteWarning([])).toBeNull();
  });

  it("single product: names the count and lists the IMEIs", () => {
    expect(
      buildUnitDeleteWarning([
        {
          name: "iPhone 15 Pro",
          imeis: ["111111111111111", "222222222222222", "333333333333333"],
        },
      ]),
    ).toBe(
      "Deleting this product also removes 3 registered in-stock IMEIs: " +
        "111111111111111, 222222222222222, 333333333333333",
    );
  });

  it("singularises a lone IMEI", () => {
    expect(
      buildUnitDeleteWarning([{ name: "iPhone", imeis: ["111111111111111"] }]),
    ).toBe(
      "Deleting this product also removes 1 registered in-stock IMEI: 111111111111111",
    );
  });

  it("batch: totals across products and lists each product's own IMEIs", () => {
    const message = buildUnitDeleteWarning([
      { name: "iPhone 15 Pro", imeis: ["111111111111111", "222222222222222"] },
      { name: "Milk 1L", imeis: [] },
      { name: "Galaxy S24", imeis: ["333333333333333"] },
    ]);
    expect(message).toBe(
      [
        "Deleting these products also removes 3 registered in-stock IMEIs across 2 products:",
        "• iPhone 15 Pro (2): 111111111111111, 222222222222222",
        "• Galaxy S24 (1): 333333333333333",
      ].join("\n"),
    );
    // The unit-free product is never listed as a bullet.
    expect(message).not.toContain("Milk 1L");
  });

  it("batch with no units anywhere -> null (plain batch confirm)", () => {
    expect(
      buildUnitDeleteWarning([
        { name: "Milk 1L", imeis: [] },
        { name: "Bread", imeis: [] },
      ]),
    ).toBeNull();
  });

  it("truncates a long IMEI list instead of producing a scrolling dialog", () => {
    const imeis = Array.from(
      { length: UNIT_DELETE_IMEI_PREVIEW_MAX + 5 },
      (_, i) => `35693803564${String(i).padStart(4, "0")}`,
    );
    const message = buildUnitDeleteWarning([{ name: "iPhone", imeis }])!;
    expect(message).toContain(`${imeis.length} registered in-stock IMEIs`);
    expect(message).toContain("… and 5 more");
    expect(message).toContain(imeis[UNIT_DELETE_IMEI_PREVIEW_MAX - 1]!);
    expect(message).not.toContain(imeis[UNIT_DELETE_IMEI_PREVIEW_MAX]!);
  });

  it("falls back to a label for an unnamed product in the batch list", () => {
    expect(
      buildUnitDeleteWarning([
        { name: "  ", imeis: ["111111111111111"] },
        { name: "Galaxy", imeis: ["222222222222222"] },
      ]),
    ).toContain("• Unnamed product (1): 111111111111111");
  });

  it("a FAILED unit check is disclosed, never reported as 'no units'", () => {
    // The destructive-dialog trap: a probe that threw must not read as zero.
    expect(buildUnitDeleteWarning([{ name: "iPhone", imeis: [] }], true)).toBe(
      "Some products could not be checked for registered IMEIs — any that exist will be removed too.",
    );
    const partial = buildUnitDeleteWarning(
      [
        { name: "iPhone", imeis: ["111111111111111"] },
        { name: "Galaxy", imeis: [] },
      ],
      true,
    )!;
    expect(partial).toContain("1 registered in-stock IMEI");
    expect(partial).toContain("could not be checked");
  });
});

describe("looksLikeImei", () => {
  it("matches a full 15-digit IMEI", () => {
    expect(looksLikeImei("356938035643809")).toBe(true);
  });

  it("matches a shorter digits-only token (>= 6 chars, permissive per the ticket)", () => {
    expect(looksLikeImei("123456")).toBe(true);
  });

  it("rejects a token shorter than 6 digits", () => {
    expect(looksLikeImei("12345")).toBe(false);
  });

  it("rejects a token with any non-digit characters", () => {
    expect(looksLikeImei("12345a")).toBe(false);
    expect(looksLikeImei("iPhone 13")).toBe(false);
    expect(looksLikeImei("LT-0825-12345")).toBe(false);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(looksLikeImei("  356938035643809  ")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(looksLikeImei("")).toBe(false);
    expect(looksLikeImei("   ")).toBe(false);
  });
});
