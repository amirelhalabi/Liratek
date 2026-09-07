/**
 * Product Repository
 *
 * Handles all database operations for products/inventory.
 * Extends BaseRepository for standard CRUD operations.
 */

import {
  BaseRepository,
  type FindOptions,
  type PaginatedResult,
} from "./BaseRepository.js";
import { DatabaseError, ValidationError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getStockAdjustmentRepository } from "./StockAdjustmentRepository.js";
import { getProductSupplierRepository } from "./ProductSupplierRepository.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import type { ProductListFilters } from "../validators/product.js";

// =============================================================================
// Types
// =============================================================================

export interface ProductEntity {
  id: number;
  barcode: string;
  name: string;
  category: string;
  item_type: string;
  cost_price_usd: number;
  selling_price_usd: number;
  whish_price?: number;
  stock_quantity: number;
  min_stock_level: number;
  image_url: string | null;
  imei: string | null;
  color: string | null;
  // NOTE: warranty_expiry intentionally NOT projected (LIRA-143 v157 decision
  // #4) — the column stays in the DB but is dead: no UI reads/writes it, and
  // warranty is now sourced from products.warranty_months / sale_items.warranty_until.
  status: string;
  is_active: number; // SQLite boolean (0 or 1)
  is_deleted: number;
  supplier: string | null;
  created_at: string;
  updated_at: string;
}

/** Product as returned to the frontend (with aliased price fields) */
export interface ProductDTO {
  id: number;
  barcode: string;
  name: string;
  category: string;
  cost_price: number;
  retail_price: number;
  stock_quantity: number;
  min_stock_level: number;
  image_url: string | null;
  is_active: number;
  is_deleted: number;
  supplier: string | null;
  created_at: string;
  /** LIRA-143 v157 (decision #9): inherited from the product's category
   *  (product_categories.tracks_imei_units), 0 for an uncategorized
   *  product. SQLite boolean (0 or 1). */
  tracks_imei_units: number;
  /** LIRA-143 v157 (decision #4): duration on the MODEL; NULL = no
   *  warranty. The clock starts at sale time, not here. */
  warranty_months: number | null;
}

export interface CreateProductData {
  barcode: string | null;
  name: string;
  category: string;
  category_id?: number | null;
  cost_price: number; // Maps to cost_price_usd
  retail_price: number; // Maps to selling_price_usd
  stock_quantity?: number;
  min_stock_level?: number;
  image_url?: string;
  item_type?: string;
  supplier?: string | null;
  /** LIRA-143 v157 (decision #4): NULL = no warranty. Set on the product
   *  form; NOT inherited from the category (tracks_imei_units is). */
  warranty_months?: number | null;
  /** SUPPLIER_STOCK_INTAKE_PLAN.md — per-entry, transient (never persisted
   *  on the product row): when a supplier is set AND `stock_quantity > 0`,
   *  this is the ONE flag that decides whether the opening quantity books a
   *  `SUPPLIER_STOCK_INTAKE` supplier-ledger debit (see
   *  `ProductRepository.shouldBookIntakeDebt`, rule 14 — the same
   *  predicate `receiveStock` uses). Default false = "yes, book it". */
  is_old_stock?: boolean;
}

export interface UpdateProductData {
  barcode?: string;
  name?: string;
  category?: string;
  category_id?: number | null;
  cost_price?: number;
  retail_price?: number;
  min_stock_level?: number;
  image_url?: string;
  supplier?: string | null;
  stock_quantity?: number;
  /** LIRA-143 v157 (decision #4): NULL = no warranty. */
  warranty_months?: number | null;
}

export interface StockStats {
  stock_budget_usd: number;
  stock_count: number;
}

export interface LowStockProduct {
  id: number;
  name: string;
  stock_quantity: number;
  min_stock_level: number;
}

export interface NegativeStockProduct {
  id: number;
  name: string;
  barcode: string | null;
  stock_quantity: number;
}

/**
 * Distinct values backing the inventory list's filter dropdowns, drawn
 * from exactly the row set the list itself shows.
 */
export interface ProductFilterOptions {
  categories: string[];
  suppliers: string[];
}

// =============================================================================
// Repository
// =============================================================================

export class ProductRepository extends BaseRepository<ProductEntity> {
  constructor() {
    super("products", { softDelete: true });
  }

  // Override getColumns() from BaseRepository
  protected getColumns(): string {
    return "id, barcode, name, item_type, category, description, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, status, is_active, is_deleted, supplier, created_at, updated_at";
  }

  // ---------------------------------------------------------------------------
  // Shared SQL fragments (rule 14 — define a business predicate ONCE)
  // ---------------------------------------------------------------------------

  /**
   * Rule-14 single definition of "this product belongs on an inventory /
   * POS product list": active, not soft-deleted, and not a virtual telecom
   * credit line (those are tracked via drawer_balances, never as stock).
   * Written with the `p` table alias, so any query using it must alias
   * `products` as `p`.
   *
   * Introduces NO `?` and deliberately STOPS SHORT of the tenant clause:
   * every call site writes its own literal `AND p.tenant_id = ?`. Tenant
   * scoping is not a business rule that benefits from being hidden behind
   * a constant — it is the invariant `scripts/check-tenant-scoping.mjs`
   * enforces in CI by reading the SQL text, and that linter cannot see
   * through an interpolated fragment (it flags such a statement
   * fail-closed). Keeping `tenant_id` literal in every query is both the
   * house convention and what keeps the guard working.
   *
   * The embedded line breaks/indentation are deliberate: interpolated into
   * `findAllProducts` after `WHERE `, this reproduces that query's
   * previous SQL byte for byte, so extracting the fragment cannot have
   * changed the plan for the POS / low-stock / inventory callers that
   * pass no filters.
   */
  private static readonly LISTABLE_PRODUCTS_WHERE = `p.is_active = 1 AND p.is_deleted = 0
          AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')`;

