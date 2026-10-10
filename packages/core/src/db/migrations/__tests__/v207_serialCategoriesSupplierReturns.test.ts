/**
 * Migration v207 (LIRA-296 P3) `serial_categories_supplier_returns`:
 *   - product_categories.serial_label ('IMEI' | 'Serial', default 'Serial',
 *     back-filled to 'IMEI' where the category already tracks units);
 *   - product_categories.serial_required ('BLOCK' | 'WARN', default 'BLOCK');
 *   - new table supplier_returns (a defective item sent back to its
 *     supplier: SENT → CREDITED | REPLACED | REJECTED), with the links its
 *     outcome wrote (supplier ledger entry, cost transaction, restock batch)
 *     so voiding the claim can reverse them (rule 20);
 *   - indexes on its foreign keys.
 * up is idempotent and keeps rows; down removes everything it added.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V207 = MIGRATIONS.find((m) => m.version === 207);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
const hasTable = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name);
const hasIndex = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?`)
    .get(name);

const CATEGORY_COLUMNS = ["serial_label", "serial_required"];
const INDEXES = [
  "idx_supplier_returns_defective_item",
  "idx_supplier_returns_claim",
  "idx_supplier_returns_supplier",
];

/** A v206 database: create_db.sql minus everything v207 adds. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(CREATE_DB_SQL);
  for (const ix of INDEXES) db.exec(`DROP INDEX IF EXISTS ${ix}`);
  db.exec(`DROP TABLE IF EXISTS supplier_returns;`);
  for (const c of CATEGORY_COLUMNS) {
    if (cols(db, "product_categories").includes(c)) {
      db.exec(`ALTER TABLE product_categories DROP COLUMN ${c}`);
    }
  }
  db.exec(`DELETE FROM schema_migrations WHERE version >= 207`);
  return db;
}

it("is registered right after v206", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  expect(V207?.name).toBe("serial_categories_supplier_returns");
  expect(versions.indexOf(207)).toBe(versions.indexOf(206) + 1);
});

describe("v207 up", () => {
  it("adds the category columns, back-fills IMEI for tracked categories, creates supplier_returns (idempotent)", () => {
    const db = makeDb();
    db.exec(
      `INSERT INTO product_categories (tenant_id, name, sort_order, tracks_imei_units) VALUES (1, 'Laptops', 9, 0)`,
    );
    V207!.up(db);
    V207!.up(db);
    for (const c of CATEGORY_COLUMNS) {
      expect(cols(db, "product_categories")).toContain(c);
    }
    const rows = db
      .prepare(
        `SELECT name, serial_label, serial_required FROM product_categories WHERE name IN ('Phones', 'Laptops') ORDER BY name`,
      )
      .all();
    expect(rows).toEqual([
      { name: "Laptops", serial_label: "Serial", serial_required: "BLOCK" },
      { name: "Phones", serial_label: "IMEI", serial_required: "BLOCK" },
    ]);
    expect(hasTable(db, "supplier_returns")).toBe(true);
    expect(cols(db, "supplier_returns")).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "defective_item_id",
        "warranty_claim_id",
        "supplier_id",
        "status",
        "credit_usd",
        "credit_lbp",
        "ledger_entry_id",
        "cost_transaction_id",
        "restock_batch_id",
        "user_id",
        "closed_by",
        "sent_at",
        "closed_at",
        "notes",
        "created_at",
        "updated_at",
      ]),
    );
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(true);
    db.close();
  });

  it("enforces the CHECK rules", () => {
    const db = makeDb();
    V207!.up(db);
    const ret = (status: string) =>
      db.exec(
        `INSERT INTO supplier_returns (tenant_id, defective_item_id, warranty_claim_id, supplier_id, status, user_id) VALUES (1, 1, 1, 1, '${status}', 1)`,
      );
    for (const s of ["SENT", "CREDITED", "REPLACED", "REJECTED"]) {
      expect(() => ret(s)).not.toThrow();
    }
    expect(() => ret("LOST")).toThrow();
    expect(() =>
      db.exec(
        `UPDATE product_categories SET serial_required = 'MAYBE' WHERE name = 'Phones'`,
      ),
    ).toThrow();
    expect(() =>
      db.exec(
        `UPDATE product_categories SET serial_label = 'Barcode' WHERE name = 'Phones'`,
      ),
    ).toThrow();
    db.close();
  });
});

describe("v207 down", () => {
  it("removes the table, the columns and the indexes", () => {
    const db = makeDb();
    V207!.up(db);
    V207!.down!(db);
    expect(hasTable(db, "supplier_returns")).toBe(false);
    for (const c of CATEGORY_COLUMNS) {
      expect(cols(db, "product_categories")).not.toContain(c);
    }
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(false);
    db.close();
  });
});

describe("create_db.sql mirror", () => {
  it("has v207 and its ledger row; the seeded Phones category is labelled IMEI", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(hasTable(db, "supplier_returns")).toBe(true);
    for (const c of CATEGORY_COLUMNS) {
      expect(cols(db, "product_categories")).toContain(c);
    }
    for (const ix of INDEXES) expect(hasIndex(db, ix)).toBe(true);
    expect(
      db
        .prepare(
          `SELECT serial_label FROM product_categories WHERE name = 'Phones'`,
        )
        .get(),
    ).toEqual({ serial_label: "IMEI" });
    expect(
      db
        .prepare(`SELECT name FROM schema_migrations WHERE version = 207`)
        .get(),
    ).toEqual({ name: "serial_categories_supplier_returns" });
    db.close();
  });
});
