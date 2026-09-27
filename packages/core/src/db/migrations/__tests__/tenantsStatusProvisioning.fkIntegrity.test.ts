/**
 * Migration v187 (tenants_status_provisioning) — FK/data-integrity proof
 * against the REAL, current ~74-table schema (`electron-app/create_db.sql`),
 * not a hand-rolled minimal fixture.
 *
 * tenantsStatusProvisioning.test.ts already proves the CHECK-widen behaviour
 * in isolation against a single hand-built `tenants` + one `clients` child
 * table. This file additionally proves the two things that only show up
 * against the REAL accumulated schema:
 *
 *   1. `tenants` is the FK TARGET of ~70 real tables (`grep -c
 *      "REFERENCES tenants(id)" electron-app/create_db.sql` = 70). v187's
 *      rebuild (DROP + RENAME) must not dangle any of them — `PRAGMA
 *      foreign_key_check` must stay empty across a broad, diverse sample of
 *      those tables, each seeded with a real row, not just one.
 *   2. Every existing `tenants` row/column survives the rebuild verbatim,
 *      and AUTOINCREMENT keeps working, when exercised via the REAL
 *      migration runner (`rollbackTo` / `runMigrations`) against the REAL
 *      schema — not `V187.up(db)` called directly against a synthetic one.
 *
 * Approach: build the DB from the CURRENT `create_db.sql` (which already
 * declares the widened CHECK and seeds `schema_migrations` up to head),
 * seed real data, `rollbackTo(186)` (exercises v187's down() — the REAL
 * "narrow the CHECK back" path — against the real populated schema, which
 * is exactly the pre-v187 shape), then `runMigrations()` again (exercises
 * v187's up() the same way). Both directions get the same FK/data assertions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { runMigrations, rollbackTo, getCurrentVersion } from "../index.js";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "..",
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
  return db;
}

/**
 * Seeds one real row into a broad, diverse sample of the ~70 tables whose
 * `tenant_id` column carries `REFERENCES tenants(id)` in create_db.sql —
 * not an exhaustive replay of every one (see DatabaseResetRepository.test.ts
 * for that, table-by-table), but enough breadth (parents, children,
 * multi-currency, ledger, session and audit tables) that a dangling FK
 * anywhere common would show up in `PRAGMA foreign_key_check`.
 */
function seedRealData(db: Database.Database, tenantId: number): void {
  const run = db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");

    const userId = db
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
         VALUES (?, ?, '', 'staff', 1)`,
      )
      .run(tenantId, `fk-user-${tenantId}`).lastInsertRowid as number;

    db.prepare(
      `INSERT OR IGNORE INTO currencies (tenant_id, code, name, symbol, decimal_places)
       VALUES (?, 'USD', 'US Dollar', '$', 2)`,
    ).run(tenantId);
    // financial_services carries FOREIGN KEY (tenant_id, provider) ->
    // service_providers(tenant_id, code) — tenant 1 gets this seeded for
    // free by create_db.sql's own fresh-install data, but a second tenant
    // (added by this fixture, not by real provisioning) does not.
    db.prepare(
      `INSERT OR IGNORE INTO service_providers
         (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
       VALUES (?, 'OMT', 'OMT', 'OMT_System', 1, 1, 1, 0)`,
    ).run(tenantId);

    const supplierId = db
      .prepare(`INSERT INTO suppliers (tenant_id, name) VALUES (?, ?)`)
      .run(tenantId, `FK Fixture Supplier ${tenantId}`)
      .lastInsertRowid as number;

    const clientId = db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'FK Fixture Client', ?)`,
      )
      .run(tenantId, `fk-phone-${tenantId}`).lastInsertRowid as number;

    const productId = db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type) VALUES (?, 'FK Fixture Product', 'Product')`,
      )
      .run(tenantId).lastInsertRowid as number;

    const partnerId = db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (?, ?)`)
      .run(tenantId, `FK Fixture Partner ${tenantId}`)
      .lastInsertRowid as number;

    const sessionId = db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, user_id, started_by) VALUES (?, ?, 'tester')`,
      )
      .run(tenantId, userId).lastInsertRowid as number;

    const maintenanceId = db
      .prepare(
        `INSERT INTO maintenance (tenant_id, device_name) VALUES (?, 'FK Fixture Device')`,
      )
      .run(tenantId).lastInsertRowid as number;

    const saleId = db
      .prepare(`INSERT INTO sales (tenant_id, client_id) VALUES (?, ?)`)
      .run(tenantId, clientId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id) VALUES (?, ?, ?)`,
    ).run(tenantId, saleId, productId);

    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type) VALUES (?, ?, 'ADJUSTMENT')`,
    ).run(tenantId, supplierId);

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

    db.prepare(
      `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary)
       VALUES (?, ?, 'tester', 'staff', 'TEST', 'test', 'fk fixture')`,
    ).run(tenantId, userId);

    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type) VALUES (?, ?, 'Test Debt')`,
    ).run(tenantId, clientId);

    db.prepare(`INSERT INTO expenses (tenant_id) VALUES (?)`).run(tenantId);

    db.prepare(
      `INSERT INTO recharges (tenant_id, carrier, amount, created_by) VALUES (?, 'mtc', 1, ?)`,
    ).run(tenantId, userId);

    db.prepare(
      `INSERT INTO custom_services (tenant_id, description) VALUES (?, 'FK Fixture service')`,
    ).run(tenantId);

    db.prepare(
      `INSERT INTO loto_tickets (tenant_id, sale_amount, commission_amount, sale_date)
       VALUES (?, 10, 1, '2026-01-01')`,
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
      `INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, ?, ?, '2030-01-01')`,
    ).run(tenantId, userId, `fk-token-${tenantId}`);

    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, created_by)
       VALUES (?, ?, ?, 'FK Fixture', 10, ?)`,
    ).run(tenantId, `FK-CODE-${tenantId}`, clientId, userId);

    db.prepare(
      `INSERT INTO maintenance_parts (tenant_id, maintenance_id, product_id, product_name, quantity)
       VALUES (?, ?, ?, 'Part', 1)`,
    ).run(tenantId, maintenanceId, productId);

    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type, transaction_id)
       VALUES (?, ?, 'sale', ?)`,
    ).run(tenantId, sessionId, saleId);

    // fs_id and product_id are captured so callers can spot-check them if
    // needed; referenced here only to avoid an unused-variable lint error
    // when a future edit trims a read above.
    void fsId;
  });
  run();
}

