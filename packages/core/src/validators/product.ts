import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

/**
 * Product/Inventory validation schemas
 */

export const createProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(255),
  category: z.string().min(1, "Category is required").max(100),
  barcode: z.string().max(100).optional(),
  cost_price_usd: positiveDecimalSchema,
  retail_price_usd: positiveDecimalSchema,
  cost_price_lbp: positiveDecimalSchema.optional(),
  retail_price_lbp: positiveDecimalSchema.optional(),
  stock: positiveIntegerSchema.default(0),
  min_stock_threshold: positiveIntegerSchema.default(0),
  supplier: z.string().max(200).optional().nullable(),
  is_active: z.boolean().default(true),
  notes: z.string().max(500).optional(),
  // LIRA-143 v157 (decision #4): duration on the MODEL, set on the product
  // form; NULL/omitted = no warranty. NOT tracks_imei_units — that lives on
  // the category, not the product.
  warranty_months: positiveIntegerSchema.optional().nullable(),
});

export const updateProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(100).optional(),
  barcode: z.string().max(100).optional(),
  cost_price_usd: positiveDecimalSchema.optional(),
  retail_price_usd: positiveDecimalSchema.optional(),
  cost_price_lbp: positiveDecimalSchema.optional(),
  retail_price_lbp: positiveDecimalSchema.optional(),
  stock: positiveIntegerSchema.optional(),
  min_stock_threshold: positiveIntegerSchema.optional(),
  supplier: z.string().max(200).optional().nullable(),
  is_active: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  warranty_months: positiveIntegerSchema.optional().nullable(),
});

export const updateStockSchema = z.object({
  id: z.number().int().positive(),
  quantity: z.number().int(),
});

export const searchProductsSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  barcode: z.string().optional(),
  activeOnly: z.boolean().default(true),
});

// =============================================================================
// Inventory product-list filters (backend SQL filtering)
// =============================================================================

/** `YYYY-MM-DD` day key — inclusive on both ends of an added-date range. */
const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The already-parsed filter set consumed by
 * `ProductRepository.findAllProducts` / `InventoryService.getProducts`.
 *
 * This is the IPC-side shape (values already have their real JS types) and
 * the OUTPUT shape the REST query-string variant below parses into — one
 * definition, both transports (rule 19b).
 *
 * Deliberately NOT enforced here: `min <= max` and `from <= to`. An
 * inverted range is a legal query that simply returns an empty set; a
 * rejection would fight the UI while the user drags a slider handle past
 * its partner.
 */
export const productListFiltersSchema = z.object({
  categories: z.array(z.string().min(1)).max(100).optional(),
  suppliers: z.array(z.string().min(1)).max(100).optional(),
  addedFrom: z.string().regex(DAY_KEY_REGEX).optional(), // inclusive
  addedTo: z.string().regex(DAY_KEY_REGEX).optional(), // inclusive
  costMin: z.number().min(0).optional(),
  costMax: z.number().min(0).optional(),
  retailMin: z.number().min(0).optional(),
  retailMax: z.number().min(0).optional(),
  profitPctMin: z.number().optional(),
  profitPctMax: z.number().optional(),
  stockMin: z.number().int().optional(),
  stockMax: z.number().int().optional(),
});

export type ProductListFilters = z.infer<typeof productListFiltersSchema>;

/**
 * Express repeated params (`?category=A&category=B`) arrive as `string[]`,
 * a single occurrence as a bare `string`, and an absent one as
 * `undefined`. Normalize all three to `string[] | undefined` before the
 * array schema runs.
 */
const queryStringArraySchema = z.preprocess(
  (v) => (v == null ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.string().min(1)).max(100).optional(),
);

/**
 * Query-string number. `''` (a cleared input the browser still submits)
 * and a missing key both mean "no bound" — they must NEVER coerce to `0`,
 * which would silently apply a real `>= 0` / `<= 0` filter. An
 * unparseable value is passed through untouched so the wrapped
 * `z.number()` rejects it with a type error rather than smuggling `NaN`
 * into the SQL.
 */
function queryNumberSchema(base: z.ZodNumber) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : v;
    }
    return v;
  }, base.optional());
}

/** Query-string `YYYY-MM-DD`; `''`/absent both mean "no bound". */
const queryDayKeySchema = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? undefined : v),
  z.string().regex(DAY_KEY_REGEX).optional(),
);

/**
 * `z.coerce.boolean()` would turn the string `'false'` into `true`
 * (non-empty string), so decode the usual falsy spellings explicitly.
 */
const queryBooleanDefaultTrueSchema = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "string")
    return !["false", "0", "no"].includes(v.toLowerCase());
  return v;
}, z.boolean().default(true));

/**
 * REST query-string variant of {@link productListFiltersSchema}: parses
 * raw `req.query` (everything is a string or string[]) and OUTPUTS the
 * flat, real-typed shape.
 *
 * Input keys `category` / `supplier` are singular because that is how
 * express repeated params read in a URL; they map to the plural output
 * keys `categories` / `suppliers` that {@link ProductListFilters} uses.
 *
 * `barcode` and `activeOnly` are accepted purely for back-compat with the
 * older `searchProductsSchema` this replaces on the list route — old
 * callers' params must not fail validation. The route ignores both.
 */
export const productListQuerySchema = z
  .object({
    search: z.string().optional(),
    barcode: z.string().optional(),
    activeOnly: queryBooleanDefaultTrueSchema,
    category: queryStringArraySchema,
    supplier: queryStringArraySchema,
    addedFrom: queryDayKeySchema,
    addedTo: queryDayKeySchema,
    costMin: queryNumberSchema(z.number().min(0)),
    costMax: queryNumberSchema(z.number().min(0)),
    retailMin: queryNumberSchema(z.number().min(0)),
    retailMax: queryNumberSchema(z.number().min(0)),
    profitPctMin: queryNumberSchema(z.number()),
    profitPctMax: queryNumberSchema(z.number()),
    stockMin: queryNumberSchema(z.number().int()),
    stockMax: queryNumberSchema(z.number().int()),
  })
  .transform(({ category, supplier, ...rest }) => ({
    ...rest,
    categories: category,
    suppliers: supplier,
  }));

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type SearchProductsInput = z.infer<typeof searchProductsSchema>;
