/**
 * Shop-day bug (2026-10-16, txn 10943 / partner ledger 78): a partner
 * settlement split across Cash $200 + Whish $100 wrote
 * `partner_ledger.settlement_method = 'CASH'` while its transaction said
 * SPLIT. The page sends the FIRST leg's method as `settlementMethod`
 * (the column's CHECK had no 'SPLIT'), and the service stored it as is.
 *
 * Contract: when payment legs are sent, the ledger row's method is derived
 * from the IN legs — the one method they all use, or 'SPLIT' when they
 * differ — the same value the PARTNER_SETTLEMENT transaction carries. The
 * money movement is unchanged (asserted per leg below). With no legs, the
 * sent `settlementMethod` is kept (CLIENT_ACCOUNT paper settlements).
 *
 * Rule 17: run before the PartnerService change — see fixes.md.
 */

import Database from "better-sqlite3";
import { PartnerRepository } from "../../repositories/PartnerRepository";
import { PartnerService } from "../PartnerService";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id          INTEGER DEFAULT 1,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Split Leg Partner');

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      tenant_id         INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      extra_usd REAL NOT NULL DEFAULT 0,
      extra_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
  `);
  return db;
}

function seedForPos(db: Database.Database, partnerId: number, amount: number) {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

function ledgerMethod(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT settlement_method FROM partner_ledger WHERE transaction_type = 'SETTLEMENT'`,
    )
    .get() as { settlement_method: string | null };
  return row.settlement_method;
}

function txnMethod(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT metadata_json FROM transactions WHERE type = 'PARTNER_SETTLEMENT'`,
    )
    .get() as { metadata_json: string };
  return JSON.parse(row.metadata_json).settlement_method as string;
}

function paidByMethod(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT method, SUM(amount) AS total FROM payments GROUP BY method`,
    )
    .all() as Array<{ method: string; total: number }>;
  return Object.fromEntries(rows.map((r) => [r.method, r.total]));
}

describe("PartnerService.settle — the ledger row records the true method", () => {
  let db: Database.Database;
  let service: PartnerService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    const repo = new PartnerRepository();
    service = new PartnerService(repo);
    // The shop owes the partner $300 (Whish App float top-up via partner).
    repo.addLedgerEntry({
      partner_id: 1,
      transaction_type: "ADJUSTMENT",
      amount: 300,
      currency: "USD",
      direction: "CREDIT",
      user_id: 1,
    });
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  it("Cash $200 + Whish $100 (page sent 'CASH') → ledger 'SPLIT', same as the transaction; money per leg unchanged", () => {
    service.settle({
      partnerId: 1,
      amount: 300,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 200 },
        { method: "WHISH", currency_code: "USD", amount: 100 },
      ],
    });
    expect(ledgerMethod(db)).toBe("SPLIT");
    expect(txnMethod(db)).toBe("SPLIT");
    expect(paidByMethod(db)).toEqual({ CASH: -200, WHISH: -100 });
  });

  it("all legs Whish (page sent 'CASH') → ledger 'WHISH'", () => {
    service.settle({
      partnerId: 1,
      amount: 300,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [
        { method: "WHISH", currency_code: "USD", amount: 250 },
        { method: "WHISH", currency_code: "USD", amount: 50 },
      ],
    });
    expect(ledgerMethod(db)).toBe("WHISH");
    expect(txnMethod(db)).toBe("WHISH");
  });

  it("a change (OUT) leg in another method does not make it a split", () => {
    service.settle({
      partnerId: 1,
      amount: 300,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 320 },
        { method: "WHISH", currency_code: "USD", amount: 20, direction: "OUT" },
      ],
    });
    expect(ledgerMethod(db)).toBe("CASH");
    expect(txnMethod(db)).toBe("CASH");
  });

  it("no legs: the sent method is kept (paper CLIENT_ACCOUNT settlement)", () => {
    service.settle({
      partnerId: 1,
      amount: 300,
      currency: "USD",
      settlementMethod: "CLIENT_ACCOUNT",
      userId: 1,
    });
    expect(ledgerMethod(db)).toBe("CLIENT_ACCOUNT");
    expect(paidByMethod(db)).toEqual({});
  });
});
