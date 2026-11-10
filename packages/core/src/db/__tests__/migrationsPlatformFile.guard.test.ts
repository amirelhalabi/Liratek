/**
 * GUARD: a new migration must not write shop rows into the PLATFORM file.
 *
 * Since the 2026-11-10 per-tenant split, the web backend runs EVERY pending
 * migration on the platform file `/data/liratek.db` at boot. That file keeps
 * the full `tenants` and `tenant_subscriptions` tables but no shop data.
 * Right after, `checkPlatformSplitStatus()` (platformSplitGuard.ts) refuses
 * per-tenant mode if any tenant-scoped table holds a non-NULL `tenant_id`
 * row. A migration that seeds per shop from `SELECT id FROM tenants` (the
 * v191 pattern) would therefore put shop rows into the platform file, the
 * guard would refuse per-tenant routing, every shop request would hit the
 * platform file, and no shop could log in.
 *
 * How this test models production:
 *  1. Build the platform file the way the backend does (create_db.sql +
 *     runMigrations), then `rollbackTo(BASELINE)` so any migration newer than
 *     the baseline is genuinely un-applied. (create_db.sql also lists new
 *     versions as applied — rule 10 — so "run whatever is pending" would skip
 *     exactly the migration this guard exists to check.)
 *  2. Simulate the split: delete every non-NULL `tenant_id` row the same way
 *     the guard counts them, and make sure tenants 1 and 5 plus their
 *     subscriptions exist, as on the real platform file.
 *  3. Assert the baseline is clean, then apply each migration newer than the
 *     baseline one at a time, and attribute any shop row to the version that
 *     wrote it, using `checkPlatformSplitStatus()` itself (rule 14: the same
 *     decision boot makes, including the `tenant_subscriptions` exemption).
 *
 * The second test case runs a throwaway per-tenant seeding migration through
 * the same detection — the proof that this guard can fail (rule 17).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../connection";
import {
  MIGRATIONS,
  runMigrations,
  rollbackTo,
  type Migration,
} from "../migrations/index";
import { checkPlatformSplitStatus } from "../platformSplitGuard";
import { discoverTenantScopedTables, quoteIdent } from "../tenantSplit";

/**
 * Migrations up to and including this version ran before the 2026-11-10
 * split; the platform file is already past them, so they never run on it
 * again (some of them, like v191, seed per tenant — that was fine then).
 * Every migration NEWER than this runs on the platform file at the next
 * deploy and is checked here. Do not raise this number to silence a failure.
 */
const PLATFORM_SPLIT_BASELINE_VERSION = 230;

/** The tenant ids the real platform file holds. */
const PLATFORM_TENANT_IDS = [1, 5] as const;

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

interface PlatformShopRowWriter {
  version: number;
  name: string;
  table: string;
  rows: number;
}

function shopRowCounts(db: Database.Database): Map<string, number> {
  return new Map(
    checkPlatformSplitStatus(db).tablesWithShopRows.map((t) => [
      t.table,
      t.rows,
    ]),
  );
}

/** Builds a platform-shaped database at the baseline version. */
function buildPlatformDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  rollbackTo(db, PLATFORM_SPLIT_BASELINE_VERSION);

  db.pragma("foreign_keys = OFF");
  // Simulate the split: no shop rows left, except where the guard itself
  // expects them (tenant_subscriptions stays whole on the platform file).
  const kept = new Set(["tenant_subscriptions"]);
  for (const table of discoverTenantScopedTables(db)) {
    if (kept.has(table)) continue;
    db.prepare(
      `DELETE FROM ${quoteIdent(table)} WHERE tenant_id IS NOT NULL`,
    ).run();
  }
  for (const id of PLATFORM_TENANT_IDS) {
    db.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
    ).run(id, `Shop ${id}`, `shop-${id}`);
    const hasSub = db
      .prepare(`SELECT 1 FROM tenant_subscriptions WHERE tenant_id = ?`)
      .get(id);
    if (!hasSub) {
      db.prepare(`INSERT INTO tenant_subscriptions (tenant_id) VALUES (?)`).run(
        id,
      );
    }
  }
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Applies each migration the way `runMigrations` does (FK off, one
 * transaction per migration, then the schema_migrations row) and reports
 * every tenant-scoped table that gained shop rows during that migration.
 */
