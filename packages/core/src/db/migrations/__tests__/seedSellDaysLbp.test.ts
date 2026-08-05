/**
 * Migration v147 — seed `sell_days_lbp` from `validity_days`.
 *
 * Two behaviours carry real risk and are guarded here:
 *
 * 1. **Scope.** Only genuine Only-Days candidates get a days price. A card with
 *    days but no credit (the standalone Validity products) has nothing to
 *    return; a card with credit but no days has nothing to sell as days. Giving
 *    either one a `sell_days_lbp` advertises a price for a sale that cannot
 *    happen.
 * 2. **No interpolation.** The price curve is linear at 8,333 LBP/day from 30
 *    through 90 days and then discounted to 6,301 for the year. Any day count
 *    absent from the table must be SKIPPED, never interpolated — interpolating
 *    would invent a price the owner never approved, and it would look correct.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";
import { TELECOM_DAYS_SELL_PRICE_LBP } from "../../../utils/telecomCredit.js";

const V147 = MIGRATIONS.find((m) => m.version === 147)!;

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
    opts.costLbp ?? 1_000_000,
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

describe("migration v147 — seed_sell_days_lbp_from_validity_days", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  it("prices every day count in the owner's table", () => {
    for (const days of Object.keys(TELECOM_DAYS_SELL_PRICE_LBP)) {
      addItem(db, `card-${days}`, {
        validityDays: Number(days),
        credits: 10,
      });
    }
    V147.up(db);
    for (const [days, price] of Object.entries(TELECOM_DAYS_SELL_PRICE_LBP)) {
      expect(sellDaysOf(db, `card-${days}`)).toBe(price);
    }
  });

  it("pins the owner-confirmed prices explicitly", () => {
    // Spelled out rather than read from the table, so a change to the table is
    // a change to a test too — these are owner-agreed numbers, not internals.
    addItem(db, "10d", { validityDays: 10, credits: 3.79 });
    addItem(db, "30d", { validityDays: 30, credits: 7.58 });
    addItem(db, "60d", { validityDays: 60, credits: 15.15 });
    addItem(db, "90d", { validityDays: 90, credits: 22.73 });
    addItem(db, "365d", { validityDays: 365, credits: 77.28 });
    V147.up(db);
    expect(sellDaysOf(db, "10d")).toBe(100_000);
    expect(sellDaysOf(db, "30d")).toBe(250_000);
    expect(sellDaysOf(db, "60d")).toBe(500_000);
    expect(sellDaysOf(db, "90d")).toBe(750_000);
    expect(sellDaysOf(db, "365d")).toBe(2_300_000);
  });

  it("SKIPS a day count absent from the table — never interpolates", () => {
    // 180 exists in the catalog's standalone Validity list. A naive
    // implementation might price it at 8,333 x 180 = 1,500,000; the real curve
    // is discounted by then, so any interpolated figure is invented.
    addItem(db, "180d", { validityDays: 180, credits: 40 });
    addItem(db, "20d", { validityDays: 20, credits: 5 });
    V147.up(db);
    expect(sellDaysOf(db, "180d")).toBeNull();
    expect(sellDaysOf(db, "20d")).toBeNull();
  });

  it("skips a days-only product — days but no credit, nothing to return", () => {
    addItem(db, "validity-30", { validityDays: 30, credits: null });
    V147.up(db);
    expect(sellDaysOf(db, "validity-30")).toBeNull();
  });

  it("skips a credit-only card — credit but no days, nothing to sell", () => {
    addItem(db, "1.67", { validityDays: null, credits: 1.67 });
    V147.up(db);
    expect(sellDaysOf(db, "1.67")).toBeNull();
  });

  it("preserves a price the operator already typed", () => {
    addItem(db, "30d", { validityDays: 30, credits: 7.58, sellDays: 190_000 });
    V147.up(db);
    expect(sellDaysOf(db, "30d")).toBe(190_000);
  });

  it("is idempotent", () => {
    addItem(db, "365d", { validityDays: 365, credits: 77.28 });
    V147.up(db);
    V147.up(db);
    expect(sellDaysOf(db, "365d")).toBe(2_300_000);
  });

  it("down() clears table prices but leaves an operator's price alone", () => {
    addItem(db, "365d", { validityDays: 365, credits: 77.28 });
    addItem(db, "30d", { validityDays: 30, credits: 7.58, sellDays: 190_000 });
    V147.up(db);
    V147.down!(db);
    expect(sellDaysOf(db, "365d")).toBeNull();
    expect(sellDaysOf(db, "30d")).toBe(190_000);
  });
});
