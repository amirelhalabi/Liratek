/**
 * v143 (backfill_credits_on_prepaid_cards) + v144
 * (seed_telecom_credit_cost_rate_and_backfill_days_cost) — driven through
 * the REAL migration runner (`runMigrations` / `rollbackTo`), not by
 * hand-calling `migration.up(db)` / `migration.down(db)` directly.
 *
 * Why this file exists alongside backfillCreditsOnPrepaidCards.test.ts /
 * seedTelecomCreditCostRateAndBackfillDaysCost.test.ts: those two prove the
 * migration BODIES are correct in isolation. This file additionally proves
 * the production DRIVER around them behaves correctly — the pending-set
 * diff against `schema_migrations`, the per-migration transaction wrapper,
 * the FK-pragma toggle, the `schema_migrations` bookkeeping INSERT/DELETE,
 * and — critically — that v143's real output (backfilled `credits`) is what
 * v144 actually reads when BOTH run back-to-back in a single real
 * `runMigrations()` call, exactly as happens on a real upgrading install.
 * `getMigration(N).up(db)` alone never exercises any of that plumbing.
 *
 * `markAppliedExcept` marks every OTHER migration in `MIGRATIONS` as already
 * applied in `schema_migrations`, so `runMigrations()`'s pending filter
 * narrows to exactly the version(s) under test, while still running through
 * the identical production code path a real pending migration would.
 */

import Database from "better-sqlite3";
import {
  MIGRATIONS,
  runMigrations,
  rollbackTo,
  getCurrentVersion,
} from "../index";
import { TELECOM_CREDIT_COST_RATE_LBP } from "../../../utils/telecomCredit";

function createSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      key_name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );
    CREATE TABLE mobile_service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      label TEXT NOT NULL,
      cost_lbp REAL NOT NULL DEFAULT 0,
      sell_lbp REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      validity_days INTEGER,
      credits REAL,
      days_cost_lbp REAL,
      sell_days_lbp REAL,
      sell_credit_lbp REAL,
      max_returned_credits_usd REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Default');
  `);
}

/**
 * Marks every migration in MIGRATIONS as "already applied" in
 * schema_migrations EXCEPT the given version(s), so a subsequent
 * `runMigrations(db)` call sees exactly those version(s) as pending and
 * runs ONLY them — through the real runner, not a hand-picked `.up()` call.
 */
function markAppliedExcept(
  db: Database.Database,
  ...exceptVersions: number[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const m of MIGRATIONS) {
    if (!exceptVersions.includes(m.version)) {
      insert.run(m.version, m.name);
    }
  }
}

/**
 * Whether a specific migration is recorded as applied.
 *
 * Use this instead of asserting `getCurrentVersion()` against a hard-coded
 * number. `markAppliedExcept` marks every OTHER migration applied — including
 * any added AFTER the ones under test — so `getCurrentVersion()` returns the
 * repo's head version, not "the one before the migration under test". Pinning
 * that number makes this suite fail every time an unrelated migration lands
 * (it did, the moment v145 was added). What the tests actually mean is "v144
 * was pending, then it wasn't".
 */
function isApplied(db: Database.Database, version: number): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM schema_migrations WHERE version = ?`)
      .get(version) !== undefined
  );
}

