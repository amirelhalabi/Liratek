/**
 * Migration v176 — add_supplier_account_link
 * (LIRA-187, docs/plans/todo_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1/§5).
 *
 * Proves:
 *  - Both nullable columns land: suppliers.account_supplier_id and
 *    supplier_ledger.settlement_id.
 *  - Seed links each tenant's 'iPick' and 'OMT_APP' supplier rows to THEIR
 *    OWN tenant's 'OMT' supplier row — never cross-tenant.
 *  - A tenant with no 'OMT' supplier ends with NULL account_supplier_id on
 *    its children — no crash, no accidental link to another tenant's OMT.
 *  - Katsh stays NULL (D7 — standalone).
 *  - Running up() twice is a no-op (doesn't reassign an existing link).
 *  - A minimal schema lacking suppliers/supplier_ledger is skipped, not
 *    thrown on (this repo's known "missing table kills every test in the
 *    file" trap).
 *  - down() drops both columns.
 *
 * Constructed directly against the migration's up()/down(), mirroring
 * ServiceProvidersTableMigration.test.ts's MIGRATIONS.find(...) pattern.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES
      (1, 'Default', 'default', 'active'),
      (2, 'Second Shop', 'second-shop', 'active'),
      (3, 'No OMT Shop', 'no-omt-shop', 'active');

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      name TEXT NOT NULL,
      provider TEXT DEFAULT NULL,
      is_system INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0
    );

    -- Tenant 1: OMT + both children + Katsh (must stay unlinked, D7).
    INSERT INTO suppliers (tenant_id, name, provider, is_system) VALUES
      (1, 'OMT', 'OMT', 1),
      (1, 'iPick', 'iPick', 1),
      (1, 'OMT App', 'OMT_APP', 1),
      (1, 'Katsh', 'Katsh', 1);

    -- Tenant 2: its OWN OMT + both children — must never link to tenant 1's OMT.
    INSERT INTO suppliers (tenant_id, name, provider, is_system) VALUES
      (2, 'OMT', 'OMT', 1),
      (2, 'iPick', 'iPick', 1),
      (2, 'OMT App', 'OMT_APP', 1);

    -- Tenant 3: no OMT supplier at all.
    INSERT INTO suppliers (tenant_id, name, provider, is_system) VALUES
      (3, 'iPick', 'iPick', 1);
  `);
  return db;
}

const migration = MIGRATIONS.find((m) => m.version === 176);

interface SupplierRow {
  id: number;
  account_supplier_id: number | null;
}

function supplierRow(
  db: Database.Database,
  tenantId: number,
  provider: string,
): SupplierRow {
  const row = db
    .prepare(
      `SELECT id, account_supplier_id FROM suppliers WHERE tenant_id = ? AND provider = ?`,
    )
    .get(tenantId, provider) as SupplierRow | undefined;
  if (!row) {
    throw new Error(`fixture missing supplier tenant=${tenantId} provider=${provider}`);
  }
  return row;
}

describe("Migration v176 — add_supplier_account_link", () => {
  it("is registered at version 176", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("add_supplier_account_link");
  });

  it("adds suppliers.account_supplier_id and supplier_ledger.settlement_id", () => {
    const db = createTestDb();
    migration!.up(db);

    const supplierCols = (
      db.prepare("PRAGMA table_info(suppliers)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(supplierCols).toContain("account_supplier_id");

    const ledgerCols = (
      db.prepare("PRAGMA table_info(supplier_ledger)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(ledgerCols).toContain("settlement_id");

    db.close();
  });

  it("links each tenant's iPick and OMT App to THEIR OWN tenant's OMT — never cross-tenant", () => {
    const db = createTestDb();
    migration!.up(db);

    const omt1 = supplierRow(db, 1, "OMT");
    const ipick1 = supplierRow(db, 1, "iPick");
    const app1 = supplierRow(db, 1, "OMT_APP");
    expect(ipick1.account_supplier_id).toBe(omt1.id);
    expect(app1.account_supplier_id).toBe(omt1.id);

    const omt2 = supplierRow(db, 2, "OMT");
    const ipick2 = supplierRow(db, 2, "iPick");
    const app2 = supplierRow(db, 2, "OMT_APP");
    expect(ipick2.account_supplier_id).toBe(omt2.id);
    expect(app2.account_supplier_id).toBe(omt2.id);

    // Cross-tenant sanity — tenant 2's children never resolve to tenant 1's OMT.
    expect(ipick2.account_supplier_id).not.toBe(omt1.id);
    expect(app2.account_supplier_id).not.toBe(omt1.id);

    db.close();
  });

  it("leaves account_supplier_id NULL for a tenant with no OMT supplier — no crash", () => {
    const db = createTestDb();
    expect(() => migration!.up(db)).not.toThrow();

    const ipick3 = supplierRow(db, 3, "iPick");
    expect(ipick3.account_supplier_id).toBeNull();

    db.close();
  });

  it("leaves Katsh unlinked (D7 — Katsh stays standalone)", () => {
    const db = createTestDb();
    migration!.up(db);

    const katsh1 = supplierRow(db, 1, "Katsh");
    expect(katsh1.account_supplier_id).toBeNull();

    db.close();
  });

  it("is idempotent — running up() twice does not change existing links", () => {
    const db = createTestDb();
    migration!.up(db);
    const before = supplierRow(db, 1, "iPick").account_supplier_id;

    migration!.up(db);
    const after = supplierRow(db, 1, "iPick").account_supplier_id;

    expect(after).toBe(before);
    db.close();
  });

  it("does not overwrite a manually re-parented link on a second run", () => {
    const db = createTestDb();
    migration!.up(db);

    // Simulate an admin manually re-parenting (LIRA-191) — a real value the
    // re-run must not clobber. Must be an existing supplier id: the column
    // carries `REFERENCES suppliers(id)` and this codebase's better-sqlite3
    // build enforces `foreign_keys = ON` by default (see the many sibling
    // *FkMigration test files' comments to the same effect), so a
    // fabricated id like 999 fails with "FOREIGN KEY constraint failed"
    // rather than proving anything about the migration. Katsh (tenant 1)
    // is a real row unrelated to the OMT account — reusing its id is a
    // stand-in for "some other real supplier the admin picked".
    const katsh1 = supplierRow(db, 1, "Katsh");
    db.prepare(
      `UPDATE suppliers SET account_supplier_id = ? WHERE tenant_id = 1 AND provider = 'iPick'`,
    ).run(katsh1.id);

    migration!.up(db);

    const ipick1 = supplierRow(db, 1, "iPick");
    expect(ipick1.account_supplier_id).toBe(katsh1.id);
    db.close();
  });

  it("skips without throwing when suppliers/supplier_ledger are absent (minimal jest schema)", () => {
    const db = new Database(":memory:");
    expect(() => migration!.up(db)).not.toThrow();
    db.close();
  });

  it("down() drops both columns", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);

    const supplierCols = (
      db.prepare("PRAGMA table_info(suppliers)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(supplierCols).not.toContain("account_supplier_id");

    const ledgerCols = (
      db.prepare("PRAGMA table_info(supplier_ledger)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(ledgerCols).not.toContain("settlement_id");

    db.close();
  });

  it("down() skips without throwing on a minimal schema", () => {
    const db = new Database(":memory:");
    expect(() => migration!.down!(db)).not.toThrow();
    db.close();
  });
});
