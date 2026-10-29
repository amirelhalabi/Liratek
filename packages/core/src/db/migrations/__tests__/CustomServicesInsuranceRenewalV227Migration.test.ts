/**
 * Migration v227 — custom_services_insurance_renewal (LIRA-360).
 *
 * Proves: up() adds insurance_type, renewal_dismissed_at and
 * renewal_dismissed_by as nullable columns (an existing row reads NULL);
 * up() is idempotent; down() removes them; both are no-ops without the
 * table; a fresh create_db.sql already has the columns and records v227.
 *
 * Written with the migration (not proven failing-first).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 227);
const COLUMNS = ["insurance_type", "renewal_dismissed_at", "renewal_dismissed_by"];

function columns(db: Database.Database): string[] {
  return (
    db.prepare(`PRAGMA table_info(custom_services)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function legacyDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      description TEXT NOT NULL,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO custom_services (id, tenant_id, description, category)
    VALUES (1, 1, 'Old insurance', 'insurance');
  `);
  return db;
}

describe("migration v227 — insurance renewal columns", () => {
  it("is registered", () => {
    expect(migration?.name).toBe("custom_services_insurance_renewal");
  });

  it("adds the three nullable columns; an existing row reads NULL", () => {
    const db = legacyDb();
    migration!.up(db);
    expect(columns(db)).toEqual(expect.arrayContaining(COLUMNS));
    expect(
      db
        .prepare(
          `SELECT insurance_type, renewal_dismissed_at, renewal_dismissed_by FROM custom_services WHERE id = 1`,
        )
        .get(),
    ).toEqual({
      insurance_type: null,
      renewal_dismissed_at: null,
      renewal_dismissed_by: null,
    });
    expect(() => migration!.up(db)).not.toThrow();
  });

  it("down() removes them and keeps the row", () => {
    const db = legacyDb();
    migration!.up(db);
    migration!.down!(db);
    for (const c of COLUMNS) expect(columns(db)).not.toContain(c);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM custom_services`).get()).toEqual({ n: 1 });
  });

  it("does nothing without the table", () => {
    const db = new Database(":memory:");
    expect(() => migration!.up(db)).not.toThrow();
    expect(() => migration!.down!(db)).not.toThrow();
  });

  it("a fresh create_db.sql already has the columns and records v227", () => {
    const db = new Database(":memory:");
    db.exec(
      fs.readFileSync(
        path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
        "utf-8",
      ),
    );
    expect(columns(db)).toEqual(expect.arrayContaining(COLUMNS));
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%migration%'`)
      .all() as Array<{ name: string }>;
    const versions = tables.flatMap(({ name }) =>
      (db.prepare(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>).map(
        (r) => r.version,
      ),
    );
    expect(versions).toContain(227);
  });
});
