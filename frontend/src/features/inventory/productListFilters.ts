/**
 * Inventory product-list filters — the pure UI-state ⇄ payload layer.
 *
 * The backend does the actual filtering in SQL, so everything here is about
 * translating the toolbar's raw form state (all strings, because that is what
 * `<input>` gives us) into a `ProductListFilters` payload with EVERY unset
 * field OMITTED. Omission is load-bearing on both transports:
 *   - REST rejects an empty param value (`?costMin=`) instead of ignoring it;
 *   - a blank number input must mean "no bound", never `0` (a real bound).
 */

import type { ProductListFilters } from "@liratek/core";

/** Raw toolbar state. Numeric/date fields are strings — `<input>` values. */
export interface ProductFiltersUiState {
  categories: string[];
  suppliers: string[];
  /** YYYY-MM-DD, inclusive */
  addedFrom: string;
  /** YYYY-MM-DD, inclusive */
  addedTo: string;
  costMin: string;
  costMax: string;
  retailMin: string;
  retailMax: string;
  profitPctMin: string;
  profitPctMax: string;
  stockMin: string;
  stockMax: string;
}

export const EMPTY_PRODUCT_FILTERS: ProductFiltersUiState = {
  categories: [],
  suppliers: [],
  addedFrom: "",
  addedTo: "",
  costMin: "",
  costMax: "",
  retailMin: "",
  retailMax: "",
  profitPctMin: "",
  profitPctMax: "",
  stockMin: "",
  stockMax: "",
};

/** The numeric min/max pairs that live behind the "Filters" popover. */
export const NUMERIC_FILTER_FIELDS = [
  "costMin",
  "costMax",
  "retailMin",
  "retailMax",
  "profitPctMin",
  "profitPctMax",
  "stockMin",
  "stockMax",
] as const;

export type NumericFilterField = (typeof NUMERIC_FILTER_FIELDS)[number];

