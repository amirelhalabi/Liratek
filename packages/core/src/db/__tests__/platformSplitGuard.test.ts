/**
 * `checkPlatformSplitStatus()` — the safety lock's detection function (§ 12.4
 * ticket item 1, `platformSplitGuard.ts`). Brand-new module: rule 17's
 * "written first, seen failing on unfixed code" does not apply here in the
 * usual sense — there is no prior version of this function to run against.
 * Stated honestly: NOT proven failing-first for the unit-level tests below;
 * each assertion is instead the specification, same as `tenantSplit.test.ts`
 * (the module it reuses) was when it was written.
 *
 * What IS proven here, with real temp files and a real better-sqlite3
 * connection (no mocks), is the end-to-end behaviour the ticket asked for:
 *
 *   - An UNSPLIT platform file (today's shared `liratek.db`, real shop rows
 *     still in it) makes the guard refuse: `installed: false`, and — because
 *     nothing calls `setDatabaseResolver()` in that branch — `getDatabase()`
 *     keeps resolving to the single platform file, which still answers shop
 *     queries correctly. This is "behave exactly like shared mode."
 *   - A SPLIT platform file (produced by the REAL `splitTenantDatabase()`
 *     tool, not a hand-rolled stand-in) makes the guard proceed: a
 *     `TenantDatabasePool` over the split-out tenant files is installed as
 *     the resolver, and a query made from inside `runWithTenant(id)` is
 *     served from THAT tenant's own file.
 *
 * Built against the REAL production schema (`electron-app/create_db.sql` +
 * `runMigrations`), the same technique `tenantSplit.test.ts` uses, for the
 * same reason: `discoverTenantScopedTables()`'s whole job is PRAGMA
 * discovery across the real ~70-table schema, so a hand-rolled mini schema
 * would prove nothing about it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  initDatabase,
  closeDatabase,
  setDatabaseResolver,
  getDatabase,
} from "../connection.js";
import { runMigrations } from "../migrations/index.js";
import {
  splitTenantDatabase,
  discoverTenantScopedTables,
  quoteIdent,
} from "../tenantSplit.js";
import { checkPlatformSplitStatus } from "../platformSplitGuard.js";
import {
  runWithTenant,
  isTenantBypass,
  getCurrentTenantId,
  TenantContextError,
  resetTenantContext,
} from "../tenantContext.js";
import { TenantDatabasePool } from "../tenantDatabasePool.js";

// packages/core/src/db/__tests__ -> repo root is 5 levels up.
const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-split-guard-"));
}

/** Real production schema, seeded with tenant 1 (schema's own default) and
 * tenant 5, each with a few rows in a couple of representative tenant-scoped
 * tables — enough for the guard to see real shop data, not a parity-proving
 * fixture (that job belongs to `tenantSplit.test.ts`). */
function buildUnsplitPlatformDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = ON");

  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Test Shop', 'test-shop', 'active')`,
  ).run();
  // Tenant 1's subscription is already seeded by create_db.sql itself
  // (`INSERT OR IGNORE INTO tenant_subscriptions ... tenant_id = 1`) — only
  // tenant 5's is new here.
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (5, 'standard', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Tenant1 Client', '1000001')`,
  ).run();
  db.prepare(
    `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (5, 'Tenant5 Client', '5000001')`,
  ).run();

  return db;
}

/** Minimal resolver, matching `backend/src/database/tenantDbResolver.ts`'s
 * `buildTenantDbResolver()` shape exactly (that module lives in the backend
 * package and cannot be imported from core), so the end-to-end test proves
 * the SAME routing decision the real backend installs, not a stand-in for
 * it. */
function buildResolver(
  pool: { get(tenantId: number): Database.Database },
  platformDb: () => Database.Database,
): () => Database.Database {
  return () => {
    if (isTenantBypass()) return platformDb();
    try {
      return pool.get(getCurrentTenantId());
    } catch (error) {
      if (error instanceof TenantContextError) return platformDb();
      throw error;
    }
  };
}

