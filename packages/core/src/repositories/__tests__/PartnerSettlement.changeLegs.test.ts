/**
 * LIRA-313 (owner decision 2026-10-12) — partner settlement with change.
 *
 * The Partners settle modal showed a "Return / Change" box (pre-filled with
 * the full change as cash handed back) that never reached the server: legs
 * had no `direction`, the page never sent the change, and the full amount
 * was booked as the settlement. A cashier who followed the screen and handed
 * $50 back left the drawer $50 short AND credited the partner $50 that had
 * already been returned. Now:
 *   - a leg may be `direction: "OUT"` (change), moving the drawer opposite to
 *     the settlement;
 *   - `amount` is the NET (IN − OUT), checked by schema AND service;
 *   - change not handed back stays on the partner's balance (crosses zero);
 *   - void nets ledger and drawer to 0 (rule 20 — generic _reversePayments
 *     reverses every payments row, the module reversal the ledger row).
 *
 * Rule 17: written after the fix — not proven failing-first. Not run yet
 * (owner asked for write-only on 2026-10-12).
 */

import Database from "better-sqlite3";
import { partnerSettleSchema } from "../../validators/partner";
import { PartnerRepository } from "../PartnerRepository";
import { PartnerService } from "../../services/PartnerService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";

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
    INSERT INTO partners (id, name) VALUES (1, 'Reversal Partner');

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

    -- Unrelated to this fixture's own scenarios, but _cancelDebt runs
    -- unconditionally on every void/refund (no-op here — no rows ever
    -- match) and needs the table to exist.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 200);
  `);
  return db;
}

function ledgerBalanceUsd(db: Database.Database, partnerId: number): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS net
       FROM partner_ledger WHERE partner_id = ? AND currency = 'USD'`,
    )
    .get(partnerId) as { net: number };
  return row.net;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  ccy = "USD",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function seedForPos(
  db: Database.Database,
  partnerId: number,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

describe("LIRA-313 partner settlement — change legs and overpayment", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let service: PartnerService;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new PartnerRepository();
    service = new PartnerService(repo);
    txnRepo = new TransactionRepository();
    // Partner owes the shop $100.
    seedForPos(db, 1, 100);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  it("partner pays $150 on $100 owed, no change back: we owe the partner $50", () => {
    const before = drawerBalance(db, "General");
    service.settle({
      partnerId: 1,
      amount: 150,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
    });
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(-50, 2);
    expect(drawerBalance(db, "General")).toBeCloseTo(before + 150, 2);
  });

  it("partner pays $150 and we hand back $50: settled exactly, drawer +100", () => {
    const before = drawerBalance(db, "General");
    const input = partnerSettleSchema.parse({
      partnerId: 1,
      amount: 100,
      currency: "USD",
      settlementMethod: "CASH",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 50, direction: "OUT" },
      ],
    });
    // Rule 23 — the schema must KEEP the leg direction (Zod strips unknown
    // keys silently).
    expect(input.payments?.[1].direction).toBe("OUT");
    service.settle({ ...input, userId: 1 });
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
    expect(drawerBalance(db, "General")).toBeCloseTo(before + 100, 2);
  });

  it("we owe the partner $50 and pay $80: the partner now owes us $30", () => {
    // Flip the balance: partner pays $150 on $100 → we owe them $50.
    service.settle({
      partnerId: 1,
      amount: 150,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
    });
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(-50, 2);
    const before = drawerBalance(db, "General");
    service.settle({
      partnerId: 1,
      amount: 80,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 80 }],
    });
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(30, 2);
    expect(drawerBalance(db, "General")).toBeCloseTo(before - 80, 2);
  });

  it("we pay $80 on $50 owed and the partner hands $30 back: settled, drawer −50", () => {
    service.settle({
      partnerId: 1,
      amount: 150,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
    });
    const before = drawerBalance(db, "General");
    service.settle({
      partnerId: 1,
      amount: 50,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 80 },
        { method: "CASH", currency_code: "USD", amount: 30, direction: "OUT" },
      ],
    });
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
    expect(drawerBalance(db, "General")).toBeCloseTo(before - 50, 2);
  });

  it("void of a settlement with change nets ledger and drawer to 0 (rule 20)", () => {
    const ledgerBefore = ledgerBalanceUsd(db, 1);
    const drawerBefore = drawerBalance(db, "General");
    const entry = service.settle({
      partnerId: 1,
      amount: 120,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 30, direction: "OUT" },
      ],
    });
    const txn = txnRepo.getBySourceId("partner_ledger", entry.id)!;
    txnRepo.voidTransaction(txn.id, 1);
    expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(ledgerBefore, 2);
    expect(drawerBalance(db, "General")).toBeCloseTo(drawerBefore, 2);
  });

  it("rejects legs whose net (paid − change) is not the amount", () => {
    expect(() =>
      service.settle({
        partnerId: 1,
        amount: 150,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 150 },
          {
            method: "CASH",
            currency_code: "USD",
            amount: 50,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/sum to the settlement amount/i);
  });

  it("rejects change only, with no paid leg", () => {
    expect(() =>
      service.settle({
        partnerId: 1,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          {
            method: "CASH",
            currency_code: "USD",
            amount: 50,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/not only change/i);
  });
});
