/**
 * Shared maintenance-parts stock helpers (LIRA-176 phase 3).
 *
 * Both `MaintenanceRepository` (unpaid job deleted, or a part line removed
 * via `syncParts`) and, from phase 4, `TransactionRepository` (job voided or
 * refunded) need to put a maintenance job's consumed parts back on the
 * shelf. `MaintenanceRepository` already imports `getTransactionRepository`,
 * so having `TransactionRepository` import `MaintenanceRepository` back
 * would create an import cycle. This standalone module breaks that cycle and
 * — per CLAUDE.md rule 14 — keeps the restore/recompute logic defined
 * exactly once instead of being copy-pasted the way
 * `TransactionRepository._restoreCustomServiceStock` had to.
 */
import type Database from "better-sqlite3";
import { getStockBatchRepository } from "./StockBatchRepository.js";

/**
 * Recompute and persist `maintenance.parts_cost_usd` / `parts_price_usd` from
 * the job's current (non-deleted) `maintenance_parts` rows. Plain USD sums —
 * parts are always priced/costed in USD (products only carry
 * `cost_price_usd` / `selling_price_usd`), so there is no rate and no
 * conversion anywhere in this function. `0` when the job has no parts left.
 */
export function recomputeMaintenancePartsTotals(
  db: Database.Database,
  maintenanceId: number,
  tenantId: number,
): void {
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(quantity * unit_cost_usd), 0) AS cost_usd,
         COALESCE(SUM(quantity * unit_price_usd), 0) AS price_usd
       FROM maintenance_parts
       WHERE maintenance_id = ? AND tenant_id = ?`,
    )
    .get(maintenanceId, tenantId) as { cost_usd: number; price_usd: number };

  db.prepare(
    `UPDATE maintenance
     SET parts_cost_usd = ?, parts_price_usd = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`,
  ).run(totals.cost_usd, totals.price_usd, maintenanceId, tenantId);
}

/**
 * Restore stock for a maintenance job's attached parts — used when an unpaid
 * job is deleted, and (phase 4) when a paid job's transaction is voided or
 * refunded.
 *
 * The `stock_restored = 0` filter below IS the double-restore guard: the
 * owner's flow allows refunding a job and THEN editing or deleting it, so
 * this function must be safely callable more than once for the same job (or
 * the same part) without returning units twice. Once a row's
 * `stock_restored` flips to 1 it is permanently excluded from future calls.
 *
 * Pass `opts.partId` to restore a single part line (e.g. `syncParts` removing
 * one row); omit it to restore every not-yet-restored part on the job (e.g.
 * `deleteJob`, or a full job void/refund).
 */
export function restoreMaintenanceJobParts(
  db: Database.Database,
  opts: { maintenanceId: number; tenantId: number; partId?: number },
): void {
  const { maintenanceId, tenantId, partId } = opts;

  const rows = (
    partId != null
      ? db
          .prepare(
            `SELECT id, product_id, quantity FROM maintenance_parts
             WHERE maintenance_id = ? AND tenant_id = ? AND stock_restored = 0 AND id = ?`,
          )
          .all(maintenanceId, tenantId, partId)
      : db
          .prepare(
            `SELECT id, product_id, quantity FROM maintenance_parts
             WHERE maintenance_id = ? AND tenant_id = ? AND stock_restored = 0`,
          )
          .all(maintenanceId, tenantId)
  ) as { id: number; product_id: number; quantity: number }[];

  const restoreProductStock = db.prepare(
    `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
  );
  const markRestored = db.prepare(
    `UPDATE maintenance_parts SET stock_restored = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`,
  );

  for (const row of rows) {
    restoreProductStock.run(row.quantity, row.product_id, tenantId);
    getStockBatchRepository().restoreForMaintenancePart(row.id);
    markRestored.run(row.id, tenantId);
  }

  recomputeMaintenancePartsTotals(db, maintenanceId, tenantId);
}