function findPlatformShopRowWriters(
  db: Database.Database,
  migrations: readonly Migration[],
): PlatformShopRowWriter[] {
  const writers: PlatformShopRowWriter[] = [];
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  db.pragma("foreign_keys = OFF");
  try {
    for (const migration of ordered) {
      const before = shopRowCounts(db);
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        ).run(migration.version, migration.name);
      })();
      for (const [table, rows] of shopRowCounts(db)) {
        const added = rows - (before.get(table) ?? 0);
        if (added > 0) {
          writers.push({
            version: migration.version,
            name: migration.name,
            table,
            rows: added,
          });
        }
      }
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return writers;
}

function explain(w: PlatformShopRowWriter): string {
  return (
    `Migration v${w.version} (${w.name}) wrote ${w.rows} shop row(s) into ` +
    `"${w.table}" on the platform file. On web this makes ` +
    `checkPlatformSplitStatus() refuse per-tenant mode and no shop can log ` +
    `in. Take shop ids from a shop table (e.g. SELECT DISTINCT tenant_id ` +
    `FROM users), never from \`SELECT id FROM tenants\`, or skip the seed ` +
    `when the database holds no shop data.`
  );
}

describe("migrations on the platform file (per-tenant web mode)", () => {
  it("the latest migration is at or above the baseline", () => {
    const latest = MIGRATIONS[MIGRATIONS.length - 1].version;
    expect(latest).toBeGreaterThanOrEqual(PLATFORM_SPLIT_BASELINE_VERSION);
  });

  it("the simulated platform file starts clean, with tenants 1 and 5", () => {
    const db = buildPlatformDb();
    try {
      expect(checkPlatformSplitStatus(db).splitRequired).toBe(false);
      const tenantIds = (
        db.prepare(`SELECT id FROM tenants ORDER BY id`).all() as {
          id: number;
        }[]
      ).map((r) => r.id);
      expect(tenantIds).toEqual(expect.arrayContaining([1, 5]));
    } finally {
      db.close();
    }
  });

  it("no migration newer than the baseline writes shop rows", () => {
    const db = buildPlatformDb();
    try {
      const newer = MIGRATIONS.filter(
        (m) => m.version > PLATFORM_SPLIT_BASELINE_VERSION,
      );
      const messages = findPlatformShopRowWriters(db, newer).map(explain);
      expect(messages).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("flags a migration that seeds per shop from SELECT id FROM tenants", () => {
    const db = buildPlatformDb();
    try {
      const seedsPerTenant: Migration = {
        version: 99999,
        name: "guard_fixture_seed_per_tenant",
        description: "Throwaway fixture: the v191 pattern.",
        type: "typescript",
        up(d) {
          const tenants = d.prepare(`SELECT id FROM tenants`).all() as {
            id: number;
          }[];
          const insert = d.prepare(
            `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (?, 'guard_fixture_key', '1')`,
          );
          for (const t of tenants) insert.run(t.id);
        },
      };
      const writers = findPlatformShopRowWriters(db, [seedsPerTenant]);
      expect(writers).toEqual([
        {
          version: 99999,
          name: "guard_fixture_seed_per_tenant",
          table: "system_settings",
          rows: 2,
        },
      ]);
      expect(explain(writers[0])).toContain("v99999");
    } finally {
      db.close();
    }
  });

  it("does not flag a migration that takes shop ids from a shop table", () => {
    const db = buildPlatformDb();
    try {
      const seedsFromShopTable: Migration = {
        version: 99998,
        name: "guard_fixture_seed_from_shop_table",
        description: "Throwaway fixture: the v229/v230-safe pattern.",
        type: "typescript",
        up(d) {
          d.exec(
            `INSERT INTO system_settings (tenant_id, key_name, value)
             SELECT DISTINCT tenant_id, 'guard_fixture_key', '1'
               FROM users WHERE tenant_id IS NOT NULL`,
          );
        },
      };
      expect(findPlatformShopRowWriters(db, [seedsFromShopTable])).toEqual([]);
    } finally {
      db.close();
    }
  });
});
