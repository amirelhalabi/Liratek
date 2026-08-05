/**
 * Migration v145 — alfa Prepaid validity_days backfill.
 *
 * TELECOM_DAYS_COST_PLAN.md §6 step 7b. The owner read these day counts off
 * the Katsh alfa shelf on 2026-08-04; they apply to all three providers
 * because the same physical Alfa card is resold through each (the rule v135
 * already established for mtc).
 *
 * The load-bearing assertion here is the EXCLUSION of `1.22` and `3.03`. The
 * owner could not confirm a day count for those two, so they stay credit-only
 * and out of Only-Days. If a future edit gives them a validity_days,
 * `isTelecomSplitComplete` flips true and their sales start routing through
 * the credit-return netting path — a money-path change, from a data edit that
 * looks harmless. That is what `excludes the credit-only cards` guards.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V145 = MIGRATIONS.find((m) => m.version === 145)!;

/** Minimal schema — only what v145 touches. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE mobile_service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      label TEXT NOT NULL,
      cost_lbp REAL NOT NULL DEFAULT 0,
      validity_days INTEGER,
      credits REAL,
      days_cost_lbp REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertItem(
  db: Database.Database,
  provider: string,
  category: string,
  subcategory: string,
  label: string,
  validityDays: number | null = null,
): void {
  db.prepare(
    `INSERT INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, validity_days)
     VALUES (?, ?, ?, ?, 1000000, ?)`,
  ).run(provider, category, subcategory, label, validityDays);
}

function daysOf(db: Database.Database, provider: string, label: string) {
  return (
    db
      .prepare(
        `SELECT validity_days FROM mobile_service_items
          WHERE provider = ? AND category = 'alfa'
            AND subcategory = 'Prepaid' AND label = ?`,
      )
      .get(provider, label) as { validity_days: number | null } | undefined
  )?.validity_days;
}

const PROVIDERS = ["iPick", "Katsh", "WHISH_APP"];
const EXPECTED: Record<string, number> = {
  "4.5": 10,
  "7.58": 30,
  "10": 30,
  "15.15": 60,
  "22.73": 90,
  "77.28": 365,
};

describe("migration v145 — backfill_alfa_prepaid_validity_days", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    for (const provider of PROVIDERS) {
      for (const label of Object.keys(EXPECTED)) {
        insertItem(db, provider, "alfa", "Prepaid", label);
      }
      insertItem(db, provider, "alfa", "Prepaid", "3.03");
    }
    insertItem(db, "iPick", "alfa", "Prepaid", "1.22");
  });

  afterEach(() => db.close());

  it("stamps the owner's day counts on all three providers", () => {
    V145.up(db);
    for (const provider of PROVIDERS) {
      for (const [label, days] of Object.entries(EXPECTED)) {
        expect(daysOf(db, provider, label)).toBe(days);
      }
    }
  });

  it("excludes the credit-only cards: 1.22 and 3.03 stay NULL", () => {
    V145.up(db);
    for (const provider of PROVIDERS) {
      expect(daysOf(db, provider, "3.03")).toBeNull();
    }
    expect(daysOf(db, "iPick", "1.22")).toBeNull();
  });

  it("alfa 4.5 is 10 days — it does NOT inherit the mtc card's 30", () => {
    // Pins the deliberate divergence. mtc 4.5 = 30 days, alfa 4.5 = 10.
    V145.up(db);
    expect(daysOf(db, "Katsh", "4.5")).toBe(10);
  });

  it("leaves a hand-entered value alone (idempotent via validity_days IS NULL)", () => {
    db.prepare(
      `UPDATE mobile_service_items SET validity_days = 999
        WHERE provider = 'Katsh' AND category = 'alfa'
          AND subcategory = 'Prepaid' AND label = '77.28'`,
    ).run();
    V145.up(db);
    expect(daysOf(db, "Katsh", "77.28")).toBe(999);
    expect(daysOf(db, "iPick", "77.28")).toBe(365);
  });

  it("does not touch other categories or subcategories", () => {
    insertItem(db, "iPick", "mtc", "Prepaid", "4.5");
    insertItem(db, "iPick", "alfa", "Mobile Internet", "4.5");
    V145.up(db);
    const mtc = db
      .prepare(
        `SELECT validity_days FROM mobile_service_items
          WHERE provider = 'iPick' AND category = 'mtc' AND label = '4.5'`,
      )
      .get() as { validity_days: number | null };
    const internet = db
      .prepare(
        `SELECT validity_days FROM mobile_service_items
          WHERE subcategory = 'Mobile Internet' AND label = '4.5'`,
      )
      .get() as { validity_days: number | null };
    expect(mtc.validity_days).toBeNull();
    expect(internet.validity_days).toBeNull();
  });

  it("is idempotent on a second run", () => {
    V145.up(db);
    V145.up(db);
    expect(daysOf(db, "iPick", "77.28")).toBe(365);
    expect(daysOf(db, "iPick", "1.22")).toBeNull();
  });

  it("down() reverts exactly the six labels and leaves 1.22/3.03 untouched", () => {
    V145.up(db);
    V145.down!(db);
    for (const provider of PROVIDERS) {
      for (const label of Object.keys(EXPECTED)) {
        expect(daysOf(db, provider, label)).toBeNull();
      }
      expect(daysOf(db, provider, "3.03")).toBeNull();
    }
    expect(daysOf(db, "iPick", "1.22")).toBeNull();
  });
});
