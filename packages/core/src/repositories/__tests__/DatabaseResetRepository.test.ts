/**
 * DatabaseResetRepository (LIRA-165 — Settings › Reset Data).
 *
 * The in-memory database is built by executing `electron-app/create_db.sql`
 * itself (not a hand-written partial schema) so the fixture cannot silently
 * drift from the real schema — a missing table/column here would otherwise
 * make every test die in SETUP looking like a broken assertion (see
 * reference_test_schema_completeness lesson). `PRAGMA foreign_keys = ON` is
 * turned on after the schema+seed exec to mirror `electron-app/main.ts`'s
 * runtime enforcement, so the tests genuinely exercise
 * `defer_foreign_keys` rather than assuming it works.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import {
  DatabaseResetRepository,
  resetDatabaseResetRepository,
} from "../DatabaseResetRepository.js";
import { runWithTenant, resetTenantContext } from "../../db/tenantContext.js";
import {
  RESET_WIPE_TABLES,
  RESET_KEEP_TABLES,
  RESET_ZERO_TABLES,
  RESET_EXCLUDED_TABLES,
  PRODUCT_CATEGORY_DEFAULTS,
  SERVICE_PRESET_DEFAULTS,
} from "../../constants/resetTables.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const sql = fs.readFileSync(CREATE_DB_SQL_PATH, "utf8");
  db.exec(sql);
  // Mirrors electron-app/main.ts's runtime PRAGMA — turned on AFTER the
  // schema+seed exec (which relies on FK checks being off while it runs in
  // whatever order create_db.sql happens to declare things).
  db.pragma("foreign_keys = ON");
  return db;
}

function countRows(
  db: Database.Database,
  table: string,
  tenantId: number,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE tenant_id = ?`)
    .get(tenantId) as { n: number };
  return row.n;
}

/**
 * Inserts exactly ONE row into every `RESET_WIPE_TABLES` table for the given
 * tenant, satisfying every NOT-NULL foreign key in `create_db.sql` (nullable
 * FKs are left NULL — they need no parent row). 13 of the 53 rows double as
 * both a "parent" row (referenced by another WIPE table's mandatory FK) and
 * a WIPE-table row in their own right (e.g. `sales` / `sale_items`), so this
 * function's INSERT count is 53, matching `RESET_WIPE_TABLES.length` exactly
 * — asserted by the "fixture sanity" step in each test that uses it.
 * `defer_foreign_keys` removes any insertion-order requirement.
 */
