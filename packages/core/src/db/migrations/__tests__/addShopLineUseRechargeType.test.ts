/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch: implement first, verify at the end).
 *
 * Migration v182 — add_shop_line_use_recharge_type.
 *
 * OWNER_NOTES_REMAINING_BUILD.md #21, case 2 (LIRA-088). Widens the
 * `recharges.recharge_type` CHECK to include `'SHOP_LINE_USE'`, the same
 * table-rebuild shape v149 used to add `'CREDIT_BUYBACK'`.
 *
 * The load-bearing guard (rule 17 — must be proven, not assumed): SQLite
 * cannot ALTER a CHECK constraint, so this migration recreates the table.
 * Pre-v182, inserting a `recharge_type = 'SHOP_LINE_USE'` row throws
 * SQLITE_CONSTRAINT_CHECK — the first test proves that failure mode exists
 * on the pre-migration schema before proving up() removes it.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function getMigration(version: number) {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new Error(`Migration v${version} not found`);
  }
  if (!migration.down) {
    throw new Error(`Migration v${version} has no down()`);
  }
  return migration as Required<typeof migration>;
}

/** The exact recharges shape v149 left behind — the state a real upgrading
 *  install is in immediately before v182 runs. */
function createPreV182Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    INSERT INTO tenants (id, name) VALUES (1, 'Default');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      carrier TEXT NOT NULL,
      recharge_type TEXT CHECK(recharge_type IN ('CREDIT_TRANSFER', 'VOUCHER', 'DAYS', 'TOP_UP', 'ALFA_GIFT', 'CREDIT_BUYBACK')) NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount DECIMAL(10, 2) NOT NULL,
      cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT DEFAULT 'CASH',
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER DEFAULT 1,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recharges_carrier_date ON recharges(carrier, created_at);
    CREATE INDEX IF NOT EXISTS idx_recharges_date ON recharges(created_at);
    CREATE INDEX IF NOT EXISTS idx_recharges_tenant_id ON recharges(tenant_id);
  `);
  return db;
}

function insertRecharge(
  db: Database.Database,
  rechargeType: string,
): { success: boolean; error?: string } {
  try {
    db.prepare(
      `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, price)
       VALUES (1, 'MTC', ?, 1, 1)`,
    ).run(rechargeType);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

describe("Migration v182 — add_shop_line_use_recharge_type", () => {
  it("PRE-FIX PROOF: the pre-v182 CHECK rejects 'SHOP_LINE_USE' — SQLITE_CONSTRAINT_CHECK", () => {
    const db = createPreV182Db();
    const result = insertRecharge(db, "SHOP_LINE_USE");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CONSTRAINT/i);
    db.close();
  });

  it("up() widens the CHECK to accept 'SHOP_LINE_USE', preserving existing rows/ids", () => {
    const db = createPreV182Db();
    // A pre-existing row of every prior type, to prove the rebuild preserves
    // data (mirrors v149's own precedent).
    db.prepare(
      `INSERT INTO recharges (id, tenant_id, carrier, recharge_type, amount, price)
       VALUES (1, 1, 'MTC', 'CREDIT_TRANSFER', 5, 500000)`,
    ).run();
    db.prepare(
      `INSERT INTO recharges (id, tenant_id, carrier, recharge_type, amount, price)
       VALUES (2, 1, 'Alfa', 'CREDIT_BUYBACK', 3, 3)`,
    ).run();

    getMigration(182).up(db);

    const result = insertRecharge(db, "SHOP_LINE_USE");
    expect(result.success).toBe(true);

    const rows = db
      .prepare(`SELECT id, recharge_type FROM recharges ORDER BY id`)
      .all() as { id: number; recharge_type: string }[];
    expect(rows[0]).toEqual({ id: 1, recharge_type: "CREDIT_TRANSFER" });
    expect(rows[1]).toEqual({ id: 2, recharge_type: "CREDIT_BUYBACK" });
    expect(rows[2].recharge_type).toBe("SHOP_LINE_USE");

    db.close();
  });

  it("down() restores the pre-v182 CHECK (rejects SHOP_LINE_USE again) when no SHOP_LINE_USE rows exist", () => {
    const db = createPreV182Db();
    getMigration(182).up(db);

    getMigration(182).down(db);

    const result = insertRecharge(db, "SHOP_LINE_USE");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CONSTRAINT/i);
    // The pre-existing CREDIT_BUYBACK type must still be accepted — down()
    // only narrows the CHECK back, it does not remove v149's addition.
    expect(insertRecharge(db, "CREDIT_BUYBACK").success).toBe(true);

    db.close();
  });

  it("down() throws when a SHOP_LINE_USE row already exists — expected, matches v149's own precedent", () => {
    const db = createPreV182Db();
    getMigration(182).up(db);
    expect(insertRecharge(db, "SHOP_LINE_USE").success).toBe(true);

    expect(() => getMigration(182).down(db)).toThrow();

    db.close();
  });

  it("up()/down() no-op cleanly against a DB with no 'recharges' table at all", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    expect(() => getMigration(182).up(db)).not.toThrow();
    expect(() => getMigration(182).down(db)).not.toThrow();
    db.close();
  });
});
