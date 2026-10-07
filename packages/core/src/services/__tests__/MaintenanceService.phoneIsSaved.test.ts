/**
 * Maintenance — "the phone field is what gets saved" (owner decision
 * 2026-10-06).
 *
 *  - A client picked from the client search links by its `client_id`.
 *  - Nothing picked, the typed phone belongs to an existing client → link
 *    THAT client, matched by phone (normalised with the save schema's own
 *    normaliser), never by name.
 *  - Nothing picked, a phone nobody has → a NEW client with the typed name
 *    and phone. A typed phone is never dropped.
 *  - Name only, no phone → walk-in: no link, name kept on the job (LIRA-246c).
 *  - Re-save (LIRA-263): untouched client fields keep the link; a changed
 *    phone re-resolves by the new phone.
 *
 * The clients table carries the production `UNIQUE (tenant_id, phone_number)`
 * constraint (electron-app/create_db.sql) so a duplicate insert fails here the
 * way it fails in the shop. Every payload is parsed through
 * `saveMaintenanceJobSchema` first, exactly as both transports do.
 *
 * Rule 17: written before the fix and run against the unfixed code — see the
 * per-test notes for which cases failed and how.
 */

import Database from "better-sqlite3";
import { MaintenanceService } from "../MaintenanceService";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, tenant_id INTEGER DEFAULT 1, role TEXT);
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, phone_number)
    );

    CREATE TABLE maintenance (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      device_name TEXT NOT NULL,
      issue_description TEXT,
      cost_usd REAL DEFAULT 0,
      price_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate REAL,
      status TEXT DEFAULT 'Received',
      paid_by TEXT DEFAULT 'CASH',
      note TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    ,
  parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
);

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Needed by maintenancePartsStock.restoreMaintenanceJobParts / syncParts,
    -- which prepare a statement against this table even with an empty parts
    -- list (better-sqlite3 validates referenced tables at prepare() time).
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
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
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0,    CURRENT_TIMESTAMP);
  `);
  return db;
}

import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import type { SaveJobParams } from "../MaintenanceService";

describe("MaintenanceService.saveJob — the typed phone decides the client", () => {
  let db: Database.Database;
  let service: MaintenanceService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    service = new MaintenanceService(new MaintenanceRepository());
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  const seedClient = (name: string, phone: string | null): number =>
    Number(
      db
        .prepare(`INSERT INTO clients (full_name, phone_number) VALUES (?, ?)`)
        .run(name, phone).lastInsertRowid,
    );

  /** Zod-parse (both transports), then saveJob. */
  const save = (fields: Record<string, unknown>): number => {
    const parsed = saveMaintenanceJobSchema.parse({
      device_name: "iPhone 13",
      issue_description: "screen",
      cost_usd: 10,
      price_usd: 50,
      final_amount_usd: 50,
      currency: "USD",
      status: "Received",
      ...fields,
    });
    const res = service.saveJob(parsed as SaveJobParams, 1);
    expect(res).toEqual(expect.objectContaining({ success: true }));
    return res.id!;
  };

  const jobClient = (id: number) =>
    db
      .prepare(`SELECT client_id, client_name FROM maintenance WHERE id = ?`)
      .get(id) as { client_id: number | null; client_name: string | null };

  const clientCount = () =>
    (db.prepare(`SELECT COUNT(*) AS c FROM clients`).get() as { c: number }).c;

  const clientRow = (id: number) =>
    db
      .prepare(`SELECT full_name, phone_number FROM clients WHERE id = ?`)
      .get(id) as { full_name: string; phone_number: string | null };

  // Regression guard (passes on the pre-fix code too — not proven failing-first).
  it("a client picked from the search links by its id, phone filled from that client", () => {
    const picked = seedClient("Rami Haddad", "03123456");
    const id = save({
      client_id: picked,
      client_name: "Rami Haddad",
      client_phone: "03123456",
    });
    expect(jobClient(id).client_id).toBe(picked);
    expect(clientCount()).toBe(1);
  });

  // Failing-first: pre-fix matched by NAME only, found nobody called
  // "Rami Hadad", and inserted a duplicate client with the same line.
  it("a typed phone that belongs to an existing client links THAT client, even with a typo'd name (formats differ)", () => {
    const existing = seedClient("Rami Haddad", "03 123 456");
    const id = save({
      client_name: "Rami Hadad",
      client_phone: "+961 3 123 456",
    });
    expect(jobClient(id).client_id).toBe(existing);
    expect(jobClient(id).client_name).toBe("Rami Hadad");
    expect(clientCount()).toBe(1);
  });

  // Failing-first: pre-fix tried to INSERT the same normalised phone, hit the
  // UNIQUE constraint, swallowed the error and left the job UNLINKED.
  it("a typed phone identical to an existing client's stored phone links that client under a different name", () => {
    const existing = seedClient("Nadine K", "03123456");
    const id = save({
      client_name: "Nadine Khoury",
      client_phone: "03 123 456",
    });
    expect(jobClient(id).client_id).toBe(existing);
    expect(clientCount()).toBe(1);
  });

  // Regression guard (passes on the pre-fix code too — not proven failing-first).
  it("a phone nobody has creates a new client with the typed name and phone", () => {
    seedClient("Someone", "70000000");
    const id = save({ client_name: "Jana Saad", client_phone: "71 222 333" });
    const linked = jobClient(id).client_id;
    expect(linked).not.toBeNull();
    expect(clientRow(linked!)).toEqual({
      full_name: "Jana Saad",
      phone_number: "71222333",
    });
    expect(clientCount()).toBe(2);
  });

  // Failing-first: pre-fix name-matched the OLD client and dropped the phone.
  it("same name + a different phone creates a NEW client, not the old one", () => {
    const old = seedClient("Ali Hassan", "70111222");
    const id = save({ client_name: "Ali Hassan", client_phone: "76 999 888" });
    const linked = jobClient(id).client_id;
    expect(linked).not.toBeNull();
    expect(linked).not.toBe(old);
    expect(clientRow(linked!)).toEqual({
      full_name: "Ali Hassan",
      phone_number: "76999888",
    });
  });

  // Regression guard (passes on the pre-fix code too — not proven failing-first).
  it("a name only (no phone) stays a walk-in: no link, no client created", () => {
    seedClient("Walk-in Sami", "70555666");
    const id = save({ client_name: "Walk-in Sami", client_phone: "" });
    expect(jobClient(id)).toEqual({
      client_id: null,
      client_name: "Walk-in Sami",
    });
    expect(clientCount()).toBe(1);
  });

  // Failing-first: pre-fix required a name before looking anything up.
  it("a phone with no name links the existing client that owns it", () => {
    const existing = seedClient("Maya F", "03 444 555");
    const id = save({ client_name: "", client_phone: "03444555" });
    expect(jobClient(id).client_id).toBe(existing);
    expect(clientCount()).toBe(1);
  });

  describe("re-save of an existing job (LIRA-263)", () => {
    // Regression guard (passes on the pre-fix code too — not proven failing-first).
    it("untouched client fields (phone sent blank, same name) keep the existing link", () => {
      const a = seedClient("Rami Haddad", "03123456");
      const id = save({
        client_id: a,
        client_name: "Rami Haddad",
        client_phone: "03123456",
      });
      save({
        id,
        client_name: "Rami Haddad",
        client_phone: "",
        status: "In_Progress",
      });
      expect(jobClient(id).client_id).toBe(a);
      expect(clientCount()).toBe(1);
    });

    // Failing-first: pre-fix kept the old link because the NAME was unchanged.
    it("a changed phone that belongs to another client re-links the job to that client", () => {
      const a = seedClient("Rami Haddad", "03123456");
      const b = seedClient("Rami H. (brother)", "70 123 123");
      const id = save({
        client_id: a,
        client_name: "Rami Haddad",
        client_phone: "03123456",
      });
      save({ id, client_name: "Rami Haddad", client_phone: "70123123" });
      expect(jobClient(id).client_id).toBe(b);
      expect(clientCount()).toBe(2);
    });

    // Failing-first: pre-fix kept the old link and dropped the new phone.
    it("a changed phone nobody has creates a new client with that phone", () => {
      const a = seedClient("Rami Haddad", "03123456");
      const id = save({
        client_id: a,
        client_name: "Rami Haddad",
        client_phone: "03123456",
      });
      save({ id, client_name: "Rami Haddad", client_phone: "81 765 432" });
      const linked = jobClient(id).client_id;
      expect(linked).not.toBe(a);
      expect(clientRow(linked!)).toEqual({
        full_name: "Rami Haddad",
        phone_number: "81765432",
      });
    });

    // Regression guard: the reopened job's phone re-sent unchanged (but in the
    // client's stored free-text format) resolves back to the same client.
    it("re-sending the linked client's own phone in another format keeps the link", () => {
      const a = seedClient("Rami Haddad", "03 123 456");
      const id = save({
        client_id: a,
        client_name: "Rami Haddad",
        client_phone: "03123456",
      });
      save({ id, client_name: "Rami Haddad", client_phone: "+961 3 123 456" });
      expect(jobClient(id).client_id).toBe(a);
      expect(clientCount()).toBe(1);
    });
  });

  describe("phone typed with no name and nobody has it — kept on the job (owner decision 2026-10-06)", () => {
    const storedJobPhone = (id: number) =>
      (
        db
          .prepare(`SELECT client_phone FROM maintenance WHERE id = ?`)
          .get(id) as { client_phone: string | null }
      ).client_phone;
    const listedPhone = (id: number) =>
      (
        service.getJobs().find((j) => j.id === id) as {
          client_phone?: string | null;
        }
      ).client_phone;

    // Failing-first: pre-fix stored the phone nowhere.
    it("new job: the normalised phone is saved on the job, no client is created, reopen shows it", () => {
      const id = save({ client_name: "", client_phone: "03 999 888" });
      expect(jobClient(id).client_id).toBeNull();
      expect(clientCount()).toBe(0);
      expect(storedJobPhone(id)).toBe("03999888");
      expect(listedPhone(id)).toBe("03999888");
    });

    // Failing-first: pre-fix dropped the new phone (and the link).
    it("re-save: a changed phone nobody has, with no name, is kept on the job", () => {
      const a = seedClient("Rami Haddad", "03123456");
      const id = save({
        client_id: a,
        client_name: "Rami Haddad",
        client_phone: "03123456",
      });
      save({ id, client_name: "", client_phone: "71 444 333" });
      expect(jobClient(id).client_id).toBeNull();
      expect(clientCount()).toBe(1);
      expect(storedJobPhone(id)).toBe("71444333");
      expect(listedPhone(id)).toBe("71444333");
    });

    // Failing-first: pre-fix had no job phone to keep.
    it("an untouched re-save (phone sent blank, same name) keeps the job's own phone", () => {
      const id = save({ client_name: "", client_phone: "03 999 888" });
      save({ id, client_name: "", client_phone: "", status: "In_Progress" });
      expect(storedJobPhone(id)).toBe("03999888");
      expect(listedPhone(id)).toBe("03999888");
    });

    // Regression guard for LIRA-263's reopen (passes pre-fix): a linked job
    // with no phone of its own still lists the client's stored phone.
    it("a linked job with no phone of its own still lists the client's phone", () => {
      const a = seedClient("Nadine K", "03/123456");
      const id = save({
        client_id: a,
        client_name: "Nadine K",
        client_phone: "",
      });
      expect(listedPhone(id)).toBe("03/123456");
    });
  });
});
