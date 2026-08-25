/**
 * CategoryRepository — LIRA-143 Phase 5 (decision #9: the tracks_imei_units
 * Settings toggle). Hand-built minimal schema (same house pattern as
 * `ProductUnitRepository.test.ts`): tenants/product_categories/products.
 *
 * Covers the `update()` extension: name-only (pre-existing behavior,
 * unchanged), flag-only, both together, and the "at least one field" guard.
 */

import Database from "better-sqlite3";
import { CategoryRepository } from "../CategoryRepository";
import { runWithTenant } from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');

    CREATE TABLE product_categories (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER REFERENCES tenants(id),
      name              TEXT NOT NULL COLLATE NOCASE,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      is_active         INTEGER NOT NULL DEFAULT 1,
      tracks_imei_units INTEGER NOT NULL DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER REFERENCES tenants(id),
      category_id INTEGER,
      category    TEXT
    );
  `);
  return db;
}

describe("CategoryRepository", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new CategoryRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  function insertCategory(
    tenantId: number,
    name: string,
    tracksImeiUnits = 0,
  ): number {
    const result = db
      .prepare(
        `INSERT INTO product_categories (tenant_id, name, tracks_imei_units) VALUES (?, ?, ?)`,
      )
      .run(tenantId, name, tracksImeiUnits);
    return Number(result.lastInsertRowid);
  }

  describe("update", () => {
    it("updates name only, leaving tracks_imei_units untouched (pre-existing behavior)", () => {
      const id = insertCategory(1, "Accessories", 0);

      const changed = runWithTenant(1, () =>
        repo.update(id, { name: "Cables" }),
      );

      expect(changed).toBe(true);
      const row = runWithTenant(1, () => repo.getAll()).find(
        (c) => c.id === id,
      )!;
      expect(row.name).toBe("Cables");
      expect(row.tracks_imei_units).toBe(0);
    });

    it("updates tracks_imei_units only, leaving name untouched", () => {
      const id = insertCategory(1, "Phones", 0);

      const changed = runWithTenant(1, () =>
        repo.update(id, { tracksImeiUnits: true }),
      );

      expect(changed).toBe(true);
      const row = runWithTenant(1, () => repo.getAll()).find(
        (c) => c.id === id,
      )!;
      expect(row.name).toBe("Phones");
      expect(row.tracks_imei_units).toBe(1);
    });

    it("updates both name and tracks_imei_units together", () => {
      const id = insertCategory(1, "Misc", 0);

      runWithTenant(1, () =>
        repo.update(id, { name: "Phones", tracksImeiUnits: true }),
      );

      const row = runWithTenant(1, () => repo.getAll()).find(
        (c) => c.id === id,
      )!;
      expect(row.name).toBe("Phones");
      expect(row.tracks_imei_units).toBe(1);
    });

    it("can flip tracks_imei_units back off", () => {
      const id = insertCategory(1, "Phones", 1);

      runWithTenant(1, () => repo.update(id, { tracksImeiUnits: false }));

      const row = runWithTenant(1, () => repo.getAll()).find(
        (c) => c.id === id,
      )!;
      expect(row.tracks_imei_units).toBe(0);
    });

    it("throws when neither name nor tracksImeiUnits is provided", () => {
      const id = insertCategory(1, "Phones", 0);

      expect(() => runWithTenant(1, () => repo.update(id, {}))).toThrow(
        /at least one/i,
      );
    });

    it("is tenant-scoped — cannot update another tenant's category", () => {
      const id = insertCategory(2, "OtherTenantCategory", 0);

      const changed = runWithTenant(1, () =>
        repo.update(id, { name: "Hijacked" }),
      );

      expect(changed).toBe(false);
    });
  });

  describe("getAll", () => {
    it("projects tracks_imei_units through the shared COLUMNS list", () => {
      insertCategory(1, "Phones", 1);
      insertCategory(1, "Accessories", 0);

      const rows = runWithTenant(1, () => repo.getAll());

      expect(rows.map((r) => r.tracks_imei_units)).toEqual([0, 1]);
    });
  });
});
