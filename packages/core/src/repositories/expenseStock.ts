/**
 * LIRA-262 — stock reversal for a "shop used its own stock" expense.
 *
 * `TransactionRepository` (generic void/refund) is the reversal owner (rule
 * 20) for an EXPENSE_INVENTORY transaction, but `ExpenseRepository` already
 * imports `getTransactionRepository`, so the reverse import would create a
 * cycle. This standalone module breaks it — the same move
 * `maintenancePartsStock.ts` made for maintenance parts.
 *
 * Only INVENTORY expenses touch stock. A Katsh / iPick / Whish App expense's
 * only side effect is its provider-drawer `payments` row, which the generic,
 * type-agnostic `_reversePayments` already reverses — nothing to do here.
 */
import type Database from "better-sqlite3";
import { getStockBatchRepository } from "./StockBatchRepository.js";

/**
 * Put an inventory expense's units back: `products.stock_quantity +=
 * item_quantity` (the FULL quantity, batch-covered or not — the decrement
 * was the full quantity too) and every batch it drew from via
 * `restoreForExpense`.
 *
 * `stock_restored = 0` in the SELECT is the exactly-once guard: once flipped
 * to 1 the row is permanently excluded, so a second call (a refund reaching
 * here after some other reversal path already ran) returns nothing twice.
 * No-op for a non-inventory expense, a legacy expense with no item columns,
 * or a schema that predates v193.
 */
export function restoreExpenseStock(
  db: Database.Database,
  opts: { expenseId: number; tenantId: number },
): void {
  const { expenseId, tenantId } = opts;
  const cols = db.prepare(`PRAGMA table_info(expenses)`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "stock_restored")) return;

  const row = db
    .prepare(
      `SELECT item_id, item_quantity FROM expenses
       WHERE id = ? AND tenant_id = ? AND item_source = 'INVENTORY'
         AND stock_restored = 0`,
    )
    .get(expenseId, tenantId) as
    | { item_id: number | null; item_quantity: number | null }
    | undefined;
  if (!row?.item_id || !row.item_quantity) return;

  db.prepare(
    `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
  ).run(row.item_quantity, row.item_id, tenantId);
  getStockBatchRepository().restoreForExpense(expenseId);
  db.prepare(
    `UPDATE expenses SET stock_restored = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`,
  ).run(expenseId, tenantId);
}