/** `""` / whitespace / non-numeric → undefined (field omitted). `"0"` → 0. */
function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** `""` / whitespace → undefined (field omitted). */
function toText(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** Drops blank entries and duplicates; an all-blank list omits the field. */
function toList(values: string[]): string[] | undefined {
  const cleaned = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Build the wire payload. Returns `undefined` when NOTHING is active, so the
 * unfiltered call stays byte-identical to what it was before filters existed.
 */
export function buildProductListFilters(
  ui: ProductFiltersUiState,
): ProductListFilters | undefined {
  const filters: ProductListFilters = {};

  const categories = toList(ui.categories);
  if (categories) filters.categories = categories;
  const suppliers = toList(ui.suppliers);
  if (suppliers) filters.suppliers = suppliers;

  const addedFrom = toText(ui.addedFrom);
  if (addedFrom) filters.addedFrom = addedFrom;
  const addedTo = toText(ui.addedTo);
  if (addedTo) filters.addedTo = addedTo;

  const costMin = toNumber(ui.costMin);
  if (costMin !== undefined) filters.costMin = costMin;
  const costMax = toNumber(ui.costMax);
  if (costMax !== undefined) filters.costMax = costMax;

  const retailMin = toNumber(ui.retailMin);
  if (retailMin !== undefined) filters.retailMin = retailMin;
  const retailMax = toNumber(ui.retailMax);
  if (retailMax !== undefined) filters.retailMax = retailMax;

  const profitPctMin = toNumber(ui.profitPctMin);
  if (profitPctMin !== undefined) filters.profitPctMin = profitPctMin;
  const profitPctMax = toNumber(ui.profitPctMax);
  if (profitPctMax !== undefined) filters.profitPctMax = profitPctMax;

  const stockMin = toNumber(ui.stockMin);
  if (stockMin !== undefined) filters.stockMin = stockMin;
  const stockMax = toNumber(ui.stockMax);
  if (stockMax !== undefined) filters.stockMax = stockMax;

  return Object.keys(filters).length > 0 ? filters : undefined;
}

/** How many of the popover's numeric bounds are set — the button's badge. */
export function countNumericFilters(ui: ProductFiltersUiState): number {
  return NUMERIC_FILTER_FIELDS.reduce(
    (n, field) => (toNumber(ui[field]) !== undefined ? n + 1 : n),
    0,
  );
}

/** One removable chip per active filter GROUP (not per bound). */
export type ProductFilterChipKey =
  | "categories"
  | "suppliers"
  | "added"
  | "cost"
  | "retail"
  | "profit"
  | "stock";

export interface ProductFilterChip {
  key: ProductFilterChipKey;
  label: string;
}

/** `min`/`max` → "1 – 5" / "≥ 1" / "≤ 5"; null when neither bound is set. */
function rangeLabel(
  min: string,
  max: string,
  prefix: string,
  suffix: string,
): string | null {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === undefined && hi === undefined) return null;
  const fmt = (n: number) => `${prefix}${n}${suffix}`;
  if (lo !== undefined && hi !== undefined) return `${fmt(lo)} – ${fmt(hi)}`;
  if (lo !== undefined) return `≥ ${fmt(lo)}`;
  return `≤ ${fmt(hi as number)}`;
}

export function activeFilterChips(
  ui: ProductFiltersUiState,
): ProductFilterChip[] {
  const chips: ProductFilterChip[] = [];

  const categories = toList(ui.categories);
  if (categories) {
    chips.push({
      key: "categories",
      label: `Category: ${categories.join(", ")}`,
    });
  }
  const suppliers = toList(ui.suppliers);
  if (suppliers) {
    chips.push({
      key: "suppliers",
      label: `Supplier: ${suppliers.join(", ")}`,
    });
  }

  const from = toText(ui.addedFrom);
  const to = toText(ui.addedTo);
  if (from || to) {
    const label =
      from && to
        ? `Added: ${from} → ${to}`
        : from
          ? `Added: from ${from}`
          : `Added: until ${to}`;
    chips.push({ key: "added", label });
  }

  const cost = rangeLabel(ui.costMin, ui.costMax, "$", "");
  if (cost) chips.push({ key: "cost", label: `Cost: ${cost}` });

  const retail = rangeLabel(ui.retailMin, ui.retailMax, "$", "");
  if (retail) chips.push({ key: "retail", label: `Retail: ${retail}` });

  const profit = rangeLabel(ui.profitPctMin, ui.profitPctMax, "", "%");
  if (profit) chips.push({ key: "profit", label: `Profit: ${profit}` });

  const stock = rangeLabel(ui.stockMin, ui.stockMax, "", "");
  if (stock) chips.push({ key: "stock", label: `Stock: ${stock}` });

  return chips;
}

/** Clears exactly the group a chip's ✕ owns, leaving every other filter set. */
export function clearFilterGroup(
  ui: ProductFiltersUiState,
  key: ProductFilterChipKey,
): ProductFiltersUiState {
  switch (key) {
    case "categories":
      return { ...ui, categories: [] };
    case "suppliers":
      return { ...ui, suppliers: [] };
    case "added":
      return { ...ui, addedFrom: "", addedTo: "" };
    case "cost":
      return { ...ui, costMin: "", costMax: "" };
    case "retail":
      return { ...ui, retailMin: "", retailMax: "" };
    case "profit":
      return { ...ui, profitPctMin: "", profitPctMax: "" };
    case "stock":
      return { ...ui, stockMin: "", stockMax: "" };
  }
}

/** Blanks only the popover's numeric bounds (its own "Reset"). */
export function clearNumericFilters(
  ui: ProductFiltersUiState,
): ProductFiltersUiState {
  return {
    ...ui,
    costMin: "",
    costMax: "",
    retailMin: "",
    retailMax: "",
    profitPctMin: "",
    profitPctMax: "",
    stockMin: "",
    stockMax: "",
  };
}
