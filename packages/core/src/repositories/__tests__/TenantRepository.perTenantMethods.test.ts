import Database from "better-sqlite3";
import { TenantRepository } from "../TenantRepository.js";

/**
 * The three additions Phase C's per-tenant provisioner/stats fan-out needs
 * (PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12.2/12.3):
 *
 *   - `getShopStats(tenantId)` — the SAME two stats `listAll()` computes per
 *     row, but queryable for a single tenant from whatever db is ambient
 *     (a shop's OWN file, in per-tenant mode).
 *   - `listAllRows()` — the plain registry rows, no stats subqueries.
 *   - `deleteRegistryRow(id)` — a raw single-row delete, no cascade.
 *
 * Shares its fixture shape with `TenantRepository.listAll.test.ts` (same
 * four tables) since `getShopStats` is the same computation, single-tenant.
 */
describe("TenantRepository — per-tenant-mode additions", () => {
  let db: Database.Database;
  let repo: TenantRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        contact_name TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        username TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        last_activity_at TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO tenants (id, name, slug) VALUES (5, 'Test', 'test');
    `);
    repo = new TenantRepository(db);
  });

  afterEach(() => db.close());

  describe("getShopStats", () => {
    it("matches listAll()'s user_count/last_activity for the SAME tenant", () => {
      db.prepare(
        "INSERT INTO users (tenant_id, username, is_active) VALUES (5, 'a', 1), (5, 'b', 0)",
      ).run();
      db.prepare(
        "INSERT INTO transactions (tenant_id, created_at) VALUES (5, ?)",
      ).run("2026-09-10 23:00:00");

      const viaListAll = repo.listAll().find((t) => t.id === 5)!;
      const viaShopStats = repo.getShopStats(5);

      expect(viaShopStats.user_count).toBe(viaListAll.user_count);
      expect(viaShopStats.last_activity).toBe(viaListAll.last_activity);
      expect(viaShopStats.user_count).toBe(1);
      expect(viaShopStats.last_activity).toBe("2026-09-10 23:00:00");
    });

    it("reports null last_activity and 0 users for an untouched tenant", () => {
      const stats = repo.getShopStats(5);
      expect(stats.user_count).toBe(0);
      expect(stats.last_activity).toBeNull();
    });

    it("takes tenantId as an explicit PARAMETER, not from ambient context — a second tenant's rows never leak in", () => {
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES (1, 'Other', 'other')").run();
      db.prepare(
        "INSERT INTO transactions (tenant_id, created_at) VALUES (1, ?)",
      ).run("2026-09-10 23:00:00");

      expect(repo.getShopStats(5).last_activity).toBeNull();
      expect(repo.getShopStats(1).last_activity).toBe("2026-09-10 23:00:00");
    });
  });

  describe("listAllRows", () => {
    it("returns every registry row without the stats subqueries", () => {
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES (1, 'Other', 'other')").run();

      const rows = repo.listAllRows();
      expect(rows.map((r) => r.id).sort()).toEqual([1, 5]);
      // Plain TenantEntity rows — no user_count/last_activity keys attached.
      expect(rows[0]).not.toHaveProperty("user_count");
      expect(rows[0]).not.toHaveProperty("last_activity");
    });

    it("orders by id ascending, same as listAll()", () => {
      db.prepare("INSERT INTO tenants (id, name, slug) VALUES (2, 'Middle', 'middle')").run();
      const rows = repo.listAllRows();
      expect(rows.map((r) => r.id)).toEqual([2, 5]);
    });
  });

  describe("deleteRegistryRow", () => {
    it("removes ONLY the tenants row — no cascade over other tables", () => {
      db.prepare(
        "INSERT INTO transactions (tenant_id, created_at) VALUES (5, ?)",
      ).run("2026-09-10 23:00:00");

      repo.deleteRegistryRow(5);

      expect(repo.getById(5)).toBeNull();
      // Unlike deleteTenantCascade, this never touches tenant-scoped tables.
      const stillThere = db
        .prepare("SELECT COUNT(*) AS c FROM transactions WHERE tenant_id = 5")
        .get() as { c: number };
      expect(stillThere.c).toBe(1);
    });

    it("is a no-op (does not throw) for a tenant id that does not exist", () => {
      expect(() => repo.deleteRegistryRow(999)).not.toThrow();
    });
  });
});
