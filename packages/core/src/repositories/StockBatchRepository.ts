/**
 * Stock Batch Repository (Supplier Stock Intake — LIRA event-based supplier
 * debt, SUPPLIER_STOCK_INTAKE_PLAN.md)
 *
 * A "batch" is one receipt of stock for one product: a specific quantity
 * bought at a specific unit cost, on a specific date, optionally from a
 * specific supplier. Unit cost lives HERE — one row per intake — rather than
 * as a single `products.cost_price_usd` column, because a product's cost
 * changes over time as it is restocked at different prices; a single column
 * can only ever hold the LATEST price, and a sale made today should be costed
 * against the batch(es) it actually came from, not whatever price happens to
 * be on the product row at sale time.
 *
 * FIFO (oldest-batch-first) is the sane physical model for how stock actually
 * leaves the shop, and — more importantly for the accounting — it is the only
 * ordering that keeps `getStockValueBySupplier()` (open remaining stock ×
 * cost) truthful without a parallel recomputation. `sale_items.
 * cost_price_snapshot_usd` is written by `SalesRepository.processSale` from
 * this repository's `consume()` result and is the SINGLE integration point
 * with every profit query in the codebase (`ProfitRepository` and friends all
 * read that column) — that is precisely why this build needs NO profit-code
 * changes: profit already trusts whatever unit cost is snapshotted on the
 * sale item, and this repository is now the one that decides that number.
 *
 * FIFO order is ALWAYS `ORDER BY created_at ASC, id ASC` — `created_at` is
 * second-granular in this DB, so two batches inserted in the same second
 * would tie without the `id` tiebreaker. Defined once as `FIFO_ORDER` and
 * reused everywhere (rule 14 — never re-derive a business-rule predicate).
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { allocateFifo, type FifoOpenRow } from "../utils/fifoCoverage.js";

// =============================================================================
// Types
// =============================================================================

export interface StockBatchEntity {
  id: number;
  tenant_id: number;
  product_id: number;
  supplier_id: number | null;
  quantity: number;
  quantity_remaining: number;
  unit_cost_usd: number;
  books_debt: number;
  ledger_entry_id: number | null;
  transaction_id: number | null;
  is_opening: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStockBatchData {
  product_id: number;
  supplier_id: number | null;
  quantity: number;
  unit_cost_usd: number;
  books_debt: boolean;
  ledger_entry_id?: number | null;
  transaction_id?: number | null;
  is_opening?: boolean;
  created_by: number | null;
}

/** One batch's contribution to a `consume()` call. */
export interface BatchTake {
  batch_id: number;
  quantity: number;
  unit_cost_usd: number;
}

export interface ConsumeResult {
  takes: BatchTake[];
  totalCostUsd: number;
  weightedUnitCostUsd: number;
  uncoveredQuantity: number;
}

type ConsumeReason = "SALE" | "ADJUSTMENT" | "SERVICE";

interface ConsumptionRow {
  id: number;
  batch_id: number;
  sale_item_id: number | null;
  quantity: number;
  unit_cost_usd: number;
  is_restored: number;
}

/**
 * `stock_batch_consumptions` traces each take back to whichever caller
 * consumed it via TWO nullable owner columns — `sale_item_id` and
 * `custom_service_id` — rather than one polymorphic `owner_id` + a type
 * column. A real foreign key per source lets the database itself enforce the
 * link and cascade (`ON DELETE SET NULL`) correctly for that specific
 * parent table; a shared `owner_id` column cannot reference two different
 * tables at once, so nothing would stop it pointing at a row that never
 * existed in either.
 */
type ConsumptionOwnerColumn =
  | "sale_item_id"
  | "custom_service_id"
  | "maintenance_part_id";

// =============================================================================
// Constants
// =============================================================================

/**
 * The ONE FIFO ordering, reused by every read path below (rule 14). Batches
 * are consumed and listed oldest-first; `id` breaks same-second ties.
 */
const FIFO_ORDER = "ORDER BY created_at ASC, id ASC";

// =============================================================================
// Repository
// =============================================================================

