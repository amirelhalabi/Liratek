/**
 * Product Unit Service — orchestration over `ProductUnitRepository`
 * (LIRA-143 Phase 2, current_sprint.md, owner-interviewed 2026-08-23).
 *
 * Thin pass-throughs plus two pieces of actual logic:
 *   - `registerUnits` validates the product exists, delegates the batch
 *     insert, then reports (never blocks on) the intake-vs-`stock_quantity`
 *     drift (owner decision #6 — warn only; the caller renders the warning).
 *   - `computeWarrantyStatus` is a pure, DB-free function implementing
 *     decision #11's lookup precedence exactly; `getUnitStory` stamps it
 *     onto every row `ProductUnitRepository.getUnitStoryByImei` returns.
 *
 * Nothing here touches the database directly (rule 13) — every read/write
 * goes through the injected repositories.
 */

import {
  getProductUnitRepository,
  type ProductUnitRepository,
  type ProductUnitEntity,
  type ProductUnitStatus,
  type ProductUnitSummary,
  type UnitStory,
  type UnitListFilters,
  type UnitListRow,
} from "../repositories/ProductUnitRepository.js";
import {
  getProductRepository,
  type ProductRepository,
} from "../repositories/ProductRepository.js";
import { inventoryLogger } from "../utils/logger.js";

// =============================================================================
// Warranty status — pure, unit-testable, no DB
// =============================================================================

export type WarrantySource = "OVERRIDE" | "REFUND" | "SALE" | null;
export type WarrantyState = "COVERED" | "EXPIRED" | "VOID" | "NONE";

export interface WarrantyStatusInput {
  overrideUntil: string | null;
  saleRefunded: boolean;
  stampedUntil: string | null;
  /** ISO date (`YYYY-MM-DD`) — plain string comparison against `overrideUntil`/
   *  `stampedUntil` is safe because both are also ISO dates. */
  today: string;
}

export interface WarrantyStatus {
  source: WarrantySource;
  until: string | null;
  state: WarrantyState;
}

/**
 * Owner decision #11's exact precedence:
 *   (a) an operator-set `overrideUntil` always wins, covered/expired by date;
 *   (b) otherwise a refunded sale voids the warranty outright — a refunded
 *       phone has no warranty left to check, regardless of what the sale
 *       line stamped;
 *   (c) otherwise the sale's own `stampedUntil`, covered/expired by date;
 *   (d) otherwise there was never a warranty to speak of.
 * ISO-date string comparison (`>=`) is safe for `YYYY-MM-DD` values — the
 * boundary `until === today` is `COVERED` (the last day of coverage still
 * counts).
 */
export function computeWarrantyStatus(
  input: WarrantyStatusInput,
): WarrantyStatus {
  if (input.overrideUntil) {
    return {
      source: "OVERRIDE",
      until: input.overrideUntil,
      state: input.overrideUntil >= input.today ? "COVERED" : "EXPIRED",
    };
  }
  if (input.saleRefunded) {
    return { source: "REFUND", until: null, state: "VOID" };
  }
  if (input.stampedUntil) {
    return {
      source: "SALE",
      until: input.stampedUntil,
      state: input.stampedUntil >= input.today ? "COVERED" : "EXPIRED",
    };
  }
  return { source: null, until: null, state: "NONE" };
}

/** `sale_items.is_refunded` truthy OR `refunded_quantity >= quantity`
 *  (quantity may be 1) — a unit that was never sold (`sale_item_id` null,
 *  every joined sale field null) is never "refunded". */
function isSaleRefunded(row: UnitStory): boolean {
  if (row.sale_item_id === null) return false;
  const quantity = row.quantity ?? 0;
  const refundedQuantity = row.refunded_quantity ?? 0;
  return !!row.is_refunded || (quantity > 0 && refundedQuantity >= quantity);
}

export interface UnitStoryWithWarranty extends UnitStory {
  warranty: WarrantyStatus;
}

/**
 * One Phone Units management-view row, warranty-stamped by the SAME
 * {@link computeWarrantyStatus} precedence `getUnitStory` uses — a given
 * unit must never show "COVERED" in the list and "VOID" in the walk-in
 * lookup. The list row carries the repository's pre-derived
 * `sale_refunded` flag (the SQL twin of {@link isSaleRefunded}) rather than
 * the raw `is_refunded`/`quantity`/`refunded_quantity` triple.
 */
export type UnitListRowWithWarranty = UnitListRow & {
  warranty: WarrantyStatus;
};

export interface UnitListResult {
  rows: UnitListRowWithWarranty[];
  total: number;
}

// =============================================================================
// Other method input/output types
// =============================================================================

export interface RegisterUnitsDrift {
  inStockUnits: number;
  stockQuantity: number;
  matches: boolean;
}

export interface RegisterUnitsResult {
  units: ProductUnitEntity[];
  drift: RegisterUnitsDrift;
}

// =============================================================================
// Service
// =============================================================================

export class ProductUnitService {
  private repo: ProductUnitRepository;
  private productRepo: ProductRepository;

  constructor(repo?: ProductUnitRepository, productRepo?: ProductRepository) {
    this.repo = repo ?? getProductUnitRepository();
    this.productRepo = productRepo ?? getProductRepository();
  }

