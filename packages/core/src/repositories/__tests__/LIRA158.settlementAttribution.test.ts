/**
 * LIRA-158_COMMISSION_REPORTING_PLAN.md §3 Phase 3 — restores per-provider /
 * per-date ATTRIBUTION for `commission_model = 1` commission, plus the D15
 * pending-count fields.
 *
 * Phase 1 (proven by LIRA158.commissionAtSettlementInterlock.test.ts) already
 * zeroes a model-1 row's profit-stamp COMMISSION TERM at creation and stamps
 * the operator's ENTERED commission on the settlement's own
 * SUPPLIER_SETTLEMENT transaction instead — correct TOTALS, correct PERIOD
 * (D7). What that leaves broken is exactly what this file pins: a
 * SUPPLIER_SETTLEMENT row is not a `financial_services` row, so it cannot
 * surface in `getFinancialSettledByProvider` / `getByDate`'s per-PROVIDER,
 * per-DATE breakdowns — those two queries read `financial_services` JOIN
 * `transactions`, and the settlement lives on `supplier_ledger` instead. The
 * fix reads `settlement_commission_allocations` (provider + per-currency
 * share + its OWN settlement-dated `created_at`) as a second UNION-ed source.
 *
 * Fixture note (CLAUDE.md's test-schema trap / this repo's own §5): both
 * `getFinancialSettledByProvider` and `getByDate` are single, unconditional
 * `.prepare()` calls that name EVERY module table whether or not a test
 * seeds rows into it (`getByDate` in particular is one big WITH-query
 * touching sales/sale_items/recharges/custom_services/maintenance/
 * loto_tickets/expenses/exchange_transactions alongside financial_services).
 * Omitting any of them throws "no such table" from inside the query and
 * kills every assertion in this file, not just the one that "needed" it —
 * so the schema below is the union of `ProfitRepository.tenantIsolation
 * .test.ts`'s full `getByDate` fixture (already proven to run getByDate
 * end-to-end) plus the v150 tables this task's own spec enumerated
 * (supplier_ledger, supplier_settlements, settlement_commission_allocations,
 * partners, clients, users) — reused, not re-derived, per rule 14.
 *
 * Rule 17: each `it()` names, in a trailing comment, the exact line/gate
 * whose removal would make it fail — this task's instructions forbid running
 * anything here (RUN NOTHING; the owner's consolidated gate is the first
 * real execution), so the failing-first proof is written down instead of run.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

// The report window used by every "current" fixture row.
const FROM_DATE = "2026-07-01";
const TO_DATE = "2026-07-31";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";

// A model-1 row transacts in JUNE (outside the report window) and settles in
// JULY (inside it) — the D7 period re-assignment this whole phase exists to
// surface correctly in the per-provider / per-date breakdowns. Both pinned
// to NOON (not near a midnight boundary) so `datetime(col, 'localtime')`'s
// UTC -> runner-local-timezone shift can never roll the calendar date over,
// whatever timezone the test runner happens to be in.
const TXN_DAY = "2026-06-15 12:00:00";
const SETTLE_DAY = "2026-07-20 12:00:00";

/**
 * Full schema needed to run `getFinancialSettledByProvider` AND `getByDate`
 * end-to-end (see file header) — the union of `ProfitRepository
 * .tenantIsolation.test.ts`'s proven getByDate fixture and the v150 tables
 * this task's spec named explicitly. `financial_services` gains the two
 * v150/v148 columns (`commission_model`, `settlement_id`) neither precedent
 * fixture carries, since this file's queries are the first in the suite to
 * read both from the SAME row.
 */
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

    -- commission_model (v150) + settlement_id (pre-existing, but absent from
    -- every prior fixture that never needed both at once) are the two
    -- columns this file's queries newly read together.
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
      created_at TEXT
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

    -- Referenced by notPartnerPending (PFT-6) — a second, independent gate
    -- on the allocation arm from the one the base arm already carries.
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

    -- Referenced by notDebtPending (DBT-1) — used unconditionally by the base
    -- arm this file never disables; left empty everywhere (gate passes).
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

    -- v150 tables this task's spec named explicitly. Not directly joined by
    -- ProfitRepository's SQL (the allocation arm only needs
    -- settlement_commission_allocations + financial_services), but created
    -- anyway per the enumerated table list — cheap, and matches what a real
    -- upgraded install actually has alongside financial_services.
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

    -- The table this whole phase reads from — one row per settled fs row,
    -- per-currency share, dated to the SETTLEMENT (D7), per
    -- SupplierRepository._bookCommissionAtSettlement's real INSERT shape.
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
}

