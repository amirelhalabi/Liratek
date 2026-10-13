/**
 * LIRA-319 (T024 + T028) — an "extra" the cashier adds on top of a total is
 * its own Profits line, "Extra charges", summed from `transactions.extra_usd`
 * / `extra_lbp` (research R2/R3):
 *   - the module row's `profit_*` EXCLUDES the extra, so the SALE row's
 *     profit and its derived `sale_kept_change_*` are unchanged;
 *   - By Module gains `{ module: "EXTRA_CHARGE", label: "Extra charges" }`
 *     with revenue = profit = Σ extra, cost 0, per currency, never converted;
 *   - the Overview carries `extra_charges { usd, lbp }` folded into gross;
 *   - By Date / By Cashier / By Client totals rise by exactly the extra, and
 *     so does a session's profit sum;
 *   - a VOIDED row leaves every view; a REFUND row's negated share nets.
 *
 * Rows are seeded directly (a real `sales` + `sale_items` pair behind each
 * SALE transaction, so the SALE module row is genuinely computed — rule 28a).
 * Every row lands on the same day, so refund dating cannot affect a figure.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { CustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { ProfitService } from "../ProfitService";
import {
  classifyProfitModuleRow,
  PROFIT_ROW_CLASS,
} from "../../constants/profitRowClass";
import { hasModuleDetailSupport } from "../../constants/profitModuleDetailSupport";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const FROM = "2020-01-01";
const TO = "2099-12-31";
let db: Database.Database;
let txns: TransactionRepository;
let profits: ProfitService;
let clientId: number;

beforeEach(() => {
  resetTransactionRepository();
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  txns = new TransactionRepository();
  profits = new ProfitService(new ProfitRepository());
  db.prepare(
    `INSERT INTO products (id, tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
     VALUES (1, 1, 'Cable', 'Product', 2, 6, 50)`,
  ).run();
  clientId = Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rami', '70111222')`,
      )
      .run().lastInsertRowid,
  );
});
afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  db.close();
});

/** A completed, fully paid sale of one item (price, cost) with an extra on
 *  top: the SALE row's amount includes the extra, its profit excludes it. */
function seedSale(price: number, cost: number, extraUsd: number): number {
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (tenant_id, status, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot)
         VALUES (1, 'completed', ?, 0, ?, ?, 0, 90000)`,
      )
      .run(price, price, price + extraUsd).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
     VALUES (1, ?, 1, 1, ?, ?, 0, 0)`,
  ).run(saleId, price, cost);
  return txns.createTransaction({
    type: "SALE",
    source_table: "sales",
    source_id: saleId,
    user_id: 1,
    amount_usd: price + extraUsd,
    amount_lbp: 0,
    profit_usd: price - cost,
    profit_lbp: 0,
    extra_usd: extraUsd,
    extra_lbp: 0,
    client_id: clientId,
    client_name: "Rami",
    summary: "Sale",
    metadata_json: {},
  });
}

function seedAll(): { sale2Id: number } {
  seedSale(6, 2, 1); // extra $1
  const sale2Txn = seedSale(10, 5, 2); // extra $2
  const sale2Id = (
    db.prepare(`SELECT source_id FROM transactions WHERE id = ?`).get(
      sale2Txn,
    ) as { source_id: number }
  ).source_id;
  // An LBP extra (counted in LBP, never converted) on a non-sale row.
  txns.createTransaction({
    type: "CUSTOM_SERVICE",
    source_table: "custom_services",
    source_id: 999,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 550000,
    profit_usd: 0,
    profit_lbp: 0,
    extra_usd: 0,
    extra_lbp: 50000,
    client_id: clientId,
    client_name: "Rami",
    summary: "Custom service",
    metadata_json: {},
  });
  // A voided sale with an extra — must leave every view.
  const voided = seedSale(20, 10, 5);
  db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(
    voided,
  );
  db.prepare(
    `UPDATE sales SET status = 'voided' WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`,
  ).run(voided);
  // A partial refund of sale 2 that gives back $0.50 of its extra only.
  txns.createTransaction({
    type: "REFUND",
    source_table: "sales",
    source_id: sale2Id,
    user_id: 1,
    amount_usd: -0.5,
    amount_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    extra_usd: -0.5,
    extra_lbp: 0,
    client_id: clientId,
    client_name: "Rami",
    summary: "Refund",
    metadata_json: {},
  });
  return { sale2Id };
}

function today(): string {
  return (
    db
      .prepare(
        `SELECT date(created_at, 'localtime') AS d FROM transactions ORDER BY id LIMIT 1`,
      )
      .get() as { d: string }
  ).d;
}