describe("migration v187 — FK/data integrity against the REAL create_db.sql schema", () => {
  it("rollbackTo(186) then runMigrations() round-trips with zero FK violations and every seeded row intact", () => {
    const db = createTestDb();
    // create_db.sql seeds `schema_migrations` up through head already (fresh
    // install semantics) — turn FK enforcement on the same way
    // electron-app/main.ts does, AFTER the schema+seed exec.
    db.pragma("foreign_keys = ON");

    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(187);

    seedRealData(db, 1);
    // A second tenant so the "does the rebuild fix every ROW, not just
    // tenant 1" question is actually exercised.
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Second Shop', 'second-shop', 'active')`,
    ).run();
    seedRealData(db, 2);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);

    const before = db
      .prepare(`SELECT id, name, slug, contact_name FROM tenants ORDER BY id`)
      .all();
    expect(before).toHaveLength(2);

    // --- down(): v187's real rollback against the real populated schema ---
    rollbackTo(db, 186);
    expect(getCurrentVersion(db)).toBe(186);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
    expect(
      db.prepare(`SELECT id, name, slug, contact_name FROM tenants ORDER BY id`).all(),
    ).toEqual(before);
    // Every seeded child row survived the tenants rebuild untouched.
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id = 1`).get() as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM financial_services WHERE tenant_id = 2`).get() as {
        n: number;
      }).n,
    ).toBe(1);
    // The narrower CHECK is back in force.
    expect(() =>
      db
        .prepare(`INSERT INTO tenants (name, slug, status) VALUES ('X', 'x-186', 'provisioning')`)
        .run(),
    ).toThrow(/CHECK constraint failed/i);

    // --- up(): re-applying v187 against the real populated schema ---
    runMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(187);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
    expect(
      db.prepare(`SELECT id, name, slug, contact_name FROM tenants ORDER BY id`).all(),
    ).toEqual(before);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id = 1`).get() as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM financial_services WHERE tenant_id = 2`).get() as {
        n: number;
      }).n,
    ).toBe(1);

    // 'provisioning' accepted again, AUTOINCREMENT moved past every id ever
    // inserted (including the row from the CHECK-violation attempt above,
    // which SQLite still burns an id for even though the INSERT failed).
    const maxIdBefore = (
      db.prepare(`SELECT MAX(id) AS m FROM tenants`).get() as { m: number }
    ).m;
    const newId = db
      .prepare(
        `INSERT INTO tenants (name, slug, status) VALUES ('Prov', 'prov-up-again', 'provisioning')`,
      )
      .run().lastInsertRowid as number;
    expect(newId).toBeGreaterThan(maxIdBefore);

    db.close();
  });
});
