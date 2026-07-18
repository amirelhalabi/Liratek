/**
 * CQ-11 (part A) — PartnerService.settle() split-leg settlement.
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
 * (2026-07-18)". Partner settlements accept an optional `payments[]` array
 * (e.g. settle $100 as $60 CASH + $40 OMT) so the shared MultiPaymentInput
 * settle modal can be offered on the Partners page. When `payments` is
 * provided it supersedes `settlementMethod` for MONEY MOVEMENT only: ONE
 * partner_ledger SETTLEMENT row, ONE PARTNER_SETTLEMENT transaction, N
 * payments rows (method-accurate drawer routing), N drawer deltas.
 *
 * These guard checks are re-verified at the service layer (not just the
 * Zod schema) because the service can be — and is, in these very tests —
 * called directly, bypassing partnerSettleSchema.
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
  `);
  return db;
}

function seedForPos(db: Database.Database, partnerId: number, amount: number) {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

function ledgerRows(db: Database.Database, partnerId: number, type: string) {
  return db
    .prepare(
      `SELECT * FROM partner_ledger WHERE partner_id = ? AND transaction_type = ?`,
    )
    .all(partnerId, type) as Array<{
    id: number;
    amount: number;
    direction: string;
  }>;
}

function settlementTxns(db: Database.Database) {
  return db
    .prepare(`SELECT * FROM transactions WHERE type = 'PARTNER_SETTLEMENT'`)
    .all() as Array<{
    id: number;
    amount_usd: number;
    amount_lbp: number;
    metadata_json: string;
  }>;
}

function paymentsForTxn(db: Database.Database, txnId: number) {
  return db
    .prepare(`SELECT * FROM payments WHERE transaction_id = ? ORDER BY id ASC`)
    .all(txnId) as Array<{
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }>;
}

function drawerBalance(db: Database.Database, drawer: string, ccy: string) {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("PartnerService.settle() — CQ-11 split payment legs", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let service: PartnerService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as {
        __LIRATEK_TEST_DB__?: Database.Database;
        __LIRATEK_TEST_DB_ALT__?: Database.Database;
      }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new PartnerRepository();
    service = new PartnerService(repo);
    // Partner owes the shop $100 (FOR_POS DEBIT) so a settlement is CREDIT.
    seedForPos(db, 1, 100);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  // ── Rejections (re-checked at the service layer) ─────────────────────────

  describe("rejects malformed legs", () => {
    it("rejects legs that do not sum to the settlement amount", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "USD", amount: 30 },
          ],
        }),
      ).toThrow(/sum to the settlement amount/i);
    });

    it("rejects a leg whose currency_code differs from the settlement currency", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "OMT", currency_code: "LBP", amount: 40 },
          ],
        }),
      ).toThrow(/currency_code must match the settlement currency/i);
    });

    it("rejects a CLIENT_ACCOUNT leg inside payments[]", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 60 },
            { method: "CLIENT_ACCOUNT", currency_code: "USD", amount: 40 },
          ],
        }),
      ).toThrow(/CLIENT_ACCOUNT/);
    });

    it("rejects settlementMethod CLIENT_ACCOUNT combined with payments[]", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CLIENT_ACCOUNT",
          userId: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
        }),
      ).toThrow(/CLIENT_ACCOUNT/);
    });

    it("writes NOTHING when the legs are rejected (no partial ledger/txn rows)", () => {
      expect(() =>
        service.settle({
          partnerId: 1,
          amount: 100,
          currency: "USD",
          settlementMethod: "CASH",
          userId: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        }),
      ).toThrow();
      expect(ledgerRows(db, 1, "SETTLEMENT")).toHaveLength(0);
      expect(settlementTxns(db)).toHaveLength(0);
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path — mixed-method split settlement", () => {
    it("books exactly ONE partner_ledger SETTLEMENT row", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      expect(ledgerRows(db, 1, "SETTLEMENT")).toHaveLength(1);
    });

    it("books exactly ONE PARTNER_SETTLEMENT transaction", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      const txns = settlementTxns(db);
      expect(txns).toHaveLength(1);
      expect(txns[0].amount_usd).toBeCloseTo(100, 2);
    });

    it("books N payments rows — one per leg, method-accurate drawer routing", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      const txnId = settlementTxns(db)[0].id;
      const legs = paymentsForTxn(db, txnId);
      expect(legs).toHaveLength(2);
      expect(legs[0]).toMatchObject({
        method: "CASH",
        drawer_name: "General",
        currency_code: "USD",
        amount: 60,
      });
      expect(legs[1]).toMatchObject({
        method: "OMT",
        drawer_name: "OMT_App",
        currency_code: "USD",
        amount: 40,
      });
    });

    it("applies a drawer delta per leg (CREDIT settlement → positive deltas)", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(60, 2);
      expect(drawerBalance(db, "OMT_App", "USD")).toBeCloseTo(40, 2);
    });

    it("stamps metadata.counterparty.method = 'SPLIT' for mixed-method legs", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      const txn = settlementTxns(db)[0];
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.counterparty.method).toBe("SPLIT");
      expect(meta.settlement_method).toBe("SPLIT");
    });

    it("negative direction (we owe the partner) applies negative drawer deltas per leg", () => {
      // Flip the balance so the shop owes the partner: CREDIT $250 vs the
      // existing $100 DEBIT FOR_POS nets to -150 (we owe $150).
      repo.addLedgerEntry({
        partner_id: 1,
        transaction_type: "ADJUSTMENT",
        amount: 250,
        currency: "USD",
        direction: "CREDIT",
        user_id: 1,
      });
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "OMT", currency_code: "USD", amount: 40 },
        ],
      });
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(-60, 2);
      expect(drawerBalance(db, "OMT_App", "USD")).toBeCloseTo(-40, 2);
    });
  });

  describe("happy path — uniform-method legs", () => {
    it("stamps the real method (not 'SPLIT') when every leg uses the same method", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "CASH", currency_code: "USD", amount: 40 },
        ],
      });
      const txn = settlementTxns(db)[0];
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.counterparty.method).toBe("CASH");
      const txnId = txn.id;
      expect(paymentsForTxn(db, txnId)).toHaveLength(2);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(100, 2);
    });
  });

  describe("happy path — BINANCE leg keeps the USDT drawer-currency override", () => {
    it("routes a BINANCE leg to the Binance/USDT drawer, not General/USD", () => {
      service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "BINANCE", currency_code: "USD", amount: 40 },
        ],
      });
      const txnId = settlementTxns(db)[0].id;
      const legs = paymentsForTxn(db, txnId);
      const binanceLeg = legs.find((l) => l.method === "BINANCE")!;
      expect(binanceLeg.currency_code).toBe("USDT");
      expect(binanceLeg.drawer_name).toBe("Binance");
      expect(drawerBalance(db, "Binance", "USDT")).toBeCloseTo(40, 2);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(60, 2);
    });
  });
});
