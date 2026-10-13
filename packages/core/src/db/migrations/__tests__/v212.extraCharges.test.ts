/**
 * LIRA-319 v212 — transactions.extra_usd / extra_lbp (Extra charges).
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

const cols = (db: Database.Database): Col[] =>
  db.prepare(`PRAGMA table_info(transactions)`).all() as Col[];
const col = (db: Database.Database, name: string) =>
  cols(db).find((c) => c.name === name);

function v212() {
  const m = MIGRATIONS.find((x) => x.version === 212);
  if (!m) throw new Error("migration v212 not found");
  return m;
}

describe("v212 extra charges columns", () => {
  it("follows v211", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 212);
    expect(i).toBeGreaterThan(0);
    expect(MIGRATIONS[i - 1].version).toBe(211);
    expect(v212().name).toBe("transactions_extra_charges");
  });

  it("the fresh schema (create_db.sql) declares both columns, REAL NOT NULL DEFAULT 0", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    for (const name of ["extra_usd", "extra_lbp"]) {
      const c = col(db, name);
      expect(c).toBeDefined();
      expect(c!.type).toBe("REAL");
      expect(c!.notnull).toBe(1);
      expect(c!.dflt_value).toBe("0");
    }
    db.close();
  });

  it("up() adds the columns to an older DB; existing rows read 0; down() removes them", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.exec(`ALTER TABLE transactions DROP COLUMN extra_lbp;`);
    db.exec(`ALTER TABLE transactions DROP COLUMN extra_usd;`);
    db.prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp) VALUES ('SALE', 'sales', 1, 1, 7, 0)`,
    ).run();

    v212().up(db);
    const row = db
      .prepare(`SELECT extra_usd, extra_lbp FROM transactions LIMIT 1`)
      .get() as { extra_usd: number; extra_lbp: number };
    expect(row).toEqual({ extra_usd: 0, extra_lbp: 0 });

    v212().down!(db);
    expect(col(db, "extra_usd")).toBeUndefined();
    expect(col(db, "extra_lbp")).toBeUndefined();
    db.close();
  });
});
