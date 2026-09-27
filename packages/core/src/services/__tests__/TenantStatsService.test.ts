/**
 * `TenantStatsService` — the admin tenant-list per-shop stats fan-out
 * (Phase C wave 2, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/12.3,
 * table row #8).
 *
 * Wires `setDatabaseResolver()` + a real `TenantDatabasePool` the same way
 * `backend/src/database/connection.ts` does in per-tenant mode (matching
 * `tenantDatabasePool.routing.test.ts`'s convention) so this exercises REAL
 * routing through `runWithTenant`/`runWithoutTenant`, not a mocked
 * repository — the property under test IS the routing (does each shop's
 * OWN file get asked for its OWN stats, merged onto the platform's rows).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { setDatabaseResolver } from "../../db/connection.js";
import {
  runWithoutTenant,
  getCurrentTenantId,
  isTenantBypass,
  TenantContextError,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  setTenantDatabaseIdLister,
  listTenantDatabaseIds,
} from "../../db/tenantDatabaseIds.js";
import { TenantDatabasePool } from "../../db/tenantDatabasePool.js";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { TenantStatsService } from "../TenantStatsService.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-stats-"));
}

const SHOP_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    username TEXT,
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
`;

function createShopFile(dir: string, tenantId: number): void {
  const db = new Database(path.join(dir, `${tenantId}.db`));
  db.exec(SHOP_SCHEMA);
  db.close();
}

describe("TenantStatsService.listAllWithStats — per-tenant mode fan-out", () => {
  let dir: string;
  let platformDb: Database.Database;
  let pool: TenantDatabasePool;
  let tenantRepo: TenantRepository;
  let service: TenantStatsService;

  beforeEach(() => {
    dir = makeTmpDir();

    platformDb = new Database(":memory:");
    platformDb.exec(`
      CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        contact_name TEXT, contact_phone TEXT, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO tenants (id, name, slug) VALUES (1, 'Alpha', 'alpha');
      INSERT INTO tenants (id, name, slug) VALUES (2, 'Beta', 'beta');
      INSERT INTO tenants (id, name, slug) VALUES (3, 'NoFileYet', 'nofileyet');
    `);
    // Empty — only needed so listAll()'s subqueries have a table to query
    // in the "shared mode" test below (bypass routes to this db there too).
    platformDb.exec(SHOP_SCHEMA);

    // Tenants 1 and 2 have their own file; 3 does NOT (mid-provisioning, or
    // a stray platform row with no file yet) — must still show up, nulled.
    createShopFile(dir, 1);
    createShopFile(dir, 2);

    pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: () => {},
    });

    setDatabaseResolver(() => {
      if (isTenantBypass()) return platformDb;
      try {
        const id = getCurrentTenantId();
        return pool.get(id);
      } catch (error) {
        if (error instanceof TenantContextError) return platformDb;
        throw error;
      }
    });
    setTenantDatabaseIdLister(() => [1, 2]);

    // NO explicit db override: getShopStats() must resolve LIVE per-call
    // (via the ambient resolver installed above), not be pinned to one
    // connection — a `new TenantRepository(platformDb)` here would silently
    // defeat the whole fan-out by always reading the platform file.
    tenantRepo = new TenantRepository();
    service = new TenantStatsService(tenantRepo);
  });

  afterEach(() => {
    setDatabaseResolver(null);
    setTenantDatabaseIdLister(null);
    resetTenantContext();
    pool.closeAll();
    platformDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sanity: listTenantDatabaseIds() reflects the installed lister", () => {
    expect(listTenantDatabaseIds()).toEqual([1, 2]);
  });

  it("merges EACH shop's own stats onto its platform row", () => {
    const shop1 = pool.get(1);
    shop1.exec(
      "INSERT INTO users (tenant_id, username, is_active) VALUES (1, 'a', 1), (1, 'b', 0)",
    );
    shop1.exec(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, '2026-09-10 23:00:00')",
    );

    const shop2 = pool.get(2);
    shop2.exec(
      "INSERT INTO users (tenant_id, username, is_active) VALUES (2, 'c', 1)",
    );

    const rows = runWithoutTenant(() => service.listAllWithStats());
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(1)?.user_count).toBe(1);
    expect(byId.get(1)?.last_activity).toBe("2026-09-10 23:00:00");
    expect(byId.get(2)?.user_count).toBe(1);
    expect(byId.get(2)?.last_activity).toBeNull();
  });

  it("shows nulls (never breaks the list) for a tenant with no file yet", () => {
    const rows = runWithoutTenant(() => service.listAllWithStats());
    const row3 = rows.find((r) => r.id === 3);
    expect(row3).toBeTruthy();
    expect(row3?.user_count).toBe(0);
    expect(row3?.last_activity).toBeNull();
  });

  it("never lets one tenant's data leak into another's row", () => {
    const shop1 = pool.get(1);
    shop1.exec(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, '2026-09-10 23:00:00')",
    );

    const rows = runWithoutTenant(() => service.listAllWithStats());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(2)?.last_activity).toBeNull();
  });

  it("shared mode (no lister installed) falls straight through to listAll()", () => {
    setTenantDatabaseIdLister(null);

    const shop1 = pool.get(1);
    shop1.exec(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, '2026-09-10 23:00:00')",
    );

    // With no lister, TenantRepository.listAll() runs its OWN correlated
    // subqueries against whatever db is ambient — here that is the
    // PLATFORM db (bypass), which has none of shop1's rows. This proves
    // the "shared mode: listAll() already complete" branch is actually
    // taken (not silently still fanning out).
    const rows = runWithoutTenant(() => service.listAllWithStats());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(1)?.last_activity).toBeNull();
  });
});