describe("checkPlatformSplitStatus", () => {
  let tmpDir: string;

  afterEach(() => {
    closeDatabase();
    setDatabaseResolver(null);
    resetTenantContext();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports splitRequired: true against an unsplit platform file with real shop rows", () => {
    tmpDir = makeTmpDir();
    const db = buildUnsplitPlatformDb(path.join(tmpDir, "liratek.db"));

    const status = checkPlatformSplitStatus(db);

    expect(status.splitRequired).toBe(true);
    expect(status.totalRows).toBeGreaterThan(0);
    const clientsFinding = status.tablesWithShopRows.find(
      (f) => f.table === "clients",
    );
    expect(clientsFinding).toBeDefined();
    expect(clientsFinding!.rows).toBe(2); // tenant 1's client + tenant 5's client
  });

  it("never reports tenant_subscriptions on its own as a reason to refuse", () => {
    // A platform db where EVERY tenant-scoped table except
    // tenant_subscriptions has been cleared to tenant_id IS NULL (simulating
    // "split already ran"), but tenant_subscriptions still legitimately
    // holds real tenant_id rows (§ 12.2 — it never moves to a shop file at
    // all). The guard must NOT treat that as "split not run".
    tmpDir = makeTmpDir();
    const db = buildUnsplitPlatformDb(path.join(tmpDir, "liratek.db"));
    // Null out EVERY tenant-scoped table's tenant_id except
    // tenant_subscriptions itself — discovered the same way the guard
    // discovers them, so this isolates the one table under test instead of
    // hand-listing (and potentially missing) every other seeded table.
    db.pragma("foreign_keys = OFF");
    for (const table of discoverTenantScopedTables(db)) {
      if (table === "tenant_subscriptions") continue;
      db.exec(`UPDATE ${quoteIdent(table)} SET tenant_id = NULL`);
    }

    const status = checkPlatformSplitStatus(db);

    expect(status.tablesWithShopRows.map((f) => f.table)).not.toContain(
      "tenant_subscriptions",
    );
    expect(status.splitRequired).toBe(false);
  });

  it("reports splitRequired: false against a genuinely fresh (never-migrated) file", () => {
    tmpDir = makeTmpDir();
    const db = new Database(path.join(tmpDir, "fresh.db"));

    const status = checkPlatformSplitStatus(db);
    db.close(); // never registered via initDatabase(), so afterEach's
    // closeDatabase() (module-level) would not close this handle — close it
    // explicitly so rmSync doesn't hit a Windows file lock.

    expect(status.splitRequired).toBe(false);
    expect(status.tablesWithShopRows).toEqual([]);
  });

  describe("end-to-end: the boot decision this guards", () => {
    it("unsplit ⇒ refusal: resolver is NOT installed, and shop data is still served from the single file", () => {
      tmpDir = makeTmpDir();
      const platformDb = buildUnsplitPlatformDb(path.join(tmpDir, "liratek.db"));

      // The exact decision `connection.ts`'s per-tenant branch makes: check,
      // then only install on a clean result.
      const status = checkPlatformSplitStatus(platformDb);
      let installed = false;
      if (!status.splitRequired) {
        installed = true;
        setDatabaseResolver(() => platformDb); // would never run in this test
      } else {
        setDatabaseResolver(null); // explicit no-op, same as shared mode
      }

      expect(status.splitRequired).toBe(true);
      expect(installed).toBe(false);

      // "Behaves exactly like shared mode": getDatabase() falls through to
      // the single db `initDatabase()` set up, not a per-tenant resolver.
      expect(getDatabase()).toBe(platformDb);

      // "Shop data still served": the shared file still answers a
      // tenant-scoped query directly — nothing was torn down or reset.
      const tenant5Clients = platformDb
        .prepare(`SELECT full_name FROM clients WHERE tenant_id = 5`)
        .all() as { full_name: string }[];
      expect(tenant5Clients).toEqual([{ full_name: "Tenant5 Client" }]);
    });

    it("split ⇒ per-tenant active: a request scoped to tenant 5 is served from tenant 5's OWN file", () => {
      tmpDir = makeTmpDir();
      const sourceDbPath = path.join(tmpDir, "source.db");
      const outputDir = path.join(tmpDir, "split-out");
      const sourceDb = buildUnsplitPlatformDb(sourceDbPath);
      sourceDb.close();

      // Real split tool (`tenantSplit.ts`), not a hand-rolled stand-in —
      // produces an actual platform.db + tenants/<id>.db pair.
      const report = splitTenantDatabase({ sourceDbPath, outputDir, write: true });
      expect(report.ok).toBe(true);

      const platformDb = new Database(report.platformFile);
      initDatabase(platformDb);

      const status = checkPlatformSplitStatus(platformDb);
      expect(status.splitRequired).toBe(false);

      const pool = new TenantDatabasePool({
        dir: path.join(outputDir, "tenants"),
        openDatabase: (fp) => new Database(fp),
        migrate: (db) => runMigrations(db),
      });

      setDatabaseResolver(buildResolver(pool, () => platformDb));

      const tenant5Clients = runWithTenant(5, () => {
        const db = getDatabase();
        return db.prepare(`SELECT full_name FROM clients`).all() as {
          full_name: string;
        }[];
      });

      // Tenant 5's OWN file — not the platform file, which the split
      // stripped down to tenant_id IS NULL rows only.
      expect(tenant5Clients).toEqual([{ full_name: "Tenant5 Client" }]);

      // And the platform file itself no longer answers this as a shop
      // query at all — proving routing actually moved, not just that a
      // second file happens to also have the row.
      const platformClients = platformDb
        .prepare(`SELECT full_name FROM clients WHERE tenant_id = 5`)
        .all();
      expect(platformClients).toEqual([]);

      // `platformDb` is closed by `afterEach`'s `closeDatabase()` — it was
      // registered via `initDatabase()` above, and closing it twice here
      // would throw.
      pool.closeAll();
    });
  });
});
