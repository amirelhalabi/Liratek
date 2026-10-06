/**
 * RechargeRepository.getTodayStats — LIRA-250 follow-up.
 *
 * The Recharge page's MTC/Alfa Count/Profit cards were switched (earlier in
 * this ticket) to read `rechargeHistory` (`RechargeRepository.getHistory`,
 * `LIMIT 100`, no type/refund filter) instead of `finTransactions`
 * (`financial_services`, which never holds a recharge row). That made the
 * cards non-zero, but it now counts the WRONG rows: refunded/voided
 * recharges, TOP_UP drawer moves, and CREDIT_BUYBACK payouts all rode along,
 * and "commission" was `price - cost` rather than the transaction's actually
 * stamped profit.
 *
 * `getTodayStats` fixes this by reusing the EXACT join/gates
 * `ProfitRepository.getRechargesByCarrier`/`getRechargesByCurrency` already
 * use for the Profits page's own recharge figures — `t.type = 'RECHARGE'`
 * (excludes TOP_UP/CREDIT_BUYBACK, which stamp `RECHARGE_TOPUP`/
 * `TELECOM_CREDIT_BUYBACK`), `notRefunded(r)`, `notDebtPending(t.id)` — with
 * "today" via `isToday` (rule 27) instead of an explicit date-range pair.
 *
 * Real writers throughout (rule 17's spirit — every fixture is created via
 * the actual repository method a real recharge/top-up/buy-back flow uses,
 * not a hand INSERT): `RechargeRepository.processRecharge` (sale + credit
 * buy-back), `RechargeRepository.topUpApp` (drawer top-up),
 * `TransactionRepository.voidTransaction` (refund). Schema copied from
 * `RechargeRepository.sms_cost.test.ts` (already proven to exercise
 * processRecharge's normal sale body + voidTransaction against this exact
 * table set) and `RechargeRepository.creditBuyback.test.ts` (proven for
 * processCreditBuyback's primary-carrier-line requirement).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import { RechargeService } from "../../services/RechargeService";
import { ProfitRepository } from "../ProfitRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (shared by every repo/service singleton) ────────────

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

// ─── Mock DebtService (not exercised — every fixture is cash-only) ──────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — same shape as RechargeRepository.sms_cost.test.ts
//     (proven for processRecharge's normal sale body + voidTransaction)
//     plus a `financial_services`/`sales` no-op table set voidTransaction's
//     generic machinery may probe. ──────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
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
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa', 'mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_carrier_lines_carrier ON carrier_lines(carrier);
    CREATE INDEX idx_carrier_lines_tenant_id ON carrier_lines(tenant_id);
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE expenses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      description       TEXT,
      category          TEXT,
      expense_type      TEXT,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      paid_by_method    TEXT DEFAULT 'CASH',
      status            TEXT NOT NULL DEFAULT 'active',
      expense_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
      note              TEXT DEFAULT NULL,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      source_ref_table  TEXT DEFAULT NULL,
      source_ref_id     INTEGER DEFAULT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_line_movements (
      id                           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                    INTEGER DEFAULT 1,
      carrier_line_id              INTEGER NOT NULL,
      transaction_id               INTEGER,
      credits_delta                REAL NOT NULL DEFAULT 0,
      validity_days_delta          INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      days_owed_delta              INTEGER NOT NULL DEFAULT 0,
      previous_days_owed           INTEGER NOT NULL DEFAULT 0,
      reason                       TEXT NOT NULL,
      is_reversed                  INTEGER NOT NULL DEFAULT 0,
      created_at                   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_carrier_line_movements_tenant_id ON carrier_line_movements(tenant_id);
    CREATE INDEX idx_carrier_line_movements_carrier_line_id ON carrier_line_movements(carrier_line_id);
    CREATE INDEX idx_carrier_line_movements_transaction_id ON carrier_line_movements(transaction_id);

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'MTC',     'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 500000000, CURRENT_TIMESTAMP);

    -- Void-path support tables — present so TransactionRepository's generic
    -- void/refund queries against them don't fail with "no such table"
    -- (same convention as RechargeRepository.sms_cost.test.ts, which already
    -- voids a plain RECHARGE transaction against this exact table set).
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
    -- LIRA-258 / G17: read by notDebtPending's session-basket arm.
    CREATE TABLE IF NOT EXISTS customer_session_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      paid_exchange_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- ProfitRepository.getRechargesByCarrier (used by the parity test below)
    -- joins this via partnerCoverageRatio/hasPartnerObligation for EVERY
    -- recharges row, regardless of whether any partner is involved — present
    -- so that query prepares; no row is ever inserted here.
    CREATE TABLE partner_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER DEFAULT 1,
      partner_id       INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table  TEXT,
      reference_id     INTEGER,
      amount           REAL NOT NULL,
      currency         TEXT NOT NULL DEFAULT 'USD',
      direction        TEXT NOT NULL,
      covered_amount   REAL NOT NULL DEFAULT 0,
      notes            TEXT,
      user_id          INTEGER,
      settlement_method TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      status                 TEXT NOT NULL DEFAULT 'completed',
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Local "today"/"N days ago" day string, sourced from SQLite's OWN
 * `'localtime'` clock on the SAME connection `isToday()`/`dateRange()`
 * query against — NOT a separately-computed JS `new Date()`.
 *
 * A JS-side `new Date()` and SQL's `CURRENT_TIMESTAMP`/`'localtime'` are two
 * INDEPENDENT reads of the real wall clock, taken at different moments as
 * the test executes (several `processRecharge()` calls, each writing its
 * own `CURRENT_TIMESTAMP`, then — separately — a `new Date()` call for the
 * comparison bounds). Around a real local-midnight boundary these two reads
 * can disagree on what day it is, which intermittently failed the "agrees
 * with ProfitRepository" test below with `mtcRow` undefined (caught in a
 * full-suite run that happened to straddle Beirut midnight — see CLAUDE.md
 * rule 27/28: this is the same "two independent 'now' reads" hazard class
 * as LIRA-237's hardcoded-date lock, just manifesting as a timing race
 * rather than a stale constant). Reading the day from `db` itself instead
 * makes every "what day is it" answer in this file resolve through the SAME
 * clock the rows themselves were stamped with.
 */
