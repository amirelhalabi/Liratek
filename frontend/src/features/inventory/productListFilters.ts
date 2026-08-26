/**
 * Inventory product-list filters — the pure UI-state ⇄ payload layer.
 *
 * The backend does the actual filtering in SQL, so everything here is about
 * translating the toolbar's raw form state (all strings, because that is what
 * `<input>` gives us) into a `ProductListFilters` payload with EVERY unset
 * field OMITTED. Omission is load-bearing on both transports:
 *   - REST rejects an empty param value (`?costMin=`) instead of ignoring it;
 *   - a blank number input must mean "no bound", never `0` (a real bound).
 *
 * The second rule is SANITIZATION: whatever the user typed, the payload built
 * here must satisfy core's `productListFiltersSchema`. An invalid bound makes
 * the backend reject the whole call — the desktop handler throws and the list
 * freezes, REST answers `{success:false}` and the list empties — so a bound
 * the schema cannot accept is repaired or dropped before it is ever sent.
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

/**
 * A cost/retail bound, sanitized to what the CORE SCHEMA accepts.
 *
 * `productListFiltersSchema` declares these as `z.number().min(0)`, so a
 * negative value is not a narrower filter — it is a payload the backend
 * REJECTS. Rejection is not a soft failure on either transport: the desktop
 * handler throws (the list freezes on its last result) and REST answers
 * `{success:false}`. Dropping the impossible bound instead keeps the list
 * alive; the user sees their other filters applied rather than nothing.
 *
 * Sanitized HERE and not by importing the zod schema: this module is renderer
 * code and must stay dependency-free — the schema is duplicated as a
 * hand-checked contract, which is why the guard tests below name each rule.
 */
function toMoneyBound(raw: string): number | undefined {
  const n = toNumber(raw);
  if (n === undefined || n < 0) return undefined;
  return n;
}

/**
 * A stock bound, sanitized to `z.number().int()`.
 *
 * There is deliberately NO lower clamp: `stock_quantity` legitimately goes
 * negative in this system (the negative-stock reports depend on it), so
 * `stockMin: -5` is a real, valid filter. Only the integer rule is enforced —
 * a `<input type="number">` hands back "2.5" from the keyboard however small
 * its `step` is. Truncation toward zero keeps a typed "2.5" a usable bound
 * rather than silently dropping the filter the user asked for.
 */
function toIntBound(raw: string): number | undefined {
  const n = toNumber(raw);
  return n === undefined ? undefined : Math.trunc(n);
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

/** Which sanitizer each numeric bound goes through — the ONE place the
 *  per-field rule is decided. */
const NUMERIC_FIELD_SANITIZERS: Record<
  NumericFilterField,
  (raw: string) => number | undefined
> = {
  costMin: toMoneyBound,
  costMax: toMoneyBound,
  retailMin: toMoneyBound,
  retailMax: toMoneyBound,
  // Signed and unconstrained in the schema — a loss-making product has a
  // negative margin. `toNumber` already rejects NaN/Infinity, as z.number() would.
  profitPctMin: toNumber,
  profitPctMax: toNumber,
  stockMin: toIntBound,
  stockMax: toIntBound,
};

/** Each numeric bound as the PAYLOAD will carry it — `undefined` where the
 *  payload omits the field. */
export type EffectiveNumericBounds = Record<
  NumericFilterField,
  number | undefined
>;

/**
 * The single sanitized view of the numeric bounds that the payload, the chips
 * and the badge all read.
 *
 * They must agree exactly: a bound the payload drops (a negative cost) is a
 * bound that never happened, so it can neither raise the badge count nor draw
 * a "Cost: ≥ $-5" chip promising a filter the list is not applying — and a
 * bound the payload repairs (stock "2.5" → 2) must be shown as the 2 that is
 * actually in force. Reading the raw strings in any one of the three is how
 * they drift apart.
 */
export function effectiveNumericBounds(
  ui: ProductFiltersUiState,
): EffectiveNumericBounds {
  const bounds = {} as EffectiveNumericBounds;
  for (const field of NUMERIC_FILTER_FIELDS) {
    bounds[field] = NUMERIC_FIELD_SANITIZERS[field](ui[field]);
  }
  return bounds;
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

  const bounds = effectiveNumericBounds(ui);
  for (const field of NUMERIC_FILTER_FIELDS) {
    const value = bounds[field];
    if (value !== undefined) filters[field] = value;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

/** How many of the popover's numeric bounds are IN FORCE — the button's
 *  badge. Counts the sanitized bounds, so it can never advertise a filter the
 *  payload dropped. */
export function countNumericFilters(ui: ProductFiltersUiState): number {
  const bounds = effectiveNumericBounds(ui);
  return NUMERIC_FILTER_FIELDS.reduce(
    (n, field) => (bounds[field] !== undefined ? n + 1 : n),
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

/**
 * `min`/`max` → "1 – 5" / "≥ 1" / "≤ 5"; null when neither bound is set.
 *
 * Takes the ALREADY-SANITIZED numbers, never the raw input strings — the chip
 * has to describe the filter the backend is applying, not the text still
 * sitting in the box.
 */
function rangeLabel(
  lo: number | undefined,
  hi: number | undefined,
  prefix: string,
  suffix: string,
): string | null {
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

  const bounds = effectiveNumericBounds(ui);

  const cost = rangeLabel(bounds.costMin, bounds.costMax, "$", "");
  if (cost) chips.push({ key: "cost", label: `Cost: ${cost}` });

  const retail = rangeLabel(bounds.retailMin, bounds.retailMax, "$", "");
  if (retail) chips.push({ key: "retail", label: `Retail: ${retail}` });

  const profit = rangeLabel(bounds.profitPctMin, bounds.profitPctMax, "", "%");
  if (profit) chips.push({ key: "profit", label: `Profit: ${profit}` });

  const stock = rangeLabel(bounds.stockMin, bounds.stockMax, "", "");
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
