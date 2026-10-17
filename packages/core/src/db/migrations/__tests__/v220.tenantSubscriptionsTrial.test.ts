/**
 * LIRA-332 v220 — tenant_subscriptions.trial_started_at / trial_ends_at (+
 * the partial index): added by up() (idempotent, no backfill), removed by
 * down() with every other column and the rows kept.
 *
 * Not proven failing-first: written with the migration (new columns).
 *
 * The version is looked up by NAME, not by number: a parallel branch also
 * adds a migration, and the merge renumbers one of them.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function v220() {
  const m = MIGRATIONS.find((x) => x.name === "tenant_subscriptions_trial");
  if (!m || !m.down) throw new Error("trial migration (with down) not found");
  return { version: m.version, up: m.up, down: m.down };
}

const cols = (db: Database.Database): string[] =>
  (
    db.prepare(`PRAGMA table_info(tenant_subscriptions)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);

const hasIndex = (db: Database.Database): boolean =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_tenant_subscriptions_trial_ends'`,
    )
    .get();

describe("tenant_subscriptions trial columns", () => {
  it("create_db.sql declares both columns and the index; the desktop seed row is not on a trial", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toEqual(
      expect.arrayContaining(["trial_started_at", "trial_ends_at"]),
    );
    expect(hasIndex(db)).toBe(true);
    const seeded = db
      .prepare(
        `SELECT trial_started_at, trial_ends_at FROM tenant_subscriptions WHERE tenant_id = 1`,
      )
      .all();
    for (const row of seeded) {
      expect(row).toEqual({ trial_started_at: null, trial_ends_at: null });
    }
    db.close();
  });

  it("down() removes them keeping every other column and row; up() restores them, idempotent, with no backfill", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (42, 'Old Shop', 'oldshop')`,
    ).run();
    db.prepare(
      `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (42, 'standard', 'active')`,
    ).run();
    const others = cols(db).filter(
      (c) => c !== "trial_started_at" && c !== "trial_ends_at",
    );

    v220().down(db);
    expect(cols(db)).toEqual(others);
    expect(hasIndex(db)).toBe(false);

    v220().up(db);
    v220().up(db);
    expect(cols(db)).toEqual([...others, "trial_started_at", "trial_ends_at"]);
    expect(hasIndex(db)).toBe(true);
    expect(
      db
        .prepare(
          `SELECT status, trial_started_at, trial_ends_at FROM tenant_subscriptions WHERE tenant_id = 42`,
        )
        .get(),
    ).toEqual({ status: "active", trial_started_at: null, trial_ends_at: null });
    db.close();
  });
});