  /**
   * Intake registration. Validates the product exists first (a clear
   * "product not found" beats a confusing FK failure from the repository),
   * delegates the batch insert/validation to
   * `ProductUnitRepository.addUnits`, then computes the intake-vs-
   * `stock_quantity` drift. The drift NEVER blocks (decision #6) — it is
   * returned for the caller to render as a warning, never thrown.
   */
  registerUnits(productId: number, imeis: string[]): RegisterUnitsResult {
    try {
      const product = this.productRepo.findById(productId);
      if (!product) {
        throw new Error(`registerUnits: product ${productId} not found`);
      }

      const units = this.repo.addUnits(productId, imeis);
      const inStockUnits = this.repo.countInStock(productId);
      const stockQuantity = product.stock_quantity;

      inventoryLogger.info(
        {
          productId,
          added: units.length,
          inStockUnits,
          stockQuantity,
        },
        "Product units registered",
      );

      return {
        units,
        drift: {
          inStockUnits,
          stockQuantity,
          matches: inStockUnits === stockQuantity,
        },
      };
    } catch (error) {
      inventoryLogger.error({ error, productId }, "registerUnits failed");
      throw error;
    }
  }

  getUnitsForProduct(
    productId: number,
    status?: ProductUnitStatus,
  ): ProductUnitEntity[] {
    try {
      return this.repo.getUnitsForProduct(productId, status);
    } catch (error) {
      inventoryLogger.error({ error, productId }, "getUnitsForProduct failed");
      throw error;
    }
  }

  getSummaryForProducts(
    productIds: number[],
  ): Record<number, ProductUnitSummary> {
    try {
      return this.repo.getSummaryForProducts(productIds);
    } catch (error) {
      inventoryLogger.error({ error, productIds }, "getSummaryForProducts failed");
      throw error;
    }
  }

  deleteUnit(unitId: number): void {
    try {
      this.repo.deleteUnit(unitId);
    } catch (error) {
      inventoryLogger.error({ error, unitId }, "deleteUnit failed");
      throw error;
    }
  }

  findActiveByImei(imei: string): ProductUnitEntity | null {
    try {
      return this.repo.findActiveByImei(imei);
    } catch (error) {
      inventoryLogger.error({ error, imei }, "findActiveByImei failed");
      throw error;
    }
  }

  /**
   * Phase 6 refund UI — the units linked to a sale being refunded (imei +
   * defective checkbox + warranty-override date per unit), thin pass-through
   * to `ProductUnitRepository.findBySaleItemIds`.
   */
  getUnitsForSaleItems(saleItemIds: number[]): ProductUnitEntity[] {
    try {
      return this.repo.findBySaleItemIds(saleItemIds);
    } catch (error) {
      inventoryLogger.error(
        { error, saleItemIds },
        "getUnitsForSaleItems failed",
      );
      throw error;
    }
  }

  /**
   * The Phone Units management view: one filtered, paginated page of units
   * across all products, each stamped with its computed
   * {@link WarrantyStatus} — the same `computeWarrantyStatus` call
   * `getUnitStory` makes, fed the same three inputs (override date, refund
   * flag, sale-stamped date), so the two reads can never disagree about a
   * unit's verdict. `today` defaults to the current date (ISO,
   * `YYYY-MM-DD`) and is injectable for tests.
   *
   * `total` passes through untouched from the repository — it is the
   * unpaged count over the same filters, for the pager.
   *
   * The row spread also carries the repository's `product_warranty_months`
   * (the owning MODEL's warranty term) through to the caller UNTOUCHED. It is
   * deliberately NOT one of `computeWarrantyStatus`'s inputs: decision #4
   * starts the clock at the sale and decision #11's precedence is
   * owner-locked, so a model's term can never retro-stamp coverage onto a
   * unit — it exists only so the UI can label unsold stock with the term it
   * WILL get ("6 mo — starts at sale") instead of a misleading "No warranty".
   */
  listUnits(
    filters: UnitListFilters,
    today: string = new Date().toISOString().slice(0, 10),
  ): UnitListResult {
    try {
      const page = this.repo.listUnits(filters);
      return {
        rows: page.rows.map((row) => ({
          ...row,
          warranty: computeWarrantyStatus({
            overrideUntil: row.warranty_override_until,
            saleRefunded: row.sale_refunded === 1,
            stampedUntil: row.warranty_until,
            today,
          }),
        })),
        total: page.total,
      };
    } catch (error) {
      inventoryLogger.error({ error, filters }, "listUnits failed");
      throw error;
    }
  }

  /**
   * The walk-in lookup (decision #7): every unit matching `imei`, each
   * stamped with its computed {@link WarrantyStatus}. `today` defaults to
   * the current date (ISO, `YYYY-MM-DD`) and is injectable for tests.
   *
   * As in `listUnits`, the row spread carries `product_warranty_months`
   * (display-only model term) through untouched and never feeds it to
   * `computeWarrantyStatus`.
   */
  getUnitStory(
    imei: string,
    today: string = new Date().toISOString().slice(0, 10),
  ): UnitStoryWithWarranty[] {
    try {
      const rows = this.repo.getUnitStoryByImei(imei);
      return rows.map((row) => ({
        ...row,
        warranty: computeWarrantyStatus({
          overrideUntil: row.warranty_override_until,
          saleRefunded: isSaleRefunded(row),
          stampedUntil: row.warranty_until,
          today,
        }),
      }));
    } catch (error) {
      inventoryLogger.error({ error, imei }, "getUnitStory failed");
      throw error;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let productUnitServiceInstance: ProductUnitService | null = null;

export function getProductUnitService(): ProductUnitService {
  if (!productUnitServiceInstance) {
    productUnitServiceInstance = new ProductUnitService();
  }
  return productUnitServiceInstance;
}

export function resetProductUnitService(): void {
  productUnitServiceInstance = null;
}
