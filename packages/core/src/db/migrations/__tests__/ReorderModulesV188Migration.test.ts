/**
 * Migration v188 (LIRA-227) — re-asserts module sort_order for
 * custom_services/profits/loto to the fresh-seed values, undoing the drift
 * v49 left behind.
 *
 * Background: v49's up() set sort_order to loto=13, custom_services=14,
 * profits=15. Both fresh-seed definitions of the module catalog
 * (electron-app/create_db.sql's tenant-1 INSERTs and
 * TenantRepository.MODULE_SEED_ROWS) have always used custom_services=12,
 * profits=13, loto=16, and no migration between v49 and v188 re-set them.
 * So a genuinely upgraded tenant 1 and a freshly installed one disagree on
 * sidebar order for these three modules — presentation only.
 *
 * Written alongside the fix in the same change (not authored independently
 * ahead of it as a failing-first guard per CLAUDE.md rule 17) — the ticket
 * this guards (LIRA-227) has no separate rule-17 acceptance criterion, and
 * unlike a bug fix in pre-existing code, there is no "pre-fix" state of v188
 * itself to run this against without reverting the migration just written
 * in this same change, which this batch's rule explicitly forbids doing
 * even temporarily. What this DOES prove, directly: (a) the exact v49 drift
 * shape is reproduced by the fixture below (sanity check), (b) up() moves
 * every affected row — across MULTIPLE tenants, since the fix is
 * deliberately tenant-unscoped — to the target values while leaving every
 * other module's sort_order and every other column untouched, and (c)
 * down() is the exact inverse, restoring v49's post-migration values.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V188 = MIGRATIONS.find((m) => m.version === 188)!;

interface ModuleRow {
  tenant_id: number;
  key: string;
  sort_order: number;
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE modules (
      tenant_id   INTEGER,
      key         TEXT NOT NULL,
      label       TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '',
      route       TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_enabled  INTEGER NOT NULL DEFAULT 1,
      admin_only  INTEGER NOT NULL DEFAULT 0,
      is_system   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, key)
    );
  `);

  // v49's exact post-migration state, seeded for TWO tenants — the fix must
  // move both, since sidebar order is deliberately not per-tenant (v162/
  // v163/v178/v179 precedent this migration follows).
  const insert = db.prepare(`
    INSERT INTO modules (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
  `);
  for (const tenantId of [1, 2]) {
    insert.run(tenantId, "loto", "Loto", "Ticket", "/loto", 13);
    insert.run(
      tenantId,
      "custom_services",
      "Services",
      "Briefcase",
      "/custom-services",
      14,
    );
    insert.run(tenantId, "profits", "Profits", "TrendingUp", "/profits", 15);
    // An untouched module — proves up()/down() don't move anything else.
    insert.run(tenantId, "pos", "Point of Sale", "ShoppingCart", "/pos", 1);
  }
  return db;
}

function sortOrders(db: Database.Database): ModuleRow[] {
  return db
    .prepare(`SELECT tenant_id, key, sort_order FROM modules ORDER BY tenant_id, key`)
    .all() as ModuleRow[];
}

describe("migration v188 — module sort_order reorder (LIRA-227)", () => {
  it("the fixture reproduces v49's exact drifted state (sanity check)", () => {
    const db = makeDb();
    const rows = sortOrders(db).filter((r) => r.tenant_id === 1);
    expect(rows.find((r) => r.key === "loto")!.sort_order).toBe(13);
    expect(rows.find((r) => r.key === "custom_services")!.sort_order).toBe(
      14,
    );
    expect(rows.find((r) => r.key === "profits")!.sort_order).toBe(15);
    db.close();
  });

  it("up() moves custom_services/profits/loto to the fresh-seed values, for every tenant, and leaves 'pos' untouched", () => {
    const db = makeDb();
    V188.up(db);

    for (const tenantId of [1, 2]) {
      const rows = sortOrders(db).filter((r) => r.tenant_id === tenantId);
      expect(rows.find((r) => r.key === "custom_services")!.sort_order).toBe(
        12,
      );
      expect(rows.find((r) => r.key === "profits")!.sort_order).toBe(13);
      expect(rows.find((r) => r.key === "loto")!.sort_order).toBe(16);
      expect(rows.find((r) => r.key === "pos")!.sort_order).toBe(1);
    }
    db.close();
  });

  it("down() is the exact inverse — restores v49's post-migration values", () => {
    const db = makeDb();
    V188.up(db);
    V188.down!(db);

    for (const tenantId of [1, 2]) {
      const rows = sortOrders(db).filter((r) => r.tenant_id === tenantId);
      expect(rows.find((r) => r.key === "custom_services")!.sort_order).toBe(
        14,
      );
      expect(rows.find((r) => r.key === "profits")!.sort_order).toBe(15);
      expect(rows.find((r) => r.key === "loto")!.sort_order).toBe(13);
      expect(rows.find((r) => r.key === "pos")!.sort_order).toBe(1);
    }
    db.close();
  });

  it("up() is idempotent (a re-run reads the same target values)", () => {
    const db = makeDb();
    V188.up(db);
    V188.up(db);

    const rows = sortOrders(db).filter((r) => r.tenant_id === 1);
    expect(rows.find((r) => r.key === "custom_services")!.sort_order).toBe(
      12,
    );
    expect(rows.find((r) => r.key === "profits")!.sort_order).toBe(13);
    expect(rows.find((r) => r.key === "loto")!.sort_order).toBe(16);
    db.close();
  });

  it("up() skips without throwing when the 'modules' table is absent (migration-runner fixture harnesses)", () => {
    const db = new Database(":memory:");
    expect(() => V188.up(db)).not.toThrow();
    db.close();
  });
});
