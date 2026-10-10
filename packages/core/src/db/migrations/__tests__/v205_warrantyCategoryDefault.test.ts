/**
 * Migration v205 (LIRA-296 P1) `warranty_category_default_and_line_audit`:
 *   - `product_categories.warranty_months INTEGER NULL` — the category's
 *     default warranty (0–60 months; NULL = none);
 *   - `sale_items.warranty_months INTEGER NULL` — the length actually used
 *     on the line (resolved or edited at the till);
 *   - `sale_items.warranty_set_by INTEGER NULL REFERENCES users(id)` — who
 *     changed it at the till, only when they did;
 *   - index `idx_sale_items_warranty_until` on `sale_items(tenant_id,
 *     warranty_until)` for the warranty search.
 * up adds them (idempotently) and keeps every row; down removes them.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V205 = MIGRATIONS.find((m) => m.version === 205);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }[];

const hasIndex = (db: Database.Database, name: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name);

/** A database at v204: create_db.sql minus everything v205 adds, with one
 *  existing category and one existing sale line. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`DROP INDEX IF EXISTS idx_sale_items_warranty_until`);
  for (const [table, col] of [
    ["product_categories", "warranty_months"],
    ["sale_items", "warranty_months"],
    ["sale_items", "warranty_set_by"],
  ]) {
    if (cols(db, table).some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
    }
  }
  db.exec(`
    INSERT INTO products (id, tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (50, 1, 'B-50', 'Earbuds', 'Accessory', 'Audio', 5, 10, 3);
    INSERT INTO sales (id, tenant_id, total_amount_usd, final_amount_usd, status)
      VALUES (70, 1, 10, 10, 'completed');
    INSERT INTO sale_items (id, tenant_id, sale_id, product_id, quantity, sold_price_usd, warranty_until)
      VALUES (90, 1, 70, 50, 1, 10, '2026-12-01');
  `);
  return db;
}

it("is registered in order, right after v204", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  expect(V205).toBeDefined();
  expect(V205!.name).toBe("warranty_category_default_and_line_audit");
  expect(versions.indexOf(205)).toBe(versions.indexOf(204) + 1);
});

describe("v205 up", () => {
  it("adds the nullable columns and the search index, keeping existing rows", () => {
    const db = makeDb();
    V205!.up(db);

    const cat = cols(db, "product_categories").find(
      (c) => c.name === "warranty_months",
    );
    expect(cat).toMatchObject({ type: "INTEGER", notnull: 0, dflt_value: null });

    const line = cols(db, "sale_items");
    expect(line.find((c) => c.name === "warranty_months")).toMatchObject({
      type: "INTEGER",
      notnull: 0,
    });
    expect(line.find((c) => c.name === "warranty_set_by")).toMatchObject({
      type: "INTEGER",
      notnull: 0,
    });

    // warranty_set_by references users(id)
    const fks = db.prepare(`PRAGMA foreign_key_list(sale_items)`).all() as {
      table: string;
      from: string;
      to: string;
    }[];
    expect(fks).toContainEqual(
      expect.objectContaining({ table: "users", from: "warranty_set_by", to: "id" }),
    );

    expect(hasIndex(db, "idx_sale_items_warranty_until")).toBe(true);

    // Existing rows are untouched; new columns read NULL.
    expect(
      db
        .prepare(
          `SELECT warranty_until, warranty_months, warranty_set_by FROM sale_items WHERE id = 90`,
        )
        .get(),
    ).toEqual({
      warranty_until: "2026-12-01",
      warranty_months: null,
      warranty_set_by: null,
    });
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM product_categories WHERE warranty_months IS NOT NULL`,
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);

    V205!.up(db); // idempotent
    db.close();
  });
});

describe("v205 down", () => {
  it("removes the columns and the index, keeping the rows", () => {
    const db = makeDb();
    V205!.up(db);
    V205!.down!(db);
    expect(cols(db, "product_categories").some((c) => c.name === "warranty_months")).toBe(false);
    expect(cols(db, "sale_items").some((c) => c.name === "warranty_months")).toBe(false);
    expect(cols(db, "sale_items").some((c) => c.name === "warranty_set_by")).toBe(false);
    expect(hasIndex(db, "idx_sale_items_warranty_until")).toBe(false);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM sale_items`).get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });
});

describe("create_db.sql mirror", () => {
  it("has the v205 columns, the index and the ledger row", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db, "product_categories").some((c) => c.name === "warranty_months")).toBe(true);
    expect(cols(db, "sale_items").some((c) => c.name === "warranty_months")).toBe(true);
    expect(cols(db, "sale_items").some((c) => c.name === "warranty_set_by")).toBe(true);
    expect(hasIndex(db, "idx_sale_items_warranty_until")).toBe(true);
    expect(
      db.prepare(`SELECT name FROM schema_migrations WHERE version = 205`).get(),
    ).toEqual({ name: "warranty_category_default_and_line_audit" });
    db.close();
  });
});
