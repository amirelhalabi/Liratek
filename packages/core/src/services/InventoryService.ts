/**
 * Inventory Service
 *
 * Business logic layer for inventory/product operations.
 * Uses ProductRepository for data access.
 *
 * This service encapsulates:
 * - Product CRUD operations
 * - Stock management
 * - Low stock alerts
 * - Category management
 */

import {
  ProductRepository,
  getProductRepository,
  StockAdjustmentRepository,
  getStockAdjustmentRepository,
  ProductUnitRepository,
  getProductUnitRepository,
  CategoryRepository,
  getCategoryRepository,
  type ProductDTO,
  type CreateProductData,
  type UpdateProductData,
  type StockStats,
  type LowStockProduct,
  type NegativeStockProduct,
  type ProductFilterOptions,
  type StockAdjustmentWithUser,
  type ProductUnitEntity,
} from "../repositories/index.js";
import type { ProductListFilters } from "../validators/product.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import { toErrorString, getRepoConstraintCode } from "../utils/errors.js";
import {
  generateUniqueNumericBarcode,
  suggestDuplicateBarcode,
} from "../utils/barcode.js";
import { inventoryLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ProductResult {
  success: boolean;
  id?: number;
  error?: string;
  code?: "DUPLICATE_BARCODE";
  suggested_barcode?: string;
  /** Set by {@link InventoryService.deleteProduct} only, and only when the
   *  cascade actually removed something: how many IN_STOCK IMEI units went
   *  with the product, and which ones. Absent (not `0`) when the product had
   *  no units, so a caller can distinguish the two. */
  removed_unit_count?: number;
  removed_unit_imeis?: string[];
}

export interface StockAdjustmentResult {
  success: boolean;
  error?: string;
}

/**
 * Result of {@link InventoryService.resolveScanCode} — the resolved
 * product plus the specific unit the scanned code identified, when the
 * code was an IMEI rather than a barcode (LIRA-143 Phase 3, owner decision
 * #2). `matched_unit` is `null` on a barcode hit — barcode resolves the
 * model only, never a specific unit. `product` is the `ProductDTO` shape
 * (aliased price fields + tracks_imei_units/warranty_months) — every
 * consumer above this method already declares/expects it (see
 * `resolveScanCode`'s own doc comment for the bug this fixed).
 */
export interface ScanCodeResolution {
  product: ProductDTO;
  matched_unit: ProductUnitEntity | null;
}

// =============================================================================
// Inventory Service Class
// =============================================================================

export class InventoryService {
  private productRepo: ProductRepository;
  private stockAdjustmentRepo: StockAdjustmentRepository;
  private productUnitRepo: ProductUnitRepository;
  /**
   * Injected override for the category repo, or `null` until the default
   * singleton is resolved on first use. Deliberately NOT resolved in the
   * constructor like the three above: `CategoryRepository`'s constructor
   * grabs a live `getDatabase()` handle (it is not a `BaseRepository`, which
   * reads the handle per query), and this service is constructed by
   * read-only callers — and by unit tests with partially mocked repos —
   * that never touch categories.
   */
  private categoryRepoRef: CategoryRepository | null;

  constructor(
    productRepo?: ProductRepository,
    stockAdjustmentRepo?: StockAdjustmentRepository,
    productUnitRepo?: ProductUnitRepository,
    categoryRepo?: CategoryRepository,
  ) {
    this.productRepo = productRepo ?? getProductRepository();
    this.stockAdjustmentRepo =
      stockAdjustmentRepo ?? getStockAdjustmentRepository();
    this.productUnitRepo = productUnitRepo ?? getProductUnitRepository();
    this.categoryRepoRef = categoryRepo ?? null;
  }

  private get categoryRepo(): CategoryRepository {
    if (!this.categoryRepoRef) {
      this.categoryRepoRef = getCategoryRepository();
    }
    return this.categoryRepoRef;
  }

  /**
   * Resolve a category NAME to its `product_categories.id`, creating the
   * row if this tenant doesn't have one yet (case-insensitive match,
   * tenant-scoped — `CategoryRepository.getOrCreate`).
   *
   * Rule 14/19b — ONE resolution path for BOTH transports, and this is it:
   * the resolution used to live in the Electron IPC handlers only
   * (`inventory:create-product` / `inventory:update-product` called
   * `catRepo.getOrCreate` and handed the service a ready `category_id`),
   * while the REST twin (`backend/src/api/inventory.ts`) passed the name
   * straight through. A web-created product therefore had `category_id`
   * NULL, so `tracks_imei_units` — COALESCE'd off the joined category on
   * EVERY product read (LIRA-143 decision #9) — was always 0 for it, and
   * every other category-joined field was lost. Worse on update:
   * `updateProductFull` writes `category_id` unconditionally, so a web edit
   * of a desktop-created product actively NULLed a correct id. Those two
   * handler blocks are GONE (2026-08-26) — the handlers now pass the NAME
   * only, exactly like the REST routes, so there is one resolution site.
   *
   * The NAME is the source of truth. `providedId` is a create-only
   * short-circuit for a caller that already resolved the row itself (no
   * second lookup); `updateProduct` deliberately does NOT pass it, so a
   * caller-supplied `category_id` can never disagree with the name it is
   * stored next to. There is no `'General'` fallback here: `createProduct`
   * rejects a blank category outright, and on update a missing category
   * means "leave the existing classification alone" (see `updateProduct`).
   */
  private resolveCategoryId(
    categoryName: string,
    providedId?: number | null,
  ): number {
    return providedId ?? this.categoryRepo.getOrCreate(categoryName);
  }

  // ---------------------------------------------------------------------------
  // Product Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all products with optional search filter and the inventory list's
   * structured filters (category/supplier/added-date/cost/retail/profit%/
   * stock). All of them AND together, and with `filters` omitted the
   * result is exactly the unfiltered list every other caller expects.
   */
  getProducts(search?: string, filters?: ProductListFilters): ProductDTO[] {
    return this.productRepo.findAllProducts(search, filters);
  }

  /**
   * Distinct category and supplier values for the inventory list's filter
   * dropdowns, scoped to the same rows the list shows.
   */
  getProductFilterOptions(): ProductFilterOptions {
    return this.productRepo.getProductFilterOptions();
  }

  /**
   * Get a single product by ID
   */
  getProductById(id: number) {
    const product = this.productRepo.findById(id);
    if (!product) {
      throw new NotFoundError("Product", id);
    }
    return product;
  }

  /**
   * Get a product by barcode
   */
  getProductByBarcode(barcode: string) {
    if (!barcode?.trim()) {
      throw new ValidationError("Barcode is required");
    }
    return this.productRepo.findByBarcode(barcode.trim());
  }

  /**
   * Search products by name or barcode
   */
  searchProducts(
    term: string,
    options?: { limit?: number; category?: string },
  ) {
    if (!term?.trim()) {
      return [];
    }
    return this.productRepo.search(term.trim(), options);
  }

  /**
   * Resolve a scanned/typed code the same way everywhere a scanner feeds
   * this app (LIRA-143 Phase 3, owner decision #2): barcode first, then —
   * only when no product has that exact barcode — an active (`IN_STOCK`)
   * unit IMEI. An IMEI hit resolves the owning product AND preselects the
   * specific unit, since scanning one phone's IMEI means the operator
   * means that unit, not just "some unit of this model". Returns `null`
   * for a blank code or a code that matches neither. `findProductDtoById`
   * already excludes soft-deleted/inactive rows (same base WHERE as
   * `findById`), so a dangling `product_units.product_id` — a unit whose
   * product was deleted after intake — is logged and treated as "no
   * match" rather than thrown, since a scan is a lookup, not a write that
   * should fail loudly.
   *
   * Returns the `ProductDTO` shape (`findProductDtoById`, same
   * column-aliasing/category-join as `findAllProducts`) — NOT the raw
   * `findByBarcode`/`findById` `ProductEntity` shape. Every consumer above
   * this method (electron.d.ts's `Product`, the REST route, and
   * ProductSearch.tsx's scan-add path) already declares/expects the DTO
   * shape; returning the raw entity here used to crash the POS scan-add
   * cart line (`item.retail_price` was `undefined`) — a real
   * frontend<->repository seam bug only a real e2e run driving the scan-
   * to-checkout flow surfaced (see `findProductDtoById`'s own doc comment).
   */
  resolveScanCode(code: string): ScanCodeResolution | null {
    const trimmed = code?.trim();
    if (!trimmed) {
      return null;
    }

    const byBarcode = this.productRepo.findByBarcode(trimmed);
    if (byBarcode) {
      const product = this.productRepo.findProductDtoById(byBarcode.id);
      // Defensive only — byBarcode itself just matched the same active,
      // non-deleted, same-tenant row, so this should always resolve.
      if (!product) return null;
      return { product, matched_unit: null };
    }

    const unit = this.productUnitRepo.findActiveByImei(trimmed);
    if (!unit) {
      return null;
    }

    const product = this.productRepo.findProductDtoById(unit.product_id);
    if (!product) {
      inventoryLogger.warn(
        { imei: trimmed, unitId: unit.id, productId: unit.product_id },
        "resolveScanCode: active unit's product not found or inactive",
      );
      return null;
    }

    return { product, matched_unit: unit };
  }

  /**
   * Get all product categories
   */
  getCategories(): string[] {
    return this.productRepo.getCategories();
  }

  // ---------------------------------------------------------------------------
  // Product CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new product
   */
  createProduct(data: CreateProductData): ProductResult {
    // Barcode behavior:
    // - If blank, auto-generate a unique 8-digit numeric barcode.
    // - If provided and duplicates exist, return a structured duplicate error.
    let barcode = data.barcode?.trim() || "";
    if (!barcode) {
      barcode = generateUniqueNumericBarcode((code: string) =>
        this.productRepo.barcodeExists(code),
      );
    }
    if (!data.name?.trim()) {
      return { success: false, error: "Product name is required" };
    }
    if (!data.category?.trim()) {
      return { success: false, error: "Category is required" };
    }
    if (data.cost_price < 0) {
      return { success: false, error: "Cost price cannot be negative" };
    }
    if (data.retail_price < 0) {
      return { success: false, error: "Retail price cannot be negative" };
    }
    if (
      data.retail_price > 0 &&
      data.cost_price > 0 &&
      data.retail_price <= data.cost_price
    ) {
      return {
        success: false,
        error: "Selling price must be greater than cost price",
      };
    }

    // Check for duplicate barcode
    if (barcode && this.productRepo.barcodeExists(barcode)) {
      const suggested = suggestDuplicateBarcode(barcode, (code: string) =>
        this.productRepo.barcodeExists(code),
      );
      return {
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: suggested,
      };
    }

    try {
      const categoryName = data.category.trim();
      const result = this.productRepo.createProduct({
        ...data,
        barcode,
        name: data.name.trim(),
        category: categoryName,
        // See resolveCategoryId: the category name is resolved HERE so IPC
        // and REST both stamp category_id (rule 14/19b).
        category_id: this.resolveCategoryId(categoryName, data.category_id),
      });
      return { success: true, id: result.id };
    } catch (error) {
      const repoCode = getRepoConstraintCode(error);
      if (repoCode === "DUPLICATE_BARCODE") {
        return { success: false, error: "Barcode already exists" };
      }
      inventoryLogger.error({ error, data }, "Create product error");
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Update an existing product
   */
  batchUpdateProducts(
    ids: number[],
    data: {
      category?: string;
      min_stock_level?: number;
      supplier?: string | null;
    },
  ): { success: boolean; updated: number; error?: string } {
    if (!ids || ids.length === 0) {
      return { success: false, updated: 0, error: "No products selected" };
    }
    const hasField =
      data.category !== undefined ||
      data.min_stock_level !== undefined ||
      data.supplier !== undefined;
    if (!hasField) {
      return { success: false, updated: 0, error: "No fields to update" };
    }
    try {
      const updated = this.productRepo.batchUpdateProducts(ids, data);
      return { success: true, updated };
    } catch (err) {
      return { success: false, updated: 0, error: String(err) };
    }
  }

  updateProduct(
    id: number,
    data: UpdateProductData & {
      barcode: string;
      name: string;
      /** Omitted/blank = keep the product's existing category (see below). */
      category?: string;
      /** Accepted for compatibility and IGNORED — the NAME is authoritative
       *  on update, so the two columns can never be written in conflict. */
      category_id?: number | null;
      cost_price: number;
      retail_price: number;
      min_stock_level: number;
      image_url?: string | null;
      supplier?: string | null;
      stock_quantity?: number;
    },
  ): ProductResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    // Check if product exists
    if (!this.productRepo.exists(id)) {
      return { success: false, error: "Product not found" };
    }

    if (
      data.retail_price > 0 &&
      data.cost_price > 0 &&
      data.retail_price <= data.cost_price
    ) {
      return {
        success: false,
        error: "Selling price must be greater than cost price",
      };
    }

    // Check for duplicate barcode (excluding this product)
    if (data.barcode && this.productRepo.barcodeExists(data.barcode, id)) {
      const suggested = suggestDuplicateBarcode(data.barcode, (code: string) =>
        this.productRepo.barcodeExists(code, id),
      );
      return {
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: suggested,
      };
    }

    try {
      // Category on UPDATE: omitted/blank means "leave this product's
      // existing category AND category_id exactly as they are" — both keys
      // stay out of the repo payload and `updateProductFull`'s
      // `COALESCE(?, category)` / `COALESCE(?, category_id)` keep the stored
      // values. Desktop cannot reach that branch (`ProductUpdateSchema`
      // requires a non-empty `category`, so `validatePayload` rejects
      // first); the unvalidated REST `PUT /products/:id` can — see the TODO
      // below — and pre-change it NULLed both columns there. A `'General'`
      // fallback would be no better: it silently reclassifies the product
      // and creates a category row the operator never asked for. That
      // default belongs to CREATE alone (`products.category DEFAULT
      // 'General'`, create_db.sql:243 — which in practice never fires
      // either, since `createProduct` rejects a blank category).
      //
      // When a name IS given it is normalized ONCE and both the free-text
      // `category` column and the resolved `category_id` are written from
      // that same value, so this path cannot leave the two disagreeing.
      // `data.category_id` is intentionally NOT forwarded (see
      // resolveCategoryId): the name is authoritative, which is also what
      // the IPC handler did before the resolution moved in here.
      //
      // TODO (rule 19c) — `PUT /api/inventory/products/:id` has no
      // `validateRequest`, so every field it hands us is caller-shaped:
      // that is the durable fix for this whole class of hole, not more
      // defaults down here. `validators/product.ts` already exports
      // `updateProductSchema`, but it speaks the REST field names
      // (`cost_price_usd`, `stock`, …) while this route and
      // `backendApi.updateProduct` send the IPC names (`cost_price`,
      // `stock_quantity`, …) — wiring it up means reconciling those first.
      const categoryName = data.category?.trim();
      this.productRepo.updateProductFull(id, {
        barcode: data.barcode,
        name: data.name,
        ...(categoryName
          ? {
              category: categoryName,
              category_id: this.resolveCategoryId(categoryName),
            }
          : {}),
        cost_price: data.cost_price,
        retail_price: data.retail_price,
        min_stock_level: data.min_stock_level,
        ...(data.image_url != null ? { image_url: data.image_url } : {}),
        supplier: data.supplier ?? null,
        stock_quantity: data.stock_quantity,
        warranty_months: data.warranty_months,
      });
      return { success: true };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "DUPLICATE_BARCODE") {
        return { success: false, error: "Barcode already exists" };
      }
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Soft delete a product, cascading its IN_STOCK IMEI units.
   *
   * Owner decision 2026-08-26 ("zero-burden delete"): deleting a phone model
   * must not leave the operator with leftover paperwork. Its unsold units go
   * with it in the SAME transaction; its SOLD units are never touched (see
   * `ProductUnitRepository.deleteInStockForProducts` for why each half is
   * required — in short, an invisible IN_STOCK unit of a soft-deleted product
   * kept holding its IMEI under the partial unique index, so re-registering
   * that IMEI failed while naming a product the operator could no longer
   * open; a SOLD unit is a customer's warranty provenance).
   *
   * The transaction is owned by the repository layer (rule 13 — this service
   * never touches the DB): `transaction()` is a `BaseRepository` affordance,
   * the same way `PartnerService` and `TenantProvisioningService` wrap their
   * multi-repository units of work. Without it, a failure between the two
   * statements would leave a deleted product with live units or vice versa.
   *
   * `removed_unit_count`/`removed_unit_imeis` are reported back so the UI's
   * confirmation can state what actually happened instead of hiding it. They
   * are absent (not `0`) when the product had no units at all, so a caller
   * can tell "no units" from "units removed: none".
   *
   * LIRA-148: on a pre-v157 schema (or a hand-built test schema) that has no
   * `product_units` table at all, the cascade query itself would throw and
   * roll back the whole transaction — losing the soft delete along with a
   * cascade that was never applicable to begin with. Asked via
   * `ProductUnitRepository.productUnitsTableExists()` (rule 13 — this
   * service never probes `sqlite_master` itself) and, when absent, the
   * cascade is skipped in favour of the query's own empty-result shape
   * (`{ count: 0, imeis: [] }`, same as "no units" today) — only the
   * cascade is skipped, the soft delete always runs.
   */
  deleteProduct(id: number): ProductResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    try {
      const removed = this.productUnitRepo.transaction(() => {
        this.productRepo.softDeleteById(id);
        return this.productUnitRepo.productUnitsTableExists()
          ? this.productUnitRepo.deleteInStockForProduct(id)
          : { count: 0, imeis: [] };
      });
      if (removed.count === 0) return { success: true };
      inventoryLogger.info(
        { productId: id, removedUnits: removed.count },
        "Product soft-deleted with its in-stock IMEI units",
      );
      return {
        success: true,
        removed_unit_count: removed.count,
        removed_unit_imeis: removed.imeis,
      };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Soft delete multiple products in a single operation.
   * Returns `{ success, deleted }` with the count of affected rows.
   *
   * Cascades IN_STOCK units for EVERY id, exactly as `deleteProduct` does for
   * one — the batch path is reached from the inventory grid's multi-select, so
   * skipping it here would leave the identical orphaned-IMEI bug behind a
   * different button (the trap rule 20 warns about: extending a capability to
   * a second call site re-triggers the obligation).
   *
   * LIRA-148: same pre-v157/table-absent guard as `deleteProduct` — the
   * batch soft delete always runs; only the cascade is skipped when
   * `product_units` doesn't exist yet.
   */
  batchDeleteProducts(ids: number[]): {
    success: boolean;
    deleted?: number;
    removed_unit_count?: number;
    removed_unit_imeis?: string[];
    error?: string;
  } {
    if (!ids || ids.length === 0) {
      return { success: false, error: "No product IDs provided" };
    }
    try {
      const { deleted, removed } = this.productUnitRepo.transaction(() => {
        const deletedCount = this.productRepo.batchSoftDelete(ids);
        return {
          deleted: deletedCount,
          removed: this.productUnitRepo.productUnitsTableExists()
            ? this.productUnitRepo.deleteInStockForProducts(ids)
            : { count: 0, imeis: [] },
        };
      });
      if (removed.count === 0) return { success: true, deleted };
      inventoryLogger.info(
        { productIds: ids, removedUnits: removed.count },
        "Products soft-deleted with their in-stock IMEI units",
      );
      return {
        success: true,
        deleted,
        removed_unit_count: removed.count,
        removed_unit_imeis: removed.imeis,
      };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Stock Management
  // ---------------------------------------------------------------------------

  /**
   * Set stock to absolute value.
   *
   * LIRA-077: `reason` and `userId` are required — every manual correction
   * is written to the `stock_adjustments` audit trail (ProductRepository
   * owns the repo-level transaction; this service never touches the DB).
   * `userId` is null only when the caller genuinely couldn't attribute one
   * (e.g. auth lookup failed) — the FK is ON DELETE SET NULL, so the column
   * itself is nullable, but every real caller should supply a userId.
   */
  adjustStock(
    id: number,
    newQuantity: number,
    reason: string,
    userId: number | null,
  ): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }
    if (newQuantity < 0) {
      return { success: false, error: "Stock quantity cannot be negative" };
    }
    if (!reason?.trim()) {
      return { success: false, error: "Reason is required" };
    }

    try {
      const changed = this.productRepo.adjustStock(
        id,
        newQuantity,
        reason.trim(),
        userId ?? null,
      );
      if (!changed) {
        return { success: false, error: "Product not found" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Increment or decrement stock by a delta.
   *
   * LIRA-077: same reason/userId + audit-trail contract as {@link adjustStock}.
   */
  adjustStockDelta(
    id: number,
    delta: number,
    reason: string,
    userId: number | null,
  ): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }
    if (!reason?.trim()) {
      return { success: false, error: "Reason is required" };
    }

    try {
      const changed = this.productRepo.adjustStockDelta(
        id,
        delta,
        reason.trim(),
        userId ?? null,
      );
      if (!changed) {
        return { success: false, error: "Product not found" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Stock adjustment audit history — scoped to one product, or the most
   * recent adjustments across all products when productId is omitted.
   */
  getStockAdjustments(productId?: number): StockAdjustmentWithUser[] {
    if (productId) {
      return this.stockAdjustmentRepo.getByProduct(productId);
    }
    return this.stockAdjustmentRepo.getRecent();
  }

  /**
   * Deduct stock for a completed sale
   */
  deductStockForSale(saleId: number): void {
    this.productRepo.deductStockForSale(saleId);
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /**
   * Get stock statistics (budget and count)
   */
  getStockStats(): StockStats {
    return this.productRepo.getStockStats();
  }

  /**
   * Get products that are at or below minimum stock level
   */
  getLowStockProducts(): LowStockProduct[] {
    return this.productRepo.findLowStock();
  }

  /**
   * Products at negative stock (oversold — need reconciliation).
   */
  getNegativeStockProducts(): NegativeStockProduct[] {
    return this.productRepo.findNegativeStock();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let inventoryServiceInstance: InventoryService | null = null;

export function getInventoryService(): InventoryService {
  if (!inventoryServiceInstance) {
    inventoryServiceInstance = new InventoryService();
  }
  return inventoryServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetInventoryService(): void {
  inventoryServiceInstance = null;
}