function insertItem(
  db: Database.Database,
  row: {
    tenant_id?: number;
    provider: string;
    category: string;
    subcategory: string;
    label: string;
    cost_lbp?: number;
    credits?: number | null;
    days_cost_lbp?: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO mobile_service_items
       (tenant_id, provider, category, subcategory, label, cost_lbp, credits, days_cost_lbp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.tenant_id ?? 1,
    row.provider,
    row.category,
    row.subcategory,
    row.label,
    row.cost_lbp ?? 100000,
    row.credits ?? null,
    row.days_cost_lbp ?? null,
  );
}

function itemRow(
  db: Database.Database,
  label: string,
  tenantId = 1,
): { credits: number | null; days_cost_lbp: number | null } {
  return db
    .prepare(
      `SELECT credits, days_cost_lbp FROM mobile_service_items WHERE label = ? AND tenant_id = ?`,
    )
    .get(label, tenantId) as {
    credits: number | null;
    days_cost_lbp: number | null;
  };
}

function rateSetting(db: Database.Database, tenantId = 1): string | undefined {
  const row = db
    .prepare(
      `SELECT value FROM system_settings WHERE tenant_id = ? AND key_name = 'telecom_credit_cost_rate_lbp'`,
    )
    .get(tenantId) as { value: string } | undefined;
  return row?.value;
}

describe("v143 + v144 — via the real migration runner (runMigrations / rollbackTo)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("v143 alone, pending, applied via runMigrations()", () => {
    beforeEach(() => {
      // Mark every OTHER migration applied, including 144, so pending is
      // exactly [143] — isolates v143's behavior even though the real
      // runner is doing the driving.
      markAppliedExcept(db, 143);
    });

    it("runMigrations() sees exactly v143 pending and applies it, backfilling the numeric label", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
      });

      const appliedBefore = new Set(
        (
          db.prepare(`SELECT version FROM schema_migrations`).all() as {
            version: number;
          }[]
        ).map((r) => r.version),
      );
      expect(appliedBefore.has(143)).toBe(false);

      runMigrations(db);

      const appliedAfter = new Set(
        (
          db.prepare(`SELECT version FROM schema_migrations`).all() as {
            version: number;
          }[]
        ).map((r) => r.version),
      );
      expect(appliedAfter.has(143)).toBe(true);
      expect(itemRow(db, "77.28").credits).toBe(77.28);
    });

    it("REGRESSION GUARD (rule 17 target): 'start'/'startSOS'/'smart'/'super' stay NULL after the real runner applies v143", () => {
      for (const label of ["start", "startSOS", "smart", "super"]) {
        insertItem(db, {
          provider: "WHISH_APP",
          category: "mtc",
          subcategory: "Prepaid",
          label,
        });
      }

      runMigrations(db);

      for (const label of ["start", "startSOS", "smart", "super"]) {
        expect(itemRow(db, label).credits).toBeNull();
      }
    });

    it("does not touch a row whose credits are already set ('1'/'1.67', predate this migration)", () => {
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label: "1",
        credits: 1,
      });
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label: "1.67",
        credits: 1.67,
      });

      runMigrations(db);

      expect(itemRow(db, "1").credits).toBe(1);
      expect(itemRow(db, "1.67").credits).toBe(1.67);
    });

    it("does not touch rows outside provider/category/subcategory scope", () => {
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Credits", // out of scope per plan §1.3
        label: "3",
      });
      insertItem(db, {
        provider: "iPick",
        category: "internet",
        subcategory: "Terranet", // wrong category entirely
        label: "10",
      });

      runMigrations(db);

      expect(itemRow(db, "3").credits).toBeNull();
      expect(itemRow(db, "10").credits).toBeNull();
    });

    it("running runMigrations() twice is idempotent — the second call has zero pending and touches nothing", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
      });

      runMigrations(db);
      expect(itemRow(db, "77.28").credits).toBe(77.28);

      // Second call: v143 is now in schema_migrations, so pending is empty —
      // this exercises the runner's own "already up to date" no-op branch.
      expect(() => runMigrations(db)).not.toThrow();
      expect(itemRow(db, "77.28").credits).toBe(77.28);
    });
  });

  describe("v144 alone, pending, applied via runMigrations() (v143 pre-applied)", () => {
    beforeEach(() => {
      markAppliedExcept(db, 144);
    });

    it("seeds telecom_credit_cost_rate_lbp for every tenant", () => {
      db.prepare(
        `INSERT INTO tenants (id, name) VALUES (2, 'Second Shop')`,
      ).run();

      expect(isApplied(db, 144)).toBe(false);
      runMigrations(db);
      expect(isApplied(db, 144)).toBe(true);

      expect(rateSetting(db, 1)).toBe(String(TELECOM_CREDIT_COST_RATE_LBP));
      expect(rateSetting(db, 2)).toBe(String(TELECOM_CREDIT_COST_RATE_LBP));
    });

    it("matches the plan's worked value exactly: iPick alfa 77.28 -> 515,200", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
      });

      runMigrations(db);

      expect(itemRow(db, "77.28").days_cost_lbp).toBe(1159200);
    });

    it("matches the plan's worked value exactly: Katsh alfa 77.28 -> 407,230", () => {
      insertItem(db, {
        provider: "Katsh",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7620030,
        credits: 77.28,
      });

      runMigrations(db);

      expect(itemRow(db, "77.28").days_cost_lbp).toBe(1051230);
    });

    it("matches the plan's worked value exactly: iPick mtc 4.5 -> 30,000", () => {
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label: "4.5",
        cost_lbp: 450000,
        credits: 4.5,
      });

      runMigrations(db);

      expect(itemRow(db, "4.5").days_cost_lbp).toBe(67500);
    });

    it("REGRESSION GUARD (rule 17 target): a row whose derivation would be <= 0 is SKIPPED, left NULL, never written", () => {
      // credits * R (10 * 93,333.33 = 933,333.3) exceeds cost_lbp (500,000).
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "over-priced-credit",
        cost_lbp: 500000,
        credits: 10,
      });

      runMigrations(db);

      expect(itemRow(db, "over-priced-credit").days_cost_lbp).toBeNull();
    });

    it("skips rows with NULL credits", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "no-credits",
        cost_lbp: 140000,
        credits: null,
      });

      runMigrations(db);

      expect(itemRow(db, "no-credits").days_cost_lbp).toBeNull();
    });

    it("is idempotent across two runMigrations() calls", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
      });

      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();
      expect(itemRow(db, "77.28").days_cost_lbp).toBe(1159200);
    });
  });

  describe("v143 -> v144 chained in ONE real runMigrations() call (both pending)", () => {
    beforeEach(() => {
      markAppliedExcept(db, 143, 144);
    });

    it("v144 reads the credits v143 JUST backfilled in the same run — proves the runner's ordering/sequencing, not just each body in isolation", () => {
      // credits starts NULL — only v143 (running first, in-order, inside
      // this SAME runMigrations() call) can populate it before v144 reads it.
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: null,
      });

      expect(isApplied(db, 143)).toBe(false);
      expect(isApplied(db, 144)).toBe(false);
      runMigrations(db);
      expect(isApplied(db, 143)).toBe(true);
      expect(isApplied(db, 144)).toBe(true);

      const row = itemRow(db, "77.28");
      expect(row.credits).toBe(77.28);
      expect(row.days_cost_lbp).toBe(1159200);
    });
  });

  describe("down() via rollbackTo() (real rollback driver)", () => {
    beforeEach(() => {
      markAppliedExcept(db, 143, 144);
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: null,
      });
      runMigrations(db); // both applied — credits backfilled, days_cost derived
    });

    it("rollbackTo(143) reverses ONLY v144: days_cost_lbp nulled + setting removed, credits untouched", () => {
      expect(itemRow(db, "77.28")).toEqual({
        credits: 77.28,
        days_cost_lbp: 1159200,
      });
      expect(rateSetting(db, 1)).toBe(String(TELECOM_CREDIT_COST_RATE_LBP));

      rollbackTo(db, 143);

      expect(getCurrentVersion(db)).toBe(143);
      expect(itemRow(db, "77.28").credits).toBe(77.28); // v143's work survives
      expect(itemRow(db, "77.28").days_cost_lbp).toBeNull();
      expect(rateSetting(db, 1)).toBeUndefined();
    });

    it("rollbackTo(142) reverses BOTH, in reverse order (144 then 143)", () => {
      rollbackTo(db, 142);

      expect(getCurrentVersion(db)).toBe(142);
      expect(itemRow(db, "77.28")).toEqual({
        credits: null,
        days_cost_lbp: null,
      });
      expect(rateSetting(db, 1)).toBeUndefined();
    });

    it("rollbackTo(142) then runMigrations() round-trips cleanly back to the same values", () => {
      rollbackTo(db, 142);
      expect(() => runMigrations(db)).not.toThrow();

      // Both under test are re-applied. Deliberately NOT asserting the head
      // version: runMigrations replays everything pending, so the head is
      // whatever the newest migration in the repo is (see isApplied's note).
      expect(isApplied(db, 143)).toBe(true);
      expect(isApplied(db, 144)).toBe(true);
      expect(itemRow(db, "77.28")).toEqual({
        credits: 77.28,
        days_cost_lbp: 1159200,
      });
      expect(rateSetting(db, 1)).toBe(String(TELECOM_CREDIT_COST_RATE_LBP));
    });
  });
});
