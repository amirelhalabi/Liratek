/**
 * ProfitRepository.getByUser / getByClient — Round 3 adversarial review
 * (OWNER_NOTES_2026-09-21.md §6, Lane LCC). Guards every MAJOR/MINOR item the
 * Round 3 review found: LCC-X1 (kept-change REFUND double-counted), LCC-X2
 * (EXCHANGE REFUND leak), LCC-X3 (strict USD bucket, EUR no longer lumped
 * into USD), LCC-X4 (Avg Profit/Txn denominator missing kept-change/exchange/
 * reattribution counts), LCC-X5 (payment-method fee dropped on a
 * debt-pending transfer), LCC-X6 (getByClient walk-in pending matching), plus
 * getByUser twins of PA-1.2/PA-2.11/PA-4.19 (LCC-X9 — the Round-1 laneLCC
 * file only exercised getByClient for those). Round 4 (below, LCC-B1/LCC-M1)
 * adds the BLOCKER regression round 3 itself introduced and the kept-change
 * REFUND misattribution round 3's own review flagged as MINOR (LCC-M1).
 *
 * Schema: the same v150+ shape as `ProfitRepository.byUserByClient.round2
 * .test.ts` (rule 14 — copied, not re-derived), which already includes
 * `exchange_transactions` and `settlement_commission_allocations`.
 *
 * RULE 17 STATUS (round 4 — this paragraph replaces the prior session's own,
 * which is superseded, not merely stale: per fable-brain §5/§8, only state an
 * execution that actually happened). This session confirmed
 * `better-sqlite3`'s ABI directly by CONSTRUCTING a database (a bare
 * `require` is a false-positive probe — see CLAUDE.md's own caveat):
 * `node -e "const D=require('better-sqlite3'); new D(':memory:').exec('CREATE TABLE t(x)'); console.log('OK')"`
 * printed `OK` under plain Node — then actually ran, this session, in order:
 *
 *  - `npx jest ProfitRepository.round3.laneLCC --maxWorkers=1` — before the
 *    round-4 fix: 3 FAILED (LCC-B1 ×2, LCC-M1 ×1), 14 passed (all pre-existing
 *    round-3 tests unaffected by adding the new ones). Observed failures
 *    matched the predicted pre-fix numbers exactly: LCC-B1's two tests read
 *    revenue_usd 30 / profit_usd 9 (received) against an expected 20 / 6;
 *    LCC-M1's test read Alice profit_usd 7.5 / Bob -6.75 against an expected
 *    0.5 / 0.25. After `refundOriginalIsProfitEvent`'s NULL-safety fix
 *    (LCC-B1) and `keptChangeAttributedUserId`'s introduction (LCC-M1): same
 *    command, 17/17 passing.
 *  - `npx jest ProfitRepository --maxWorkers=1` (the full ProfitRepository
 *    suite, a superset of the 8 files the prior session's docblock named) —
 *    27 suites / 260 tests, 0 failures, after ALL of round 4's edits
 *    (LCC-B1, LCC-M1, and the LCC-M2 `pendingLegacyCommissionForKey`
 *    extraction), confirming no bind-arity crash and no regression against
 *    every pre-existing ProfitRepository assertion in the package.
 *  - `npx jest ProfitRepository.getByClient.laneLCC --maxWorkers=1` (run
 *    individually, since LCC-M2 rewrote its `pending_profit_usd`/
 *    `pending_profit_lbp` SQL text) — 11/11 passing, including PA-1.3/PA-2.6/
 *    PA-3.9's own pending-profit assertions.
 *
 * What round 4 does NOT re-certify: the round-3 LCC-X1..X9 tests passing
 * here does not itself re-prove each one's ORIGINAL failing-first evidence
 * from the round-3 session (this session did not revert round 3's own
 * `ProfitRepository.ts` edits and re-run) — that evidence is unchanged from
 * round 3's own report and is not re-asserted by this paragraph.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";
const IN_RANGE = "2026-07-15 12:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      settlement_id INTEGER,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP',
      model INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (5, 1, 'Client Five', '71000000')`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'Alice')`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (2, 1, 'Bob')`,
  ).run();
}

function seedRecharge(
  db: Database.Database,
  opts: {
    userId: number;
    clientId: number | null;
    clientName?: string | null;
    amountUsd?: number;
    profitUsd?: number;
    createdAt?: string;
  },
): number {
  const rechargeId = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, price, cost, created_at) VALUES (1, 'Alfa', ?, 0, ?)`,
      )
      .run(opts.amountUsd ?? 10, opts.createdAt ?? IN_RANGE).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
      )
      .run(
        rechargeId,
        opts.userId,
        opts.amountUsd ?? 10,
        opts.profitUsd ?? 2,
        opts.clientId,
        opts.clientName ?? null,
        opts.createdAt ?? IN_RANGE,
      ).lastInsertRowid,
  );
  return txnId;
}

describe("ProfitRepository — Round 3 Lane LCC (OWNER_NOTES_2026-09-21.md §6, adversarial review)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  // ---------------------------------------------------------------------
  // LCC-X1 — kept-change DEBT_REPAYMENT refund double-counted
  // ---------------------------------------------------------------------
  describe("LCC-X1 — a kept-change DEBT_REPAYMENT refunded by another user nets to 0, matching getDebtRepaymentProfit", () => {
    function seedKeptChangeAndRefund(): void {
      const originalId = Number(
        db
          .prepare(
            `INSERT INTO transactions
              (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
             VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 1, 0, 0, 7, 0, 5, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'debt_ledger', 1, 2, 0, 0, -7, 0, 5, ?, ?)`,
      ).run(originalId, IN_RANGE);
    }

    it("getByUser: the Σ profit_usd across every row is 0, matching getDebtRepaymentProfit", () => {
      seedKeptChangeAndRefund();
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const totalUsd = rows.reduce((s, r) => s + r.profit_usd, 0);
      const overview = runWithTenant(1, () =>
        repo.getDebtRepaymentProfit(FROM, TO),
      );
      expect(overview.profit_usd).toBeCloseTo(0, 5);
      expect(totalUsd).toBeCloseTo(overview.profit_usd, 5);
    });

    it("getByClient: the Σ profit_usd across every row is 0", () => {
      seedKeptChangeAndRefund();
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const totalUsd = rows.reduce((s, r) => s + r.profit_usd, 0);
      expect(totalUsd).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X2 — refunded EXCHANGE leaks into both tabs
  // ---------------------------------------------------------------------
  describe("LCC-X2 — a refunded EXCHANGE nets to 0 on getByUser and leaves no trace on getByClient", () => {
    function seedExchangeAndRefund(): number {
      const exId = Number(
        db
          .prepare(
            `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
             VALUES (1, 1000, 15, 0, 1, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      const originalId = Number(
        db
          .prepare(
            `INSERT INTO transactions
              (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, created_at)
             VALUES (1, 'EXCHANGE', 'ACTIVE', 'exchange_transactions', ?, 11, 1000, 0, 15, 0, 'Bob', ?)`,
          )
          .run(exId, IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'exchange_transactions', ?, 11, -1000, 0, -15, 0, 'Bob', ?, ?)`,
      ).run(exId, originalId, IN_RANGE);
      return exId;
    }

    it("getByUser: Σ profit_usd and Σ revenue_usd are 0, matching getExchangeTotals", () => {
      db.prepare(
        `INSERT INTO users (id, tenant_id, username) VALUES (11, 1, 'Cashier Eleven')`,
      ).run();
      seedExchangeAndRefund();

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const totalUsd = rows.reduce((s, r) => s + r.profit_usd, 0);
      const totalRevenue = rows.reduce((s, r) => s + r.revenue_usd, 0);
      const overview = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
      expect(overview.profit_usd).toBeCloseTo(0, 5);
      expect(totalUsd).toBeCloseTo(0, 5);
      expect(totalRevenue).toBeCloseTo(0, 5);
    });

    it("getByClient: no client/walk-in row carries any of this exchange's profit or revenue", () => {
      seedExchangeAndRefund();
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const totalUsd = rows.reduce((s, r) => s + r.profit_usd, 0);
      const totalRevenue = rows.reduce((s, r) => s + r.revenue_usd, 0);
      expect(totalUsd).toBeCloseTo(0, 5);
      expect(totalRevenue).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X3 — strict USD bucket (EUR dropped, not lumped into USD)
  // ---------------------------------------------------------------------
  describe("LCC-X3 — a non-USD/non-LBP currency (EUR) is dropped from revenue/pending/PM-fee, not lumped into USD", () => {
    it("getByUser: a EUR-denominated FS transfer does not inflate revenue_usd", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 500, 'EUR', 0, 0, 1, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 500, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].revenue_lbp).toBeCloseTo(0, 5);
    });

    it("getByClient: a EUR-denominated unsettled legacy commission does not inflate pending_profit_usd", () => {
      seedRecharge(db, { userId: 1, clientId: 5, amountUsd: 1, profitUsd: 0 });
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 300, 'EUR', 20, 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].pending_profit_usd).toBeCloseTo(0, 5);
      expect(rows[0].pending_profit_lbp).toBeCloseTo(0, 5);
    });

    it("getByUser: a EUR-denominated transfer's payment-method fee is dropped from both currency buckets", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, payment_method_fee, created_at)
             VALUES (1, 'OMT_APP', 300, 'EUR', 0, 0, 1, 0, 4, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 300, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].profit_usd).toBeCloseTo(0, 5);
      expect(rows[0].profit_lbp).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X4 — Avg Profit/Txn denominator
  // ---------------------------------------------------------------------
  describe("LCC-X4 — recognized_transaction_count grows with every source folded into profit_usd/profit_lbp", () => {
    it("getByUser: 1 sale + 50 exchanges gives a denominator of 51, not 1", () => {
      db.prepare(
        `INSERT INTO users (id, tenant_id, username) VALUES (3, 1, 'Cashier Three')`,
      ).run();
      seedRecharge(db, { userId: 3, clientId: 5, amountUsd: 5, profitUsd: 2 });
      for (let i = 0; i < 50; i++) {
        const exId = Number(
          db
            .prepare(
              `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, created_at)
               VALUES (1, 100, 5, 0, ?)`,
            )
            .run(IN_RANGE).lastInsertRowid,
        );
        db.prepare(
          `INSERT INTO transactions
            (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at)
           VALUES (1, 'EXCHANGE', 'ACTIVE', 'exchange_transactions', ?, 3, 100, 0, 5, 0, ?)`,
        ).run(exId, IN_RANGE);
      }

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const cashier = rows.find((r) => r.user_id === 3);
      expect(cashier).toBeDefined();
      // profit_usd: $2 (sale) + 50 * $5 (exchanges) = $252.
      expect(cashier?.profit_usd).toBeCloseTo(252, 5);
      // The correct denominator: 1 recognized RECHARGE + 50 recognized
      // exchange rows = 51 — NOT 1 (which would read Avg Profit/Txn as $252).
      expect(cashier?.recognized_transaction_count).toBe(51);
      const avg = (cashier?.profit_usd ?? 0) / (cashier?.recognized_transaction_count ?? 1);
      expect(avg).toBeCloseTo(252 / 51, 2);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X5 — PM fee unconditional on debt-pending status
  // ---------------------------------------------------------------------
  describe("LCC-X5 — a payment-method fee counts even when the underlying transfer is debt-pending", () => {
    it("getByUser: a debt-pending FS row's PM fee still shows on profit_usd", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, payment_method_fee, created_at)
             VALUES (1, 'OMT_APP', 50, 'USD', 0, 0, 0, 0, 3, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      const txnId = Number(
        db
          .prepare(
            `INSERT INTO transactions
              (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
             VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 50, 0, 0, 0, 5, ?)`,
          )
          .run(fsId, IN_RANGE).lastInsertRowid,
      );
      // Debt-pending: an uncovered "Service Debt" row keyed to this txn.
      db.prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, created_at)
         VALUES (1, 5, 'Service Debt', 50, 0, ?, 0, 0, ?)`,
      ).run(txnId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      // notDebtPending is false here (0 < 50), so the commission-stamp term
      // is correctly 0 — but the PM fee is real money kept at the counter
      // regardless, and must still show.
      expect(rows[0].profit_usd).toBeCloseTo(3, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X6 — getByClient walk-in pending matching
  // ---------------------------------------------------------------------
  describe("LCC-X6 — getByClient's walk-in pending_profit_usd matches by client_id IS NULL + name, not a bare name equality", () => {
    it("an UNNAMED walk-in group (client_name NULL) gets its pending profit, not 0", () => {
      seedRecharge(db, {
        userId: 1,
        clientId: null,
        clientName: null,
        amountUsd: 1,
        profitUsd: 0,
      });
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 100, 'USD', 20, 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 0, 0, 0, NULL, NULL, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const walkin = rows.find((r) => r.client_id === null);
      expect(walkin).toBeDefined();
      expect(walkin?.pending_profit_usd).toBeCloseTo(20, 5);
    });

    it("a LINKED client's pending is NOT duplicated onto a same-named walk-in row", () => {
      // Linked client 5 ('Client Five') has its own qualifying row.
      seedRecharge(db, {
        userId: 1,
        clientId: 5,
        amountUsd: 1,
        profitUsd: 0,
      });
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 100, 'USD', 20, 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      // A SEPARATE walk-in row that happens to share client 5's DISPLAY
      // name ('Client Five') but has NO client_id of its own.
      seedRecharge(db, {
        userId: 1,
        clientId: null,
        clientName: "Client Five",
        amountUsd: 1,
        profitUsd: 0,
      });

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const client5 = rows.find((r) => r.client_id === 5);
      const walkin = rows.find((r) => r.client_id === null);
      expect(client5?.pending_profit_usd).toBeCloseTo(20, 5);
      // Pre-fix: the walk-in row's own correlated subquery matched on a bare
      // `t2.client_name = t.client_name`, which also matched client 5's own
      // fs2 row (t2.client_name is NULL there, so this specific leak needs
      // the walk-in's OWN name to equal the linked client's snapshot — this
      // fixture's walk-in row shares the display name, proving the SAME
      // symptom class the review's probe P5 describes).
      expect(walkin?.pending_profit_usd ?? 0).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-X9 — getByUser twins of PA-1.2 / PA-2.11 / PA-4.19
  // ---------------------------------------------------------------------
  describe("getByUser twins of getByClient.laneLCC's Round-1 cases (LCC-X9)", () => {
    it("PA-1.2: an LBP-denominated financial_services transfer does not inflate revenue_usd", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 5000000, 'LBP', 0, 0, 1, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 5000000, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].revenue_lbp).toBeCloseTo(5000000, 5);
    });

    it("PA-2.11: a refund created AFTER the report window still nets against a sale INSIDE it", () => {
      const originalId = seedRecharge(db, {
        userId: 1,
        clientId: 5,
        amountUsd: 100,
        profitUsd: 20,
        createdAt: IN_RANGE,
      });
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'recharges', 1, 2, -100, 0, -20, 0, 5, ?, ?)`,
      ).run(originalId, "2026-08-05 12:00:00");

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].profit_usd).toBeCloseTo(0, 5);
      expect(rows[0].transaction_count).toBe(2);
    });

    it("PA-4.19: counts a plain RECHARGE, excludes its REFUND, an unrelated SUPPLIER_SETTLEMENT, and an unsettled FS row", () => {
      seedRecharge(db, {
        userId: 1,
        clientId: 5,
        amountUsd: 100,
        profitUsd: 20,
        createdAt: IN_RANGE,
      });
      const secondId = seedRecharge(db, {
        userId: 1,
        clientId: 5,
        amountUsd: 30,
        profitUsd: 5,
        createdAt: IN_RANGE,
      });
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'recharges', 2, 1, -30, 0, -5, 0, 5, ?, ?)`,
      ).run(secondId, IN_RANGE);
      db.prepare(
        `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
         VALUES (950, 1, 1, 'SETTLEMENT', 0, 0, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 950, 1, 0, 0, 0, 0, 5, ?)`,
      ).run(IN_RANGE);
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 40, 'USD', 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 40, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].transaction_count).toBe(5);
      expect(rows[0].recognized_transaction_count).toBe(2);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-B1 / PA-2.11 / LCC-X1 — BLOCKER regression (round 4): a REFUND row
  // whose `reverses_id` is NULL (e.g. SalesRepository.refundSaleItem, which
  // never sets it — see that method's own `createTransaction` call) vanishes
  // from getByUser/getByClient entirely. `refundOriginalIsProfitEvent`
  // evaluated `(t.type <> 'REFUND' OR orig.type IN (PROFIT_TXN_TYPES))`: with
  // no matching `orig` row, `orig.type IN (...)` is SQL NULL, so
  // `FALSE OR NULL` is NULL — excluded by the WHERE clause, not merely
  // zeroed. Measured pre-fix (this exact test, run against the round-3 code):
  // revenue_usd 30 / profit_usd 9 (the REFUND row missing entirely) instead
  // of 20 / 6.
  // ---------------------------------------------------------------------
  describe("LCC-B1 — a REFUND row with reverses_id NULL (item refund) is NOT dropped from getByUser/getByClient", () => {
    function seedSaleAndItemRefund(): void {
      db.prepare(
        `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
         VALUES (1, 1, 'completed', 30, 30, 0, 90000, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 30, 0, 9, 0, 5, ?)`,
      ).run(IN_RANGE);
      // The item-refund shape: reverses_id is NEVER set by
      // SalesRepository.refundSaleItem's createTransaction call — this is
      // the exact row shape that vanished pre-fix.
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'sales', 1, 1, -10, 0, -3, 0, 5, NULL, ?)`,
      ).run(IN_RANGE);
    }

    it("getByUser: Σ revenue_usd/profit_usd equal the Overview's getSalesProfit (20 / 6, not 30 / 9)", () => {
      seedSaleAndItemRefund();
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const overview = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
      expect(overview.profit_usd).toBeCloseTo(6, 5);
      const totalRevenue = rows.reduce((s, r) => s + r.revenue_usd, 0);
      const totalProfit = rows.reduce((s, r) => s + r.profit_usd, 0);
      expect(totalRevenue).toBeCloseTo(20, 5);
      expect(totalProfit).toBeCloseTo(overview.profit_usd, 5);
    });

    it("getByClient: Σ revenue_usd/profit_usd equal the Overview's getSalesProfit (20 / 6, not 30 / 9)", () => {
      seedSaleAndItemRefund();
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const overview = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
      const totalRevenue = rows.reduce((s, r) => s + r.revenue_usd, 0);
      const totalProfit = rows.reduce((s, r) => s + r.profit_usd, 0);
      expect(totalRevenue).toBeCloseTo(20, 5);
      expect(totalProfit).toBeCloseTo(overview.profit_usd, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-M1 (round 4) — a kept-change REFUND row's own `user_id` is always the
  // REFUNDER (TransactionRepository's generic reversal path), not the
  // original seller — getByUser must attribute it to the ORIGINAL
  // DEBT_REPAYMENT's creator via `reverses_id`, matching "refund attributed
  // to the original seller" everywhere else in this file (e.g. a SALE
  // REFUND's client_id fallback, PA-2.11's date fallback).
  // ---------------------------------------------------------------------
  describe("LCC-M1 — kept-change REFUND profit is attributed to the ORIGINAL creator, not the refunder", () => {
    function seedKeptChangeAndRefundByOtherUser(): number {
      const originalId = Number(
        db
          .prepare(
            `INSERT INTO transactions
              (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
             VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 1, 0, 0, 7, 0, 5, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'debt_ledger', 1, 2, 0, 0, -7, 0, 5, ?, ?)`,
      ).run(originalId, IN_RANGE);
      return originalId;
    }

    it("Alice (creator, user 1) keeps +7 and −7 net 0; Bob (refunder, user 2) is NOT the one who nets to 0 alone", () => {
      seedKeptChangeAndRefundByOtherUser();
      // Give both users a real PROFIT_TXN_TYPES row so each gets a main-branch
      // output row (isolates attribution from the orphan-row UNION).
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 1, 0, 0.5, 0, 5, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
         VALUES (1, 1, 'completed', 1, 1, 0, 90000, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', 2, 2, 1, 0, 0.25, 0, 5, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
         VALUES (2, 1, 'completed', 1, 1, 0, 90000, ?)`,
      ).run(IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const alice = rows.find((r) => r.user_id === 1);
      const bob = rows.find((r) => r.user_id === 2);
      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      // Attributed to Alice (the ORIGINAL creator): her own +0.5 SALE plus
      // the net kept-change swing (+7 original, -7 refund) = +0.5.
      expect(alice!.profit_usd).toBeCloseTo(0.5, 5);
      // Bob (the refunder) carries ONLY his own +0.25 SALE — none of the
      // kept-change swing, since it is not his to report.
      expect(bob!.profit_usd).toBeCloseTo(0.25, 5);
      // LCC-M1-count-guard (round 2 follow-up, OWNER_NOTES_2026-09-21.md
      // §6): the COUNT half of LCC-M1 (keptChangeRecognizedCount's
      // `kc.type IN ('DEBT_REPAYMENT', 'KEPT_CHANGE')` restriction) had no
      // assertion here — removing that restriction still passed every
      // pre-existing test in this file. Alice's denominator is her own SALE
      // (1) plus the DEBT_REPAYMENT original (1) — the REFUND row is
      // attributed to her too (same key) but excluded by `kc.type`, so it
      // must NOT add a second count. Bob's denominator is only his own SALE
      // — the kept-change pair is not attributed to him at all.
      expect(alice!.recognized_transaction_count).toBe(2);
      expect(bob!.recognized_transaction_count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-B1-disjunct-unguarded (round-2 LCC follow-up, OWNER_NOTES_2026-09-21
  // .md §6, MINOR) — LCC-B1's own two tests above seed a `reverses_id`-NULL
  // sales REFUND alongside its SALE row (same `source_id`). Once
  // PA-2.11-itemrefund/LCC-itemrefund-fanout (`refundOriginalJoin`'s
  // `source_id` fallback, added this round in `ProfitRepository.ts`)
  // resolves that exact shape, those two tests pass through
  // `refundOriginalIsProfitEvent`'s `orig.type IN (PROFIT_TXN_TYPES)`
  // disjunct instead of its `orig.id IS NULL` one — by reading, deleting the
  // `orig.id IS NULL` disjunct entirely would now fail no test in this file
  // (rule 17: a guard that cannot fail on the bug it names is not a guard).
  // This block re-covers the disjunct directly with a REFUND whose original
  // is UNRESOLVABLE by EITHER path: `reverses_id` points at a nonexistent
  // transactions row, AND `source_table` is `'financial_services'`, not
  // `'sales'` — so `refundOriginalJoin`'s fallback (gated on
  // `alias.source_table = 'sales'`) never even attempts the `source_id`
  // match. `orig` is guaranteed to stay fully unmatched, so only the
  // `orig.id IS NULL` disjunct can keep this row from vanishing.
  //
  // NOT RUN tonight (NO-EXECUTION RULE) — red/green proof pending
  // (tomorrow): expected RED against `refundOriginalIsProfitEvent` with the
  // `orig.id IS NULL` disjunct removed (both `it`s below would then see an
  // empty `rows` array / `undefined` instead of the row), GREEN with it
  // present (current code).
  // ---------------------------------------------------------------------
  describe("LCC-B1-disjunct-unguarded — a REFUND whose original resolves through NEITHER refundOriginalJoin disjunct is still counted", () => {
    function seedUnresolvableRefund(): void {
      // No `financial_services` row id 777 exists, and `reverses_id`
      // 999999 matches no `transactions` row either — `orig` can never
      // resolve via `reverses_id`, and the fallback's
      // `source_table = 'sales'` guard excludes this row from ever trying
      // the `source_id` path (this row's `source_table` is
      // 'financial_services').
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'financial_services', 777, 1, -10, 0, -3, 0, 5, 999999, ?)`,
      ).run(IN_RANGE);
    }

    it("getByUser: the row survives — Alice (user 1) gets an output row, not an empty result", () => {
      seedUnresolvableRefund();
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const alice = rows.find((r) => r.user_id === 1);
      expect(alice).toBeDefined();
      expect(alice!.transaction_count).toBe(1);
    });

    it("getByClient: the row survives — client 5 gets an output row, not an empty result", () => {
      seedUnresolvableRefund();
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const client5 = rows.find((r) => r.client_id === 5);
      expect(client5).toBeDefined();
      expect(client5!.transaction_count).toBe(1);
    });
  });
});
