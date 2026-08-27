/**
 * Product-list filter payload builder.
 *
 * The load-bearing rule under test is OMISSION: a blank input must leave the
 * field ABSENT from the payload, never `0` / `""`. Both transports depend on
 * it — REST rejects an empty param value (`?costMin=`) outright, and a `0`
 * that meant "blank" would silently become a real lower bound and hide rows.
 */
import {
  EMPTY_PRODUCT_FILTERS,
  activeFilterChips,
  buildProductListFilters,
  clearFilterGroup,
  clearNumericFilters,
  countNumericFilters,
  type ProductFiltersUiState,
} from "../productListFilters";

const ui = (patch: Partial<ProductFiltersUiState>): ProductFiltersUiState => ({
  ...EMPTY_PRODUCT_FILTERS,
  ...patch,
});

describe("buildProductListFilters — omission", () => {
  it("returns undefined when nothing is set", () => {
    expect(buildProductListFilters(EMPTY_PRODUCT_FILTERS)).toBeUndefined();
  });

  it("omits blank number inputs entirely — never coerces them to 0", () => {
    const payload = buildProductListFilters(ui({ costMin: "5" }));
    expect(payload).toEqual({ costMin: 5 });
    expect(payload).not.toHaveProperty("costMax");
    expect(payload).not.toHaveProperty("retailMin");
    expect(payload).not.toHaveProperty("stockMin");
  });

  it("keeps an explicit 0 — it is a real bound, not a blank", () => {
    expect(buildProductListFilters(ui({ stockMin: "0" }))).toEqual({
      stockMin: 0,
    });
  });

  it("omits whitespace-only and non-numeric input", () => {
    expect(
      buildProductListFilters(ui({ costMin: "   ", costMax: "abc" })),
    ).toBeUndefined();
  });

  it("omits empty arrays and drops blank/duplicate list entries", () => {
    expect(buildProductListFilters(ui({ categories: [] }))).toBeUndefined();
    expect(
      buildProductListFilters(ui({ categories: ["", "  "] })),
    ).toBeUndefined();
    expect(
      buildProductListFilters(
        ui({ categories: ["Phones", "Phones", " Cases "] }),
      ),
    ).toEqual({ categories: ["Phones", "Cases"] });
  });

  it("omits blank date bounds independently", () => {
    expect(buildProductListFilters(ui({ addedFrom: "2026-01-01" }))).toEqual({
      addedFrom: "2026-01-01",
    });
    expect(buildProductListFilters(ui({ addedTo: "2026-02-01" }))).toEqual({
      addedTo: "2026-02-01",
    });
  });

  it("carries every field through when all are set", () => {
    expect(
      buildProductListFilters(
        ui({
          categories: ["Phones"],
          suppliers: ["Acme"],
          addedFrom: "2026-01-01",
          addedTo: "2026-02-01",
          costMin: "1",
          costMax: "2",
          retailMin: "3",
          retailMax: "4",
          profitPctMin: "5",
          profitPctMax: "6",
          stockMin: "7",
          stockMax: "8",
        }),
      ),
    ).toEqual({
      categories: ["Phones"],
      suppliers: ["Acme"],
      addedFrom: "2026-01-01",
      addedTo: "2026-02-01",
      costMin: 1,
      costMax: 2,
      retailMin: 3,
      retailMax: 4,
      profitPctMin: 5,
      profitPctMax: 6,
      stockMin: 7,
      stockMax: 8,
    });
  });
});

/**
 * The payload must satisfy core's `productListFiltersSchema` no matter what
 * was typed. A bound the schema refuses does NOT degrade to "filter ignored":
 * the desktop handler throws (the list keeps showing its last result and stops
 * responding) and REST answers `{success:false}` (the list empties). Every
 * rule below is one line of that schema.
 */
describe("buildProductListFilters — sanitization to the core schema", () => {
  it("drops a negative cost/retail bound (schema: z.number().min(0))", () => {
    expect(buildProductListFilters(ui({ costMin: "-5" }))).toBeUndefined();
    expect(buildProductListFilters(ui({ costMax: "-0.01" }))).toBeUndefined();
    expect(buildProductListFilters(ui({ retailMin: "-1" }))).toBeUndefined();
    expect(buildProductListFilters(ui({ retailMax: "-1" }))).toBeUndefined();
  });

  it("drops ONLY the invalid bound — the rest of the filter set still ships", () => {
    expect(
      buildProductListFilters(
        ui({ categories: ["Phones"], costMin: "-5", costMax: "20" }),
      ),
    ).toEqual({ categories: ["Phones"], costMax: 20 });
  });

  it("keeps cost/retail 0 — the boundary the schema allows", () => {
    expect(buildProductListFilters(ui({ costMin: "0" }))).toEqual({
      costMin: 0,
    });
  });

  it("truncates a fractional stock bound (schema: z.number().int())", () => {
    expect(buildProductListFilters(ui({ stockMin: "2.5" }))).toEqual({
      stockMin: 2,
    });
    expect(buildProductListFilters(ui({ stockMax: "9.9" }))).toEqual({
      stockMax: 9,
    });
  });

  it("keeps a NEGATIVE stock bound — stock_quantity really does go negative", () => {
    expect(buildProductListFilters(ui({ stockMin: "-3" }))).toEqual({
      stockMin: -3,
    });
    // Truncation is toward zero, so a negative fraction stays negative.
    expect(buildProductListFilters(ui({ stockMax: "-2.5" }))).toEqual({
      stockMax: -2,
    });
  });

  it("leaves profit % alone — it is signed and unconstrained", () => {
    expect(
      buildProductListFilters(
        ui({ profitPctMin: "-20", profitPctMax: "12.5" }),
      ),
    ).toEqual({ profitPctMin: -20, profitPctMax: 12.5 });
  });

  it("keeps fractional cost/retail — only stock is an integer field", () => {
    expect(buildProductListFilters(ui({ costMin: "1.25" }))).toEqual({
      costMin: 1.25,
    });
  });
});

