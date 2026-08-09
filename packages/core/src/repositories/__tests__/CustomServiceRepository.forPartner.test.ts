/**
 * CustomServiceRepository — LIRA-081 "For Partner" tests
 *
 * The FULL price collection from a walk-in customer is diverted to the
 * partner's tab — booked per currency component (custom services can carry
 * BOTH a USD and an LBP price simultaneously, unlike a single-currency
 * recharge). The shop's own cost is a profit input only — it must NOT move
 * cash (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC, 2026-08-09):
 * unlike FOR_RECHARGE/FOR_IPICK/FOR_KATSH, which still post a real cost
 * outflow, Custom Services stopped doing that — it was the outlier the plan
 * exists to fix.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ─────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

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
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose: _cancelDebt (run by every void/refund, via
    -- deleteService -> voidTransaction) queries this table unconditionally
    -- with no existence check. A for-partner service never books client
    -- debt, but the table must exist.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedPartner(db: Database.Database, name = "Service Partner"): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
    .run(name);
  return Number(res.lastInsertRowid);
}

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("CustomServiceRepository.createService() — for-partner (LIRA-081)", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("does NOT post the cost outflow — cost is profit-only — and books the FULL price to the partner's tab (USD only)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Paperwork for partner",
        cost_usd: 2,
        price_usd: 10,
        partnerId,
        partnerMode: "FOR",
      } as any,
      1,
    );

    expect(result.success).toBe(true);

    // §2 FINAL SPEC: cost never moves cash, even though cost_usd=2.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    // No price collected from a walk-in customer.
    expect(balance(db, "General", "LBP")).toBeCloseTo(0, 2);

    // Exactly one partner_ledger row: FOR_CUSTOM_SERVICE DEBIT for the price.
    const entries = db
      .prepare("SELECT * FROM partner_ledger WHERE partner_id = ?")
      .all(partnerId) as any[];
    expect(entries).toHaveLength(1);
    expect(entries[0].transaction_type).toBe("FOR_CUSTOM_SERVICE");
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].amount).toBeCloseTo(10, 2);
    expect(entries[0].currency).toBe("USD");
    expect(entries[0].reference_table).toBe("custom_services");

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'CUSTOM_SERVICE'")
      .get() as any;
    expect(txn.profit_usd).toBeCloseTo(8, 2); // price - cost, same as normal
    expect(txn.client_name).toBe("Service Partner [partner]");

    // No payment row was written at all — no cost outflow, no price inflow.
    const payments = db.prepare("SELECT * FROM payments").all() as any[];
    expect(payments).toHaveLength(0);
  });

  it("books BOTH currency components separately when the service has a mixed USD+LBP price", () => {
    const partnerId = seedPartner(db);

    repo.createService(
      {
        description: "Mixed-currency partner job",
        cost_usd: 1,
        cost_lbp: 50_000,
        price_usd: 5,
        price_lbp: 200_000,
        partnerId,
        partnerMode: "FOR",
      } as any,
      1,
    );

    // §2 FINAL SPEC: cost never moves cash — General is untouched despite
    // cost_usd=1 / cost_lbp=50_000.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(0, 0);

    const entries = db
      .prepare(
        "SELECT * FROM partner_ledger WHERE partner_id = ? ORDER BY currency",
      )
      .all(partnerId) as any[];
    expect(entries).toHaveLength(2);
    const lbpEntry = entries.find((e) => e.currency === "LBP");
    const usdEntry = entries.find((e) => e.currency === "USD");
    expect(usdEntry.amount).toBeCloseTo(5, 2);
    expect(lbpEntry.amount).toBeCloseTo(200_000, 0);
    expect(usdEntry.transaction_type).toBe("FOR_CUSTOM_SERVICE");
    expect(lbpEntry.transaction_type).toBe("FOR_CUSTOM_SERVICE");
  });

  it("rejects a for-partner service with no partnerId", () => {
    const result = repo.createService(
      {
        description: "Missing partner",
        price_usd: 10,
        partnerMode: "FOR",
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/partnerId is required/);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM custom_services").get() as any).c,
    ).toBe(0);
  });

  it("rejects a for-partner service carrying a leaked payment leg (defense in depth)", () => {
    const partnerId = seedPartner(db);

    const result = repo.createService(
      {
        description: "Leaked leg",
        price_usd: 10,
        partnerId,
        partnerMode: "FOR",
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      } as any,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no counter payment/i);
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);
  });

  it("voiding a for-partner service leaves General untouched (no cost outflow to reverse) and nets the partner ledger to 0", () => {
    const partnerId = seedPartner(db);

    repo.createService(
      {
        description: "Void me",
        cost_usd: 2,
        price_usd: 10,
        partnerId,
        partnerMode: "FOR",
      } as any,
      1,
    );

    // §2 FINAL SPEC: nothing was ever posted to General for the cost.
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);

    const serviceId = (
      db.prepare("SELECT id FROM custom_services").get() as any
    ).id;

    const result = repo.deleteService(serviceId);
    expect(result.success).toBe(true);

    // Nothing to reverse — General stays at 0 (trivially net-to-0).
    expect(balance(db, "General", "USD")).toBeCloseTo(0, 2);

    // Partner ledger nets to 0 for this service (DEBIT 10 + CREDIT 10).
    const rows = db
      .prepare(
        "SELECT direction, amount, currency FROM partner_ledger WHERE partner_id = ?",
      )
      .all(partnerId) as any[];
    expect(rows).toHaveLength(2);
    const net = rows.reduce(
      (sum, r) => sum + (r.direction === "DEBIT" ? r.amount : -r.amount),
      0,
    );
    expect(net).toBeCloseTo(0, 2);
  });
});
