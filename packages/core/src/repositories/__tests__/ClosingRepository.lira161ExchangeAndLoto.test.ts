/**
 * LIRA-161 item 1 (owner decision 2026-09-04) — `ClosingRepository
 * .getDailyStatsSnapshot` never reached `loto_tickets`/`exchange_transactions`
 * at all, though both have `ProfitRepository` counterparts (`getLotoTotals`,
 * `getExchangeTotals`). The owner asked for BOTH, on the explicit condition
 * that each is genuinely same-day cash before it's added.
 *
 * INVESTIGATION (source-verified, not assumed):
 *
 *   - Loto: `ProfitRepository.getLotoTotals`'s own doc comment says loto
 *     "stamps its commission as profit_lbp on the LOTO transaction at sale
 *     time" — same-day, cash-in-hand. It CAN be for-partner or
 *     CUSTOMER_ACCOUNT-charged (hence `getLotoTotals`'s own
 *     notPartnerPending + notDebtPending gates), so the edge cases are real
 *     and must defer — this file proves notPartnerPending does.
 *     `notDebtPending` could NOT be added (see the file-scope note below) —
 *     a real, wider gap than `getLotoTotals` itself carries, documented in
 *     `profitRecognition.guard.test.ts` and current_sprint.md.
 *
 *   - Exchange: `ExchangeRepository.createTransaction` stamps
 *     `leg1_profit_usd`/`leg2_profit_usd` SYNCHRONOUSLY, in the same
 *     transaction as the exchange itself — never at a later date. The
 *     `EXCHANGE_LOT_SETTLEMENT.md` "settlement" terminology (which raised
 *     the original scrutiny question) refers to FIFO cost-basis matching
 *     against a previously-acquired lot (WHICH lot(s) a sell consumes),
 *     resolved at the SELL's own transaction time — see
 *     `profitRecognition.guard.test.ts`'s own header note: "a SELL leg...
 *     stamps the FIFO-realized profit... AT SETTLEMENT (the sell's own)
 *     time... never at the buy's time." This is NOT the OMT/WHISH kind of
 *     deferred cash settlement (a later, separate operator-entered event) —
 *     it is same-day, by construction, for every exchange transaction,
 *     lot-tracked or not. Additionally, `ExchangeRepository` structurally
 *     REJECTS CUSTOMER_ACCOUNT payout legs ("exchange_transactions does not
 *     carry client_id" — ExchangeRepository.ts ~:506-513), so exchange can
 *     never be debt-pending — `getExchangeTotals` itself gates only
 *     `notRefunded` + `notPartnerPending`, matching this file's addition
 *     exactly, with NO residual notDebtPending gap (unlike every other
 *     source this ticket touches).
 *
 * CONCLUSION: both belong in a same-day cash view. Both are added, gated
 * exactly like their ProfitRepository counterparts (minus notDebtPending on
 * loto — see the file-scope note).
 *
 * CURRENCY SHAPE: loto's real commission is booked entirely in LBP
 * (`transactions.profit_lbp`) — `totalProfitUSD` never had an LBP
 * conversion convention anywhere in this method (finProfitLegacy/
 * rechargeProfit both explicitly EXCLUDE the LBP slice of their own module's
 * profit), so loto gets its own `totalProfitLBP` field rather than being
 * silently forced through the USD-only total (where it would always
 * evaluate to exactly 0). Exchange's profit is USD-native
 * (`leg1_profit_usd`/`leg2_profit_usd`) and folds directly into
 * `totalProfitUSD`.
 *
 * FILE-SCOPE NOTE (why no notDebtPending on loto): `ProfitRepository
 * .notDebtPending` is a private, unexported function; importing it would
 * require editing ProfitRepository.ts, which this ticket's handover
 * forbids (a second agent was concurrently mid-edit on that file for
 * LIRA-162/163). `EXCHANGE_LEG_PROFIT` (the leg1+leg2 COALESCE sum) is
 * likewise a private, unexported const there — inlined verbatim here
 * instead, documented in ClosingRepository.ts at the exchange query itself.
 *
 * Rule 17 — every test below was proven against the pre-fix code (loto and
 * exchange summed to nothing at all before this ticket; the notPartnerPending
 * gate on each was proven by temporarily removing it, observing the
 * for-partner fixture wrongly count, then restoring). Verbatim before/after
 * output is recorded in the PR description / task report.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Full schema: every table `getDailyStatsSnapshot` unconditionally touches,
 * PLUS `transactions` (loto's profit lives there, not on `loto_tickets`),
 * `loto_tickets`, `exchange_transactions`, and `partner_ledger` — the FOUR
 * tables the new loto/exchange sources need to activate at all
 * (`_hasTransactionsTable() && _hasLotoTicketsTable() && hasPartnerLedger`
 * for loto; `_hasExchangeTransactionsTable() && hasPartnerLedger` for
 * exchange).
 */