function sqlLocalDay(db: Database.Database, daysAgo: number): string {
  const { day } = db
    .prepare(`SELECT date('now', 'localtime', ?) AS day`)
    .get(`-${daysAgo} day`) as { day: string };
  return day;
}

function localDateTime(
  db: Database.Database,
  daysAgo: number,
  hhmmss = "12:00:00",
): string {
  return `${sqlLocalDay(db, daysAgo)} ${hhmmss}`;
}

function localDateBounds(
  db: Database.Database,
  daysAgo: number,
): { from: string; to: string } {
  const day = sqlLocalDay(db, daysAgo);
  return { from: `${day} 00:00:00`, to: `${day} 23:59:59` };
}

describe("RechargeRepository.getTodayStats (LIRA-250 follow-up)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let txnRepo: TransactionRepository;
  let lineRepo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
    txnRepo = new TransactionRepository();
    lineRepo = new CarrierLineRepository();
    // A primary MTC line — required by CREDIT_BUYBACK
    // (`processCreditBuyback` hard-rejects with no primary line) and
    // exercised (harmlessly) by every other sale type too.
    lineRepo.createLine({ carrier: "mtc", phone_number: "03111111" });
  });

  afterEach(() => {
    db.close();
    resetTenantContext();
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
  });

  it("counts a today MTC sale, excludes a refunded sale, a TOP_UP, a CREDIT_BUYBACK, and a yesterday sale", () => {
    // 1. Counted: a today MTC VOUCHER sale, price 5 / cost 4 -> profit 1 USD.
    const sale = repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    expect(sale.success).toBe(true);

    // 2. NOT counted: a second today MTC sale, then refunded (voided).
    const refundedSale = repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 10,
      cost: 7,
      price: 10,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    expect(refundedSale.success).toBe(true);
    const refundedTxnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND type = 'RECHARGE'`,
        )
        .get(refundedSale.id) as { id: number }
    ).id;
    txnRepo.voidTransaction(refundedTxnId, 1);
    const refundedRow = db
      .prepare(`SELECT is_refunded FROM recharges WHERE id = ?`)
      .get(refundedSale.id) as { is_refunded: number };
    expect(refundedRow.is_refunded).toBe(1);

    // 3. NOT counted: a TOP_UP (drawer move, transaction type
    //    RECHARGE_TOPUP, not RECHARGE). LIRA-258 / G15: `topUpApp` now
    //    REFUSES MTC/Alfa (drawer must equal Σ line credits, LIRA-252), so
    //    a new one cannot be booked — assert the refusal, then seed a
    //    LEGACY today TOP_UP row of the shape `topUpApp` used to write
    //    (pre-LIRA-258 shops have them) and keep proving it is excluded.
    const topUp = repo.topUpApp({
      provider: "MTC",
      amount: 50,
      currency: "USD",
      sourceDrawer: "General",
      userId: 1,
    });
    expect(topUp.success).toBe(false);
    const legacyTopUpAt = localDateTime(db, 0);
    const legacyTopUpId = Number(
      db
        .prepare(
          `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, created_at, tenant_id)
           VALUES ('MTC', 'TOP_UP', 50, 0, 0, 'USD', ?, 1)`,
        )
        .run(legacyTopUpAt).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, amount_usd, created_at, tenant_id)
       VALUES ('RECHARGE_TOPUP', 'ACTIVE', 'recharges', ?, 50, ?, 1)`,
    ).run(legacyTopUpId, legacyTopUpAt);

    // 4. NOT counted: a CREDIT_BUYBACK (cash-out payout, transaction type
    //    TELECOM_CREDIT_BUYBACK, not RECHARGE).
    const buyback = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_BUYBACK",
      amount: 8,
      cost: 0,
      price: 6,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      userId: 1,
    });
    expect(buyback.success).toBe(true);

    // 5. NOT counted: a sale backdated to yesterday.
    const yesterday = repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 3,
      cost: 2,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
      transaction_time: localDateTime(db, 1),
    });
    expect(yesterday.success).toBe(true);

    // ── The read under test ──────────────────────────────────────────────
    const stats = repo.getTodayStats("MTC");

    expect(stats.count).toBe(1);
    expect(stats.profit_usd).toBeCloseTo(1, 2); // only the first, uncounted-elsewhere sale
    expect(stats.profit_lbp).toBeCloseTo(0, 2);
    expect(stats.byCurrency).toEqual([
      { currency: "USD", commission: 1, count: 1 },
    ]);

    // Alfa (nothing booked there) reads all-zero, not an error.
    const alfaStats = repo.getTodayStats("Alfa");
    expect(alfaStats).toEqual({
      count: 0,
      profit_usd: 0,
      profit_lbp: 0,
      byCurrency: [],
    });
  });

  it("RechargeService.getTodayStats is a thin pass-through and zeroes out on a repository error", () => {
    repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    const service = new RechargeService(repo);
    expect(service.getTodayStats("MTC")).toEqual(repo.getTodayStats("MTC"));

    const brokenRepo = {
      getTodayStats: () => {
        throw new Error("boom");
      },
    } as unknown as RechargeRepository;
    const brokenService = new RechargeService(brokenRepo);
    expect(brokenService.getTodayStats("MTC")).toEqual({
      count: 0,
      profit_usd: 0,
      profit_lbp: 0,
      byCurrency: [],
    });
  });

  it("agrees with ProfitRepository.getRechargesByCarrier's own today figure for MTC (the Profits page's recharge source)", () => {
    repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: 2,
      price: 6,
      currency: "USD",
      paid_by_method: "CASH",
      userId: 1,
    });
    // A LBP-denominated sale too, to prove the parity holds per currency.
    repo.processRecharge({
      provider: "MTC",
      type: "VOUCHER",
      amount: 7,
      cost: 400000,
      price: 450000,
      currency: "LBP",
      paid_by_method: "CASH",
      userId: 1,
    });

    const stats = repo.getTodayStats("MTC");

    const profitRepo = new ProfitRepository();
    const { from, to } = localDateBounds(db, 0);
    const byCarrier = profitRepo.getRechargesByCarrier(from, to);
    const mtcRow = byCarrier.find((r) => r.carrier === "MTC")!;

    expect(mtcRow).toBeDefined();
    expect(stats.count).toBe(mtcRow.count);
    expect(stats.profit_usd).toBeCloseTo(mtcRow.profit_usd, 2);
    expect(stats.profit_lbp).toBeCloseTo(mtcRow.profit_lbp, 2);
  });
});