  /**
   * The category value the UI actually DISPLAYS: the joined
   * `product_categories.name` when the product is categorized, falling
   * back to the legacy free-text `products.category` column when it is
   * not. Filtering and the filter-option list must both agree with the
   * column the user is looking at, so both build from this one expression.
   */
  private static readonly DISPLAY_CATEGORY_EXPR = `COALESCE(pc.name, p.category)`;

  /**
   * The profit-percent value the UI DISPLAYS, as SQL. Used for both the
   * min and the max bound so a range can never be evaluated against two
   * subtly different formulas.
   *
   * The `cost = 0 AND retail > 0 => 100` branch is a deliberate product
   * decision (margin on a free-to-acquire item is reported as 100%, not
   * infinity/undefined) and mirrors the frontend's displayed column. Do
   * not "correct" it to a NULL/skip — the filter would then disagree with
   * the number on screen.
   */
  private static readonly PROFIT_PCT_EXPR = `CASE WHEN p.cost_price_usd > 0 THEN (p.selling_price_usd - p.cost_price_usd) * 100.0 / p.cost_price_usd WHEN p.selling_price_usd > 0 THEN 100 ELSE 0 END`;

  /** `(?, ?, ?)` for a dynamic `IN` list — placeholders only, never values. */
  private static placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
  }

  /**
   * Translate a {@link ProductListFilters} set into `AND …` clauses plus
   * their bound params.
   *
   * Contract relied on by every existing caller: when `filters` is absent
   * — or present but with every field `undefined` — this returns an EMPTY
   * sql string and NO params, so the generated query is unchanged. An
   * empty array (`categories: []`) means "the user cleared this filter",
   * not "match nothing", and is likewise treated as absent.
   */
  private static buildFilterClauses(filters?: ProductListFilters): {
    sql: string;
    params: (string | number)[];
  } {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (!filters) return { sql: "", params };

    const pushIn = (expr: string, values?: string[]): void => {
      if (!values || values.length === 0) return;
      clauses.push(
        `${expr} IN (${ProductRepository.placeholders(values.length)})`,
      );
      params.push(...values);
    };
    const pushRange = (expr: string, min?: number, max?: number): void => {
      if (min !== undefined) {
        clauses.push(`${expr} >= ?`);
        params.push(min);
      }
      if (max !== undefined) {
        clauses.push(`${expr} <= ?`);
        params.push(max);
      }
    };

    pushIn(ProductRepository.DISPLAY_CATEGORY_EXPR, filters.categories);
    pushIn(`p.supplier`, filters.suppliers);

    // date() normalizes both storage forms present in this DB:
    // 'YYYY-MM-DD HH:MM:SS' and the ISO 'YYYY-MM-DDTHH:MM:SS.sssZ' form.
    // Both bounds are inclusive whole days.
    //
    // 'localtime' on the COLUMN side only. `created_at` is stamped by
    // CURRENT_TIMESTAMP (UTC) while the list's "Added" column renders it with
    // toLocaleDateString() — bucketing by the UTC day would put a product the
    // operator sees as added today into yesterday's (or tomorrow's) filter
    // window for part of every 24h. Local-day bucketing is the app-wide
    // convention for user-facing date ranges (see ClosingRepository).
    // The bound is already a LOCAL 'YYYY-MM-DD' the user picked, so it stays
    // a bare date(?) — converting it too would shift it twice.
    if (filters.addedFrom !== undefined) {
      clauses.push(`date(p.created_at, 'localtime') >= date(?)`);
      params.push(filters.addedFrom);
    }
    if (filters.addedTo !== undefined) {
      clauses.push(`date(p.created_at, 'localtime') <= date(?)`);
      params.push(filters.addedTo);
    }

    pushRange(`p.cost_price_usd`, filters.costMin, filters.costMax);
    pushRange(`p.selling_price_usd`, filters.retailMin, filters.retailMax);
    pushRange(
      ProductRepository.PROFIT_PCT_EXPR,
      filters.profitPctMin,
      filters.profitPctMax,
    );
    pushRange(`p.stock_quantity`, filters.stockMin, filters.stockMax);

    return { sql: clauses.map((c) => ` AND ${c}`).join(""), params };
  }

  // ---------------------------------------------------------------------------
  // Product-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Rule-14 single definition of "this product has a unit whose IMEI
   * matches" (LIRA-143 Phase 3, owner decision #2: IMEI joins product
   * search everywhere barcode works). Matches ALL unit statuses
   * deliberately (owner decision #7: the same search must still find a
   * SOLD unit's model) — do NOT add `AND pu.status = 'IN_STOCK'` here.
   * `qualifier` is the products table alias ("p") or the bare table name
   * ("products") for unaliased queries; both call sites append exactly one
   * extra `%term%`-style LIKE param for the `?` this fragment introduces.
   */
  private static unitImeiMatchFragment(qualifier: string): string {
    return `EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = ${qualifier}.id AND pu.tenant_id = ${qualifier}.tenant_id AND pu.imei LIKE ?)`;
  }

  /**
   * Get all products with optional search filter (as DTOs for frontend),
   * optionally narrowed by the inventory list's structured filters.
   *
   * `filters` only ever ADDS `AND …` clauses — with it omitted (POS,
   * low-stock, every pre-existing caller) the generated SQL and params are
   * exactly what they were before filtering existed.
   *
   * ⚠ WHERE-only. The SELECT list here must stay column-identical to
   * `findProductDtoById` — the two feed the same `ProductDTO` consumers and
   * a past divergence between them shipped a real crash (see that method's
   * doc comment). Both are left as literal text rather than a shared
   * constant precisely so the two lists can be diffed by eye.
   */
  findAllProducts(search?: string, filters?: ProductListFilters): ProductDTO[] {
    try {
      const tenantId = getCurrentTenantId();
      let query = `
        SELECT
          p.id, p.barcode, p.name, p.stock_quantity, p.min_stock_level,
          p.image_url, p.is_active, p.is_deleted, p.created_at,
          p.cost_price_usd as cost_price,
          p.selling_price_usd as retail_price,
          p.supplier,
          p.category_id,
          p.warranty_months,
          COALESCE(pc.name, p.category) as category,
          COALESCE(pc.tracks_imei_units, 0) as tracks_imei_units
        FROM ${this.tableName} p
        LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE ${ProductRepository.LISTABLE_PRODUCTS_WHERE}
          AND p.tenant_id = ?
      `;
      const params: (string | number)[] = [tenantId, tenantId];

      if (search) {
        query += ` AND (p.name LIKE ? OR p.barcode LIKE ? OR ${ProductRepository.DISPLAY_CATEGORY_EXPR} LIKE ? OR ${ProductRepository.unitImeiMatchFragment("p")})`;
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      const filterClauses = ProductRepository.buildFilterClauses(filters);
      query += filterClauses.sql;
      params.push(...filterClauses.params);

      query += ` ORDER BY p.name ASC`;
      return this.query<ProductDTO>(query, ...params);
    } catch (error) {
      throw new DatabaseError("Failed to find products", { cause: error });
    }
  }

  /**
   * The distinct values that populate the inventory list's category and
   * supplier filter dropdowns.
   *
   * Scoped to exactly the same row set the list itself shows
   * (`LISTABLE_PRODUCTS_WHERE`) so an option can never be offered that
   * matches zero visible products. Categories use the DISPLAYED value
   * (joined category name, else the legacy free-text column), the same
   * expression the `categories` filter matches against. NULL and empty
   * values are excluded; ordering is case-insensitive.
   */
  getProductFilterOptions(): ProductFilterOptions {
    try {
      const tenantId = getCurrentTenantId();

      const categoryRows = this.query<{ v: string }>(
        `
        SELECT DISTINCT ${ProductRepository.DISPLAY_CATEGORY_EXPR} AS v
        FROM ${this.tableName} p
        LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE ${ProductRepository.LISTABLE_PRODUCTS_WHERE}
          AND p.tenant_id = ?
          AND COALESCE(${ProductRepository.DISPLAY_CATEGORY_EXPR}, '') != ''
        ORDER BY v COLLATE NOCASE ASC
      `,
        tenantId,
        tenantId,
      );

      const supplierRows = this.query<{ v: string }>(
        `
        SELECT DISTINCT p.supplier AS v
        FROM ${this.tableName} p
        WHERE ${ProductRepository.LISTABLE_PRODUCTS_WHERE}
          AND p.tenant_id = ?
          AND p.supplier IS NOT NULL AND p.supplier != ''
        ORDER BY p.supplier COLLATE NOCASE ASC
      `,
        tenantId,
      );

      return {
        categories: categoryRows.map((r) => r.v),
        suppliers: supplierRows.map((r) => r.v),
      };
    } catch (error) {
      throw new DatabaseError("Failed to get product filter options", {
        cause: error,
      });
    }
  }

  /**
   * Get paginated products with search filter
   */
  findProductsPaginated(
    options: FindOptions & { search?: string } = {},
  ): PaginatedResult<ProductDTO> {
    const { limit = 50, offset = 0, search } = options;

    const data = this.findAllProducts(search);
    const total = search ? data.length : this.count();

    // Apply pagination in memory for simplicity (or could do SQL LIMIT/OFFSET)
    const paginatedData = limit ? data.slice(offset, offset + limit) : data;

    return {
      data: paginatedData,
      total,
      limit,
      offset,
      hasMore: offset + paginatedData.length < total,
    };
  }

  /**
   * Get product by barcode
   */
  findByBarcode(barcode: string): ProductEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE barcode = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`;
      return this.queryOne<ProductEntity>(query, barcode, getCurrentTenantId());
    } catch (error) {
      throw new DatabaseError("Failed to find product by barcode", {
        cause: error,
      });
    }
  }

  /**
   * DTO-shaped single-product lookup by id — same column aliasing
   * (cost_price_usd -> cost_price, selling_price_usd -> retail_price) and
   * `product_categories` join (tracks_imei_units, warranty_months) as
   * `findAllProducts`, but for exactly one row.
   *
   * LIRA-143 layer-seam fix (2026-08-25): `resolveScanCode`'s barcode/IMEI-
   * unit hits used to return the RAW `findById`/`findByBarcode` shape
   * (`ProductEntity`: `cost_price_usd`/`selling_price_usd`, no
   * `tracks_imei_units`/`warranty_months`) even though every layer above it
   * (electron.d.ts, the REST route, ProductSearch.tsx) declares/expects the
   * `ProductDTO` shape `findAllProducts` returns. Feeding that raw shape
   * into a POS scan-add cart line crashed CartLineRow
   * (`item.retail_price.toFixed(2)` on `undefined`) — a real
   * frontend<->repository seam bug the phase-6a unit tests never caught
   * because they never rendered a `resolveScanCode` result through the
   * actual Cart/CartLineRow tree (only a real e2e run driving the scan-to-
   * checkout flow surfaces it).
   */
  findProductDtoById(id: number): ProductDTO | null {
    try {
      const tenantId = getCurrentTenantId();
      const query = `
        SELECT
          p.id, p.barcode, p.name, p.stock_quantity, p.min_stock_level,
          p.image_url, p.is_active, p.is_deleted, p.created_at,
          p.cost_price_usd as cost_price,
          p.selling_price_usd as retail_price,
          p.supplier,
          p.category_id,
          p.warranty_months,
          COALESCE(pc.name, p.category) as category,
          COALESCE(pc.tracks_imei_units, 0) as tracks_imei_units
        FROM ${this.tableName} p
        LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE p.id = ? AND p.is_active = 1 AND p.is_deleted = 0 AND p.tenant_id = ?
      `;
      return this.queryOne<ProductDTO>(query, tenantId, id, tenantId);
    } catch (error) {
      throw new DatabaseError("Failed to find product by id (DTO)", {
        cause: error,
      });
    }
  }

  /**
   * Check if a barcode exists among active products.
   * Soft-deleted products are excluded so that re-importing a barcode
   * falls through to createProduct(), which reactivates the deleted row.
   */
  barcodeExists(barcode: string, excludeId?: number): boolean {
    try {
      const tenantId = getCurrentTenantId();
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND id != ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`
        : `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`;

      const params = excludeId
        ? [barcode, excludeId, tenantId]
        : [barcode, tenantId];
      return this.queryOne<{ 1: number }>(query, ...params) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check barcode existence", {
        cause: error,
      });
    }
  }

  /**
   * Resolve a supplier NAME to its linked `suppliers.id`, auto-creating the
   * `product_suppliers` (+ backing `suppliers`) row when it doesn't exist
   * yet (`ProductSupplierRepository.getOrCreate`). Returns `null` for a
   * blank/absent name — "no supplier" is a valid, common case (opening
   * stock with no known source).
   *
   * `ProductSupplierRepository.getOrCreate` returns the `product_suppliers`
   * row id, NOT `suppliers.id` — the two are linked 1:1 via
   * `product_suppliers.supplier_id`, which is what `product_stock_batches.
   * supplier_id` and `SupplierRepository.recordStockIntake` actually need
   * (the batch/ledger schema references `suppliers(id)`). The extra lookup
   * below reads that link column directly off `product_suppliers` — a
   * plain read of another repository's table, the same pattern
   * `findAllProducts` already uses to LEFT JOIN `product_categories`.
   */
  private resolveSupplierId(supplierName: string | null): number | null {
    if (!supplierName) return null;
    const tenantId = getCurrentTenantId();
    const productSupplierId =
      getProductSupplierRepository().getOrCreate(supplierName);
    const link = this.db
      .prepare(
        `SELECT supplier_id FROM product_suppliers WHERE id = ? AND tenant_id = ?`,
      )
      .get(productSupplierId, tenantId) as
      | { supplier_id: number | null }
      | undefined;
    return link?.supplier_id ?? null;
  }

  /**
   * Rule-14 single definition of "does this stock movement book a supplier
   * debt": only when it is actually tied to a resolved supplier AND the
   * caller hasn't flagged it as pre-existing ("old stock") inventory being
   * backfilled rather than newly purchased. Reused verbatim by
   * `receiveStock` and `createProduct`'s opening-stock path — do not
   * re-derive this condition at either call site (SUPPLIER_STOCK_INTAKE_
   * PLAN.md).
   */
  private static shouldBookIntakeDebt(
    supplierId: number | null,
    isOldStock: boolean,
  ): boolean {
    return supplierId !== null && !isOldStock;
  }

  /**
   * Books a `SUPPLIER_STOCK_INTAKE` supplier-ledger debit (when
   * applicable) and ALWAYS creates the FIFO cost batch for a quantity of
   * stock entering one product. The ONE composing unit of work shared by
   * `receiveStock()` (existing product, explicit intake form) and
   * `createProduct()`'s opening-stock path (a brand-new — or
   * barcode-reactivated — product created with `stock_quantity > 0` and a
   * supplier already attached): rule 14 forbids writing this
   * booking/batch logic twice.
   *
   * MUST be called from inside the caller's own `this.transaction(...)` —
   * it does not open one itself, so its writes commit/roll back with
   * whatever product mutation (INSERT or UPDATE) triggered it.
   *
   * A `quantity <= 0` is a no-op (batch_id 0, nothing booked) — a new
   * product created with zero opening stock has nothing to receive yet.
   */
  private bookIntakeAndBatch(params: {
    product_id: number;
    product_name: string;
    quantity: number;
    unit_cost_usd: number;
    supplier_name: string | null;
    is_old_stock: boolean;
    created_by: number | null;
  }): { batch_id: number } {
    if (params.quantity <= 0) {
      return { batch_id: 0 };
    }

    const supplierId = this.resolveSupplierId(params.supplier_name);
    const booksDebt = ProductRepository.shouldBookIntakeDebt(
      supplierId,
      params.is_old_stock,
    );

    let ledgerEntryId: number | null = null;
    let transactionId: number | null = null;
    if (booksDebt && supplierId !== null) {
      // `recordStockIntake` requires a REAL `created_by: number` —
      // `transactions.user_id` is NOT NULL, and this codebase deliberately
      // removed every `|| 1`/`?? 1` placeholder-actor default from
      // SupplierRepository in favor of every caller passing the
      // authenticated user. Never invent an id (0 or otherwise) here
      // either: a debt IS genuinely owed (booksDebt is true) and silently
      // skipping the booking to dodge a missing actor would lose the debt
      // — the exact bug this feature exists to fix. Fail loudly instead,
      // so a transport that forgot to authenticate surfaces immediately
      // rather than quietly corrupting the ledger. Both transports
      // authenticate before reaching this layer, so this should never
      // actually throw in production.
      if (params.created_by === null) {
        throw new ValidationError(
          "An authenticated user is required to book supplier debt",
        );
      }
      const booked = getSupplierRepository().recordStockIntake({
        supplier_id: supplierId,
        product_id: params.product_id,
        product_name: params.product_name,
        quantity: params.quantity,
        unit_cost_usd: params.unit_cost_usd,
        created_by: params.created_by,
      });
      ledgerEntryId = booked.ledgerEntryId;
      transactionId = booked.transactionId;
    }

    const batchId = getStockBatchRepository().createBatch({
      product_id: params.product_id,
      supplier_id: supplierId,
      quantity: params.quantity,
      unit_cost_usd: params.unit_cost_usd,
      books_debt: booksDebt,
      ledger_entry_id: ledgerEntryId,
      transaction_id: transactionId,
      created_by: params.created_by,
    });

    return { batch_id: batchId };
  }

  /**
   * Receive stock for an EXISTING product (Supplier Stock Intake,
   * SUPPLIER_STOCK_INTAKE_PLAN.md). Raises `stock_quantity` by `quantity`,
   * sets `cost_price_usd = unit_cost_usd` (owner decision D4: newest price
   * wins), writes the `stock_adjustments` audit row, and — via
   * `bookIntakeAndBatch` — creates the cost batch and books the supplier
   * debit unless `is_old_stock` or there is no supplier. ALL inside ONE db
   * transaction (rule 13 — `InventoryService.receiveStock` holds no SQL).
   */
  receiveStock(data: {
    product_id: number;
    quantity: number;
    unit_cost_usd: number;
    supplier?: string | null;
    is_old_stock: boolean;
    reason?: string;
    created_by: number | null;
  }): { batch_id: number } {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      const product = this.db
        .prepare(
          `SELECT name, stock_quantity FROM ${this.tableName} WHERE id = ? AND tenant_id = ?`,
        )
        .get(data.product_id, tenantId) as
        | { name: string; stock_quantity: number }
        | undefined;
      if (!product) {
        throw new DatabaseError("Product not found", {
          entityId: data.product_id,
        });
      }

      const oldQuantity = product.stock_quantity;
      const newQuantity = oldQuantity + data.quantity;
      this.execute(
        `UPDATE ${this.tableName}
         SET stock_quantity = ?, cost_price_usd = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`,
        newQuantity,
        data.unit_cost_usd,
        data.product_id,
        tenantId,
      );

      getStockAdjustmentRepository().create({
        product_id: data.product_id,
        delta: data.quantity,
        old_quantity: oldQuantity,
        new_quantity: newQuantity,
        reason: data.reason?.trim() || "Stock received",
        user_id: data.created_by,
      });

      return this.bookIntakeAndBatch({
        product_id: data.product_id,
        product_name: product.name,
        quantity: data.quantity,
        unit_cost_usd: data.unit_cost_usd,
        supplier_name: data.supplier?.trim() || null,
        is_old_stock: data.is_old_stock,
        created_by: data.created_by,
      });
    });
  }

  /**
   * Create a new product.
   *
   * Wrapped in `this.transaction(...)` (SUPPLIER_STOCK_INTAKE_PLAN.md): when
   * the new product has a supplier AND an opening `stock_quantity > 0`
   * (either the plain INSERT below, or the barcode-collision REACTIVATION
   * branch that revives a soft-deleted row with a new quantity),
   * `bookIntakeAndBatch` runs in the SAME transaction as the product
   * write, so a mid-failure can never leave a product's opening stock
   * un-batched/un-costed or a batch dangling with no product.
   *
   * `userId` attributes the opening-stock batch/ledger row when this create
   * books one — optional, defaulting to `null`, so every pre-existing
   * caller that only ever created products (never moved money) keeps
   * compiling unchanged. A create can now book real supplier debt, so an
   * unattributed row here is a genuine audit-trail gap; callers that DO
   * have an authenticated actor (the IPC handler / REST route) must pass it.
   */
  createProduct(
    data: CreateProductData,
    userId: number | null = null,
  ): { id: number } {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      let productId: number;
      let effectiveSupplier: string | null;

      try {
        const stmt = this.db.prepare(`
          INSERT INTO ${this.tableName} (
            barcode, name, category, category_id, cost_price_usd, selling_price_usd,
            stock_quantity, min_stock_level, image_url, item_type, supplier, warranty_months, created_at, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `);

        const result = stmt.run(
          data.barcode,
          data.name,
          data.category,
          data.category_id ?? null,
          data.cost_price,
          data.retail_price,
          data.stock_quantity ?? 0,
          data.min_stock_level ?? 5,
          data.image_url ?? null,
          data.item_type ?? "Product",
          data.supplier ?? null,
          data.warranty_months ?? null,
          tenantId,
        );

        productId = result.lastInsertRowid as number;
        effectiveSupplier = data.supplier ?? null;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === "SQLITE_CONSTRAINT_UNIQUE" && data.barcode) {
          // Check if the collision is with a soft-deleted product — reactivate it
          // Check both is_active=0 OR is_deleted=1
          const deleted = this.queryOne<
            Pick<ProductEntity, "id" | "supplier">
          >(
            `SELECT id, supplier FROM ${this.tableName} WHERE barcode = ? AND (is_active = 0 OR is_deleted = 1) AND tenant_id = ?`,
            data.barcode,
            tenantId,
          );
          if (deleted) {
            this.db
              .prepare(
                `UPDATE ${this.tableName} SET
                  name = ?, category = COALESCE(?, category), category_id = COALESCE(?, category_id),
                  cost_price_usd = ?, selling_price_usd = ?,
                  stock_quantity = ?, min_stock_level = ?,
                  image_url = COALESCE(?, image_url), item_type = COALESCE(?, item_type),
                  supplier = COALESCE(?, supplier), warranty_months = ?,
                  is_active = 1, is_deleted = 0,
                  created_at = COALESCE(created_at, datetime('now')),
                  updated_at = datetime('now')
                WHERE id = ? AND tenant_id = ?`,
              )
              .run(
                data.name,
                data.category,
                data.category_id ?? null,
                data.cost_price,
                data.retail_price,
                data.stock_quantity ?? 0,
                data.min_stock_level ?? 5,
                data.image_url ?? null,
                data.item_type ?? "Product",
                data.supplier ?? null,
                data.warranty_months ?? null,
                deleted.id,
                tenantId,
              );
            productId = deleted.id;
            // COALESCE(?, supplier) above keeps the pre-existing supplier
            // when data.supplier is blank — the booking below must agree
            // with what actually ended up on the row, not just what this
            // call passed in.
            effectiveSupplier = data.supplier ?? deleted.supplier ?? null;
          } else {
            throw new DatabaseError("Barcode already exists", {
              cause: error,
              code: "DUPLICATE_BARCODE",
            });
          }
        } else {
          throw new DatabaseError("Failed to create product", {
            cause: error,
          });
        }
      }

      const supplierName = effectiveSupplier?.trim() || null;
      const openingQuantity = data.stock_quantity ?? 0;
      if (supplierName && openingQuantity > 0) {
        this.bookIntakeAndBatch({
          product_id: productId,
          product_name: data.name,
          quantity: openingQuantity,
          unit_cost_usd: data.cost_price,
          supplier_name: supplierName,
          is_old_stock: data.is_old_stock ?? false,
          created_by: userId,
        });
      }

      return { id: productId };
    });
  }

  /**
   * Update an existing product
   */
  updateProduct(id: number, data: UpdateProductData): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = COALESCE(?, barcode),
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          cost_price_usd = COALESCE(?, cost_price_usd),
          selling_price_usd = COALESCE(?, selling_price_usd),
          min_stock_level = COALESCE(?, min_stock_level),
          image_url = COALESCE(?, image_url),
          warranty_months = COALESCE(?, warranty_months),
          updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.barcode ?? null,
        data.name ?? null,
        data.category ?? null,
        data.cost_price ?? null,
        data.retail_price ?? null,
        data.min_stock_level ?? null,
        data.image_url ?? null,
        data.warranty_months ?? null,
        id,
        getCurrentTenantId(),
      );

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError("Barcode already exists", {
          cause: error,
          code: "DUPLICATE_BARCODE",
        });
      }
      throw new DatabaseError("Failed to update product", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Update product with all fields explicitly (for handler compatibility)
   */
  /**
   * Batch-update shared fields for multiple products.
   * Only updates fields that are explicitly provided (non-undefined).
   * Unique fields (barcode, name, cost, retail price) are intentionally excluded.
   */
  batchUpdateProducts(
    ids: number[],
    data: {
      category?: string;
      category_id?: number | null;
      min_stock_level?: number;
      supplier?: string | null;
    },
  ): number {
    if (ids.length === 0) return 0;

    // Build SET clause dynamically from provided fields
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (data.category !== undefined) {
      setClauses.push("category = ?");
      params.push(data.category);
    }
    if (data.category_id !== undefined) {
      setClauses.push("category_id = ?");
      params.push(data.category_id);
    }
    if (data.min_stock_level !== undefined) {
      setClauses.push("min_stock_level = ?");
      params.push(data.min_stock_level);
    }
    if (data.supplier !== undefined) {
      setClauses.push("supplier = ?");
      params.push(data.supplier);
    }

    if (setClauses.length === 0) return 0;

    setClauses.push("updated_at = datetime('now')");

    const placeholders = ids.map(() => "?").join(", ");
    params.push(...ids);
    params.push(getCurrentTenantId());

    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE id IN (${placeholders}) AND tenant_id = ?`,
      )
      .run(...(params as Parameters<typeof this.db.prepare>[0][]));

    return result.changes;
  }

  /**
   * Soft-delete multiple products in a single SQL statement.
   * Returns the number of rows affected.
   */
  batchSoftDelete(ids: number[]): number {
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => "?").join(", ");
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET is_deleted = 1, updated_at = datetime('now') WHERE id IN (${placeholders}) AND tenant_id = ?`,
      )
      .run(...([...ids, tenantId] as any[]));

    return result.changes;
  }

  /**
   * Full-row product edit (single call site: `InventoryService.updateProduct`).
   *
   * `category`/`category_id` are OPTIONAL and behave like the sibling
   * `stock_quantity` in this same statement: omitted (or null) leaves the
   * stored value untouched via `COALESCE(?, <column>)`, it does not clear it.
   * That is what lets the service express "an update that names no category
   * keeps the product's existing classification" without a read-modify-write
   * (and without the pre-2026-08-26 behaviour, where an unvalidated REST PUT
   * body with no `category` NULLed both columns). Clearing `category_id` is
   * `CategoryRepository.delete`'s job, which nullifies orphans itself.
   */
  updateProductFull(
    id: number,
    data: {
      barcode: string;
      name: string;
      category?: string;
      category_id?: number | null;
      cost_price: number;
      retail_price: number;
      min_stock_level: number;
      image_url?: string | null;
      supplier?: string | null;
      /** Owner decision D13 (SUPPLIER_STOCK_INTAKE_PLAN.md): accepted for
       *  compatibility with existing callers' payload shape and
       *  DELIBERATELY IGNORED — this method no longer writes
       *  `stock_quantity`. Quantity is now an EVENT (a batch + optional
       *  supplier-ledger debit via `InventoryService.receiveStock` /
       *  `adjustStockDelta`), not a field an edit form can silently
       *  overwrite: an un-audited overwrite here would either book a
       *  supplier debt at whatever stale `cost_price` happens to be on the
       *  form, or (worse) silently skip booking one entirely while still
       *  moving the number the operator sees — same reasoning as the
       *  `category`/`category_id` compatibility fields above. */
      stock_quantity?: number;
      /** LIRA-143 v157 (decision #4): NULL = no warranty. */
      warranty_months?: number | null;
    },
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = ?, name = ?,
          category = COALESCE(?, category),
          category_id = COALESCE(?, category_id),
          cost_price_usd = ?,
          selling_price_usd = ?, min_stock_level = ?, image_url = ?,
          supplier = ?,
          warranty_months = ?,
          updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.barcode,
        data.name,
        data.category ?? null,
        data.category_id ?? null,
        data.cost_price,
        data.retail_price,
        data.min_stock_level,
        data.image_url ?? null,
        data.supplier ?? null,
        data.warranty_months ?? null,
        id,
        getCurrentTenantId(),
      );

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError("Barcode already exists", {
          cause: error,
          code: "DUPLICATE_BARCODE",
        });
      }
      throw new DatabaseError("Failed to update product", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Adjust stock quantity (set to absolute value).
   *
   * LIRA-077: writes a `stock_adjustments` audit row (old/new quantity,
   * delta, reason, acting user) in the SAME db transaction as the
   * stock_quantity UPDATE — repo-level transaction so a mid-failure can
   * never leave the audit trail out of sync with the actual quantity
   * (rule 13/20 discipline: services never touch the DB, this is where the
   * atomicity lives).
   */
  adjustStock(
    id: number,
    newQuantity: number,
    reason: string,
    userId: number | null,
  ): boolean {
    try {
      const tenantId = getCurrentTenantId();
      return this.transaction(() => {
        const current = this.db
          .prepare(
            `SELECT stock_quantity FROM ${this.tableName} WHERE id = ? AND tenant_id = ?`,
          )
          .get(id, tenantId) as { stock_quantity: number } | undefined;
        if (!current) return false;

        const oldQuantity = current.stock_quantity;
        const result = this.execute(
          `UPDATE ${this.tableName} SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
          newQuantity,
          id,
          tenantId,
        );
        if (result.changes > 0) {
          getStockAdjustmentRepository().create({
            product_id: id,
            delta: newQuantity - oldQuantity,
            old_quantity: oldQuantity,
            new_quantity: newQuantity,
            reason,
            user_id: userId,
          });
        }
        return result.changes > 0;
      });
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Increment/decrement stock quantity.
   *
   * LIRA-077: same audit-in-transaction contract as {@link adjustStock}.
   */
  adjustStockDelta(
    id: number,
    delta: number,
    reason: string,
    userId: number | null,
  ): boolean {
    try {
      const tenantId = getCurrentTenantId();
      return this.transaction(() => {
        const current = this.db
          .prepare(
            `SELECT stock_quantity FROM ${this.tableName} WHERE id = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`,
          )
          .get(id, tenantId) as { stock_quantity: number } | undefined;
        if (!current) return false;

        const oldQuantity = current.stock_quantity;
        const newQuantity = oldQuantity + delta;
        const result = this.execute(
          `UPDATE ${this.tableName} SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`,
          delta,
          id,
          tenantId,
        );
        if (result.changes > 0) {
          getStockAdjustmentRepository().create({
            product_id: id,
            delta,
            old_quantity: oldQuantity,
            new_quantity: newQuantity,
            reason,
            user_id: userId,
          });
        }
        return result.changes > 0;
      });
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock delta", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Manual DECREASE correction (shrinkage/loss/miscount) — the SAME entry
   * point `InventoryService.applyStockDelta` uses for a negative
   * `adjustStock`/`adjustStockDelta` call. FIFO-consumes batches
   * (`StockBatchRepository.consume`, `reason: 'ADJUSTMENT'`) so batches
   * never drift from `stock_quantity`, and NEVER touches the supplier
   * ledger — a decrease is shrinkage/loss, not a return to the supplier;
   * the shop still owes for units it already received.
   * //TODO (owner, deferred 2026-09-06): "Return to supplier" — a typed
   * option here that also reduces the supplier debt. See
   * docs/plans/todo_plans/SUPPLIER_STOCK_INTAKE_PLAN.md §1 "Deferred".
   * Until then a decrease is shrinkage/loss: the shop still owes the
   * supplier.
   *
   * Both the batch consumption and the `stock_quantity` decrement (+ its
   * audit row, via the existing `adjustStockDelta`) run inside ONE
   * transaction — a mid-failure can never leave batches out of sync with
   * the live count.
   */
  decreaseStockForAdjustment(
    id: number,
    quantity: number,
    reason: string,
    userId: number | null,
  ): boolean {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      const product = this.db
        .prepare(
          `SELECT cost_price_usd FROM ${this.tableName} WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, tenantId) as { cost_price_usd: number } | undefined;
      if (!product) return false;

      getStockBatchRepository().consume(id, quantity, {
        reason: "ADJUSTMENT",
        fallbackUnitCostUsd: product.cost_price_usd,
      });

      return this.adjustStockDelta(id, -quantity, reason, userId);
    });
  }

  /**
   * Deduct stock for multiple products.
   *
   * ⚠️ UNGUARDED / currently unused. This does a blind `stock_quantity - qty`
   * with no `>= qty` guard or rows-affected check, so it can oversell into
   * negative stock. Do NOT wire this into a sale-finalization path — the live
   * sale uses the guarded decrement in `SalesRepository.processSale`. If this
   * ever becomes live, port that guard here first (iterate items with a
   * conditional UPDATE + rows-affected check).
   */
  deductStockForSale(saleId: number): void {
    try {
      const tenantId = getCurrentTenantId();
      this.execute(
        `
        UPDATE ${this.tableName}
        SET stock_quantity = stock_quantity - (
          SELECT quantity
          FROM sale_items
          WHERE sale_items.product_id = products.id AND sale_items.sale_id = ? AND sale_items.tenant_id = ?
        ), updated_at = datetime('now')
        WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ? AND tenant_id = ?) AND tenant_id = ?
      `,
        saleId,
        tenantId,
        saleId,
        tenantId,
        tenantId,
      );
    } catch (error) {
      throw new DatabaseError("Failed to deduct stock for sale", {
        cause: error,
      });
    }
  }

  /**
   * Get stock statistics (budget and count)
   */
  getStockStats(): StockStats {
    try {
      const result = this.queryOne<StockStats>(
        `
        SELECT
          COALESCE(SUM(cost_price_usd * stock_quantity), 0) AS stock_budget_usd,
          COALESCE(SUM(stock_quantity), 0) AS stock_count
        FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
      `,
        getCurrentTenantId(),
      );
      return result ?? { stock_budget_usd: 0, stock_count: 0 };
    } catch (error) {
      throw new DatabaseError("Failed to get stock stats", { cause: error });
    }
  }

  /**
   * Get products that are at or below minimum stock level
   * Excludes virtual products (MTC/Alfa credits are tracked via drawer_balances)
   */
  findLowStock(): LowStockProduct[] {
    try {
      return this.query<LowStockProduct>(
        `
        SELECT id, name, stock_quantity, min_stock_level
        FROM ${this.tableName}
        WHERE stock_quantity <= min_stock_level AND is_active = 1 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
        ORDER BY name ASC
      `,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to get low stock products", {
        cause: error,
      });
    }
  }

  /**
   * Products whose stock has gone negative — oversold before the stock-oversell
   * guard shipped, or via a manual adjustment. They can no longer be sold (the
   * guard blocks stock < qty) until the count is reconciled. Excludes virtual
   * (MTC/Alfa) items, which are not physical stock. Tenant-scoped.
   */
  findNegativeStock(): NegativeStockProduct[] {
    try {
      return this.query<NegativeStockProduct>(
        `
        SELECT id, name, barcode, stock_quantity
        FROM ${this.tableName}
        WHERE stock_quantity < 0 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
        ORDER BY stock_quantity ASC
      `,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to get negative-stock products", {
        cause: error,
      });
    }
  }

  /**
   * Search products by multiple criteria
   */
  search(
    term: string,
    options: { limit?: number; category?: string } = {},
  ): ProductDTO[] {
    try {
      const { limit = 20, category } = options;
      const searchTerm = `%${term}%`;
      const tenantId = getCurrentTenantId();

      let query = `
        SELECT
          id, barcode, name, category, stock_quantity, min_stock_level,
          image_url, is_active, is_deleted, created_at,
          cost_price_usd as cost_price,
          selling_price_usd as retail_price
        FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0 AND (name LIKE ? OR barcode LIKE ? OR ${ProductRepository.unitImeiMatchFragment("products")}) AND tenant_id = ?
      `;
      const params: (string | number)[] = [
        searchTerm,
        searchTerm,
        searchTerm,
        tenantId,
      ];

      if (category) {
        query += ` AND category = ?`;
        params.push(category);
      }

      query += ` ORDER BY name ASC LIMIT ?`;
      params.push(limit);

      return this.query<ProductDTO>(query, ...params);
    } catch (error) {
      throw new DatabaseError("Failed to search products", { cause: error });
    }
  }

  /**
   * Get all distinct categories
   */
  getCategories(): string[] {
    try {
      const results = this.query<{ category: string }>(
        `
        SELECT DISTINCT category FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0 AND category IS NOT NULL AND category != ''
          AND tenant_id = ?
        ORDER BY category ASC
      `,
        getCurrentTenantId(),
      );
      return results.map((r) => r.category);
    } catch (error) {
      throw new DatabaseError("Failed to get categories", { cause: error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let productRepositoryInstance: ProductRepository | null = null;

export function getProductRepository(): ProductRepository {
  if (!productRepositoryInstance) {
    productRepositoryInstance = new ProductRepository();
  }
  return productRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetProductRepository(): void {
  productRepositoryInstance = null;
}
