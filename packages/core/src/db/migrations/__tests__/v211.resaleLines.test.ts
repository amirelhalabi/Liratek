/**
 * LIRA-309 v211 — resale_lines + resale_line_recharges: created by up(),
 * removed by down(), with the constraints data-model.md specifies.
 *
 * NOT proven failing-first (rule 17): the migration was written before this
 * file.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const TABLES = ["resale_lines", "resale_line_recharges"] as const;

function v211() {
  const m = MIGRATIONS.find((x) => x.version === 211);
  if (!m) throw new Error("migration v211 not found");
  return m;
}

function freshPreV211(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  for (const t of [...TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${t}`);
  return db;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES.map(() => "?").join(",")})`,
      )
      .all(...TABLES) as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("v211 resale_lines", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshPreV211();
    v211().up(db);
  });

  afterEach(() => db.close());

  it("follows v210", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 211);
    expect(MIGRATIONS[i - 1].version).toBe(210);
    expect(v211().name).toBe("resale_lines");
  });

  it("creates both tables with id, tenant_id, created_at, updated_at", () => {
    expect(tableNames(db).sort()).toEqual([...TABLES].sort());
    for (const t of TABLES) {
      const names = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      expect(names).toEqual(
        expect.arrayContaining(["id", "tenant_id", "created_at", "updated_at"]),
      );
    }
    const lineCols = (
      db.prepare(`PRAGMA table_info(resale_lines)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    // The number is the product's barcode — never copied here (rule 14).
    expect(lineCols).not.toContain("phone_number");
  });

  it("allows one details row per product and only mtc/alfa", () => {
    db.prepare(
      `INSERT INTO products (id, tenant_id, name, item_type, category) VALUES (900, 1, 'Line', 'product', 'Phone Lines')`,
    ).run();
    db.prepare(`INSERT INTO resale_lines (tenant_id, product_id, carrier) VALUES (1, 900, 'mtc')`).run();
    expect(() =>
      db.prepare(`INSERT INTO resale_lines (tenant_id, product_id, carrier) VALUES (1, 900, 'alfa')`).run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db.prepare(`INSERT INTO resale_lines (tenant_id, product_id, carrier) VALUES (1, 901, 'touch')`).run(),
    ).toThrow(/CHECK/);
  });

  it("limits recharge sources to CARD, SHOP_LINE_CREDIT and DAYS", () => {
    // Only the CHECK is under test here, not the foreign keys.
    db.pragma("foreign_keys = OFF");
    const insert = (source: string) =>
      db
        .prepare(
          `INSERT INTO resale_line_recharges
             (tenant_id, transaction_id, resale_line_id, product_id, source, cost_usd,
              prev_cost_usd, prev_price_usd, prev_credits)
           VALUES (1, ?, 1, 1, ?, 3, 15, 25, 0)`,
        )
        .run(source === "DAYS" ? 1 : 2, source);
    expect(() => insert("DAYS")).not.toThrow();
    expect(() => insert("CASH")).toThrow(/CHECK/);
  });

  it("down() removes both tables", () => {
    v211().down!(db);
    expect(tableNames(db)).toEqual([]);
  });
});
