/**
 * Migration v160 — `mobile_service_items.max_returned_credits_usd`.
 *
 * The column is trivial; the BACKFILL is what needs guarding. The owner scoped
 * it deliberately narrowly (2026-09-07): only the 365-day 77.28 rows get 73.5,
 * even though all twelve catalog card types would gain half a dollar from a
 * plausible customer balance. A backfill that quietly widened would change what
 * the shop books on cards nobody has verified at the counter — silently, and on
 * every sale.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V160 = MIGRATIONS.find((m) => m.version === 160)!;
const V169 = MIGRATIONS.find((m) => m.version === 169)!;

const BACKFILL = 73.5;

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
  opts: { credits?: number | null; validityDays?: number | null } = {},
): void {
  db.prepare(
    `INSERT INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, validity_days, credits)
     VALUES ('iPick', 'alfa', 'Prepaid', ?, 7728000, ?, ?)`,
  ).run(label, opts.validityDays ?? null, opts.credits ?? null);
}

function overrideOf(db: Database.Database, label: string): number | null {
  return (
    (
      db
        .prepare(
          `SELECT max_returned_credits_usd FROM mobile_service_items WHERE label = ?`,
        )
        .get(label) as { max_returned_credits_usd: number | null } | undefined
    )?.max_returned_credits_usd ?? null
  );
}

function hasColumn(db: Database.Database): boolean {
  const cols = db.prepare("PRAGMA table_info(mobile_service_items)").all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === "max_returned_credits_usd");
}

describe("migration v160 — add_max_returned_credits_override", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  it("adds the column", () => {
    expect(hasColumn(db)).toBe(false);
    V160.up(db);
    expect(hasColumn(db)).toBe(true);
  });

  it("backfills 73.5 on a 365-day 77.28 card", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });

    V160.up(db);

    expect(overrideOf(db, "77.28")).toBe(BACKFILL);
  });

  it("leaves every OTHER card computing bare", () => {
    // All of these would gain half a dollar from a small customer balance, and
    // none of them is in scope. Widening the backfill makes this fail.
    addItem(db, "22.73", { credits: 22.73, validityDays: 90 });
    addItem(db, "15.15", { credits: 15.15, validityDays: 60 });
    addItem(db, "3.79", { credits: 3.79, validityDays: 10 });

    V160.up(db);

    expect(overrideOf(db, "22.73")).toBeNull();
    expect(overrideOf(db, "15.15")).toBeNull();
    expect(overrideOf(db, "3.79")).toBeNull();
  });

  it("does not touch a 77.28 card of a different duration", () => {
    // The face value alone must not be the match key — a 77.28 card that is
    // not the 365-day product has not been verified at the counter.
    addItem(db, "77.28-30d", { credits: 77.28, validityDays: 30 });

    V160.up(db);

    expect(overrideOf(db, "77.28-30d")).toBeNull();
  });

  it("does not touch a 365-day card of a different face value", () => {
    addItem(db, "50-365d", { credits: 50, validityDays: 365 });

    V160.up(db);

    expect(overrideOf(db, "50-365d")).toBeNull();
  });

  it("preserves a value an operator already set", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    V160.up(db);
    db.prepare(
      `UPDATE mobile_service_items SET max_returned_credits_usd = 73 WHERE label = '77.28'`,
    ).run();

    V160.up(db); // re-run, as a catching-up database would

    expect(overrideOf(db, "77.28")).toBe(73);
  });

  it("is idempotent", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });

    V160.up(db);
    V160.up(db);

    expect(overrideOf(db, "77.28")).toBe(BACKFILL);
    expect(hasColumn(db)).toBe(true);
  });

  it("down() drops the column", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    V160.up(db);

    V160.down!(db);

    expect(hasColumn(db)).toBe(false);
  });

  it("down() is safe on a database that never ran up()", () => {
    expect(() => V160.down!(db)).not.toThrow();
  });

  // Regression: the first version of this migration went straight to ALTER
  // TABLE. Migration tests build minimal databases holding only the tables
  // their own migration touches, and the runner walks EVERY migration over
  // them — so the bare ALTER blew up an UNRELATED suite
  // (PartnersSystemAssociationFkMigrationViaRunner's round-trip test) with
  // "no such table: mobile_service_items", nowhere near this change.
  describe("on a database with no mobile_service_items table", () => {
    let bare: Database.Database;

    beforeEach(() => {
      bare = new Database(":memory:");
    });

    afterEach(() => bare.close());

    it("up() is a no-op instead of throwing", () => {
      expect(() => V160.up(bare)).not.toThrow();
    });

    it("down() is a no-op instead of throwing", () => {
      expect(() => V160.down!(bare)).not.toThrow();
    });

    it("survives the full up/down/up cycle the runner performs", () => {
      expect(() => {
        V160.up(bare);
        V160.down!(bare);
        V160.up(bare);
      }).not.toThrow();
    });
  });
});

/**
 * Migration v169 — the repair for v160's unreachable backfill.
 *
 * v160 runs at startup; `mobile_service_items` is seeded LATER, by
 * `MobileServiceItemsContext` once someone logs in. So on a fresh database
 * v160's UPDATE hit an empty table and every card seeded with NULL — verified
 * on a real install (column present, 0 of 411 rows populated, v160 recorded as
 * applied). The durable fix is the seeder supplying the value; this migration
 * is the backstop for a database that ALREADY holds a catalog, which is
 * precisely the state v160 could never have been in.
 */