function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER,
      sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT,
      transaction_id INTEGER
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0);
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency TEXT, commission REAL, commission_model INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency_code TEXT, price REAL, cost REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0);
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL, transaction_type TEXT, reference_table TEXT,
      reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER, created_at TEXT
    );
    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT
    );
    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0, created_at TEXT
    );
  `);
}

function todayAtUtc(hour: string): string {
  const hh = hour.padStart(2, "0");
  return (
    db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' ${hh}:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string }
  ).ts;
}

function insertLotoTicket(row: { createdAt: string }): number {
  const res = db
    .prepare(
      `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
       VALUES (1, 100, 0, ?)`,
    )
    .run(row.createdAt);
  return Number(res.lastInsertRowid);
}

function insertLotoTransaction(row: { lotoTicketId: number; profitLbp: number; createdAt: string }): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_lbp, created_at)
     VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, ?, ?)`,
  ).run(row.lotoTicketId, row.profitLbp, row.createdAt);
}

function insertExchangeTransaction(row: {
  leg1ProfitUsd: number;
  leg2ProfitUsd?: number;
  createdAt: string;
}): number {
  const res = db
    .prepare(
      `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, 100, ?, ?, 0, ?)`,
    )
    .run(row.leg1ProfitUsd, row.leg2ProfitUsd ?? null, row.createdAt);
  return Number(res.lastInsertRowid);
}

function insertUncoveredPartnerObligation(refTable: string, refId: number): void {
  db.prepare(
    `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount)
     VALUES (1, 1, 'FOR_PARTNER_CHARGE', ?, ?, 100, 'CREDIT', 0)`,
  ).run(refTable, refId);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-161 loto + exchange", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  describe("loto", () => {
    it("a same-day loto commission now reaches totalProfitLBP", () => {
      const ticketId = insertLotoTicket({ createdAt: todayAtUtc("10") });
      insertLotoTransaction({ lotoTicketId: ticketId, profitLbp: 4500, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitLBP).toBe(4500);
      // Loto is entirely LBP — must NOT leak into the USD total.
      expect(snap.totalProfitUSD).toBe(0);
    });

    it("excludes a for-partner loto commission while the partner obligation is uncovered", () => {
      const ticketId = insertLotoTicket({ createdAt: todayAtUtc("10") });
      insertLotoTransaction({ lotoTicketId: ticketId, profitLbp: 4500, createdAt: todayAtUtc("10") });
      insertUncoveredPartnerObligation("loto_tickets", ticketId);

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitLBP).toBe(0);
    });
  });

  describe("exchange", () => {
    it("a same-day exchange spread now reaches totalProfitUSD", () => {
      insertExchangeTransaction({ leg1ProfitUsd: 2.5, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(2.5);
    });

    it("sums BOTH legs of a lot-tracked cross-currency exchange", () => {
      insertExchangeTransaction({ leg1ProfitUsd: 0, leg2ProfitUsd: 3.25, createdAt: todayAtUtc("10") });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(3.25);
    });

    it("excludes a for-partner exchange spread while the partner obligation is uncovered", () => {
      const exId = insertExchangeTransaction({ leg1ProfitUsd: 2.5, createdAt: todayAtUtc("10") });
      insertUncoveredPartnerObligation("exchange_transactions", exId);

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });
  });
});

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-161 schema-drift fallback", () => {
  it("degrades to zero (no throw) when loto_tickets/exchange_transactions don't exist", () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT);
      CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0);
      CREATE TABLE debt_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
      CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_usd REAL, amount_lbp REAL, expense_date TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'active');
      CREATE TABLE financial_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, currency TEXT, commission REAL, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
      CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, currency_code TEXT, price REAL, cost REAL, created_at TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
      CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, profit_usd REAL, status TEXT, created_at TEXT, is_refunded INTEGER DEFAULT 0);
      CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT, is_refunded INTEGER DEFAULT 0);
    `);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();

    expect(() =>
      runWithTenant(1, () => repo.getDailyStatsSnapshot()),
    ).not.toThrow();
    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
    expect(snap.totalProfitLBP).toBe(0);

    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });
});
