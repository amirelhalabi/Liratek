/**
 * Test helper: the money state of a shop, per currency, without ids or
 * timestamps — so a replayed booking and an online booking can be compared.
 */
import type Database from "better-sqlite3";

export function moneyState(db: Database.Database): Record<string, unknown> {
  const q = (sql: string) => db.prepare(sql).all();
  return {
    drawers: q(`SELECT drawer_name, currency_code, ROUND(balance, 4) AS balance FROM drawer_balances WHERE tenant_id = 1 AND balance != 0 ORDER BY drawer_name, currency_code`),
    payments: q(`SELECT method, drawer_name, currency_code, ROUND(amount, 4) AS amount, note FROM payments WHERE tenant_id = 1 ORDER BY method, currency_code, amount`),
    stock: q(`SELECT id, stock_quantity FROM products WHERE tenant_id = 1 ORDER BY id`),
    transactions: q(`SELECT type, source_table, ROUND(amount_usd, 4) AS amount_usd, ROUND(amount_lbp, 4) AS amount_lbp, ROUND(profit_usd, 4) AS profit_usd, ROUND(profit_lbp, 4) AS profit_lbp, client_id, exchange_rate, status FROM transactions WHERE tenant_id = 1 ORDER BY type, amount_usd`),
    debt: q(`SELECT client_id, transaction_type, ROUND(amount_usd, 4) AS amount_usd, ROUND(amount_lbp, 4) AS amount_lbp FROM debt_ledger WHERE tenant_id = 1 ORDER BY client_id, transaction_type, amount_usd`),
    sales: q(`SELECT client_id, ROUND(total_amount_usd, 4) AS total, ROUND(final_amount_usd, 4) AS final, ROUND(paid_usd, 4) AS paid_usd, ROUND(paid_lbp, 4) AS paid_lbp, status FROM sales WHERE tenant_id = 1 ORDER BY id`),
  };
}
