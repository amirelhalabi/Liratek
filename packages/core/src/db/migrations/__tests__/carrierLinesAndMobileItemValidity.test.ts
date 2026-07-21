/**
 * v135 — carrier_lines table + mobile_service_items validity_days/credits
 * backfill (LIRA W6).
 *
 * Covers:
 *  - carrier_lines table is created.
 *  - mobile_service_items gains nullable validity_days/credits columns.
 *  - iPick mtc Prepaid OLD verbose labels ("10 days 3.79$", "credit only
 *    1$", "start 4.5$", …) are renamed to the card face value AND backfill
 *    validity_days/credits from what the old label encoded.
 *  - Katsh/WHISH_APP mtc Prepaid rows already on the new (v117-renamed) face
 *    value get validity_days/credits stamped by label match.
 *  - Untouched control rows (a different subcategory) are NOT backfilled.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function migration(version: number) {
  const m = MIGRATIONS.find((x) => x.version === version);
  if (!m) throw new Error(`migration v${version} not found`);
  return m;
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
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
  },
) {
  db.prepare(
    `INSERT INTO mobile_service_items (provider, category, subcategory, label, cost_lbp, sell_lbp)
     VALUES (?, ?, ?, ?, 100000, 150000)`,
  ).run(row.provider, row.category, row.subcategory, row.label);
}

function getItem(
  db: Database.Database,
  provider: string,
  label: string,
): {
  label: string;
  validity_days: number | null;
  credits: number | null;
} {
  return db
    .prepare(
      `SELECT label, validity_days, credits FROM mobile_service_items
        WHERE provider = ? AND category = 'mtc' AND subcategory = 'Prepaid' AND label = ?`,
    )
    .get(provider, label) as any;
}

describe("v135 — carrier_lines + mobile_service_items validity/credits", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();

    // iPick — OLD verbose labels (pre-rename, as an aged/upgraded shop would have)
    for (const label of [
      "credit only 1$",
      "credit only 1.67$",
      "10 days 3.79$",
      "30 days 4.5$",
      "30 days 7.58$",
      "30 days 10$",
      "60 days 15.15$",
      "90 days 22.73$",
      "365 days 77.28$",
      "start 4.5$",
    ]) {
      insertItem(db, {
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label,
      });
    }

    // Katsh / WHISH_APP — already renamed to face value by v117 (pre-existing
    // in every real DB since v117 ran long before this migration).
    for (const provider of ["Katsh", "WHISH_APP"]) {
      for (const label of ["1", "3.79", "77.28"]) {
        insertItem(db, {
          provider,
          category: "mtc",
          subcategory: "Prepaid",
          label,
        });
      }
    }

    // Control row: different subcategory — must NOT be touched.
    insertItem(db, {
      provider: "iPick",
      category: "mtc",
      subcategory: "Credits",
      label: "3$",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("creates the carrier_lines table", () => {
    migration(135).up(db);
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='carrier_lines'`,
      )
      .get();
    expect(row).toBeTruthy();
  });

  it("adds nullable validity_days/credits columns to mobile_service_items", () => {
    migration(135).up(db);
    const cols = db
      .prepare(`PRAGMA table_info(mobile_service_items)`)
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("validity_days");
    expect(names).toContain("credits");
  });

  it("renames iPick mtc Prepaid OLD verbose labels to face value and backfills validity_days/credits", () => {
    migration(135).up(db);

    expect(getItem(db, "iPick", "1")).toMatchObject({
      credits: 1,
      validity_days: null,
    });
    expect(getItem(db, "iPick", "1.67")).toMatchObject({
      credits: 1.67,
      validity_days: null,
    });
    expect(getItem(db, "iPick", "3.79")).toMatchObject({
      validity_days: 10,
      credits: null,
    });
    expect(getItem(db, "iPick", "4.5")).toMatchObject({
      validity_days: 30,
      credits: null,
    });
    expect(getItem(db, "iPick", "7.58")).toMatchObject({
      validity_days: 30,
      credits: null,
    });
    expect(getItem(db, "iPick", "10")).toMatchObject({
      validity_days: 30,
      credits: null,
    });
    expect(getItem(db, "iPick", "15.15")).toMatchObject({
      validity_days: 60,
      credits: null,
    });
    expect(getItem(db, "iPick", "22.73")).toMatchObject({
      validity_days: 90,
      credits: null,
    });
    expect(getItem(db, "iPick", "77.28")).toMatchObject({
      validity_days: 365,
      credits: null,
    });
    // "start" has no derivable validity/credit — label renamed, meta stays null.
    expect(getItem(db, "iPick", "start")).toMatchObject({
      validity_days: null,
      credits: null,
    });

    // Old verbose labels no longer exist.
    const oldRow = db
      .prepare(
        `SELECT * FROM mobile_service_items WHERE label = 'credit only 1$'`,
      )
      .get();
    expect(oldRow).toBeUndefined();
  });

  it("stamps validity_days/credits on Katsh/WHISH_APP mtc Prepaid rows already on the face-value label", () => {
    migration(135).up(db);

    for (const provider of ["Katsh", "WHISH_APP"]) {
      expect(getItem(db, provider, "1")).toMatchObject({
        credits: 1,
        validity_days: null,
      });
      expect(getItem(db, provider, "3.79")).toMatchObject({
        validity_days: 10,
        credits: null,
      });
      expect(getItem(db, provider, "77.28")).toMatchObject({
        validity_days: 365,
        credits: null,
      });
    }
  });

  it("does not touch a different subcategory (mtc Credits) control row", () => {
    migration(135).up(db);
    const row = db
      .prepare(
        `SELECT label, validity_days, credits FROM mobile_service_items
          WHERE provider = 'iPick' AND category = 'mtc' AND subcategory = 'Credits'`,
      )
      .get() as any;
    expect(row.label).toBe("3$");
    expect(row.validity_days).toBeNull();
    expect(row.credits).toBeNull();
  });
});