/** Same schema, minus `settlement_commission_allocations` and the two
 *  columns (`commission_model`, `settlement_id`) that only exist from
 *  v148/v150 onward — simulates a pre-LIRA-158 fixture / a real DB that
 *  hasn't run those migrations yet (§5's schema-drift trap). */
function createLegacySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, username TEXT NOT NULL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, full_name TEXT, phone_number TEXT);
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, product_id INTEGER, sold_price_usd REAL DEFAULT 0, cost_price_snapshot_usd REAL DEFAULT 0, quantity INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, client_id INTEGER, client_name TEXT, client_phone TEXT, reverses_id INTEGER, created_at TEXT
    );
    -- Pre-v148: NO commission_model, NO settlement_id.
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      omt_fee REAL, cost REAL DEFAULT 0, price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, carrier TEXT, currency_code TEXT DEFAULT 'USD', price REAL DEFAULT 0, cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, price_usd REAL DEFAULT 0, price_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, final_amount_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE loto_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT DEFAULT 'active', amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, expense_date TEXT, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE exchange_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL, transaction_type TEXT,
      reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')), notes TEXT, user_id INTEGER, settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, covered_amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, transaction_id INTEGER, note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER, is_refunded INTEGER DEFAULT 0, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
    -- Deliberately NO settlement_commission_allocations table at all.
  `);
}

function seedFs(
  db: Database.Database,
  opts: {
    provider: string;
    amount?: number;
    currency?: string;
    commission?: number;
    commissionModel?: number;
    isSettled?: 0 | 1;
    settlementId?: number | null;
    isRefunded?: 0 | 1;
    createdAt: string;
    withCommissionModelColumn?: boolean;
  },
): number {
  const hasModelCol = opts.withCommissionModelColumn ?? true;
  const sql = hasModelCol
    ? `INSERT INTO financial_services
         (tenant_id, provider, amount, currency, commission, commission_model, is_settled, settlement_id, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    : `INSERT INTO financial_services
         (tenant_id, provider, amount, currency, commission, is_settled, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`;
  const params = hasModelCol
    ? [
        opts.provider,
        opts.amount ?? 100,
        opts.currency ?? "USD",
        opts.commission ?? 0,
        opts.commissionModel ?? 0,
        opts.isSettled ?? 0,
        opts.settlementId ?? null,
        opts.isRefunded ?? 0,
        opts.createdAt,
      ]
    : [
        opts.provider,
        opts.amount ?? 100,
        opts.currency ?? "USD",
        opts.commission ?? 0,
        opts.isSettled ?? 0,
        opts.isRefunded ?? 0,
        opts.createdAt,
      ];
  const res = db.prepare(sql).run(...params);
  return Number(res.lastInsertRowid);
}