describe("migration v169 — rebackfill_max_returned_credits_override", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    V160.up(db); // the column belongs to v160
  });

  afterEach(() => db.close());

  it("fills the card v160 could not reach", () => {
    // The fresh-install shape: the catalog arrived AFTER v160 ran, so the row
    // exists now and is NULL.
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    expect(overrideOf(db, "77.28")).toBeNull();

    V169.up(db);

    expect(overrideOf(db, "77.28")).toBe(BACKFILL);
  });

  it("covers all six shelves the card sits on", () => {
    // iPick / Katsh / WHISH_APP x alfa / mtc — the predicate is keyed on the
    // CARD (credits + validity_days), never on provider or category.
    for (const shelf of ["a", "b", "c", "d", "e", "f"]) {
      addItem(db, `77.28-${shelf}`, { credits: 77.28, validityDays: 365 });
    }

    V169.up(db);

    for (const shelf of ["a", "b", "c", "d", "e", "f"]) {
      expect(overrideOf(db, `77.28-${shelf}`)).toBe(BACKFILL);
    }
  });

  it("leaves a value an operator already set", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    db.prepare(
      `UPDATE mobile_service_items SET max_returned_credits_usd = 73 WHERE label = '77.28'`,
    ).run();

    V169.up(db);

    expect(overrideOf(db, "77.28")).toBe(73);
  });

  it("leaves every other card computing bare", () => {
    addItem(db, "22.73", { credits: 22.73, validityDays: 90 });
    addItem(db, "77.28-30d", { credits: 77.28, validityDays: 30 });
    addItem(db, "50-365d", { credits: 50, validityDays: 365 });

    V169.up(db);

    expect(overrideOf(db, "22.73")).toBeNull();
    expect(overrideOf(db, "77.28-30d")).toBeNull();
    expect(overrideOf(db, "50-365d")).toBeNull();
  });

  it("is a no-op on a database v160 already filled", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    V160.up(db); // this time the row exists, so v160 fills it
    expect(overrideOf(db, "77.28")).toBe(BACKFILL);

    V169.up(db);

    expect(overrideOf(db, "77.28")).toBe(BACKFILL);
  });

  it("is idempotent", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });

    V169.up(db);
    V169.up(db);

    expect(overrideOf(db, "77.28")).toBe(BACKFILL);
  });

  it("down() clears the seeded value but not a tuned one", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    addItem(db, "tuned", { credits: 77.28, validityDays: 365 });
    V169.up(db);
    db.prepare(
      `UPDATE mobile_service_items SET max_returned_credits_usd = 73 WHERE label = 'tuned'`,
    ).run();

    V169.down!(db);

    expect(overrideOf(db, "77.28")).toBeNull();
    expect(overrideOf(db, "tuned")).toBe(73);
  });

  it("down() leaves the COLUMN alone — that belongs to v160", () => {
    addItem(db, "77.28", { credits: 77.28, validityDays: 365 });
    V169.up(db);

    V169.down!(db);

    expect(hasColumn(db)).toBe(true);
  });

  it("is a no-op on a database with no table or no column", () => {
    const bare = new Database(":memory:");
    expect(() => V169.up(bare)).not.toThrow();
    expect(() => V169.down!(bare)).not.toThrow();
    bare.close();

    // Table present, column absent (a database that never reached v160).
    const noCol = makeDb();
    expect(() => V169.up(noCol)).not.toThrow();
    noCol.close();
  });
});
