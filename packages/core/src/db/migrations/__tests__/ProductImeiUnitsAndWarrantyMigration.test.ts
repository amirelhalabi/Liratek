/**
 * Migration v157 — add_product_imei_units_and_warranty
 * (LIRA-143 phase 1 — schema only; nothing reads/writes product_units yet).
 *
 * Proves:
 *  - up() creates `product_units` plus all 5 indexes.
 *  - up() adds products.warranty_months, product_categories.tracks_imei_units
 *    (backfilled to 1 for the row named 'Phones', 0 for every other row),
 *    and sale_items.warranty_until.
 *  - up() is idempotent (column-existence guards + CREATE ... IF NOT EXISTS
 *    — a second call is a clean no-op, no thrown error, no duplicated rows,
 *    and does not clobber a hand-edited tracks_imei_units value).
 *  - The partial unique index idx_product_units_active_imei blocks a
 *    duplicate IMEI only among IN_STOCK units for the SAME tenant: a second
 *    IN_STOCK insert of the same (tenant_id, imei) throws, but flipping the
 *    first to SOLD frees the IMEI for a fresh IN_STOCK insert, and the same
 *    IMEI is free for a DIFFERENT tenant throughout.
 *  - product_units.status CHECK accepts exactly ('IN_STOCK', 'SOLD') and
 *    rejects anything else.
 *  - sale_item_id going NULL on a sale_items delete (ON DELETE SET NULL)
 *    rather than blocking the delete.
 *  - down() drops product_units and drops the three added columns (this
 *    better-sqlite3 build's bundled SQLite supports DROP COLUMN — same
 *    precedent as v136/v141).
 *
 * Constructed directly against the migration's up()/down()
 * (`MIGRATIONS.find(...)` pattern, mirrors
 * `ExchangeLotSettlementTablesMigration.test.ts`).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 157);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Second', 'second', 'active');

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL,
      category           TEXT DEFAULT 'General',
      cost_price_usd     DECIMAL(10, 2) DEFAULT 0,
      selling_price_usd  DECIMAL(10, 2) DEFAULT 0,
      stock_quantity      INTEGER DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO products (id, tenant_id, name, item_type) VALUES (1, 1, 'iPhone 13', 'Phone');
    INSERT INTO products (id, tenant_id, name, item_type) VALUES (2, 2, 'iPhone 13', 'Phone');

    CREATE TABLE product_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER REFERENCES tenants(id),
      name       TEXT NOT NULL COLLATE NOCASE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );
    INSERT INTO product_categories (tenant_id, name, sort_order) VALUES
      (1, 'Accessories', 0),
      (1, 'Phones', 1),
      (2, 'Phones', 0);

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO sales (id, tenant_id) VALUES (1, 1);

    CREATE TABLE sale_items (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER REFERENCES tenants(id),
      sale_id                  INTEGER NOT NULL REFERENCES sales(id),
      product_id               INTEGER NOT NULL REFERENCES products(id),
      quantity                 INTEGER DEFAULT 1,
      sold_price_usd           DECIMAL(10, 2),
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO sale_items (id, tenant_id, sale_id, product_id) VALUES (1, 1, 1, 1);
  `);
  return db;
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

function indexExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(name) !== undefined
  );
}

function columnExists(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

describe("Migration v157 — add_product_imei_units_and_warranty", () => {
  it("is registered at version 157", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("add_product_imei_units_and_warranty");
  });

  it("up() creates product_units and all 5 indexes", () => {
    const db = createTestDb();
    migration!.up(db);

    expect(tableExists(db, "product_units")).toBe(true);
    expect(indexExists(db, "idx_product_units_active_imei")).toBe(true);
    expect(indexExists(db, "idx_product_units_tenant_id")).toBe(true);
    expect(indexExists(db, "idx_product_units_imei")).toBe(true);
    expect(indexExists(db, "idx_product_units_product")).toBe(true);
    expect(indexExists(db, "idx_product_units_sale_item")).toBe(true);

    db.close();
  });

  it("up() adds warranty_months, tracks_imei_units (backfilled), and warranty_until", () => {
    const db = createTestDb();
    migration!.up(db);

    expect(columnExists(db, "products", "warranty_months")).toBe(true);
    expect(columnExists(db, "product_categories", "tracks_imei_units")).toBe(
      true,
    );
    expect(columnExists(db, "sale_items", "warranty_until")).toBe(true);

    const rows = db
      .prepare(
        `SELECT tenant_id, name, tracks_imei_units FROM product_categories ORDER BY tenant_id, name`,
      )
      .all() as { tenant_id: number; name: string; tracks_imei_units: number }[];

    const phonesRows = rows.filter((r) => r.name === "Phones");
    expect(phonesRows).toHaveLength(2);
    for (const r of phonesRows) {
      expect(r.tracks_imei_units).toBe(1);
    }
    const accessories = rows.find((r) => r.name === "Accessories");
    expect(accessories!.tracks_imei_units).toBe(0);

    db.close();
  });

  it("up() is idempotent — a second call is a clean no-op and preserves data", () => {
    const db = createTestDb();
    migration!.up(db);

    db.prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (1, 1, '111111111111111')`,
    ).run();
    // Hand-edit a tracks_imei_units value to prove the backfill UPDATE (which
    // re-runs unguarded inside the ADD COLUMN branch) doesn't clobber it —
    // the guard is on column existence, so a second up() call must skip the
    // ALTER/UPDATE entirely once the column is already there.
    db.prepare(
      `UPDATE product_categories SET tracks_imei_units = 0 WHERE name = 'Phones' AND tenant_id = 1`,
    ).run();

    expect(() => migration!.up(db)).not.toThrow();

    const units = db.prepare(`SELECT * FROM product_units`).all();
    expect(units).toHaveLength(1);

    const phonesTenant1 = db
      .prepare(
        `SELECT tracks_imei_units FROM product_categories WHERE name = 'Phones' AND tenant_id = 1`,
      )
      .get() as { tracks_imei_units: number };
    expect(phonesTenant1.tracks_imei_units).toBe(0);

    db.close();
  });

  it("up() on a bare DB with NONE of products/product_categories/sale_items does not throw, still creates product_units, and down() cleans it up (regression guard for the runner-test bug: table_info on a missing table returns an empty array, so the naive column guard alone walked straight into ALTER TABLE <missing>)", () => {
    // Deliberately not using createTestDb() — this DB has no tenants,
    // products, product_categories, or sale_items tables at all, mirroring
    // how telecomDaysCostMigrationsViaRunner.test.ts /
    // PartnersSystemAssociationFkMigrationViaRunner.test.ts build a minimal
    // DB from a slice of migrations with no create_db.sql base.
    const db = new Database(":memory:");

    expect(() => migration!.up(db)).not.toThrow();
    expect(tableExists(db, "product_units")).toBe(true);
    expect(indexExists(db, "idx_product_units_active_imei")).toBe(true);
    // The three ALTER TABLE ADD COLUMN blocks were all skipped (their base
    // tables don't exist in this bare DB) — CREATE TABLE product_units
    // itself does NOT require products/sale_items to exist yet (SQLite
    // defers FK-target resolution to enforcement time, not schema-creation
    // time), which is exactly why the migration got as far as the ALTERs
    // before this bug was caught.
    expect(columnExists(db, "products", "warranty_months")).toBe(false);

    expect(() => migration!.down!(db)).not.toThrow();
    expect(tableExists(db, "product_units")).toBe(false);

    db.close();
  });

  it("down() drops product_units and the three added columns", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);

    expect(tableExists(db, "product_units")).toBe(false);
    expect(columnExists(db, "products", "warranty_months")).toBe(false);
    expect(columnExists(db, "product_categories", "tracks_imei_units")).toBe(
      false,
    );
    expect(columnExists(db, "sale_items", "warranty_until")).toBe(false);

    db.close();
  });

  it("down() -> up() round trip is clean", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);
    expect(() => migration!.up(db)).not.toThrow();
    expect(tableExists(db, "product_units")).toBe(true);
    expect(columnExists(db, "products", "warranty_months")).toBe(true);
    db.close();
  });

  describe("partial unique index — duplicate IMEI blocked only among IN_STOCK units", () => {
    it("rejects a second IN_STOCK insert of the same (tenant, imei), frees it once the first is SOLD, and never collides across tenants", () => {
      const db = createTestDb();
      migration!.up(db);

      const first = db
        .prepare(
          `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (1, 1, '359876543210987')`,
        )
        .run();
      const firstId = Number(first.lastInsertRowid);

      // Same tenant, same IMEI, still IN_STOCK — must be rejected.
      expect(() =>
        db
          .prepare(
            `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (1, 1, '359876543210987')`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);

      // A different tenant may register the SAME IMEI — the index is
      // scoped to (tenant_id, imei), not imei alone.
      const otherTenant = db
        .prepare(
          `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (2, 2, '359876543210987')`,
        )
        .run();
      expect(otherTenant.changes).toBe(1);

      // Flip the first unit to SOLD (as a sale would) — the IMEI is now
      // free for tenant 1 to re-register.
      db.prepare(`UPDATE product_units SET status = 'SOLD' WHERE id = ?`).run(
        firstId,
      );

      const reregistered = db
        .prepare(
          `INSERT INTO product_units (tenant_id, product_id, imei) VALUES (1, 1, '359876543210987')`,
        )
        .run();
      expect(reregistered.changes).toBe(1);

      db.close();
    });
  });

  it("status CHECK accepts exactly ('IN_STOCK', 'SOLD') and rejects a bogus value", () => {
    const db = createTestDb();
    migration!.up(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, 1, '111', 'BOGUS')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    for (const status of ["IN_STOCK", "SOLD"]) {
      const result = db
        .prepare(
          `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, 1, ?, ?)`,
        )
        .run(`imei-${status}`, status);
      expect(result.changes).toBe(1);
    }

    db.close();
  });

  it("sale_item_id is nulled (not blocked) when the referenced sale_items row is deleted", () => {
    const db = createTestDb();
    migration!.up(db);

    db.prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei, status, sale_item_id) VALUES (1, 1, '222', 'SOLD', 1)`,
    ).run();

    expect(() => db.prepare(`DELETE FROM sale_items WHERE id = 1`).run()).not.toThrow();

    const unit = db
      .prepare(`SELECT sale_item_id FROM product_units WHERE imei = '222'`)
      .get() as { sale_item_id: number | null };
    expect(unit.sale_item_id).toBeNull();

    db.close();
  });
});
