/**
 * SessionCheckoutService — session→client resolution (walk-in misattribution)
 *
 * Repro from production data (2026-07-10): a session started as name-only
 * "amir" checked out; the old fallback `clientRepo.search("amir", {limit: 1})`
 * ran `LIKE '%amir%' ORDER BY full_name LIMIT 1` and stamped the basket's
 * transaction on "AMIR SHNEIF" — a different, unrelated client, whose purchase
 * history silently gained the sale.
 *
 * Post-fix contract (resolveSessionClientForCheckout):
 *   - name+phone → the phone owner, REGISTERING the client when unknown
 *     (FEATURE_GUIDE §6: unknown name+phone auto-creates) so an on-account
 *     basket never dies with "Cannot create basket debt without a client";
 *   - name-only → EXACT full_name match or undefined — never fuzzy.
 */

import Database from "better-sqlite3";
import { resolveSessionClientForCheckout } from "../SessionCheckoutService";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_clients_tenant_phone
      ON clients(tenant_id, phone_number);

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function seedClient(
  db: Database.Database,
  fullName: string,
  phone: string | null,
): number {
  const result = db
    .prepare(
      `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
    )
    .run(fullName, phone);
  return Number(result.lastInsertRowid);
}

describe("resolveSessionClientForCheckout", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    resetClientRepository();
    resetTransactionRepository();
  });

  afterEach(() => {
    (globalThis as any).__LIRATEK_TEST_DB__ = undefined;
    db.close();
    resetClientRepository();
    resetTransactionRepository();
  });

  // The production misattribution: "amir" must NOT resolve to "AMIR SHNEIF".
  it("name-only session never fuzzy-matches a partial name", () => {
    seedClient(db, "AMIR SHNEIF", "76698748");

    const resolved = resolveSessionClientForCheckout("amir", undefined, 1);

    expect(resolved).toBeUndefined();
  });

  it("name-only session resolves an EXACT full-name match", () => {
    const id = seedClient(db, "AMIR SHNEIF", "76698748");

    const resolved = resolveSessionClientForCheckout(
      "AMIR SHNEIF",
      undefined,
      1,
    );

    expect(resolved).toBe(id);
  });

  it("name-only exact match ignores letter case (exact-modulo-case, still never substring)", () => {
    const id = seedClient(db, "AMIR SHNEIF", "76698748");

    expect(resolveSessionClientForCheckout("amir shneif", undefined, 1)).toBe(
      id,
    );
    // Substring of the same name must still NOT match.
    expect(
      resolveSessionClientForCheckout("amir shnei", undefined, 1),
    ).toBeUndefined();
  });

  it("unknown name+phone registers the client (with its CLIENT_CREATED row)", () => {
    seedClient(db, "AMIR SHNEIF", "76698748"); // must not be picked

    const resolved = resolveSessionClientForCheckout(
      "amir halabi",
      "81077357",
      7,
    );

    expect(resolved).toBeDefined();
    const row = db
      .prepare(`SELECT full_name, phone_number FROM clients WHERE id = ?`)
      .get(resolved) as { full_name: string; phone_number: string };
    expect(row).toEqual({ full_name: "amir halabi", phone_number: "81077357" });

    const audit = db
      .prepare(
        `SELECT user_id FROM transactions
          WHERE type = 'CLIENT_CREATED' AND source_table = 'clients' AND source_id = ?`,
      )
      .get(resolved) as { user_id: number } | undefined;
    expect(audit?.user_id).toBe(7);
  });

  it("a phone owned by an existing client resolves to that client — no duplicate", () => {
    const owner = seedClient(db, "amir halabi", "81077357");
    const before = db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as {
      n: number;
    };

    // Same phone typed under a different spelling: phone is the identity key.
    const resolved = resolveSessionClientForCheckout(
      "Amir El Halabi",
      "81077357",
      1,
    );

    expect(resolved).toBe(owner);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
  });

  it("a session without a customer name resolves to no client", () => {
    expect(
      resolveSessionClientForCheckout(undefined, "81077357", 1),
    ).toBeUndefined();
    expect(
      resolveSessionClientForCheckout("   ", "81077357", 1),
    ).toBeUndefined();
  });
});
