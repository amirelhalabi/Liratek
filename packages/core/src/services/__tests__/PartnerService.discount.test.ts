/**
 * CQ-10 — Partner ledger discounts / write-offs.
 *
 * A partner FOR_% obligation (partner owes the shop) can be settled part
 * cash + part FORGIVEN ("owed X, paid Y, discount Z"), bundled with
 * PartnerService.settle's `discount` param or posted standalone
 * (PartnerService.writeOff). The DISCOUNT ledger row MUST apply
 * applySettlementCoverage exactly like a SETTLEMENT row — otherwise the
 * FOR_% obligation stays "partner-pending" forever even though it's fully
 * accounted for (cash + forgiveness).
 *
 * partner_ledger is one-currency-per-row (unlike debt_ledger/supplier_ledger,
 * which have both amount_usd/amount_lbp columns), so both settle() and
 * writeOff() reject a discount that supplies BOTH currencies at once —
 * covered separately below.
 */

import Database from "better-sqlite3";
import { PartnerRepository } from "../../repositories/PartnerRepository";
import { PartnerService } from "../PartnerService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { counterpartyMetadataSchema } from "../../validators/counterparty";

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
    INSERT INTO partners (id, name) VALUES (1, 'Discount Partner');

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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);
  return db;
}

function ledgerBalanceUsd(db: Database.Database, partnerId: number) {
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

function forPosRow(db: Database.Database, partnerId: number) {
  return db
    .prepare(
      `SELECT amount, covered_amount FROM partner_ledger
       WHERE partner_id = ? AND transaction_type = 'FOR_POS'`,
    )
    .get(partnerId) as { amount: number; covered_amount: number };
}

function discountTxn(db: Database.Database) {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' ORDER BY id DESC LIMIT 1`,
    )
    .get() as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
    status: string;
  };
}

function drawerBalance(db: Database.Database, drawer: string, ccy: string) {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Seed a FOR_POS row: the partner owes the shop (DEBIT) — a for-partner
 *  sale margin, deferred until the partner settles (PFT-6). */
function seedForPos(db: Database.Database, partnerId: number, amount: number) {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

describe("CQ-10 — PartnerService discount/write-off", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let service: PartnerService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new PartnerRepository();
    service = new PartnerService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  describe("bundled with a settlement (owed $100, paid $60, discount $40)", () => {
    beforeEach(() => {
      seedForPos(db, 1, 100);
    });

    it("nets the partner's USD ledger to exactly 0", () => {
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
    });

    it("fully covers the FOR_POS row — the recognition gate (notPartnerPending) opens", () => {
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 40, amount_lbp: 0 },
      });
      const row = forPosRow(db, 1);
      expect(row.covered_amount).toBeGreaterThanOrEqual(row.amount - 0.005);
    });

    it("posts ONE COUNTERPARTY_DISCOUNT transaction: amount 0, profit = -discount, valid counterparty metadata", () => {
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      const txn = discountTxn(db);
      expect(txn.amount_usd).toBe(0);
      expect(txn.amount_lbp).toBe(0);
      expect(txn.profit_usd).toBeCloseTo(-40, 2);
      expect(txn.status).toBe("ACTIVE");

      const meta = JSON.parse(txn.metadata_json);
      const parsed = counterpartyMetadataSchema.parse(meta.counterparty);
      expect(parsed.kind).toBe("partner");
      expect(parsed.flow).toBe("IN");
      expect(parsed.discount?.amount_usd).toBeCloseTo(40, 2);
    });

    it("moves the drawer ONLY by the cash part ($60), never the discount", () => {
      service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 40, amount_lbp: 0 },
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(60, 2);
    });

    it("rejects a discount that supplies BOTH currencies at once", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 60,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          discount: { amount_usd: 10, amount_lbp: 10000 },
        }),
      ).toThrow(/one currency at a time/i);
    });

    // Audit finding (post-implementation review): settlement amount and the
    // bundled discount are two separate ledger rows in the SAME direction —
    // without a combined check, a caller could settle $60 + forgive $50 on a
    // $100 balance, forgiving $10 that was never owed. Proven failing-first:
    // temporarily removed the combined guard in PartnerService.settle — this
    // test went red (no throw, ledger overshot by -10) — then restored it.
    it("rejects a settlement + discount whose combined total exceeds the outstanding balance", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 60,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          discount: { amount_usd: 50, amount_lbp: 0 },
        }),
      ).toThrow(/exceeds the outstanding balance/i);
      // Nothing was written — the FOR_POS row is untouched.
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
      const row = forPosRow(db, 1);
      expect(row.covered_amount).toBeCloseTo(0, 2);
    });
  });

  describe("standalone write-off", () => {
    it("posts a 'DISCOUNT' ledger row (CREDIT) + COUNTERPARTY_DISCOUNT txn, and covers an outstanding FOR_% row", () => {
      seedForPos(db, 1, 25);
      const result = service.writeOff({
        partnerId: 1,
        amount_usd: 25,
        amount_lbp: 0,
        reason: "full forgiveness",
        userId: 1,
      });
      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const discountRow = db
        .prepare(
          `SELECT direction, amount FROM partner_ledger WHERE partner_id = 1 AND transaction_type = 'DISCOUNT'`,
        )
        .get() as { direction: string; amount: number };
      expect(discountRow.direction).toBe("CREDIT");
      expect(discountRow.amount).toBeCloseTo(25, 2);

      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);

      const row = forPosRow(db, 1);
      expect(row.covered_amount).toBeGreaterThanOrEqual(row.amount - 0.005);

      // No cash moved by a pure write-off.
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(0, 2);
    });

    it("rejects a write-off that exceeds the outstanding balance", () => {
      seedForPos(db, 1, 30);
      const result = service.writeOff({
        partnerId: 1,
        amount_usd: 30.5,
        amount_lbp: 0,
        userId: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exceeds/i);
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(30, 2);
    });

    it("rejects a write-off supplying both currencies at once", () => {
      seedForPos(db, 1, 30);
      const result = service.writeOff({
        partnerId: 1,
        amount_usd: 10,
        amount_lbp: 10000,
        userId: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/one currency at a time/i);
    });

    it("rejects a write-off with no amount", () => {
      const result = service.writeOff({
        partnerId: 1,
        amount_usd: 0,
        amount_lbp: 0,
        userId: 1,
      });
      expect(result.success).toBe(false);
    });
  });
});
