/**
 * ProfitRepository — cross-tenant isolation (multi-tenant WP3e, rule 17).
 *
 * Two tenants with MIRRORED money data (tenant 2's amounts are exactly 3×
 * tenant 1's). Every assertion checks EXACT sums, not row counts — a single
 * unscoped tenant-table reference in any aggregate (including correlated
 * subqueries and the getByDate CTE bodies) makes the other tenant's revenue
 * bleed into the total and shows up as a wrong number, not a missing row.
 *
 * Per rule 17, the suite was proven to FAIL against sabotaged code:
 * removing the `si.tenant_id/s.tenant_id` predicates from getSalesRevCost
 * (and their binds) inflated revenue 100 → 400 (tenant 2's 300 leaked in)
 * before the predicates were restored.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      transaction_id INTEGER,
      method TEXT,
      drawer_name TEXT,
      currency_code TEXT,
      amount REAL DEFAULT 0,
      created_at TEXT
    );

    -- Referenced by ProfitRepository's notPartnerPending / salePaidOrPartnerSettled
    -- fragments (PFT-6). Left empty: the NOT EXISTS gate then passes every row,
    -- preserving this suite's pre-partner tenant-isolation expectations unchanged.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by ProfitRepository's notDebtPending fragment (DBT-1, v129).
    -- Left empty: the NOT EXISTS gate passes every row unchanged.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );
  `);
}

/**
 * Seed one tenant's full mirrored dataset. All money amounts are `base × mult`
 * so tenant totals differ and any cross-tenant leak changes an exact sum.
 */
