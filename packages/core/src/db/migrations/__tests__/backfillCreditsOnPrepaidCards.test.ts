/**
 * Migration v143 — backfill_credits_on_prepaid_cards.
 *
 * Covers TELECOM_DAYS_COST_PLAN.md §6 step 3: existing installs never
 * re-run the frontend catalog seed (parseCatalogToSeedData only runs when
 * mobile_service_items is EMPTY), so the 2026-08-03 `credits` addition to
 * the alfa + mtc Prepaid catalog blocks never reaches them on its own. This
 * migration backfills `credits = CAST(label AS REAL)` for those rows.
 *
 * The load-bearing guard (rule 17 — must be proven, not assumed): 'start',
 * 'startSOS', 'smart', 'super' sit in the exact same
 * provider/category/subcategory bucket as the numeric face-value cards, and
 * SQLite's `CAST('start' AS REAL)` silently returns `0.0` with NO error —
 * the naive `CAST(label AS REAL)` alone (no GLOB guard) would give those
 * named plans a bogus `credits = 0`. The "pre-fix" reintroduction below
 * proves that failure mode actually fires before proving the shipped
 * migration avoids it.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

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
  return db;
}

function insertItem(
  db: Database.Database,
  row: {
    provider: string;
    category: string;
    subcategory: string;
    label: string;
    cost_lbp?: number;
    credits?: number | null;
  },
) {
  db.prepare(
    `INSERT INTO mobile_service_items (provider, category, subcategory, label, cost_lbp, credits)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.provider,
    row.category,
    row.subcategory,
    row.label,
    row.cost_lbp ?? 100000,
    row.credits ?? null,
  );
}

function creditsOf(db: Database.Database, label: string): number | null {
  const row = db
    .prepare(`SELECT credits FROM mobile_service_items WHERE label = ?`)
    .get(label) as { credits: number | null };
  return row.credits;
}

describe("Migration v143 — backfill_credits_on_prepaid_cards", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("sets credits = numeric label for a NULL alfa Prepaid card (iPick)", () => {
    insertItem(db, {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7728000,
    });

    getMigration(143).up(db);

    expect(creditsOf(db, "77.28")).toBe(77.28);
  });

  it("sets credits = numeric label for a NULL mtc Prepaid card (Katsh)", () => {
    insertItem(db, {
      provider: "Katsh",
      category: "mtc",
      subcategory: "Prepaid",
      label: "3.79",
      cost_lbp: 398723,
    });

    getMigration(143).up(db);

    expect(creditsOf(db, "3.79")).toBe(3.79);
  });

  it("REGRESSION GUARD: does not corrupt non-numeric mtc Prepaid labels ('start'/'startSOS'/'smart'/'super') with a bogus 0", () => {
    for (const label of ["start", "startSOS", "smart", "super"]) {
      insertItem(db, {
        provider: "WHISH_APP",
        category: "mtc",
        subcategory: "Prepaid",
        label,
      });
    }

    getMigration(143).up(db);

    for (const label of ["start", "startSOS", "smart", "super"]) {
      expect(creditsOf(db, label)).toBeNull();
    }
  });

  it("PROVES the guard is load-bearing: a naive CAST(label AS REAL) with no GLOB guard DOES corrupt 'start' to 0 (pre-fix reproduction, rule 17)", () => {
    insertItem(db, {
      provider: "WHISH_APP",
      category: "mtc",
      subcategory: "Prepaid",
      label: "start",
    });

    // The buggy version of this migration's UPDATE — identical WHERE clause,
    // minus the two GLOB numeric-guard lines. Reintroduced here only to
    // prove the failure mode fires; NOT the shipped migration.
    db.prepare(
      `UPDATE mobile_service_items
       SET credits = CAST(label AS REAL)
       WHERE provider IN ('iPick', 'Katsh', 'WHISH_APP')
         AND category IN ('alfa', 'mtc')
         AND subcategory = 'Prepaid'
         AND credits IS NULL`,
    ).run();

    // SQLite really does silently coerce 'start' to 0.0 — this is the exact
    // corruption the shipped migration's GLOB guard exists to prevent.
    expect(creditsOf(db, "start")).toBe(0);
  });

  it("does not clobber a card whose credits are already set ('1'/'1.67', predate this migration)", () => {
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

    getMigration(143).up(db);

    expect(creditsOf(db, "1")).toBe(1);
    expect(creditsOf(db, "1.67")).toBe(1.67);
  });

  it("does not touch rows outside provider/category/subcategory scope", () => {
    insertItem(db, {
      provider: "iPick",
      category: "mtc",
      subcategory: "Credits",
      label: "3", // "3$" category — out of scope per plan §1.3
    });
    insertItem(db, {
      provider: "iPick",
      category: "internet",
      subcategory: "Terranet",
      label: "10", // numeric label, but wrong category entirely
    });

    getMigration(143).up(db);

    const rows = db
      .prepare(`SELECT label, credits FROM mobile_service_items`)
      .all() as { label: string; credits: number | null }[];
    for (const row of rows) {
      expect(row.credits).toBeNull();
    }
  });

  it("is idempotent — running twice does not throw and does not change already-set values", () => {
    insertItem(db, {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7728000,
    });

    getMigration(143).up(db);
    expect(() => getMigration(143).up(db)).not.toThrow();
    expect(creditsOf(db, "77.28")).toBe(77.28);
  });

  it("down() nulls out the backfilled rows but preserves '1'/'1.67'", () => {
    insertItem(db, {
      provider: "iPick",
      category: "mtc",
      subcategory: "Prepaid",
      label: "1",
      credits: 1,
    });
    insertItem(db, {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7728000,
    });

    getMigration(143).up(db);
    expect(creditsOf(db, "77.28")).toBe(77.28);

    getMigration(143).down(db);

    expect(creditsOf(db, "77.28")).toBeNull();
    expect(creditsOf(db, "1")).toBe(1); // never touched, must survive rollback
  });

  it("up() -> down() -> up() round-trips cleanly", () => {
    insertItem(db, {
      provider: "Katsh",
      category: "alfa",
      subcategory: "Prepaid",
      label: "77.28",
      cost_lbp: 7620030,
    });

    getMigration(143).up(db);
    getMigration(143).down(db);
    expect(() => getMigration(143).up(db)).not.toThrow();
    expect(creditsOf(db, "77.28")).toBe(77.28);
  });
});
