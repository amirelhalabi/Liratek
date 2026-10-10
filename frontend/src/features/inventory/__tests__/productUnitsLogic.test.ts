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
 * LIRA-296 follow-up (owner decision 2026-10-10) — ONE mapping for both the
 * Phone Units table and the unit story card. A unit on the shelf has no
 * warranty yet (it starts at the sale, chosen at the till), so EVERY in-stock
 * unit reads "Not sold" — whatever its stored verdict, including an old
 * refund-time override date (COVERED/EXPIRED) or a refunded sale's VOID.
 * When the model grants a term, the badge still says what the next sale will
 * carry (the owner's 2026-08-26 report), as secondary text. A SOLD unit keeps
 * its real verdict, and a model's term never leaks onto it (decision #4).
 *
 * Supersedes the 2026-08-26/27 mappings ("6 mo — starts at sale" for unsold
 * stock, an override outranking it, the story card keeping "Void (refunded)").
 */
describe("warrantyDisplayBadge — Phone Units table and story card", () => {
  const NONE: WarrantyStatus = { source: null, until: null, state: "NONE" };
  const VOID: WarrantyStatus = { source: "REFUND", until: null, state: "VOID" };
  const OVERRIDE_COVERED: WarrantyStatus = {
    source: "OVERRIDE",
    until: "2027-03-01",
    state: "COVERED",
  };
  const OVERRIDE_EXPIRED: WarrantyStatus = {
    source: "OVERRIDE",
    until: "2025-03-01",
    state: "EXPIRED",
  };

  it.each([NONE, VOID, OVERRIDE_COVERED, OVERRIDE_EXPIRED])(
    "an in-stock unit with no model term reads Not sold (verdict %o)",
    (warranty) => {
      for (const productWarrantyMonths of [null, 0]) {
        expect(
          warrantyDisplayBadge({
            warranty,
            status: "IN_STOCK",
            productWarrantyMonths,
          }).label,
        ).toBe("Not sold");
      }
    },
  );

  it.each([NONE, VOID, OVERRIDE_COVERED, OVERRIDE_EXPIRED])(
    "an in-stock unit of a model with a term reads Not sold plus the term (verdict %o)",
    (warranty) => {
      expect(
        warrantyDisplayBadge({
          warranty,
          status: "IN_STOCK",
          productWarrantyMonths: 6,
        }).label,
      ).toBe("Not sold (6 mo from sale)");
    },
  );

  it("the Not sold badge is never the emerald of real coverage", () => {
    const badge = warrantyDisplayBadge({
      warranty: OVERRIDE_COVERED,
      status: "IN_STOCK",
      productWarrantyMonths: 6,
    });
    expect(badge.className).not.toContain("emerald");
  });

  it("a SOLD unit keeps its verdict exactly as warrantyBadgeInfo renders it, term or not", () => {
    const verdicts: WarrantyStatus[] = [
      NONE,
      VOID,
      { source: "SALE", until: "2027-01-15", state: "COVERED" },
      { source: "SALE", until: "2025-06-01", state: "EXPIRED" },
      OVERRIDE_COVERED,
    ];
    for (const warranty of verdicts) {
      for (const productWarrantyMonths of [null, 0, 6]) {
        expect(
          warrantyDisplayBadge({
            warranty,
            status: "SOLD",
            productWarrantyMonths,
          }),
        ).toEqual(warrantyBadgeInfo(warranty));
      }
    }
  });

  it("NEVER applies the term to a SOLD unit — decision #4 forbids retro-stamping", () => {
    expect(
      warrantyDisplayBadge({
        warranty: NONE,
        status: "SOLD",
        productWarrantyMonths: 6,
      }).label,
    ).toBe("No warranty");
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