function seedTenant(
  db: Database.Database,
  tenantId: number,
  mult: number,
  username: string,
): void {
  const t = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...params);

  t(
    `INSERT INTO users (tenant_id, username) VALUES (?, ?)`,
    tenantId,
    username,
  );
  const userId = Number(
    db.prepare(`SELECT id FROM users WHERE tenant_id = ?`).get(tenantId) &&
      (
        db
          .prepare(`SELECT id FROM users WHERE tenant_id = ?`)
          .get(tenantId) as { id: number }
      ).id,
  );

  // Sale: fully paid, completed. Revenue 100m, cost 60m, profit 40m.
  const sale = t(
    `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
     VALUES (?, 'completed', ?, ?, 0, 90000, ?)`,
    tenantId,
    100 * mult,
    100 * mult,
    D,
  );
  const saleId = Number(sale.lastInsertRowid);
  t(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (?, ?, ?, ?, 1, 0)`,
    tenantId,
    saleId,
    100 * mult,
    60 * mult,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
     VALUES (?, 'SALE', 'ACTIVE', 'sales', ?, ?, ?, ?, ?)`,
    tenantId,
    saleId,
    userId,
    100 * mult,
    40 * mult,
    D,
  );
  const saleTxnId = Number(
    (
      db.prepare(`SELECT MAX(id) AS id FROM transactions`).get() as {
        id: number;
      }
    ).id,
  );

  // Settled OMT commission: amount 100m, commission 5m (cost 0 → revenue = amount).
  const fs = t(
    `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, is_refunded, created_at)
     VALUES (?, 'OMT', ?, 'USD', ?, 0, 0, 1, 0, ?)`,
    tenantId,
    100 * mult,
    5 * mult,
    D,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
     VALUES (?, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?)`,
    tenantId,
    Number(fs.lastInsertRowid),
    userId,
    100 * mult,
    5 * mult,
    D,
  );

  // Recharge: price 20m, cost 18m, profit 2m.
  const r = t(
    `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
     VALUES (?, 'MTC', 'USD', ?, ?, 0, ?)`,
    tenantId,
    20 * mult,
    18 * mult,
    D,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
     VALUES (?, 'RECHARGE', 'ACTIVE', 'recharges', ?, ?, ?, ?, ?)`,
    tenantId,
    Number(r.lastInsertRowid),
    userId,
    20 * mult,
    2 * mult,
    D,
  );

  // Custom service: price 30m, cost 27m, profit 3m.
  const cs = t(
    `INSERT INTO custom_services (tenant_id, status, price_usd, cost_usd, is_refunded, created_at)
     VALUES (?, 'completed', ?, ?, 0, ?)`,
    tenantId,
    30 * mult,
    27 * mult,
    D,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
     VALUES (?, 'CUSTOM_SERVICE', 'ACTIVE', 'custom_services', ?, ?, ?, ?, ?)`,
    tenantId,
    Number(cs.lastInsertRowid),
    userId,
    30 * mult,
    3 * mult,
    D,
  );

  // Maintenance: Delivered, final 50m, cost 30m, profit 20m.
  const m = t(
    `INSERT INTO maintenance (tenant_id, status, final_amount_usd, cost_usd, is_refunded, created_at)
     VALUES (?, 'Delivered', ?, ?, 0, ?)`,
    tenantId,
    50 * mult,
    30 * mult,
    D,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
     VALUES (?, 'MAINTENANCE', 'ACTIVE', 'maintenance', ?, ?, ?, ?, ?)`,
    tenantId,
    Number(m.lastInsertRowid),
    userId,
    50 * mult,
    20 * mult,
    D,
  );

  // Loto ticket: face 100000m LBP, commission 8000m LBP.
  const lt = t(
    `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
     VALUES (?, ?, 0, ?)`,
    tenantId,
    100000 * mult,
    D,
  );
  t(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_lbp, profit_lbp, created_at)
     VALUES (?, 'LOTO', 'ACTIVE', 'loto_tickets', ?, ?, ?, ?, ?)`,
    tenantId,
    Number(lt.lastInsertRowid),
    userId,
    100000 * mult,
    8000 * mult,
    D,
  );

  // Expense: 10m USD.
  t(
    `INSERT INTO expenses (tenant_id, status, amount_usd, expense_date) VALUES (?, 'active', ?, ?)`,
    tenantId,
    10 * mult,
    D,
  );

  // Exchange: amount_in 200m, profit 2m.
  t(
    `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
    tenantId,
    200 * mult,
    2 * mult,
    D,
  );

  // Customer cash payment leg for the sale.
  t(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_at)
     VALUES (?, ?, 'CASH', 'General', 'USD', ?, ?)`,
    tenantId,
    saleTxnId,
    100 * mult,
    D,
  );
}

describe("ProfitRepository — cross-tenant isolation (exact sums)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    seedTenant(db, 1, 1, "alice");
    seedTenant(db, 2, 3, "bob");
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getSalesRevCost sums ONLY the active tenant's sales", () => {
    const t1 = runWithTenant(1, () => repo.getSalesRevCost(FROM, TO));
    expect(t1.revenue_usd).toBe(100);
    expect(t1.cost_usd).toBe(60);
    expect(t1.count).toBe(1);

    const t2 = runWithTenant(2, () => repo.getSalesRevCost(FROM, TO));
    expect(t2.revenue_usd).toBe(300);
    expect(t2.cost_usd).toBe(180);
    expect(t2.count).toBe(1);
  });

  it("getSalesProfit sums ONLY the active tenant's ledger profit", () => {
    expect(
      runWithTenant(1, () => repo.getSalesProfit(FROM, TO)).profit_usd,
    ).toBe(40);
    expect(
      runWithTenant(2, () => repo.getSalesProfit(FROM, TO)).profit_usd,
    ).toBe(120);
  });

  it("getFinancialSettledByCurrency scopes both fs and its joined transaction", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].revenue).toBe(100);
    expect(rows[0].commission).toBe(5);
    expect(rows[0].count).toBe(1);
  });

  it("getRechargesByCurrency / getCustomServicesTotals / getMaintenanceTotals / getLotoTotals", () => {
    runWithTenant(1, () => {
      const rech = repo.getRechargesByCurrency(FROM, TO);
      expect(rech).toHaveLength(1);
      expect(rech[0].revenue).toBe(20);
      expect(rech[0].cost).toBe(18);
      expect(rech[0].profit).toBe(2);

      const custom = repo.getCustomServicesTotals(FROM, TO);
      expect(custom.revenue_usd).toBe(30);
      expect(custom.cost_usd).toBe(27);
      expect(custom.profit_usd).toBe(3);

      const maint = repo.getMaintenanceTotals(FROM, TO);
      expect(maint.revenue_usd).toBe(50);
      expect(maint.cost_usd).toBe(30);
      expect(maint.profit_usd).toBe(20);

      const loto = repo.getLotoTotals(FROM, TO);
      expect(loto.revenue_lbp).toBe(100000);
      expect(loto.profit_lbp).toBe(8000);
    });
  });

  it("getExchangeTotals / getExpenseTotals / commission totals", () => {
    runWithTenant(1, () => {
      const ex = repo.getExchangeTotals(FROM, TO);
      expect(ex.revenue_usd).toBe(200);
      expect(ex.profit_usd).toBe(2);

      const exp = repo.getExpenseTotals(FROM, TO);
      expect(exp.total_usd).toBe(10);
      expect(exp.count).toBe(1);

      // Expected values unchanged by LIRA-108 (realized now JOINs an ACTIVE
      // FINANCIAL_SERVICE txn + counterparty gates): every fs row here has a
      // matching ACTIVE txn and both ledger tables are empty, so the gates
      // pass every row — but a mis-scoped tenant bind in the new JOIN would
      // break these exact sums first.
      const realized = repo.getRealizedCommissionTotals(FROM, TO);
      expect(realized.total_usd).toBe(5);
      expect(realized.count).toBe(1);

      const pending = repo.getPendingCommissionTotals(FROM, TO);
      expect(pending.total_usd).toBe(0);
    });
    runWithTenant(2, () => {
      expect(repo.getExchangeTotals(FROM, TO).profit_usd).toBe(6);
      expect(repo.getExpenseTotals(FROM, TO).total_usd).toBe(30);
      expect(repo.getRealizedCommissionTotals(FROM, TO).total_usd).toBe(15);
    });
  });

  it("getByDate CTE chain — every daily CTE is scoped (exact day totals)", () => {
    const day1 = runWithTenant(1, () =>
      repo.getByDate("2026-07-01", "2026-07-01", FROM, TO),
    );
    expect(day1).toHaveLength(1);
    // revenue: 100 sales + 100 fs + 20 recharge + 30 custom + 50 maint + 200 exchange
    expect(day1[0].revenue_usd).toBe(500);
    // profit: 40 + 5 + 2 + 3 + 20 + 2
    expect(day1[0].profit_usd).toBe(72);
    expect(day1[0].profit_lbp).toBe(8000);
    expect(day1[0].expenses_usd).toBe(10);
    expect(day1[0].net_profit_usd).toBe(62);

    const day2 = runWithTenant(2, () =>
      repo.getByDate("2026-07-01", "2026-07-01", FROM, TO),
    );
    expect(day2[0].revenue_usd).toBe(1500);
    expect(day2[0].profit_usd).toBe(216);
    expect(day2[0].net_profit_usd).toBe(186);
  });

  it("getByUser — correlated subqueries and joins are scoped", () => {
    const rows1 = runWithTenant(1, () => repo.getByUser(FROM, TO));
    expect(rows1).toHaveLength(1);
    expect(rows1[0].username).toBe("alice");
    // revenue: 100 sale + 100 fs + 20 recharge + 30 custom + 50 maint (loto is LBP)
    expect(rows1[0].revenue_usd).toBe(300);
    // profit: 40 + 5 + 2 + 3 + 20
    expect(rows1[0].profit_usd).toBe(70);
    expect(rows1[0].profit_lbp).toBe(8000);
    expect(rows1[0].transaction_count).toBe(6);
    expect(rows1[0].pending_profit_usd).toBe(0);

    const rows2 = runWithTenant(2, () => repo.getByUser(FROM, TO));
    expect(rows2).toHaveLength(1);
    expect(rows2[0].username).toBe("bob");
    expect(rows2[0].revenue_usd).toBe(900);
    expect(rows2[0].profit_usd).toBe(210);
  });

  it("getPaymentMethodRows sums ONLY the active tenant's payment legs", () => {
    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe("CASH");
    expect(rows[0].total_usd).toBe(100);
    expect(rows[0].count).toBe(1);

    const rows2 = runWithTenant(2, () => repo.getPaymentMethodRows(FROM, TO));
    expect(rows2[0].total_usd).toBe(300);
  });
});
