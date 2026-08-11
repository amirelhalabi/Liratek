/**
 * RechargeRepository — transactions.exchange_rate stamps the tendered rate
 * (owner decision, 2026-08-08)
 *
 * Same owner decision as FinancialServiceRepository.stampedExchangeRate.test.ts:
 * the STAMP should reflect what the operator actually tendered
 * (`data.tender_exchange_rate`) when it's within `TENDER_RATE_BAND_PCT`
 * (±10%) of the server sell rate — the reconciliation anchor itself is
 * unaffected; see RechargeRepository.legReconciliation.test.ts for the
 * band-reject/reconcile proofs, which stay green and untouched.
 *
 * Covers BOTH call sites that stamp `transactions.exchange_rate` in this
 * repository: the main SEND method (processRecharge, CREDIT_TRANSFER type)
 * and processCreditBuyback.
 */

import Database from "better-sqlite3";
import {
  RechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetDebtService } from "../../services/DebtService";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

function lastTransactionExchangeRate(db: Database.Database): number {
  const row = db
    .prepare(`SELECT exchange_rate FROM transactions ORDER BY id DESC LIMIT 1`)
    .get() as { exchange_rate: number };
  return row.exchange_rate;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The SEND method (processRecharge, CREDIT_TRANSFER) — mirrors
//    RechargeRepository.legReconciliation.test.ts's schema.
// ═══════════════════════════════════════════════════════════════════════════
describe("RechargeRepository — SEND stamps the tendered rate", () => {
  let db: Database.Database;
  let repo: RechargeRepository;

  function createSendTestDb(): Database.Database {
    const d = new Database(":memory:");
    d.exec(`
      CREATE TABLE recharges (
        tenant_id INTEGER DEFAULT 1,
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        carrier                TEXT NOT NULL,
        recharge_type          TEXT NOT NULL,
        amount                 REAL NOT NULL,
        cost                   REAL NOT NULL DEFAULT 0,
        price                  REAL NOT NULL DEFAULT 0,
        default_price_to_client REAL,
        currency_code          TEXT DEFAULT 'USD',
        paid_by                TEXT DEFAULT 'CASH',
        phone_number           TEXT,
        client_id              INTEGER,
        client_name            TEXT,
        note                   TEXT,
        created_by             INTEGER DEFAULT 1,
        created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
        edited_by              TEXT,
        edited_at              TEXT
      , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

      CREATE TABLE transactions (
        tenant_id INTEGER DEFAULT 1,
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        type         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'ACTIVE',
        source_table TEXT NOT NULL,
        source_id    INTEGER NOT NULL,
        user_id      INTEGER NOT NULL DEFAULT 1,
        amount_usd   REAL NOT NULL DEFAULT 0,
        amount_lbp   REAL NOT NULL DEFAULT 0,
        exchange_rate REAL,
        client_id    INTEGER,
        client_name  TEXT,
        client_phone TEXT,
        reverses_id  INTEGER,
        profit_usd   REAL NOT NULL DEFAULT 0,
        profit_lbp   REAL NOT NULL DEFAULT 0,
        summary      TEXT,
        metadata_json TEXT,
        device_id    TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE payments (
        tenant_id INTEGER DEFAULT 1,
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER,
        session_id     INTEGER,
        method         TEXT NOT NULL,
        drawer_name    TEXT NOT NULL,
        currency_code  TEXT NOT NULL,
        amount         REAL NOT NULL,
        note           TEXT,
        created_by     INTEGER,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE drawer_balances (
        tenant_id INTEGER DEFAULT 1,
        drawer_name   TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        balance       REAL NOT NULL DEFAULT 0,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, drawer_name, currency_code)
      );

      CREATE TABLE clients (
        tenant_id INTEGER DEFAULT 1,
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name    TEXT NOT NULL,
        phone_number TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE debt_ledger (
        tenant_id INTEGER DEFAULT 1,
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id        INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        amount_usd       REAL NOT NULL DEFAULT 0,
        amount_lbp       REAL NOT NULL DEFAULT 0,
        transaction_id   INTEGER,
        note             TEXT,
        due_date         TEXT,
        created_by       INTEGER,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

      CREATE TABLE exchange_rates (
        to_code    TEXT,
        sell_rate  REAL,
        market_rate REAL
      );
      INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);

      INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
      INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
      INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
      INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);
    `);
    return d;
  }

  beforeEach(() => {
    db = createSendTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("owner repro: MTC CREDIT_TRANSFER, server sell rate 90,000, tender_exchange_rate 89,000 — stamps 89,000, not 90,000", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000099",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      tender_exchange_rate: 89_000,
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lastTransactionExchangeRate(db)).toBe(89000);
  });

  it("out-of-band tender (40,000 vs. server 90,000) still stamps the server rate (90,000) — via deferPayment, isolating the stamp from the (unmodified) reconciliation hard-reject", () => {
    // A raw out-of-band tender_exchange_rate would also fail the (unmodified)
    // leg-reconciliation hard-reject if reconciliation actually ran (see
    // RechargeRepository.legReconciliation.test.ts's "REJECTS a
    // tender_exchange_rate outside the ±10% band" case) — deferPayment skips
    // that check entirely, isolating the STAMP's own silent-fallback behavior.
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000098",
      deferPayment: true,
      tender_exchange_rate: 40_000,
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lastTransactionExchangeRate(db)).toBe(90000);
  });

  it("no tender_exchange_rate at all: stamps the server rate exactly as before (backward compatible)", () => {
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5.0,
      price: 6.0,
      currency: "USD",
      phoneNumber: "03000097",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lastTransactionExchangeRate(db)).toBe(90000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. processCreditBuyback — mirrors
//    RechargeRepository.creditBuyback.test.ts's schema/setup.
// ═══════════════════════════════════════════════════════════════════════════
describe("RechargeRepository — processCreditBuyback stamps the tendered rate", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let lineRepo: CarrierLineRepository;
  const FUTURE_EXPIRY = "2099-01-01";

  function createBuybackTestDb(): Database.Database {
    const d = new Database(":memory:");
    d.exec(`
      CREATE TABLE recharges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        carrier TEXT NOT NULL,
        recharge_type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        default_price_to_client REAL,
        currency_code TEXT NOT NULL DEFAULT 'USD',
        paid_by TEXT,
        phone_number TEXT,
        client_id INTEGER,
        client_name TEXT,
        note TEXT,
        created_by INTEGER DEFAULT 1,
        edited_by TEXT,
        edited_at DATETIME,
        is_refunded INTEGER DEFAULT 0,
        refunded_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        full_name TEXT NOT NULL,
        phone_number TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE carrier_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        carrier TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
        phone_number TEXT NOT NULL,
        label TEXT,
        credits REAL NOT NULL DEFAULT 0,
        validity_expires_at TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
        ON carrier_lines(tenant_id, carrier)
        WHERE is_primary = 1;

      CREATE TABLE carrier_line_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        carrier_line_id INTEGER NOT NULL,
        transaction_id INTEGER,
        credits_delta REAL NOT NULL DEFAULT 0,
        validity_days_delta INTEGER NOT NULL DEFAULT 0,
        previous_validity_expires_at TEXT,
        reason TEXT NOT NULL,
        is_reversed INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        source_table TEXT,
        source_id INTEGER,
        user_id INTEGER,
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_lbp REAL NOT NULL DEFAULT 0,
        profit_usd REAL NOT NULL DEFAULT 0,
        profit_lbp REAL NOT NULL DEFAULT 0,
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
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

      CREATE TABLE debt_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        client_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_lbp REAL NOT NULL DEFAULT 0,
        transaction_id INTEGER,
        session_id INTEGER,
        note TEXT,
        due_date TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

      CREATE TABLE exchange_rates (
        to_code    TEXT,
        sell_rate  REAL,
        market_rate REAL
      );
      INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);
    `);
    return d;
  }

  function seedDrawer(
    d: Database.Database,
    drawer: string,
    currency: string,
    amount: number,
  ): void {
    d.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
    ).run(drawer, currency, amount);
  }

  beforeEach(() => {
    db = createBuybackTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetRechargeRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetDebtService();
    resetTransactionRepository();
    repo = new RechargeRepository();
    lineRepo = new CarrierLineRepository();
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
    resetRechargeRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetDebtService();
    resetTransactionRepository();
  });

  it("owner repro: server sell rate 90,000, tender_exchange_rate 89,000 — stamps 89,000, not 90,000", () => {
    lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });
    seedDrawer(db, "MTC", "USD", 20);
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 9,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 9 }],
      tender_exchange_rate: 89_000,
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lastTransactionExchangeRate(db)).toBe(89000);
  });

  it("out-of-band tender (40,000 vs. server 90,000) is still REJECTED by the (unmodified) reconciliation safety net — processCreditBuyback has no defer/bypass path, so this proves the guard wasn't weakened rather than the stamp's isolated fallback (already proven above and in the FinancialServiceRepository suite via its deferPayment bypass)", () => {
    lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111112",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });
    seedDrawer(db, "MTC", "USD", 20);
    seedDrawer(db, "General", "USD", 500);
    const before = {
      recharges: (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as any)
        .c,
      transactions: (
        db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any
      ).c,
    };

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 9,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 9 }],
      tender_exchange_rate: 40_000,
      userId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the accepted/);
    // Atomic: nothing persisted.
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM recharges`).get() as any).c,
    ).toBe(before.recharges);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any).c,
    ).toBe(before.transactions);
  });

  it("no tender_exchange_rate at all: stamps the server rate exactly as before (backward compatible)", () => {
    lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111113",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });
    seedDrawer(db, "MTC", "USD", 20);
    seedDrawer(db, "General", "USD", 500);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 10,
      cost: 0,
      price: 9,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 9 }],
      userId: 1,
    });

    expect(result.success).toBe(true);
    expect(lastTransactionExchangeRate(db)).toBe(90000);
  });
});
