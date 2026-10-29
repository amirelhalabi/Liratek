/**
 * LIRA-361 guard — `ProductSupplierRepository.merge` re-points every column
 * in `SUPPLIER_REFERENCES` from the duplicate supplier to the real one, then
 * deletes the duplicate. Two of those foreign keys are ON DELETE CASCADE, so
 * a table missing from the list would lose its rows silently. This reads the
 * real fresh schema (electron-app/create_db.sql) and fails, naming the
 * table and column, on any supplier reference the merge does not move.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SUPPLIER_REFERENCES } from "../ProductSupplierRepository.js";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

describe("supplier merge covers every supplier reference (LIRA-361)", () => {
  it("every FK to suppliers(id), and every *supplier_id column, is in SUPPLIER_REFERENCES", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);

    const found = new Set<string>();
    for (const table of tables) {
      const fks = db.pragma(`foreign_key_list(${JSON.stringify(table)})`) as {
        table: string;
        from: string;
      }[];
      for (const fk of fks)
        if (fk.table === "suppliers") found.add(`${table}.${fk.from}`);
      const cols = db.pragma(`table_info(${JSON.stringify(table)})`) as {
        name: string;
      }[];
      for (const c of cols)
        if (/(^|_)supplier_id$/.test(c.name)) found.add(`${table}.${c.name}`);
    }
    db.close();

    const listed = new Set(
      SUPPLIER_REFERENCES.map((r) => `${r.table}.${r.column}`),
    );
    expect([...found].filter((ref) => !listed.has(ref)).sort()).toEqual([]);
    expect(found.size).toBeGreaterThanOrEqual(9);
  });
});