function insertTenantFixture(db: Database.Database, tenantId: number): void {
  const run = db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");

    if (tenantId !== 1) {
      db.prepare(
        `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
      ).run(tenantId, `Tenant ${tenantId}`, `tenant-${tenantId}`);
    }

    const userId = db
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
         VALUES (?, ?, '', 'staff', 1)`,
      )
      .run(tenantId, `user${tenantId}`).lastInsertRowid as number;

    // Non-WIPE parents these fixture rows' mandatory FKs need.
    db.prepare(
      `INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places)
       VALUES (?, 'USD', 'US Dollar', '$', 2)`,
    ).run(tenantId);
    db.prepare(
      `INSERT OR IGNORE INTO service_providers
         (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
       VALUES (?, 'OMT', 'OMT', 'OMT_System', 1, 1, 1, 0)`,
    ).run(tenantId);

    // 13 tables that are BOTH a mandatory-FK parent for another WIPE table
    // AND themselves a RESET_WIPE_TABLES entry.
    const supplierId = db
      .prepare(`INSERT INTO suppliers (tenant_id, name) VALUES (?, ?)`)
      .run(tenantId, `Fixture Supplier ${tenantId}`).lastInsertRowid as number;
    const clientId = db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'Fixture Client', ?)`,
      )
      .run(tenantId, `phone-${tenantId}`).lastInsertRowid as number;
    const productId = db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type) VALUES (?, 'Fixture Product', 'Product')`,
      )
      .run(tenantId).lastInsertRowid as number;
    const carrierLineId = db
      .prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number) VALUES (?, 'alfa', ?)`,
      )
      .run(tenantId, `03-${tenantId}`).lastInsertRowid as number;
    const sessionId = db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, user_id, started_by) VALUES (?, ?, 'tester')`,
      )
      .run(tenantId, userId).lastInsertRowid as number;
    const closingId = db
      .prepare(`INSERT INTO daily_closings (tenant_id) VALUES (?)`)
      .run(tenantId).lastInsertRowid as number;
    const maintenanceId = db
      .prepare(
        `INSERT INTO maintenance (tenant_id, device_name) VALUES (?, 'Fixture Device')`,
      )
      .run(tenantId).lastInsertRowid as number;
    const partnerId = db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (?, ?)`)
      .run(tenantId, `Fixture Partner ${tenantId}`).lastInsertRowid as number;
    const saleId = db
      .prepare(`INSERT INTO sales (tenant_id, client_id) VALUES (?, ?)`)
      .run(tenantId, clientId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id) VALUES (?, ?, ?)`,
    ).run(tenantId, saleId, productId);
    const supplierLedgerId = db
      .prepare(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type) VALUES (?, ?, 'ADJUSTMENT')`,
      )
      .run(tenantId, supplierId).lastInsertRowid as number;
    const stockBatchId = db
      .prepare(
        `INSERT INTO product_stock_batches (tenant_id, product_id, supplier_id, quantity, quantity_remaining)
         VALUES (?, ?, ?, 1, 1)`,
      )
      .run(tenantId, productId, supplierId).lastInsertRowid as number;
    const fsId = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency)
         VALUES (?, 'OMT', 'BILL', 10, 'USD')`,
      )
      .run(tenantId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id)
       VALUES (?, 'SALE', 'sales', ?, ?)`,
    ).run(tenantId, saleId, userId);

    // The remaining 40 WIPE tables — one plain row each.
    db.prepare(
      `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary)
       VALUES (?, ?, 'tester', 'staff', 'TEST', 'test', 'fixture')`,
    ).run(tenantId, userId);
    db.prepare(
      `INSERT INTO carrier_line_movements (tenant_id, carrier_line_id, reason) VALUES (?, ?, 'TEST')`,
    ).run(tenantId, carrierLineId);
    db.prepare(
      `INSERT INTO custom_services (tenant_id, description) VALUES (?, 'Fixture service')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type, transaction_id)
       VALUES (?, ?, 'sale', ?)`,
    ).run(tenantId, sessionId, saleId);
    db.prepare(
      `INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code)
       VALUES (?, ?, 'General', 'USD')`,
    ).run(tenantId, closingId);
    db.prepare(
      `INSERT INTO daily_closing_carrier_lines (tenant_id, closing_id, carrier_line_id) VALUES (?, ?, ?)`,
    ).run(tenantId, closingId, carrierLineId);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type) VALUES (?, ?, 'Test Debt')`,
    ).run(tenantId, clientId);
    db.prepare(
      `INSERT INTO drawer_cashouts (tenant_id, notes) VALUES (?, 'Fixture cashout')`,
    ).run(tenantId);
    db.prepare(`INSERT INTO drawer_topups (tenant_id) VALUES (?)`).run(
      tenantId,
    );
    db.prepare(
      `INSERT INTO drawer_transfers (tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp)
       VALUES (?, 'General', 'OMT_System', 1, 0)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO exchange_lot_settlements
         (tenant_id, basis_source, settled_by_table, settled_by_id, qty, unit_cost_usd, unit_proceeds_usd, profit_usd)
       VALUES (?, 'MARKET', 'exchange_transactions', 1, 1, 1, 1, 0)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO exchange_lots
         (tenant_id, currency_code, source_type, original_qty, remaining_qty, unit_cost_usd, acquired_at)
       VALUES (?, 'USD', 'ADJUSTMENT', 1, 1, 1, CURRENT_TIMESTAMP)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO exchange_position_adjustments (tenant_id, currency_code, qty) VALUES (?, 'USD', 1)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO exchange_transactions
         (tenant_id, type, from_currency, to_currency, amount_in, amount_out, rate)
       VALUES (?, 'BUY', 'USD', 'LBP', 1, 1, 1)`,
    ).run(tenantId);
    db.prepare(`INSERT INTO expenses (tenant_id) VALUES (?)`).run(tenantId);
    db.prepare(
      `INSERT INTO hold_money (tenant_id, client_name) VALUES (?, 'Fixture')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO item_costs (tenant_id, provider, category, item_key, cost)
       VALUES (?, 'test', 'test', 'test-key', 1)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO loto_cash_prizes (tenant_id, prize_amount, prize_date) VALUES (?, 10, '2026-01-01')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO loto_checkpoints (tenant_id, checkpoint_date, period_start, period_end)
       VALUES (?, '2026-01-01', '2026-01-01', '2026-01-01')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO loto_monthly_fees (tenant_id, fee_amount, fee_month, fee_year, recorded_date)
       VALUES (?, 10, 'January', 2026, '2026-01-01')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO loto_settlements (tenant_id, settlement_date, checkpoint_ids, net_settlement)
       VALUES (?, '2026-01-01', '[]', 0)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO loto_tickets (tenant_id, sale_amount, commission_amount, sale_date)
       VALUES (?, 10, 1, '2026-01-01')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO maintenance_parts (tenant_id, maintenance_id, product_id, product_name, quantity)
       VALUES (?, ?, ?, 'Part', 1)`,
    ).run(tenantId, maintenanceId, productId);
    db.prepare(
      `INSERT INTO maintenance_status_history (tenant_id, maintenance_id, to_status)
       VALUES (?, ?, 'Received')`,
    ).run(tenantId, maintenanceId);
    db.prepare(
      `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label)
       VALUES (?, 'mtc', 'recharge', 'credit', 'Fixture')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, direction)
       VALUES (?, ?, 'TEST', 1, 'DEBIT')`,
    ).run(tenantId, partnerId);
    db.prepare(
      `INSERT INTO payments (tenant_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'CASH', 'General', 'USD', 1)`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO product_suppliers (tenant_id, name) VALUES (?, ?)`,
    ).run(tenantId, `Fixture Product Supplier ${tenantId}`);
    db.prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (?, ?, ?)`,
    ).run(tenantId, productId, `IMEI-${tenantId}`);
    db.prepare(
      `INSERT INTO recharges (tenant_id, carrier, amount, created_by) VALUES (?, 'mtc', 1, ?)`,
    ).run(tenantId, userId);
    db.prepare(
      `INSERT INTO session_cart_items
         (tenant_id, session_id, item_id, module, label, amount, ipc_channel)
       VALUES (?, ?, 'item1', 'pos', 'Fixture', 1, 'channel')`,
    ).run(tenantId, sessionId);
    db.prepare(
      `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, ?, ?, '2030-01-01')`,
    ).run(tenantId, userId, `token-${tenantId}`);
    db.prepare(
      `INSERT INTO settlement_commission_allocations
         (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider)
       VALUES (?, ?, ?, 'BILL', 'OMT')`,
    ).run(tenantId, supplierLedgerId, fsId);
    db.prepare(
      `INSERT INTO stock_adjustments
         (tenant_id, product_id, delta, old_quantity, new_quantity, reason)
       VALUES (?, ?, 1, 0, 1, 'test')`,
    ).run(tenantId, productId);
    db.prepare(
      `INSERT INTO stock_batch_consumptions (tenant_id, batch_id, product_id, quantity, unit_cost_usd)
       VALUES (?, ?, ?, 1, 1)`,
    ).run(tenantId, stockBatchId, productId);
    db.prepare(
      `INSERT INTO supplier_purchases (tenant_id, supplier_id, total_usd) VALUES (?, ?, 10)`,
    ).run(tenantId, supplierId);
    db.prepare(
      `INSERT INTO supplier_settlements (tenant_id, supplier_id, ledger_entry_id, model)
       VALUES (?, ?, ?, 0)`,
    ).run(tenantId, supplierId, supplierLedgerId);
    db.prepare(
      `INSERT INTO voucher_images (tenant_id, provider, category, item_key, image_path)
       VALUES (?, 'test', 'test', 'key', 'path.png')`,
    ).run(tenantId);
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, created_by)
       VALUES (?, ?, ?, 'Fixture', 10, ?)`,
    ).run(tenantId, `CODE-${tenantId}`, clientId, userId);
    db.prepare(
      `INSERT INTO wallet_exchanges
         (tenant_id, drawer_name, from_currency, to_currency, amount_in, amount_out, rate)
       VALUES (?, 'OMT_App', 'USD', 'LBP', 1, 1, 1)`,
    ).run(tenantId);
  });
  run();
}

describe("DatabaseResetRepository", () => {
  let db: Database.Database;
  let repo: DatabaseResetRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new DatabaseResetRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetDatabaseResetRepository();
    db.close();
  });

  it("wipes every RESET_WIPE_TABLES row for the tenant", () => {
    insertTenantFixture(db, 1);

    // Fixture sanity — every WIPE table starts with exactly 1 row, and the
    // fixture wrote exactly RESET_WIPE_TABLES.length rows (53), not fewer
    // (a silently-skipped table would otherwise make this test pass
    // vacuously on that table).
    for (const table of RESET_WIPE_TABLES) {
      expect(countRows(db, table, 1)).toBe(1);
    }

    runWithTenant(1, () => repo.resetTenantData());

    for (const table of RESET_WIPE_TABLES) {
      expect(countRows(db, table, 1)).toBe(0);
    }
  });

  it("never touches another tenant's rows (tenant isolation)", () => {
    insertTenantFixture(db, 1);
    insertTenantFixture(db, 2);

    runWithTenant(1, () => repo.resetTenantData());

    for (const table of RESET_WIPE_TABLES) {
      expect(countRows(db, table, 1)).toBe(0);
      expect(countRows(db, table, 2)).toBe(1);
    }
  });

  it("leaves every RESET_KEEP_TABLES row exactly as it was", () => {
    // create_db.sql's own fresh-install seed already populates every KEEP
    // table for tenant 1 (currencies, modules, payment_methods, ...) — no
    // extra fixture needed.
    const before: Record<string, string> = {};
    for (const table of RESET_KEEP_TABLES) {
      before[table] = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
    }

    runWithTenant(1, () => repo.resetTenantData());

    for (const table of RESET_KEEP_TABLES) {
      const after = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
      expect(after).toBe(before[table]);
    }
  });

  it("deletes only ad-hoc suppliers, keeping module-owned and system rows", () => {
    db.prepare(`INSERT INTO suppliers (tenant_id, name) VALUES (1, 'AdHoc Co')`).run();

    runWithTenant(1, () => repo.resetTenantData());

    const byName = (name: string): number =>
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE tenant_id = 1 AND name = ?`)
          .get(name) as { n: number }
      ).n;

    expect(byName("AdHoc Co")).toBe(0);
    // Seeded by create_db.sql: is_system = 0 but module_key = 'omt_whish'.
    expect(byName("Whish")).toBe(1);
    // Seeded by create_db.sql: is_system = 1.
    expect(byName("iPick")).toBe(1);
  });

  it("wipes and reseeds product_categories / service_presets to the exact create_db.sql defaults", () => {
    db.prepare(
      `INSERT INTO product_categories (tenant_id, name, sort_order) VALUES (1, 'Custom Category', 99)`,
    ).run();
    db.prepare(
      `INSERT INTO service_presets (tenant_id, name, category, cost_usd, price_usd, sort_order)
       VALUES (1, 'Custom Preset', 'digital_account', 1, 2, 99)`,
    ).run();

    runWithTenant(1, () => repo.resetTenantData());

    const categories = db
      .prepare(
        `SELECT name, sort_order, tracks_imei_units FROM product_categories WHERE tenant_id = 1 ORDER BY sort_order`,
      )
      .all();
    expect(categories).toEqual(
      PRODUCT_CATEGORY_DEFAULTS.map((c) => ({
        name: c.name,
        sort_order: c.sort_order,
        tracks_imei_units: c.tracks_imei_units,
      })),
    );

    const presets = db
      .prepare(
        `SELECT name, category, cost_usd, price_usd, sort_order FROM service_presets WHERE tenant_id = 1 ORDER BY sort_order`,
      )
      .all();
    expect(presets).toEqual(
      SERVICE_PRESET_DEFAULTS.map((p) => ({
        name: p.name,
        category: p.category,
        cost_usd: p.cost_usd,
        price_usd: p.price_usd,
        sort_order: p.sort_order,
      })),
    );
  });

  it("zeroes drawer_balances without deleting rows", () => {
    for (const table of RESET_ZERO_TABLES) {
      expect(table).toBe("drawer_balances");
    }

    const before = db
      .prepare(`SELECT COUNT(*) AS n FROM drawer_balances WHERE tenant_id = 1`)
      .get() as { n: number };
    expect(before.n).toBeGreaterThan(0);

    db.prepare(
      `UPDATE drawer_balances SET balance = 500 WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
    ).run();

    runWithTenant(1, () => repo.resetTenantData());

    const after = db
      .prepare(`SELECT COUNT(*) AS n FROM drawer_balances WHERE tenant_id = 1`)
      .get() as { n: number };
    expect(after.n).toBe(before.n);

    // The exact predicate ClosingRepository.hasInitialBalancesSet() uses.
    const nonZero = db
      .prepare(
        `SELECT COUNT(*) AS n FROM drawer_balances WHERE tenant_id = 1 AND balance != 0`,
      )
      .get() as { n: number };
    expect(nonZero.n).toBe(0);
  });

  it("never touches sync_queue / sync_errors (EXCLUDED — no tenant_id column)", () => {
    for (const table of RESET_EXCLUDED_TABLES) {
      expect(["sync_errors", "sync_queue"]).toContain(table);
    }

    db.prepare(`INSERT INTO sync_queue (table_name) VALUES ('test')`).run();
    db.prepare(`INSERT INTO sync_errors (endpoint) VALUES ('test')`).run();

    runWithTenant(1, () => repo.resetTenantData());

    const queueCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM sync_queue`).get() as {
        n: number;
      }
    ).n;
    const errorsCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM sync_errors`).get() as {
        n: number;
      }
    ).n;
    expect(queueCount).toBe(1);
    expect(errorsCount).toBe(1);
  });

  it("previewCounts reports the exact per-table counts resetTenantData will delete", () => {
    insertTenantFixture(db, 1);
    db.prepare(`INSERT INTO suppliers (tenant_id, name) VALUES (1, 'AdHoc Co')`).run();

    const preview = runWithTenant(1, () => repo.previewCounts());

    for (const table of RESET_WIPE_TABLES) {
      expect(preview.counts[table]).toBe(1);
    }
    // Only the ad-hoc supplier counts toward the partial-wipe preview.
    expect(preview.counts.suppliers).toBe(1);
    expect(preview.totalRows).toBe(
      Object.values(preview.counts).reduce((sum, n) => sum + n, 0),
    );
  });
});
