/**
 * SalesRepository — cross-tenant isolation (multi-tenant retrofit, WP3a).
 *
 * Two tenants (1, 2) share the SAME physical `sales`/`sale_items`/`products`
 * tables (single-DB multi-tenancy per docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md
 * §6). Every row is tagged `tenant_id`; the repository must never let tenant 1's
 * context see tenant 2's rows — not in a get-by-id, not in a list, not in an
 * aggregate SUM. Mirrored rows are seeded for both tenants with DISTINCT
 * amounts so a leak visibly moves a total, and every row satisfies the same
 * non-tenant filters (status/date) the method already applies — so removing
 * ONLY the tenant_id predicate is what makes the leak visible (rule 17 below).
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { runWithTenant, resetTenantContext } from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      barcode        TEXT,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      min_stock_level INTEGER NOT NULL DEFAULT 5,
      is_active      INTEGER NOT NULL DEFAULT 1,
      tenant_id      INTEGER NOT NULL
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      edited_by              TEXT,
      edited_at              TEXT,
      tenant_id              INTEGER NOT NULL,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER NOT NULL,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      tenant_id        INTEGER NOT NULL,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

/**
 * Mirrored "today, completed" sale for a tenant — distinct amount per tenant.
 * created_at must be seeded UTC (datetime('now')) exactly like production's
 * CURRENT_TIMESTAMP writes: getDashboardStats applies the 'localtime' shift
 * when READING, so a fixture that pre-shifts to localtime gets shifted twice
 * and falls off "today" whenever local time is within UTC-offset hours of
 * midnight (this test failed every evening after 21:00 in UTC+3).
 */
function seedCompletedSaleToday(
  db: Database.Database,
  tenantId: number,
  finalAmountUsd: number,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO sales (final_amount_usd, paid_usd, paid_lbp, status, tenant_id, created_at)
         VALUES (?, ?, 0, 'completed', ?, datetime('now'))`,
      )
      .run(finalAmountUsd, finalAmountUsd, tenantId).lastInsertRowid,
  );
}

function seedDraftSale(
  db: Database.Database,
  tenantId: number,
  finalAmountUsd: number,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO sales (final_amount_usd, status, tenant_id) VALUES (?, 'draft', ?)`,
      )
      .run(finalAmountUsd, tenantId).lastInsertRowid,
  );
}

function seedLowStockProduct(db: Database.Database, tenantId: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (name, stock_quantity, min_stock_level, is_active, tenant_id)
         VALUES ('Low stock item', 1, 5, 1, ?)`,
      )
      .run(tenantId).lastInsertRowid,
  );
}

describe("SalesRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("findById: tenant 1 cannot fetch tenant 2's sale by its real id", () => {
    const tenant2SaleId = seedCompletedSaleToday(db, 2, 999);

    const seenByTenant1 = runWithTenant(1, () => repo.findById(tenant2SaleId));
    expect(seenByTenant1).toBeNull();

    // Sanity: tenant 2 CAN see its own row.
    const seenByTenant2 = runWithTenant(2, () => repo.findById(tenant2SaleId));
    expect(seenByTenant2).not.toBeNull();
  });

  it("findDrafts: only returns the calling tenant's drafts", () => {
    const t1Draft = seedDraftSale(db, 1, 50);
    seedDraftSale(db, 2, 12345);

    const drafts = runWithTenant(1, () => repo.findDrafts());

    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(t1Draft);
  });

  it("getDashboardStats: today's SUM(final_amount_usd) does not include tenant 2's sales", () => {
    seedCompletedSaleToday(db, 1, 100);
    seedCompletedSaleToday(db, 2, 999); // mirrored, same day, same status — distinct amount

    const stats = runWithTenant(1, () => repo.getDashboardStats());

    expect(stats.totalSalesUSD).toBe(100); // NOT 1099
  });

  it("getDashboardStats: low-stock product count does not include tenant 2's products", () => {
    seedLowStockProduct(db, 1);
    seedLowStockProduct(db, 2);
    seedLowStockProduct(db, 2);

    const stats = runWithTenant(1, () => repo.getDashboardStats());

    expect(stats.lowStockCount).toBe(1); // NOT 3
  });
});