describe("LIRA-319 — Extra charges in Profits", () => {
  it("By Module has an Extra charges row; the SALE row is unchanged", () => {
    seedAll();
    const rows = profits.getByModule(FROM, TO);
    const extra = rows.find((r) => r.module === "EXTRA_CHARGE");
    expect(extra).toMatchObject({
      module: "EXTRA_CHARGE",
      label: "Extra charges",
      revenue_usd: 2.5,
      revenue_lbp: 50000,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 2.5,
      profit_lbp: 50000,
      count: 3,
    });
    const sale = rows.find((r) => r.module === "SALE");
    expect(sale).toBeDefined();
    expect(sale!.revenue_usd).toBeCloseTo(16, 6);
    expect(sale!.cost_usd).toBeCloseTo(7, 6);
    expect(sale!.profit_usd).toBeCloseTo(9, 6);
    expect(sale!.sale_kept_change_usd ?? 0).toBe(0);
  });

  it("Overview carries extra_charges and folds it into gross", () => {
    seedAll();
    const s = profits.getSummary(FROM, TO);
    expect(s).toMatchObject({ extra_charges: { usd: 2.5, lbp: 50000 } });
    expect(s.sales.profit_usd).toBeCloseTo(9, 6);
    expect(s.totals.gross_profit_usd).toBeCloseTo(11.5, 6);
    expect(s.totals.gross_profit_lbp).toBeCloseTo(50000, 6);
    expect(s.totals.gross_revenue_usd).toBeCloseTo(16 + 2.5, 6);
  });

  // Passed on the pre-fix code too (neither side had the extra) — not
  // proven failing-first; it guards that the two stay reconciled.
  it("By Module rows add up to the Overview gross profit", () => {
    seedAll();
    const rows = profits.getByModule(FROM, TO);
    const s = profits.getSummary(FROM, TO);
    const sumUsd = rows.reduce((a, r) => a + r.profit_usd, 0);
    const sumLbp = rows.reduce((a, r) => a + r.profit_lbp, 0);
    expect(sumUsd).toBeCloseTo(s.totals.gross_profit_usd, 6);
    expect(sumLbp).toBeCloseTo(s.totals.gross_profit_lbp, 6);
  });

  it("the drill-down lists the extra rows and reproduces the row total", () => {
    seedAll();
    const detail = profits.getModuleDetail("EXTRA_CHARGE", FROM, TO);
    expect(detail.counted_total_profit_usd).toBeCloseTo(2.5, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(50000, 6);
    expect(detail.counted).toHaveLength(4); // 3 charges + 1 refund share
  });

  // Written after T027 landed — not proven failing-first.
  it("EXTRA_CHARGE renders as one profit figure and has a drill-down", () => {
    expect(classifyProfitModuleRow("EXTRA_CHARGE")).toBe(
      PROFIT_ROW_CLASS.PROFIT_ONLY,
    );
    expect(hasModuleDetailSupport("EXTRA_CHARGE")).toBe(true);
  });

  it("By Date total rises by exactly the extra", () => {
    seedAll();
    const d = today();
    const rows = profits.getByDate(d, d);
    expect(rows).toHaveLength(1);
    expect(rows[0].profit_usd).toBeCloseTo(11.5, 6);
    expect(rows[0].profit_lbp).toBeCloseTo(50000, 6);
    expect(rows[0].net_profit_usd).toBeCloseTo(11.5, 6);
  });

  it("By Cashier total rises by exactly the extra", () => {
    seedAll();
    const u = profits.getByUser(FROM, TO).find((r) => r.user_id === 1);
    expect(u).toBeDefined();
    expect(u!.profit_usd).toBeCloseTo(11.5, 6);
    expect(u!.profit_lbp).toBeCloseTo(50000, 6);
  });

  it("By Client total rises by exactly the extra", () => {
    seedAll();
    const c = profits
      .getByClient(FROM, TO)
      .find((r) => r.client_id === clientId);
    expect(c).toBeDefined();
    expect(c!.profit_usd).toBeCloseTo(11.5, 6);
    expect(c!.profit_lbp).toBeCloseTo(50000, 6);
  });

  it("a session's profit sum rises by exactly its linked extra", () => {
    const sessions = new CustomerSessionRepository(db);
    const sessionId = sessions.createSession({ started_by: "admin" });
    const txnId = seedSale(6, 2, 1);
    sessions.linkTransaction(sessionId, "SALE", 1, 7, 0, 4, 0, txnId);
    const d = today();
    const row = sessions
      .getSessionsByDateRange(d, d)
      .find((s) => s.id === sessionId);
    expect(row).toBeDefined();
    expect(row!.total_profit_usd).toBeCloseTo(5, 6);
    const todayRow = sessions.getTodaySessions().find((s) => s.id === sessionId);
    expect(todayRow!.total_profit_usd).toBeCloseTo(5, 6);
  });

  // ---------------------------------------------------------------------
  // Owner decisions 2026-10-14 — written FIRST, seen failing on the
  // pre-change code (see the LIRA-319 report).
  // ---------------------------------------------------------------------

  function addSara(): void {
    db.prepare(
      `INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES (2, 1, 'sara', 'x', 'staff')`,
    ).run();
  }

  /** Moves a transaction (and, for a SALE, its sales row) to a fixed day. */
  function setDay(txnId: number, day: string): void {
    db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
      `${day} 12:00:00`,
      txnId,
    );
    db.prepare(
      `UPDATE sales SET created_at = ? WHERE id = (SELECT source_id FROM transactions WHERE id = ? AND source_table = 'sales' AND type = 'SALE')`,
    ).run(`${day} 12:00:00`, txnId);
  }

  it("a refunded share lands on the REFUND's own day; past days never change", () => {
    addSara();
    // Zero-margin sale so every figure below is the extra alone.
    const saleTxn = seedSale(10, 10, 3);
    setDay(saleTxn, "2026-10-10");
    const saleId = (
      db.prepare(`SELECT source_id FROM transactions WHERE id = ?`).get(
        saleTxn,
      ) as { source_id: number }
    ).source_id;
    const refundTxn = txns.createTransaction({
      type: "REFUND",
      source_table: "sales",
      source_id: saleId,
      user_id: 2,
      amount_usd: -1,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      extra_usd: -1,
      extra_lbp: 0,
      client_id: clientId,
      client_name: "Rami",
      summary: "Refund",
      metadata_json: {},
    });
    setDay(refundTxn, "2026-10-15");

    const byDate = profits.getByDate("2026-10-10", "2026-10-15");
    const day = (d: string) => byDate.find((r) => r.date === d)!;
    expect(day("2026-10-10").profit_usd).toBeCloseTo(3, 6);
    expect(day("2026-10-15").profit_usd).toBeCloseTo(-1, 6);

    const oct10 = profits
      .getByModule("2026-10-10", "2026-10-10")
      .find((r) => r.module === "EXTRA_CHARGE");
    expect(oct10?.profit_usd).toBeCloseTo(3, 6);
    expect(
      profits.getSummary("2026-10-10", "2026-10-10").extra_charges.usd,
    ).toBeCloseTo(3, 6);
    expect(
      profits.getSummary("2026-10-15", "2026-10-15").extra_charges.usd,
    ).toBeCloseTo(-1, 6);
    // By Cashier agrees: the refund's share is on its own day.
    const cashier15 = profits.getByUser("2026-10-15", "2026-10-15");
    const sum15 = cashier15.reduce((a, r) => a + r.profit_usd, 0);
    expect(sum15).toBeCloseTo(-1, 6);
    const cashier10 = profits.getByUser("2026-10-10", "2026-10-10");
    expect(cashier10.reduce((a, r) => a + r.profit_usd, 0)).toBeCloseTo(3, 6);
  });

  it("a session basket's EXTRA_CHARGE row counts in By Cashier and By Client as profit only", () => {
    addSara();
    const lone = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Lone', '70999888')`,
        )
        .run().lastInsertRowid,
    );
    // User 2 / client "Lone" have NO other activity: only the basket row.
    txns.createTransaction({
      type: "EXTRA_CHARGE",
      source_table: "customer_sessions",
      source_id: 1,
      user_id: 2,
      amount_usd: 2,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      extra_usd: 2,
      extra_lbp: 0,
      client_id: lone,
      client_name: "Lone",
      summary: "Extra charge",
      metadata_json: {},
    });
    const sara = profits.getByUser(FROM, TO).find((r) => r.user_id === 2);
    expect(sara).toBeDefined();
    expect(sara!.profit_usd).toBeCloseTo(2, 6);
    expect(sara!.revenue_usd).toBeCloseTo(0, 6);
    const client = profits
      .getByClient(FROM, TO)
      .find((r) => r.client_id === lone);
    expect(client).toBeDefined();
    expect(client!.profit_usd).toBeCloseTo(2, 6);
    expect(client!.revenue_usd).toBeCloseTo(0, 6);
  });

  it("a $6 + $1 extra sale paid only $6 is NOT fully paid ($1 still owed)", () => {
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales (tenant_id, client_id, status, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot)
           VALUES (1, ?, 'completed', 6, 0, 6, 6, 0, 90000)`,
        )
        .run(clientId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
       VALUES (1, ?, 1, 1, 6, 2, 0, 0)`,
    ).run(saleId);
    txns.createTransaction({
      type: "SALE",
      source_table: "sales",
      source_id: saleId,
      user_id: 1,
      amount_usd: 7,
      amount_lbp: 0,
      profit_usd: 4,
      profit_lbp: 0,
      extra_usd: 1,
      extra_lbp: 0,
      client_id: clientId,
      client_name: "Rami",
      summary: "Sale",
      metadata_json: {},
    });
    // The sale's own margin waits for the debt like any unpaid sale.
    expect(profits.getSummary(FROM, TO).sales.profit_usd).toBeCloseTo(0, 6);
    const pending = new ProfitRepository()
      .getPendingSaleProfit()
      .find((r) => r.sale_id === saleId);
    expect(pending).toBeDefined();
    expect(pending!.outstanding_usd).toBeCloseTo(1, 6);
  });
});
