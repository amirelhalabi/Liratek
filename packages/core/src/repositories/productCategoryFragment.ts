/**
 * The category a product is shown under: its managed category's name, else
 * the legacy free-text `products.category`. Expects the product aliased `p`
 * and `product_categories` aliased `pc`. ONE definition (rule 14), shared by
 * the Inventory page (`ProductRepository`), the Transactions Summary view's
 * Category rows and the list's category drill-down (LIRA-389), so a category
 * is named — and matched — the same everywhere.
 *
 * Leaf module: no imports.
 */
export const PRODUCT_DISPLAY_CATEGORY_SQL = `COALESCE(pc.name, p.category)`;

/** The same category as a group key: blank reads as "no category" (NULL). */
export const PRODUCT_CATEGORY_KEY_SQL = `NULLIF(TRIM(${PRODUCT_DISPLAY_CATEGORY_SQL}), '')`;
