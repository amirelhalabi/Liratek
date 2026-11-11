/**
 * LIRA-388 — migration v232: `hold_money.voided_at` / `voided_by` (a Hold
 * Money drop-off refunded from its Transactions row). Up adds both nullable
 * columns on the real schema rolled back to v231, keeps every row; down
 * drops them again; create_db.sql already carries them.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, rollbackTo, runMigrations } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(hold_money)`).all() as { name: string }[]).map(
    (c) => c.name,
  );

describe("v232 hold_money_voided", () => {
  it("is the migration directly after v231", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 232);
    expect(MIGRATIONS[i - 1]?.version).toBe(231);
    expect(MIGRATIONS[i].name).toBe("hold_money_voided");
  });

  it("create_db.sql carries both columns", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toEqual(
      expect.arrayContaining(["voided_at", "voided_by"]),
    );
    db.close();
  });

  it("down drops them, up adds them back and keeps the rows", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.prepare(
      `INSERT INTO hold_money (tenant_id, client_name, usd_amount, lbp_amount) VALUES (1, 'Keep me', 10, 0)`,
    ).run();
    rollbackTo(db, 231);
    expect(cols(db)).not.toContain("voided_at");
    expect(cols(db)).not.toContain("voided_by");
    runMigrations(db);
    expect(cols(db)).toEqual(
      expect.arrayContaining(["voided_at", "voided_by"]),
    );
    const row = db
      .prepare(`SELECT client_name, voided_at FROM hold_money`)
      .get() as { client_name: string; voided_at: string | null };
    expect(row).toEqual({ client_name: "Keep me", voided_at: null });
    db.close();
  });
});
