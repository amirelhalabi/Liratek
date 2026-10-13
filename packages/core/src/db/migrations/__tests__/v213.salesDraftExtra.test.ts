/**
 * LIRA-319 v213 — sales.extra_usd, so a POS sale saved as a DRAFT keeps its
 * extra and restores it on resume (owner decision 2026-10-14). A draft writes
 * no transactions row, so the extra has nowhere else to live until completion.
 *
 * Rule 17: written BEFORE the migration and run against the code without it.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

type Col = { name: string; type: string; notnull: number; dflt_value: string | null };

const col = (db: Database.Database, name: string) =>
  (db.prepare(`PRAGMA table_info(sales)`).all() as Col[]).find((c) => c.name === name);

function v213() {
  const m = MIGRATIONS.find((x) => x.version === 213);
  if (!m) throw new Error("migration v213 not found");
  return m;
}

describe("v213 sales.extra_usd (draft extra)", () => {
  it("follows v212", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 213);
    expect(i).toBeGreaterThan(0);
    expect(MIGRATIONS[i - 1].version).toBe(212);
    expect(v213().name).toBe("sales_extra_usd");
  });

  it("the fresh schema (create_db.sql) declares it, REAL NOT NULL DEFAULT 0", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    const c = col(db, "extra_usd");
    expect(c).toBeDefined();
    expect(c!.type).toBe("REAL");
    expect(c!.notnull).toBe(1);
    expect(c!.dflt_value).toBe("0");
    const marker = db
      .prepare(`SELECT name FROM schema_migrations WHERE version = 213`)
      .get() as { name: string } | undefined;
    expect(marker?.name).toBe("sales_extra_usd");
    db.close();
  });

  it("up() adds it to an older DB; existing rows read 0; down() removes it", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.exec(`ALTER TABLE sales DROP COLUMN extra_usd;`);
    db.prepare(
      `INSERT INTO sales (tenant_id, total_amount_usd, final_amount_usd, status) VALUES (1, 6, 6, 'draft')`,
    ).run();

    v213().up(db);
    expect(
      db.prepare(`SELECT extra_usd FROM sales LIMIT 1`).get(),
    ).toEqual({ extra_usd: 0 });

    v213().down!(db);
    expect(col(db, "extra_usd")).toBeUndefined();
    db.close();
  });
});