export class StockBatchRepository extends BaseRepository<StockBatchEntity> {
  constructor() {
    super("product_stock_batches", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, tenant_id, product_id, supplier_id, quantity, quantity_remaining, unit_cost_usd, books_debt, ledger_entry_id, transaction_id, is_opening, created_by, created_at, updated_at";
  }

  /**
   * Insert one batch. `quantity_remaining` starts equal to `quantity` — a
   * fresh intake has consumed nothing yet.
   */
  createBatch(data: CreateStockBatchData): number {
    try {
      const tenantId = getCurrentTenantId();
      const result = this.execute(
        `INSERT INTO product_stock_batches (
          tenant_id, product_id, supplier_id, quantity, quantity_remaining,
          unit_cost_usd, books_debt, ledger_entry_id, transaction_id,
          is_opening, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        tenantId,
        data.product_id,
        data.supplier_id,
        data.quantity,
        data.quantity,
        data.unit_cost_usd,
        data.books_debt ? 1 : 0,
        data.ledger_entry_id ?? null,
        data.transaction_id ?? null,
        data.is_opening ? 1 : 0,
        data.created_by,
      );
      return result.lastInsertRowid as number;
    } catch (error) {
      throw new DatabaseError("Failed to create stock batch", {
        cause: error,
      });
    }
  }

  /** All batches for a product, FIFO order (oldest first). */
  listByProduct(productId: number): StockBatchEntity[] {
    return this.query<StockBatchEntity>(
      `SELECT ${this.getColumns()} FROM product_stock_batches
       WHERE product_id = ? AND tenant_id = ? ${FIFO_ORDER}`,
      productId,
      getCurrentTenantId(),
    );
  }

  /** Only batches with stock left to consume, FIFO order. */
  listOpenByProduct(productId: number): StockBatchEntity[] {
    return this.query<StockBatchEntity>(
      `SELECT ${this.getColumns()} FROM product_stock_batches
       WHERE product_id = ? AND tenant_id = ? AND quantity_remaining > 0
       ${FIFO_ORDER}`,
      productId,
      getCurrentTenantId(),
    );
  }

  findByTransactionId(transactionId: number): StockBatchEntity | undefined {
    return (
      this.queryOne<StockBatchEntity>(
        `SELECT ${this.getColumns()} FROM product_stock_batches
         WHERE transaction_id = ? AND tenant_id = ?`,
        transactionId,
        getCurrentTenantId(),
      ) ?? undefined
    );
  }

  findByLedgerEntryId(ledgerEntryId: number): StockBatchEntity | undefined {
    return (
      this.queryOne<StockBatchEntity>(
        `SELECT ${this.getColumns()} FROM product_stock_batches
         WHERE ledger_entry_id = ? AND tenant_id = ?`,
        ledgerEntryId,
        getCurrentTenantId(),
      ) ?? undefined
    );
  }

  /**
   * FIFO-consume `quantity` units of `productId`.
   *
   * MUST NEVER THROW on insufficient batch cover: a sale (or any other stock
   * movement) must never fail because of batch bookkeeping — batches are a
   * costing/valuation ledger layered on top of `products.stock_quantity`,
   * not the source of truth for whether stock exists. Two legitimate cases
   * exceed available batch cover on purpose: (1) legacy stock that predates
   * this feature has no batches at all, and (2) `allowOutOfStock` sales are
   * explicitly allowed to sell more than is on hand. In both cases the
   * shortfall is reported via `uncoveredQuantity` and priced at
   * `opts.fallbackUnitCostUsd` (the caller passes the product's current
   * `cost_price_usd`, matching the pre-batch behavior exactly) so a cost is
   * still stamped on the sale item.
   *
   * Reuses `allocateFifo` (utils/fifoCoverage.ts) for the actual walk — same
   * "oldest-first, clamp take at what's left" algorithm as every other FIFO
   * coverage site in the repo (debt/partner/supplier payment coverage).
   * `epsilon = 0` because batch quantities are whole units, never fractional
   * money — the only sensible cutoff is "nothing left."
   *
   * Insufficient cover vs. a genuine write failure are NOT the same thing,
   * and only the first is swallowed. Insufficient cover (legacy stock with no
   * batches, or an `allowOutOfStock` sale exceeding what's on hand) is a
   * normal, expected condition — it is handled via `uncoveredQuantity` /
   * `fallbackUnitCostUsd` and this method returns normally. A genuine DB
   * error (the consumption INSERT or the batch UPDATE failing) is NOT
   * swallowed — it propagates like any other repository method, because
   * `consume()` runs inside the caller's (the sale's) db transaction: letting
   * it throw rolls the whole sale back. Catching it here instead would leave
   * a committed sale with a fabricated fallback-priced cost snapshot and
   * missing/partial consumption rows — batches silently out of sync with
   * `products.stock_quantity` with no trace of why. Do not re-add a
   * catch-all around this method for that reason.
   */
  consume(
    productId: number,
    quantity: number,
    opts: {
      saleItemId?: number | null;
      /** An inventory-backed custom service consuming a batch unit. Mutually
       *  exclusive with `saleItemId` in practice (a consumption row is owned
       *  by exactly one source), both are optional so a caller passes only
       *  the one that applies. */
      customServiceId?: number | null;
      /** A maintenance job's attached part consuming batch units. Mutually
       *  exclusive in practice with saleItemId/customServiceId (a consumption
       *  row is owned by exactly one source). */
      maintenancePartId?: number | null;
      reason: ConsumeReason;
      fallbackUnitCostUsd: number;
    },
  ): ConsumeResult {
    if (quantity <= 0) {
      return {
        takes: [],
        totalCostUsd: 0,
        weightedUnitCostUsd: 0,
        uncoveredQuantity: 0,
      };
    }

    const tenantId = getCurrentTenantId();
    const openBatches = this.listOpenByProduct(productId);
    const openRows: FifoOpenRow[] = openBatches.map((b) => ({
      id: b.id,
      outstanding: b.quantity_remaining,
    }));

    const allocations = allocateFifo(openRows, quantity, 0);
    const batchById = new Map(openBatches.map((b) => [b.id, b]));

    const takes: BatchTake[] = [];
    let coveredQuantity = 0;
    let totalCostUsd = 0;

    const insertConsumption = this.db.prepare(
      `INSERT INTO stock_batch_consumptions (
        tenant_id, batch_id, sale_item_id, custom_service_id, maintenance_part_id,
        product_id, quantity, unit_cost_usd, reason, is_restored, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const decrementBatch = this.db.prepare(
      `UPDATE product_stock_batches
       SET quantity_remaining = quantity_remaining - ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
    );

    for (const alloc of allocations) {
      const batch = batchById.get(alloc.id as number);
      if (!batch) continue; // defensive; allocateFifo only returns ids we gave it
      const takeQty = alloc.take;

      decrementBatch.run(takeQty, batch.id, tenantId);
      insertConsumption.run(
        tenantId,
        batch.id,
        opts.saleItemId ?? null,
        opts.customServiceId ?? null,
        opts.maintenancePartId ?? null,
        productId,
        takeQty,
        batch.unit_cost_usd,
        opts.reason,
      );

      takes.push({
        batch_id: batch.id,
        quantity: takeQty,
        unit_cost_usd: batch.unit_cost_usd,
      });
      coveredQuantity += takeQty;
      totalCostUsd += takeQty * batch.unit_cost_usd;
    }

    const uncoveredQuantity = quantity - coveredQuantity;
    if (uncoveredQuantity > 0) {
      // Insufficient cover — the expected, non-error case documented above.
      // Priced at the fallback cost and reported via uncoveredQuantity;
      // never thrown.
      totalCostUsd += uncoveredQuantity * opts.fallbackUnitCostUsd;
    }

    const weightedUnitCostUsd = quantity > 0 ? totalCostUsd / quantity : 0;

    return { takes, totalCostUsd, weightedUnitCostUsd, uncoveredQuantity };
  }

  /**
   * Shared walk behind `restoreForSaleItem` / `restoreForCustomService`
   * (rule 14 — the two public methods differ only in which owner column
   * they filter on, so the FIFO-reversal logic lives here exactly once).
   *
   * Give consumed units back to the batches they came from. Walks this
   * owner's (non-restored) consumption rows NEWEST FIRST — the mirror image
   * of FIFO consumption, so a partial restore unwinds the most recent
   * draw-down first rather than reaching back into stock that was already
   * fully re-settled. With no `quantity` argument, restores everything not
   * yet restored; with one, restores only that many units, splitting the
   * newest row (reducing its `quantity`, leaving it `is_restored = 0`) when
   * the requested amount doesn't exactly cover it. A row is marked
   * `is_restored = 1` only once FULLY restored — that flag is what stops the
   * same units being restored twice on a second restore call for the same
   * owner.
   */
  private _restoreConsumptions(
    ownerColumn: ConsumptionOwnerColumn,
    ownerId: number,
    quantity: number | undefined,
  ): void {
    try {
      const tenantId = getCurrentTenantId();
      const rows = this.query<ConsumptionRow>(
        `SELECT id, batch_id, sale_item_id, quantity, unit_cost_usd, is_restored
         FROM stock_batch_consumptions
         WHERE ${ownerColumn} = ? AND tenant_id = ? AND is_restored = 0
         ORDER BY created_at DESC, id DESC`,
        ownerId,
        tenantId,
      );

      let remaining = quantity ?? Infinity;
      if (remaining <= 0) return;

      const incrementBatch = this.db.prepare(
        `UPDATE product_stock_batches
         SET quantity_remaining = quantity_remaining + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      );
      const markFullyRestored = this.db.prepare(
        `UPDATE stock_batch_consumptions
         SET is_restored = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      );
      const reduceConsumption = this.db.prepare(
        `UPDATE stock_batch_consumptions
         SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      );

      for (const row of rows) {
        if (remaining <= 0) break;
        const give = Math.min(remaining, row.quantity);
        if (give <= 0) continue;

        incrementBatch.run(give, row.batch_id, tenantId);

        if (give >= row.quantity) {
          markFullyRestored.run(row.id, tenantId);
        } else {
          reduceConsumption.run(give, row.id, tenantId);
        }

        remaining -= give;
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to restore stock batch consumptions for ${ownerColumn}`,
        { cause: error, entityId: ownerId },
      );
    }
  }

  /**
   * Sale refund path — see `_restoreConsumptions` for the full semantics.
   * Named for its own source (rather than a single generic `restore(...)`)
   * because callers read better naming the thing they're actually undoing.
   */
  restoreForSaleItem(saleItemId: number, quantity?: number): void {
    this._restoreConsumptions("sale_item_id", saleItemId, quantity);
  }

  /**
   * Custom-service void path — an inventory-backed custom service consumes a
   * batch unit the same way a sale item does, but it cannot use
   * `sale_item_id` (that foreign key points at `sale_items`, not
   * `custom_services` — using it here would either violate the FK or
   * silently misattribute the row). Voiding such a service must return its
   * unit the same way a sale refund does, or the create-then-void cycle
   * leaks batch cover permanently and later sales silently fall through to
   * fallback pricing. See `_restoreConsumptions` for the full semantics.
   */
  restoreForCustomService(customServiceId: number, quantity?: number): void {
    this._restoreConsumptions("custom_service_id", customServiceId, quantity);
  }

  /**
   * Maintenance-part void/refund path — a maintenance job's attached part
   * consumes a batch unit the same way a sale item does, but it cannot use
   * `sale_item_id` (that foreign key points at `sale_items`, not
   * `maintenance_parts` — using it here would either violate the FK or
   * silently misattribute the row) nor `custom_service_id` (that points at
   * `custom_services`). Refunding or voiding the job, deleting an unpaid job,
   * or removing the part line must return those units the same way a sale
   * refund does, or the create-then-reverse cycle leaks batch cover
   * permanently and later sales silently fall through to fallback pricing.
   * See `_restoreConsumptions` for the full semantics.
   */
  restoreForMaintenancePart(
    maintenancePartId: number,
    quantity?: number,
  ): void {
    this._restoreConsumptions(
      "maintenance_part_id",
      maintenancePartId,
      quantity,
    );
  }

  /**
   * Void an intake batch. Refuses (returns `false`) when any unit of the
   * batch has already been consumed (`quantity_remaining < quantity`) — the
   * caller (the SUPPLIER_STOCK_INTAKE void path) must then refuse the void
   * rather than silently deleting a batch that sales already relied on for
   * costing. When untouched, deletes the (necessarily unrestored — nothing
   * was consumed) consumption rows if any exist, then the batch row itself.
   */
  deleteBatchForVoid(batchId: number): boolean {
    try {
      const tenantId = getCurrentTenantId();
      const batch = this.queryOne<StockBatchEntity>(
        `SELECT ${this.getColumns()} FROM product_stock_batches
         WHERE id = ? AND tenant_id = ?`,
        batchId,
        tenantId,
      );
      if (!batch) return false;
      if (batch.quantity_remaining < batch.quantity) return false;

      this.execute(
        `DELETE FROM stock_batch_consumptions
         WHERE batch_id = ? AND tenant_id = ? AND is_restored = 0`,
        batchId,
        tenantId,
      );
      this.execute(
        `DELETE FROM product_stock_batches WHERE id = ? AND tenant_id = ?`,
        batchId,
        tenantId,
      );
      return true;
    } catch (error) {
      throw new DatabaseError("Failed to delete stock batch for void", {
        cause: error,
        entityId: batchId,
      });
    }
  }

  /**
   * Informational: current open (unconsumed) stock value per supplier,
   * `SUM(quantity_remaining * unit_cost_usd)`. Excludes batches with no
   * supplier (opening/no-supplier stock has nothing to report per-supplier).
   */
  getStockValueBySupplier(): {
    supplier_id: number;
    stock_value_usd: number;
  }[] {
    return this.query<{ supplier_id: number; stock_value_usd: number }>(
      `SELECT supplier_id, SUM(quantity_remaining * unit_cost_usd) AS stock_value_usd
       FROM product_stock_batches
       WHERE tenant_id = ? AND supplier_id IS NOT NULL
       GROUP BY supplier_id`,
      getCurrentTenantId(),
    );
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: StockBatchRepository | null = null;

export function getStockBatchRepository(): StockBatchRepository {
  if (!instance) {
    instance = new StockBatchRepository();
  }
  return instance;
}

export function resetStockBatchRepository(): void {
  instance = null;
}
