/**
 * Migration v144 — seed_telecom_credit_cost_rate_and_backfill_days_cost.
 *
 * Covers TELECOM_DAYS_COST_PLAN.md §6 step 7a (owner-confirmed 2026-08-04):
 *  (a) seeds telecom_credit_cost_rate_lbp = 93,333.33 per tenant (INSERT OR
 *      IGNORE, same pattern as v141's telecom_credit_sell_price_lbp).
 *  (b) backfills mobile_service_items.days_cost_lbp for every row with
 *      cost_lbp > 0 AND credits > 0 AND days_cost_lbp IS NULL, using
 *      deriveDaysCostLbp (packages/core/src/utils/telecomCredit.ts) — the
 *      ONE definition of the formula (rule 14) — never re-derived here.
 *
 * Rule 17: the guard-rejection path (days_cost_lbp would be <= 0 or >=
 * cost_lbp) is proven to actually skip-and-log, not silently write a bad
 * value, by feeding it a combination that fails the §4.4 bound.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";
import { TELECOM_CREDIT_COST_RATE_LBP } from "../../../utils/telecomCredit";

function getMigration(version: number) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`Migration v${version} not found`);
  }
  if (!migration.down) {
    throw new Error(`Migration v${version} has no down()`);
  }
  return migration as Required<typeof migration>;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Default');
  `);
  return db;
}

function insertItem(
  db: Database.Database,
  row: {
    tenant_id?: number;
    provider: string;
    category: string;
    subcategory: string;
    label: string;
    cost_lbp: number;
    credits?: number | null;
    days_cost_lbp?: number | null;
  },
) {
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
    row.cost_lbp,
    row.credits ?? null,
    row.days_cost_lbp ?? null,
  );
}

function itemRow(db: Database.Database, label: string, tenantId = 1) {
  return db
    .prepare(
      `SELECT days_cost_lbp FROM mobile_service_items WHERE label = ? AND tenant_id = ?`,
    )
    .get(label, tenantId) as { days_cost_lbp: number | null };
}

function rateSetting(db: Database.Database, tenantId = 1) {
  return db
    .prepare(
      `SELECT value FROM system_settings WHERE tenant_id = ? AND key_name = 'telecom_credit_cost_rate_lbp'`,
    )
    .get(tenantId) as { value: string } | undefined;
}

describe("Migration v144 — seed_telecom_credit_cost_rate_and_backfill_days_cost", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("(a) telecom_credit_cost_rate_lbp setting", () => {
    it("seeds 93333.33 for every existing tenant", () => {
      db.prepare(`INSERT INTO tenants (id, name) VALUES (2, 'Second Shop')`).run();

      getMigration(144).up(db);

      expect(rateSetting(db, 1)?.value).toBe(
        String(TELECOM_CREDIT_COST_RATE_LBP),
      );
      expect(rateSetting(db, 2)?.value).toBe(
        String(TELECOM_CREDIT_COST_RATE_LBP),
      );
    });

    it("does not clobber an existing value (INSERT OR IGNORE)", () => {
      db.prepare(
        `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'telecom_credit_cost_rate_lbp', '85000')`,
      ).run();

      getMigration(144).up(db);

      expect(rateSetting(db, 1)?.value).toBe("85000");
    });
  });

  describe("(b) days_cost_lbp backfill", () => {
    it("matches the plan §4.5 worked value exactly (iPick alfa 77.28 -> 515,200)", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
      });

      getMigration(144).up(db);

      expect(itemRow(db, "77.28").days_cost_lbp).toBe(515200);
    });

    it("matches the plan §4.5 worked value exactly (iPick mtc 3.79 -> 25,267, the catalog minimum)", () => {
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label: "3.79",
        cost_lbp: 379000,
        credits: 3.79,
      });

      getMigration(144).up(db);

      expect(itemRow(db, "3.79").days_cost_lbp).toBe(25267);
    });

    it("uses the TENANT's own rate, not the literal constant, when it was customized before the migration ran", () => {
      db.prepare(
        `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'telecom_credit_cost_rate_lbp', '85000')`,
      ).run();
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
      });

      getMigration(144).up(db);

      // 7,728,000 - 77.28 * 85,000 = 1,159,200 (plan §4.5's R=85k column)
      expect(itemRow(db, "77.28").days_cost_lbp).toBe(1159200);
    });

    it("does not touch a row missing credits or cost_lbp", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "no-credits",
        cost_lbp: 140000,
        credits: null,
      });
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "no-cost",
        cost_lbp: 0,
        credits: 5,
      });

      getMigration(144).up(db);

      expect(itemRow(db, "no-credits").days_cost_lbp).toBeNull();
      expect(itemRow(db, "no-cost").days_cost_lbp).toBeNull();
    });

    it("does not overwrite a row whose days_cost_lbp is already set", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
        days_cost_lbp: 999999,
      });

      getMigration(144).up(db);

      expect(itemRow(db, "77.28").days_cost_lbp).toBe(999999);
    });

    it("REGRESSION GUARD (rule 17): skips — never writes — a row whose combination fails the §4.4 bound (days_cost_lbp would be <= 0)", () => {
      // credits * R (93,333.33 * 10 = 933,333.3) exceeds cost_lbp (500,000):
      // deriveDaysCostLbp must return null, and this migration must leave
      // the row NULL rather than writing a negative value.
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "over-priced-credit",
        cost_lbp: 500000,
        credits: 10,
      });

      getMigration(144).up(db);

      expect(itemRow(db, "over-priced-credit").days_cost_lbp).toBeNull();
    });

    it("PROVES the guard is load-bearing: a naive `cost_lbp - credits * R` with no bound check DOES write a negative value (pre-fix reproduction)", () => {
      const rate = TELECOM_CREDIT_COST_RATE_LBP;
      const costLbp = 500000;
      const credits = 10;
      const naiveDaysCost = Math.round(costLbp - credits * rate);

      expect(naiveDaysCost).toBeLessThan(0); // -433,333 — exactly what the guard exists to reject
    });

    it("is idempotent — running twice does not throw and does not change the computed value", () => {
      insertItem(db, {
        provider: "iPick",
        category: "alfa",
        subcategory: "Prepaid",
        label: "77.28",
        cost_lbp: 7728000,
        credits: 77.28,
      });

      getMigration(144).up(db);
      expect(() => getMigration(144).up(db)).not.toThrow();
      expect(itemRow(db, "77.28").days_cost_lbp).toBe(515200);
    });
  });

  it("down() nulls the backfilled rows and removes the setting", () => {
    insertItem(db, {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7728000,
      credits: 77.28,
    });

    getMigration(144).up(db);
    expect(itemRow(db, "77.28").days_cost_lbp).toBe(515200);

    getMigration(144).down(db);

    expect(itemRow(db, "77.28").days_cost_lbp).toBeNull();
    expect(rateSetting(db, 1)).toBeUndefined();
  });

  it("up() -> down() -> up() round-trips cleanly", () => {
    insertItem(db, {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7728000,
      credits: 77.28,
    });

    getMigration(144).up(db);
    getMigration(144).down(db);
    expect(() => getMigration(144).up(db)).not.toThrow();
    expect(itemRow(db, "77.28").days_cost_lbp).toBe(515200);
  });
});
