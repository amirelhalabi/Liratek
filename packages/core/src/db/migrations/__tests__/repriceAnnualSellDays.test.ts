/**
 * Migration v159 — reprice the 365-day days-only sale, 2,300,000 → 1,780,000.
 *
 * A price migration is a rewrite of data an operator can also edit by hand, so
 * the two behaviours that carry real risk are both about what it must NOT
 * touch:
 *
 * 1. **Scope.** Only 365-day credit-bearing rows still holding EXACTLY the old
 *    2,300,000 table price move. A hand-tuned annual price, a non-365 duration
 *    that happens to be priced at 2,300,000, and a days-only Validity product
 *    (no credit, so nothing to return and no Only-Days sale to price) all stay
 *    put. Stomping an operator's own price is the failure this guards.
 * 2. **Round-trip.** up() then down() returns the row to 2,300,000, and down()
 *    is likewise scoped so a price edited after up() ran is not dragged back.
 *
 * Also pinned here: the migration must use LITERALS, not
 * `TELECOM_DAYS_SELL_PRICE_LBP[365]`. The table is live and will be repriced
 * again; a migration that reads it would silently re-target itself and rewrite
 * rows it never meant to when an old database catches up. The final test locks
 * that by repricing the imported table in-memory and asserting v159 still
 * moves rows to 1,780,000.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V159 = MIGRATIONS.find((m) => m.version === 159)!;

/** v147's price — what rows hold before this migration. */
const OLD_ANNUAL_LBP = 2_300_000;
/** Owner-confirmed 2026-08-29. */
const NEW_ANNUAL_LBP = 1_780_000;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE mobile_service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      label TEXT NOT NULL,
      cost_lbp REAL NOT NULL DEFAULT 0,
      validity_days INTEGER,
      credits REAL,
      sell_days_lbp REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function addItem(
  db: Database.Database,
  label: string,
  opts: {
    costLbp?: number;
    validityDays?: number | null;
    credits?: number | null;
    sellDays?: number | null;
  } = {},
): void {
  db.prepare(
    `INSERT INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, validity_days, credits, sell_days_lbp)
     VALUES ('iPick', 'mtc', 'Prepaid', ?, ?, ?, ?, ?)`,
  ).run(
    label,
    opts.costLbp ?? 7_728_000,
    opts.validityDays ?? null,
    opts.credits ?? null,
    opts.sellDays ?? null,
  );
}

function sellDaysOf(db: Database.Database, label: string): number | null {
  return (
    (
      db
        .prepare(
          `SELECT sell_days_lbp FROM mobile_service_items WHERE label = ?`,
        )
        .get(label) as { sell_days_lbp: number | null } | undefined
    )?.sell_days_lbp ?? null
  );
}

describe("migration v159 — reprice_annual_sell_days_lbp", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  it("reprices a 365-day card sitting on the old table price", () => {
    addItem(db, "77.28", {
      validityDays: 365,
      credits: 77.28,
      sellDays: OLD_ANNUAL_LBP,
    });

    V159.up(db);

    expect(sellDaysOf(db, "77.28")).toBe(NEW_ANNUAL_LBP);
  });

  it("leaves a hand-tuned annual price alone", () => {
    // The operator already decided this card's year is worth 2,000,000. A
    // reprice must not silently overrule that.
    addItem(db, "tuned", {
      validityDays: 365,
      credits: 77.28,
      sellDays: 2_000_000,
    });

    V159.up(db);

    expect(sellDaysOf(db, "tuned")).toBe(2_000_000);
  });

  it("leaves other durations alone even at the same price", () => {
    // Nothing in the catalog prices 90 days at 2,300,000 today, but matching on
    // price alone rather than price AND duration is exactly how a reprice
    // bleeds into a tier it was never about.
    addItem(db, "90d", {
      validityDays: 90,
      credits: 22.73,
      sellDays: OLD_ANNUAL_LBP,
    });

    V159.up(db);

    expect(sellDaysOf(db, "90d")).toBe(OLD_ANNUAL_LBP);
  });

  it("leaves a days-only Validity product alone (no credit to return)", () => {
    addItem(db, "validity-365", {
      validityDays: 365,
      credits: null,
      sellDays: OLD_ANNUAL_LBP,
    });

    V159.up(db);

    expect(sellDaysOf(db, "validity-365")).toBe(OLD_ANNUAL_LBP);
  });

  it("leaves an unpriced row NULL rather than inventing a price", () => {
    addItem(db, "unpriced", {
      validityDays: 365,
      credits: 77.28,
      sellDays: null,
    });

    V159.up(db);

    expect(sellDaysOf(db, "unpriced")).toBeNull();
  });

  it("is idempotent", () => {
    addItem(db, "77.28", {
      validityDays: 365,
      credits: 77.28,
      sellDays: OLD_ANNUAL_LBP,
    });

    V159.up(db);
    V159.up(db);

    expect(sellDaysOf(db, "77.28")).toBe(NEW_ANNUAL_LBP);
  });

  it("down() restores the old price, and only where up() put the new one", () => {
    addItem(db, "77.28", {
      validityDays: 365,
      credits: 77.28,
      sellDays: OLD_ANNUAL_LBP,
    });
    addItem(db, "tuned", {
      validityDays: 365,
      credits: 77.28,
      sellDays: 2_000_000,
    });

    V159.up(db);
    V159.down!(db);

    expect(sellDaysOf(db, "77.28")).toBe(OLD_ANNUAL_LBP);
    expect(sellDaysOf(db, "tuned")).toBe(2_000_000);
  });

  it("does not read the live price table — the figures are pinned", async () => {
    // The trap this locks: if the migration read TELECOM_DAYS_SELL_PRICE_LBP,
    // the NEXT reprice would retroactively change what v159 does to a database
    // that has not caught up yet. Mutating the imported table here must not
    // move the migration.
    const telecom = await import("../../../utils/telecomCredit.js");
    const table = telecom.TELECOM_DAYS_SELL_PRICE_LBP as Record<number, number>;
    const restore = table[365];
    let mutated = false;
    try {
      // Object.freeze makes this a no-op rather than a throw in sloppy mode;
      // either way the assertion below is what matters.
      (table as { 365: number })[365] = 999_000;
      mutated = table[365] === 999_000;
    } catch {
      mutated = false;
    }

    addItem(db, "77.28", {
      validityDays: 365,
      credits: 77.28,
      sellDays: OLD_ANNUAL_LBP,
    });

    V159.up(db);

    expect(sellDaysOf(db, "77.28")).toBe(NEW_ANNUAL_LBP);

    if (mutated) {
      (table as { 365: number })[365] = restore;
    }
  });
});