/**
 * The payload, the chips and the badge read ONE sanitized view of the numeric
 * bounds (`effectiveNumericBounds`), so they cannot disagree. A bound the
 * payload drops must be invisible everywhere — a "Cost: ≥ $-5" chip over a
 * list that is not filtered by cost is a lie the user acts on — and a bound
 * the payload repairs must be shown repaired.
 */
describe("chips + badge agree with the payload", () => {
  it("a dropped negative bound draws no chip and does not count", () => {
    const state = ui({ costMin: "-5" });
    expect(buildProductListFilters(state)).toBeUndefined();
    expect(activeFilterChips(state)).toEqual([]);
    expect(countNumericFilters(state)).toBe(0);
  });

  it("labels the surviving half of a partly-invalid range", () => {
    const state = ui({ costMin: "-5", costMax: "20" });
    expect(buildProductListFilters(state)).toEqual({ costMax: 20 });
    expect(activeFilterChips(state)).toEqual([
      { key: "cost", label: "Cost: ≤ $20" },
    ]);
    expect(countNumericFilters(state)).toBe(1);
  });

  it("shows the TRUNCATED stock bound the backend will actually apply", () => {
    const state = ui({ stockMin: "2.5" });
    expect(buildProductListFilters(state)).toEqual({ stockMin: 2 });
    expect(activeFilterChips(state)).toEqual([
      { key: "stock", label: "Stock: ≥ 2" },
    ]);
    expect(countNumericFilters(state)).toBe(1);
  });

  it("keeps negative stock and negative profit visible — both are valid", () => {
    const state = ui({ stockMax: "-2", profitPctMin: "-20" });
    expect(buildProductListFilters(state)).toEqual({
      stockMax: -2,
      profitPctMin: -20,
    });
    expect(activeFilterChips(state)).toEqual([
      { key: "profit", label: "Profit: ≥ -20%" },
      { key: "stock", label: "Stock: ≤ -2" },
    ]);
    expect(countNumericFilters(state)).toBe(2);
  });

  it("every field the badge counts is a field the payload carries", () => {
    const state = ui({
      costMin: "-5", // dropped
      costMax: "20", // kept
      retailMin: "-1", // dropped
      profitPctMax: "-3.5", // kept, signed
      stockMin: "4.9", // kept, truncated
    });
    const payload = buildProductListFilters(state);
    expect(Object.keys(payload ?? {}).length).toBe(countNumericFilters(state));
    expect(payload).toEqual({ costMax: 20, profitPctMax: -3.5, stockMin: 4 });
  });
});

describe("countNumericFilters", () => {
  it("counts only set numeric bounds — list/date filters do not count", () => {
    expect(countNumericFilters(EMPTY_PRODUCT_FILTERS)).toBe(0);
    expect(
      countNumericFilters(
        ui({ categories: ["Phones"], addedFrom: "2026-01-01" }),
      ),
    ).toBe(0);
    expect(countNumericFilters(ui({ costMin: "1", stockMax: "0" }))).toBe(2);
  });
});

describe("activeFilterChips", () => {
  it("renders no chips when nothing is active", () => {
    expect(activeFilterChips(EMPTY_PRODUCT_FILTERS)).toEqual([]);
  });

  it("groups a min/max pair into ONE chip and labels open-ended ranges", () => {
    expect(activeFilterChips(ui({ costMin: "1", costMax: "5" }))).toEqual([
      { key: "cost", label: "Cost: $1 – $5" },
    ]);
    expect(activeFilterChips(ui({ stockMin: "3" }))).toEqual([
      { key: "stock", label: "Stock: ≥ 3" },
    ]);
    expect(activeFilterChips(ui({ profitPctMax: "20" }))).toEqual([
      { key: "profit", label: "Profit: ≤ 20%" },
    ]);
  });

  it("joins multi-select values into one chip", () => {
    expect(activeFilterChips(ui({ categories: ["Phones", "Cases"] }))).toEqual([
      { key: "categories", label: "Category: Phones, Cases" },
    ]);
  });

  it("labels the added-date range by which bounds are set", () => {
    expect(
      activeFilterChips(ui({ addedFrom: "2026-01-01", addedTo: "2026-02-01" })),
    ).toEqual([{ key: "added", label: "Added: 2026-01-01 → 2026-02-01" }]);
    expect(activeFilterChips(ui({ addedTo: "2026-02-01" }))).toEqual([
      { key: "added", label: "Added: until 2026-02-01" },
    ]);
  });
});

describe("clearing", () => {
  it("clearFilterGroup clears exactly one group and leaves the rest", () => {
    const state = ui({
      categories: ["Phones"],
      costMin: "1",
      costMax: "5",
      stockMin: "2",
    });
    const cleared = clearFilterGroup(state, "cost");
    expect(buildProductListFilters(cleared)).toEqual({
      categories: ["Phones"],
      stockMin: 2,
    });
  });

  it("clearNumericFilters leaves the inline list/date filters alone", () => {
    const state = ui({
      categories: ["Phones"],
      addedFrom: "2026-01-01",
      costMin: "1",
      profitPctMax: "9",
    });
    expect(buildProductListFilters(clearNumericFilters(state))).toEqual({
      categories: ["Phones"],
      addedFrom: "2026-01-01",
    });
  });
});
