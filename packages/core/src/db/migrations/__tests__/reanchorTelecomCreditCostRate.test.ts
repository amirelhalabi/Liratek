/**
 * Migration v146 — re-anchor the telecom credit cost rate to 85,000 LBP/$.
 *
 * The load-bearing behaviour here is NOT the arithmetic (that is
 * `deriveDaysCostLbp`, already covered). It is the **override preservation**:
 * v146 must recompute only those rows whose stored `days_cost_lbp` is still
 * exactly what the OLD rate's formula produced, and leave anything else alone.
 *
 * Get that wrong in either direction and it is silent:
 *   - too greedy → an operator's hand-entered days cost is overwritten and
 *     they never find out
 *   - too shy    → the shipped catalog keeps 93,333-era values while the rate
 *     setting says 85,000, so the Settings decision aid and the split gate
 *     disagree with the configured rate forever
 *
 * That is why this migration recomputes from `cost_lbp`/`credits` rather than
 * scaling the stored number: scaling would carry an override forward to a new
 * wrong value while looking like it worked.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";
import { TELECOM_CREDIT_COST_RATE_LBP } from "../../../utils/telecomCredit.js";

const V146 = MIGRATIONS.find((m) => m.version === 146)!;
const OLD_RATE = 93333.33;

/** Minimal schema — only what v146 touches. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
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
      credits REAL,
      days_cost_lbp REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Default');
  `);
  return db;
}

function setRate(db: Database.Database, value: number, tenantId = 1): void {
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value)
     VALUES (?, 'telecom_credit_cost_rate_lbp', ?)`,
  ).run(tenantId, String(value));
}

function rateOf(db: Database.Database, tenantId = 1): string | undefined {
  return (
    db
      .prepare(
        `SELECT value FROM system_settings
          WHERE tenant_id = ? AND key_name = 'telecom_credit_cost_rate_lbp'`,
      )
      .get(tenantId) as { value: string } | undefined
  )?.value;
}

function addItem(
  db: Database.Database,
  label: string,
  costLbp: number,
  credits: number | null,
  daysCostLbp: number | null,
  tenantId = 1,
): void {
  db.prepare(
    `INSERT INTO mobile_service_items
       (tenant_id, provider, category, subcategory, label, cost_lbp, credits, days_cost_lbp)
     VALUES (?, 'iPick', 'mtc', 'Prepaid', ?, ?, ?, ?)`,
  ).run(tenantId, label, costLbp, credits, daysCostLbp);
}

function daysCostOf(
  db: Database.Database,
  label: string,
  tenantId = 1,
): number | null {
  return (
    (
      db
        .prepare(
          `SELECT days_cost_lbp FROM mobile_service_items
            WHERE label = ? AND tenant_id = ?`,
        )
        .get(label, tenantId) as { days_cost_lbp: number | null } | undefined
    )?.days_cost_lbp ?? null
  );
}

// The 77.28 card, both rates hand-derived:
//   old: 7,728,000 − 77.28 × 93,333.33 =   515,200
//   new: 7,728,000 − 77.28 × 85,000    = 1,159,200
const COST_7728 = 7_728_000;
const CREDITS_7728 = 77.28;
const OLD_7728 = 515_200;
const NEW_7728 = 1_159_200;

describe("migration v146 — reanchor_telecom_credit_cost_rate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  it("moves the rate setting off the old default", () => {
    setRate(db, OLD_RATE);
    V146.up(db);
    expect(Number(rateOf(db))).toBe(TELECOM_CREDIT_COST_RATE_LBP);
  });

  it("leaves a CUSTOMISED rate alone — a tenant who set their own keeps it", () => {
    setRate(db, 88_000);
    V146.up(db);
    expect(Number(rateOf(db))).toBe(88_000);
  });

  it("re-derives a row that still holds the old rate's value", () => {
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, OLD_7728);
    V146.up(db);
    expect(daysCostOf(db, "77.28")).toBe(NEW_7728);
  });

  it("PRESERVES an operator override — the load-bearing case", () => {
    // 900,000 is not what EITHER rate produces, so it can only have been typed
    // by a human. It must survive untouched.
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, 900_000);
    V146.up(db);
    expect(daysCostOf(db, "77.28")).toBe(900_000);
  });

  it("skips rows with no days_cost_lbp yet (v144's job, not this one)", () => {
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, null);
    V146.up(db);
    expect(daysCostOf(db, "77.28")).toBeNull();
  });

  it("skips rows with no credits — the formula has no input", () => {
    setRate(db, OLD_RATE);
    addItem(db, "start", 450_000, null, null);
    V146.up(db);
    expect(daysCostOf(db, "start")).toBeNull();
  });

  it("is idempotent — a second run does not move an already-migrated row", () => {
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, OLD_7728);
    V146.up(db);
    V146.up(db);
    expect(daysCostOf(db, "77.28")).toBe(NEW_7728);
    expect(Number(rateOf(db))).toBe(TELECOM_CREDIT_COST_RATE_LBP);
  });

  it("uses each tenant's OWN rate, not the global constant", () => {
    db.prepare(`INSERT INTO tenants (id, name) VALUES (2, 'Second Shop')`).run();
    setRate(db, OLD_RATE, 1);
    setRate(db, 80_000, 2); // customised — must be respected AND used
    addItem(db, "77.28", COST_7728, CREDITS_7728, OLD_7728, 1);
    addItem(db, "77.28", COST_7728, CREDITS_7728, OLD_7728, 2);

    V146.up(db);

    expect(daysCostOf(db, "77.28", 1)).toBe(NEW_7728);
    // 7,728,000 − 77.28 × 80,000 = 7,728,000 − 6,182,400 = 1,545,600
    expect(daysCostOf(db, "77.28", 2)).toBe(1_545_600);
    expect(Number(rateOf(db, 2))).toBe(80_000);
  });

  it("down() restores the old rate's values and the old setting", () => {
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, OLD_7728);
    V146.up(db);
    V146.down!(db);
    expect(daysCostOf(db, "77.28")).toBe(OLD_7728);
    expect(Number(rateOf(db))).toBe(OLD_RATE);
  });

  it("down() also preserves an override rather than forcing it back", () => {
    setRate(db, OLD_RATE);
    addItem(db, "77.28", COST_7728, CREDITS_7728, 900_000);
    V146.up(db);
    V146.down!(db);
    expect(daysCostOf(db, "77.28")).toBe(900_000);
  });
});
