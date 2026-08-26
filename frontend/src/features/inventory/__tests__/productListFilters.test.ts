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