function seedFsTransaction(
  db: Database.Database,
  fsId: number,
  opts: { profitUsd?: number; profitLbp?: number; amountUsd?: number; createdAt: string },
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?)`,
    )
    .run(fsId, opts.amountUsd ?? 100, opts.profitUsd ?? 0, opts.profitLbp ?? 0, opts.createdAt);
  return Number(res.lastInsertRowid);
}

function seedAllocation(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    financialServiceId: number;
    provider: string;
    commissionUsd?: number;
    commissionLbp?: number;
    createdAt: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO settlement_commission_allocations
         (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
       VALUES (1, ?, ?, 'SEND', ?, ?, ?, ?)`,
    )
    .run(
      opts.settlementLedgerId,
      opts.financialServiceId,
      opts.provider,
      opts.commissionUsd ?? 0,
      opts.commissionLbp ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function seedForPartnerRow(
  db: Database.Database,
  fsId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
     VALUES (1, 1, 'FOR_WHISH_SEND', 'financial_services', ?, ?, 'USD', 'DEBIT', ?, ?)`,
  ).run(fsId, amount, coveredAmount, TXN_DAY);
}

describe("LIRA-158 Phase 3 — settlement-sourced attribution + D15 pending counts", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("per-provider / per-date attribution (settlement day, not transaction day)", () => {
    it(
      "a settled model-1 OMT row's ENTERED commission ($2.00) surfaces under " +
        "OMT in getFinancialSettledByProvider, dated to the SETTLEMENT day " +
        "(July, in-window) even though the underlying transaction happened " +
        "in June (out of window) — revenue/count stay 0 since the fs row " +
        "itself never falls inside this report's window",
      () => {
        const settlementLedgerId = 501;
        const fsId = seedFs(db, {
          provider: "OMT",
          amount: 100,
          commissionModel: 1,
          isSettled: 1,
          settlementId: settlementLedgerId,
          createdAt: TXN_DAY,
        });
        // Phase 1: the FINANCIAL_SERVICE stamp's commission term is 0 for a
        // model-1 row — this is what "already self-corrects to no double
        // count" means; the real figure lives in the allocation instead.
        seedFsTransaction(db, fsId, { profitUsd: 0, createdAt: TXN_DAY });
        seedAllocation(db, {
          settlementLedgerId,
          financialServiceId: fsId,
          provider: "OMT",
          commissionUsd: 2.0,
          createdAt: SETTLE_DAY,
        });

        const rows = runWithTenant(1, () =>
          repo.getFinancialSettledByProvider(FROM, TO),
        );
        const omt = rows.find((r) => r.provider === "OMT");
        // Would be `undefined` (no OMT row at all) if the allocation UNION
        // arm were removed — the base arm alone finds nothing here because
        // fs.created_at (June) falls outside [FROM, TO] (July).
        expect(omt).toBeDefined();
        expect(omt!.profit_usd).toBeCloseTo(2, 4);
        expect(omt!.profit_lbp).toBe(0);
        // Would read 100 (the fs row's own price/amount) if the allocation
        // arm ever emitted anything but 0 for revenue — an allocation is a
        // commission SHARE only, never a revenue/cost pair of its own.
        expect(omt!.revenue_usd).toBe(0);
        // Deliberate design choice (see ProfitRepository.ts's doc comment on
        // getFinancialSettledByProvider): the allocation arm emits 0 AS
        // count so the underlying fs row — already counted once by the base
        // arm whenever both arms land in the same period — is never counted
        // twice. Would read 1 (not 0) if that arm's `0 AS count` were ever
        // changed to `1 AS count`.
        expect(omt!.count).toBe(0);
      },
    );

    it(
      "the SAME row's commission lands on JULY 20 (the settlement day) in " +
        "getByDate's daily breakdown, not on any day in June",
      () => {
        const settlementLedgerId = 502;
        const fsId = seedFs(db, {
          provider: "WHISH_APP",
          amount: 50,
          commissionModel: 1,
          isSettled: 1,
          settlementId: settlementLedgerId,
          createdAt: TXN_DAY,
        });
        seedFsTransaction(db, fsId, { profitUsd: 0, createdAt: TXN_DAY });
        seedAllocation(db, {
          settlementLedgerId,
          financialServiceId: fsId,
          provider: "WHISH_APP",
          commissionUsd: 1.25,
          createdAt: SETTLE_DAY,
        });

        const rows = runWithTenant(1, () =>
          repo.getByDate(FROM_DATE, TO_DATE, FROM, TO),
        );
        const settleRow = rows.find((r) => r.date === "2026-07-20");
        // Would read 0 (or the row could even be entirely absent from the
        // COALESCE-summed total) if `daily_commissions`'s new allocation arm
        // were dated by fs.created_at instead of sca.created_at — that is
        // exactly the bug this phase exists to fix (D7 lands the money on
        // the settlement's day, not the transaction's).
        expect(settleRow).toBeDefined();
        expect(settleRow!.profit_usd).toBeCloseTo(1.25, 4);

        // No day in the window should show the commission on the
        // TRANSACTION's own date — June isn't even in this window, but as a
        // belt-and-braces check every OTHER day in the window stays 0.
        const otherDaysTotal = rows
          .filter((r) => r.date !== "2026-07-20")
          .reduce((sum, r) => sum + r.profit_usd, 0);
        expect(otherDaysTotal).toBe(0);
      },
    );

    it(
      "regression sanity: a LEGACY model-0 row is completely unaffected — " +
        "still attributed via the base arm on its OWN transaction date " +
        "(D3 cutover; proves the UNION restructuring didn't touch this path)",
      () => {
        const fsId = seedFs(db, {
          provider: "OMT",
          amount: 100,
          commission: 5,
          commissionModel: 0,
          isSettled: 1,
          createdAt: SETTLE_DAY, // in-window, no allocation involved at all
        });
        seedFsTransaction(db, fsId, { profitUsd: 5, createdAt: SETTLE_DAY });

        const rows = runWithTenant(1, () =>
          repo.getFinancialSettledByProvider(FROM, TO),
        );
        const omt = rows.find((r) => r.provider === "OMT");
        // Would read 0 (or be missing) if the base arm's own WHERE/JOIN were
        // ever disturbed by the UNION restructuring — this pins that it
        // wasn't: a legacy row with no allocation row at all still reports
        // its stamped commission exactly as before Phase 3.
        expect(omt).toBeDefined();
        expect(omt!.profit_usd).toBe(5);
        expect(omt!.count).toBe(1);
      },
    );
  });

  describe("FOR-partner allocation still defers (supplier-settled != partner-settled)", () => {
    it(
      "a model-1 WHISH row settled with the supplier but still UNCOVERED by " +
        "its own FOR_% partner_ledger row does not surface its commission",
      () => {
        const settlementLedgerId = 601;
        const fsId = seedFs(db, {
          provider: "WHISH",
          amount: 200,
          commissionModel: 1,
          isSettled: 1,
          settlementId: settlementLedgerId,
          createdAt: TXN_DAY,
        });
        seedFsTransaction(db, fsId, { profitUsd: 0, createdAt: TXN_DAY });
        seedAllocation(db, {
          settlementLedgerId,
          financialServiceId: fsId,
          provider: "WHISH",
          commissionUsd: 5.0,
          createdAt: SETTLE_DAY, // in-window
        });
        // Uncovered FOR_% row (covered_amount 0 < amount 205) — the fs row is
        // partner-pending regardless of the supplier settlement above.
        seedForPartnerRow(db, fsId, 205, 0);

        const rows = runWithTenant(1, () =>
          repo.getFinancialSettledByProvider(FROM, TO),
        );
        // Would read profit_usd: 5 (or the row would exist) if the
        // allocation arm's OWN `notPartnerPending` gate were ever dropped —
        // supplier-settled is a SEPARATE fact from partner-settled, and this
        // is the second, independent gate the task spec calls out.
        const whish = rows.find((r) => r.provider === "WHISH");
        expect(whish).toBeUndefined();

        const daily = runWithTenant(1, () =>
          repo.getByDate(FROM_DATE, TO_DATE, FROM, TO),
        );
        const settleRow = daily.find((r) => r.date === "2026-07-20");
        // Same gate, same day — getByDate's daily_commissions allocation arm
        // must defer identically.
        expect(settleRow?.profit_usd ?? 0).toBe(0);
      },
    );
  });

  describe("D15 — pending awaiting_settlement_count fields", () => {
    it(
      "a model-0 pending row keeps its dollar total; a model-1 pending row " +
        "(WHISH, commission stuck at 0) contributes ONLY to " +
        "awaiting_settlement_count, and still surfaces its OWN provider row " +
        "with total_usd: 0",
      () => {
        // Legacy pending row — dollar figure, unaffected by D15.
        seedFs(db, {
          provider: "OMT",
          commission: 3,
          commissionModel: 0,
          isSettled: 0,
          createdAt: SETTLE_DAY,
        });
        // New-model pending row: WHISH forces commission to 0 at creation
        // (§1.1 of the plan) — this is the exact shape that used to vanish
        // from every pending view because `commission > 0` excluded it.
        seedFs(db, {
          provider: "WHISH",
          commission: 0,
          commissionModel: 1,
          isSettled: 0,
          createdAt: SETTLE_DAY,
        });

        const totals = runWithTenant(1, () =>
          repo.getPendingCommissionTotals(FROM, TO),
        );
        // Would read total_usd: 3, count: 1 either way (unchanged legacy
        // figure) — the assertion that matters is awaiting_settlement_count.
        // Would read 0 if `atSettlementCommission`'s CASE were ever gated
        // behind `commission > 0` the way the legacy dollar figure is (the
        // WHISH row's commission is 0, so that predicate would silently
        // exclude it again — the exact bug this phase exists to fix).
        expect(totals.total_usd).toBe(3);
        expect(totals.count).toBe(1);
        expect(totals.awaiting_settlement_count).toBe(1);

        const byProvider = runWithTenant(1, () =>
          repo.getPendingCommissionByProvider(FROM, TO),
        );
        const omt = byProvider.find((r) => r.provider === "OMT");
        const whish = byProvider.find((r) => r.provider === "WHISH");
        expect(omt).toBeDefined();
        expect(omt!.total_usd).toBe(3);
        expect(omt!.awaiting_settlement_count).toBe(0);
        // The model-1-only-provider case the task spec calls out by name:
        // WHISH has NO dollar-eligible row at all, yet must still appear
        // (not be silently dropped) with a nonzero awaiting count. Would be
        // `undefined` if the outer WHERE still carried `commission > 0` —
        // that would filter WHISH's zero-commission row out of the
        // GROUP BY entirely, the structural bug named in §1.1 of the plan.
        expect(whish).toBeDefined();
        expect(whish!.total_usd).toBe(0);
        expect(whish!.awaiting_settlement_count).toBe(1);
      },
    );
  });
});

describe("LIRA-158 Phase 3 — schema-drift fallback (pre-v148/v150 fixture)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createLegacySchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    // A FRESH instance is required here: _hasCommissionModelColumn() and
    // _hasSettlementAllocationsTable() are memoized per repository instance,
    // so reusing an instance that already probed a DIFFERENT db's schema
    // would silently reuse the WRONG cached answer.
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it(
    "getFinancialSettledByProvider / getByDate run without throwing when " +
      "settlement_commission_allocations does not exist at all, and still " +
      "return the legacy (base-arm-only) figures",
    () => {
      const fsId = seedFs(db, {
        provider: "OMT",
        commission: 5,
        isSettled: 1,
        createdAt: SETTLE_DAY,
        withCommissionModelColumn: false,
      });
      seedFsTransaction(db, fsId, { profitUsd: 5, createdAt: SETTLE_DAY });

      // Would throw "no such table: settlement_commission_allocations" if
      // `_hasSettlementAllocationsTable()`'s guard were removed (or ignored)
      // and the UNION arm were unconditionally concatenated into the SQL.
      expect(() => {
        runWithTenant(1, () => repo.getFinancialSettledByProvider(FROM, TO));
      }).not.toThrow();
      const byProvider = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const omt = byProvider.find((r) => r.provider === "OMT");
      expect(omt).toBeDefined();
      expect(omt!.profit_usd).toBe(5);

      expect(() => {
        runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      }).not.toThrow();
    },
  );

  it(
    "getPendingCommissionTotals / getPendingCommissionByProvider run without " +
      "throwing when commission_model does not exist at all, treat every row " +
      "as legacy (embeddedCommission degrades to 1=1), and report " +
      "awaiting_settlement_count: 0 everywhere (atSettlementCommission " +
      "degrades to 1=0 — 'match nothing', the opposite literal)",
    () => {
      seedFs(db, {
        provider: "OMT",
        commission: 4,
        isSettled: 0,
        createdAt: SETTLE_DAY,
        withCommissionModelColumn: false,
      });

      // Would throw "no such column: commission_model" if
      // embeddedCommission/atSettlementCommission's `supported` guard were
      // ever bypassed and the raw column name referenced unconditionally.
      expect(() => {
        runWithTenant(1, () => repo.getPendingCommissionTotals(FROM, TO));
      }).not.toThrow();
      const totals = runWithTenant(1, () =>
        repo.getPendingCommissionTotals(FROM, TO),
      );
      expect(totals.total_usd).toBe(4);
      expect(totals.count).toBe(1);
      // Would read 1 (not 0) if atSettlementCommission's degradation were
      // ever written as "1 = 1" (embeddedCommission's OWN degradation
      // literal) instead of "1 = 0" — the two predicates are complements and
      // must degrade to OPPOSITE literals, not the same one.
      expect(totals.awaiting_settlement_count).toBe(0);

      const byProvider = runWithTenant(1, () =>
        repo.getPendingCommissionByProvider(FROM, TO),
      );
      expect(byProvider.find((r) => r.provider === "OMT")?.total_usd).toBe(4);
      expect(
        byProvider.find((r) => r.provider === "OMT")?.awaiting_settlement_count,
      ).toBe(0);
    },
  );
});
