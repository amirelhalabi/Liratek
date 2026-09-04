/**
 * LIRA-159 (D1) — behavioural proof for `FinancialRepository.getMonthlyPL`'s
 * rewrite: the commission arms are now COMPOSED from
 * `ProfitRepository.getRealizedCommissionTotals` (legacy, `commission_model =
 * 0`) + `ProfitRepository.getSupplierCommissionTotals` (settlement-day,
 * `commission_model = 1`) instead of a raw `SUM(financial_services.commission)`,
 * and the sales arm now gates on `notRefunded("si")`. See
 * `FinancialRepository.ts`'s own doc comment on `getMonthlyPL` for the full
 * rationale (D6/D7/D10 — no stamp-back, cash-basis recognition at
 * settlement).
 *
 * THE SCHEMA TRAP (see CLAUDE.md / reference_test_schema_completeness): a
 * missing table or column makes the repository swallow the SQLite error and
 * throw, so EVERY test in this file dies in SETUP looking like a broken
 * assertion instead of a schema gap. The fixture below is the union of every
 * table/column each fragment this composition touches actually reads,
 * cross-checked against `electron-app/create_db.sql` (column types/defaults
 * mirrored so the fixture cannot drift from the real schema) AND against two
 * proven-working sibling fixtures that already exercise this exact
 * composition end-to-end:
 *   - `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts` (the
 *     financial_services / transactions / settlement_commission_allocations /
 *     partner_ledger / debt_ledger shape, and its seedFs/seedFsTransaction/
 *     seedSettlementTxn/seedAllocation helper shapes, reused near-verbatim
 *     below)
 *   - `LIRA158.estimateNoLongerReported.test.ts` (the commission_model /
 *     is_settled schema-drift shape)
 *
 * Tables this fixture creates, and WHY each is required:
 *   - `sales`            — FinancialRepository's own sales-profit arm
 *                          (`s.status`, `s.created_at`, `s.tenant_id`)
 *   - `sale_items`        — same arm (`si.sold_price_usd`,
 *                          `si.cost_price_snapshot_usd`, `si.is_refunded`,
 *                          `si.sale_id`, `si.tenant_id`) — `is_refunded` is
 *                          the NEW gate this fixture proves (Task 1 item 5)
 *   - `expenses`          — FinancialRepository's own expenses arm
 *                          (`amount_usd`, `amount_lbp`, `status`,
 *                          `is_refunded`, `expense_date`, `tenant_id`) via
 *                          `activeExpense()`
 *   - `financial_services` — every commission arm's base table
 *                          (`is_settled`, `commission`, `commission_model`,
 *                          `currency`, `is_refunded`, `settlement_id`,
 *                          `created_at`, `tenant_id`, `provider`,
 *                          `service_type`)
 *   - `transactions`      — the FINANCIAL_SERVICE join `getRealizedCommissionTotals`
 *                          needs (`source_table`/`source_id`/`type`/`status`)
 *                          AND the SUPPLIER_SETTLEMENT/REFUND rows
 *                          `getSupplierCommissionTotals`'s billsOnly bucket
 *                          reads directly (`profit_usd`/`profit_lbp`)
 *   - `partner_ledger`    — required (even empty) by `notPartnerPending`,
 *                          called unconditionally by both commission arms
 *   - `debt_ledger`       — required (even empty) by `notDebtPending`
 *                          (`getRealizedCommissionTotals`) and
 *                          `allocationNotDebtPending`
 *                          (`getSupplierCommissionTotals`'s cashless bucket)
 *   - `settlement_commission_allocations` — the cashless-bucket source table
 *                          for `getSupplierCommissionTotals`
 *                          (`financial_service_id`, `settlement_ledger_id`,
 *                          `commission_usd`/`commission_lbp`, `service_type`,
 *                          `provider`, `created_at`, `tenant_id`)
 *
 * No `supplier_ledger` table is needed: `settlement_ledger_id` /
 * `source_id` are plain integer correlation keys with no FK enforced by
 * better-sqlite3 (no `PRAGMA foreign_keys = ON` anywhere in this test
 * process) — confirmed by both sibling fixtures above, neither of which
 * creates a `supplier_ledger` table either.
 *
 * Singleton hygiene: `FinancialRepository.getMonthlyPL` calls the
 * `ProfitRepository` SINGLETON via `getProfitRepository()`, whose two schema
 * probes (`_hasCommissionModelColumnCache` /
 * `_hasSettlementAllocationsTableCache`) are memoized PER INSTANCE. Every
 * `beforeEach` below calls `resetProfitRepository()` after (re)pointing
 * `__LIRATEK_TEST_DB__` at the fresh in-memory db, so the next
 * `getProfitRepository()` call inside `getMonthlyPL()` constructs a brand
 * new instance against the CURRENT test's schema. `FinancialRepository`
 * itself has no singleton/reset pair (verified: `FinancialRepository.ts`
 * exports only `getFinancialRepository()`, no `resetFinancialRepository()`)
 * — this file constructs `new FinancialRepository()` directly each
 * `beforeEach`, mirroring `ExpenseActiveGate.test.ts`'s own precedent for
 * this exact repository.
 *
 * Date-boundary safety: every fixed timestamp below is placed mid-month
 * (day 5-13, at 09:00-14:00) specifically so that `dateRange()`'s
 * `'localtime'` conversion cannot push it across a month boundary under ANY
 * real-world machine timezone (even a full ±14h offset from a mid-month
 * midday timestamp stays inside the same calendar month) — those tests are
 * deliberately TZ-agnostic. Only test 6 depends on the actual local/UTC
 * offset. It is only well-defined under a POSITIVE local offset (a genuine
 * UTC+N zone) — under UTC or a negative offset, local time cannot precede
 * UTC time, so no crossing can exist BY DEFINITION and the property is
 * untestable, not false. Test 6 is therefore registered with plain
 * `it`/`it.skip`, chosen from a module-scope offset probe (see
 * `LOCAL_OFFSET_HOURS` below) — SKIPPED (not failed) when the offset is
 * non-positive, and it keeps a hard throw for the one case that IS a real
 * defect: a measured positive offset that still fails to cross.
 */

import Database from "better-sqlite3";
import { FinancialRepository } from "../FinancialRepository.js";
import { resetProfitRepository } from "../ProfitRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const TENANT_ID = 1;

// =============================================================================
// LIRA-159 test 6 — local/UTC offset probe (decides it vs it.skip below)
// =============================================================================
//
// Measured empirically on this machine (Windows, 2026-09-04) via the core
// workspace's real `test` script (`cross-env TZ=Asia/Beirut jest ...`),
// building "01:00 local on the 1st of the current local month" and
// converting to UTC:
//
//   TZ unset       -> localtime offset = +3h   01:00 -> 2026-08-31 22:00  CROSSES
//   TZ=Asia/Beirut -> localtime offset = +1h   01:00 -> 2026-09-01 00:00  DOES NOT CROSS  <- this harness
//   TZ=UTC         -> localtime offset =  0h   01:00 -> 2026-09-01 01:00  DOES NOT CROSS
//
// Why +1h and not Beirut's real +3h: `TZ=Asia/Beirut` is an IANA zone name,
// and Windows' MSVC `localtime` cannot parse IANA names — it only
// understands POSIX `STDoffset[DST]`. With no numeric offset it falls back
// to base UTC+0, then applies the DEFAULT US DST rule, which in September
// adds 1 hour. So this suite runs at UTC+1 on Windows, NOT Beirut's +3; on
// Linux CI the same TZ string IS honoured and gives the real +3. Both are
// positive, so both can demonstrate the crossing.
//
// With a local time of 00:01:00 instead of 01:00:00, all three above cross
// (or, for TZ=UTC, correctly cannot — local == UTC there):
//
//   TZ unset       -> 2026-08-31 21:01  CROSSES
//   TZ=Asia/Beirut -> 2026-08-31 23:01  CROSSES
//   TZ=UTC         -> 2026-09-01 00:01  cannot cross (correct: local == UTC)
//
// 00:01:00 is therefore the local time test 6 uses below — it is robust to
// ANY positive offset down to one minute, on both Windows and Linux CI.
const LOCAL_OFFSET_HOURS = (() => {
  const probeDb = new Database(":memory:");
  const { hours } = probeDb
    .prepare(
      `SELECT (julianday(datetime('now','localtime')) - julianday(datetime('now'))) * 24 AS hours`,
    )
    .get() as { hours: number };
  probeDb.close();
  return hours;
})();

// =============================================================================
// Schema
// =============================================================================

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER,
      status                 TEXT DEFAULT 'completed',
      final_amount_usd       DECIMAL(10, 2),
      paid_usd               DECIMAL(10, 2) DEFAULT 0,
      paid_lbp               DECIMAL(15, 2) DEFAULT 0,
      exchange_rate_snapshot DECIMAL(15, 2),
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER,
      sale_id                 INTEGER NOT NULL,
      sold_price_usd          DECIMAL(10, 2),
      cost_price_snapshot_usd DECIMAL(10, 2),
      is_refunded             BOOLEAN DEFAULT 0,
      created_at              TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at              TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE expenses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      amount_usd   DECIMAL(10, 2),
      amount_lbp   DECIMAL(15, 2),
      status       TEXT NOT NULL DEFAULT 'active',
      is_refunded  INTEGER DEFAULT 0,
      expense_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER,
      provider          TEXT,
      service_type      TEXT,
      amount            REAL DEFAULT 0,
      currency          TEXT DEFAULT 'USD',
      commission        REAL DEFAULT 0,
      commission_model  INTEGER NOT NULL DEFAULT 0,
      is_settled        INTEGER NOT NULL DEFAULT 1,
      settlement_id     INTEGER,
      is_refunded       INTEGER DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER,
      amount_usd    REAL DEFAULT 0,
      amount_lbp    REAL DEFAULT 0,
      profit_usd    REAL DEFAULT 0,
      profit_lbp    REAL DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Required (even empty) by notPartnerPending — called unconditionally by
    -- both getRealizedCommissionTotals and getSupplierCommissionTotals's
    -- cashless bucket. Left empty in every test here: NOT EXISTS passes
    -- every row, matching "no partner involvement" for all fixtures below.
    CREATE TABLE partner_ledger (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      partner_id         INTEGER NOT NULL,
      transaction_type   TEXT,
      reference_table    TEXT,
      reference_id       INTEGER,
      amount             REAL NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'USD',
      direction          TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount     REAL NOT NULL DEFAULT 0,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Required (even empty) by notDebtPending (getRealizedCommissionTotals)
    -- and allocationNotDebtPending (getSupplierCommissionTotals's cashless
    -- bucket). Left empty in every test here: no row is ever charged to a
    -- client's account in this fixture, so NOT EXISTS passes every row.
    CREATE TABLE debt_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      client_id         INTEGER NOT NULL,
      transaction_type  TEXT NOT NULL,
      amount_usd        REAL DEFAULT 0,
      amount_lbp        REAL DEFAULT 0,
      transaction_id    INTEGER,
      is_refunded       INTEGER DEFAULT 0,
      covered_usd       REAL NOT NULL DEFAULT 0,
      covered_lbp       REAL NOT NULL DEFAULT 0,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id             INTEGER DEFAULT 1,
      settlement_ledger_id  INTEGER NOT NULL,
      financial_service_id  INTEGER NOT NULL,
      service_type          TEXT NOT NULL,
      provider              TEXT NOT NULL,
      commission_usd        REAL NOT NULL DEFAULT 0,
      commission_lbp        REAL NOT NULL DEFAULT 0,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// =============================================================================
// Seed helpers
// =============================================================================

function insertFs(
  db: Database.Database,
  opts: {
    provider?: string;
    currency?: string;
    commission?: number;
    commissionModel?: 0 | 1;
    isSettled?: 0 | 1;
    settlementId?: number | null;
    isRefunded?: 0 | 1;
    createdAt: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled, settlement_id, is_refunded, created_at)
       VALUES (?, ?, 'SEND', 100, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      TENANT_ID,
      opts.provider ?? "OMT",
      opts.currency ?? "USD",
      opts.commission ?? 0,
      opts.commissionModel ?? 1,
      opts.isSettled ?? 1,
      opts.settlementId ?? null,
      opts.isRefunded ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

/** Phase-1's zeroed FINANCIAL_SERVICE stamp — the join getRealizedCommissionTotals
 *  needs, and (for a model-1 row) the real production shape: profit_usd/lbp = 0. */
function insertFsTransaction(
  db: Database.Database,
  fsId: number,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
       VALUES (?, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, 0, 0, ?)`,
    )
    .run(TENANT_ID, fsId, createdAt);
  return Number(res.lastInsertRowid);
}

function insertSettlementTxn(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    profitUsd?: number;
    profitLbp?: number;
    createdAt: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (?, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', ?, ?, ?, ?)`,
    )
    .run(
      TENANT_ID,
      opts.settlementLedgerId,
      opts.profitUsd ?? 0,
      opts.profitLbp ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function insertAllocation(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    financialServiceId: number;
    serviceType: string;
    provider?: string;
    commissionUsd?: number;
    commissionLbp?: number;
    createdAt: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO settlement_commission_allocations
         (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      TENANT_ID,
      opts.settlementLedgerId,
      opts.financialServiceId,
      opts.serviceType,
      opts.provider ?? "OMT",
      opts.commissionUsd ?? 0,
      opts.commissionLbp ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function insertSale(
  db: Database.Database,
  opts: { finalAmountUsd: number; paidUsd: number; createdAt: string },
): number {
  const res = db
    .prepare(
      `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
       VALUES (?, 'completed', ?, ?, 0, 90000, ?)`,
    )
    .run(TENANT_ID, opts.finalAmountUsd, opts.paidUsd, opts.createdAt);
  return Number(res.lastInsertRowid);
}

function insertSaleItem(
  db: Database.Database,
  opts: {
    saleId: number;
    soldPriceUsd: number;
    costPriceSnapshotUsd: number;
    isRefunded?: 0 | 1;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, is_refunded)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      TENANT_ID,
      opts.saleId,
      opts.soldPriceUsd,
      opts.costPriceSnapshotUsd,
      opts.isRefunded ?? 0,
    );
  return Number(res.lastInsertRowid);
}

function insertExpense(
  db: Database.Database,
  opts: { amountUsd: number; amountLbp?: number; expenseDate: string },
): number {
  const res = db
    .prepare(
      `INSERT INTO expenses (tenant_id, amount_usd, amount_lbp, status, is_refunded, expense_date)
       VALUES (?, ?, ?, 'active', 0, ?)`,
    )
    .run(TENANT_ID, opts.amountUsd, opts.amountLbp ?? 0, opts.expenseDate);
  return Number(res.lastInsertRowid);
}

// =============================================================================
// Tests
// =============================================================================

describe("FinancialRepository.getMonthlyPL — LIRA-159 D1 composition", () => {
  let db: Database.Database;
  let financialRepo: FinancialRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    initFixedTenantContext(TENANT_ID);
    // MUST run after __LIRATEK_TEST_DB__ is (re)pointed and BEFORE the test
    // body calls getMonthlyPL — see this file's header comment on singleton
    // hygiene. getMonthlyPL's own getProfitRepository() call then constructs
    // a fresh instance against THIS test's schema/db.
    resetProfitRepository();
    financialRepo = new FinancialRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
    resetProfitRepository();
    resetTenantContext();
  });

  it("1. a model-1 (AT_SETTLEMENT) row's creation-time estimate is NOT reported in the transaction month, USD", () => {
    const fsId = insertFs(db, {
      commission: 0.5,
      commissionModel: 1,
      isSettled: 0,
      createdAt: "2026-06-10 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-10 12:00:00");

    const pl = financialRepo.getMonthlyPL("2026-06");
    expect(pl.serviceCommissionsUSD).toBe(0);
    expect(pl.netProfitUSD).toBe(0);
  });

  it("1b. LBP twin: a model-1 (AT_SETTLEMENT) row's creation-time estimate is NOT reported in the transaction month, LBP", () => {
    // LBP row construction (currency/commission shape) reused from 3a/3b —
    // not a second way of building an LBP fixture. Unsettled (isSettled: 0),
    // no settlement transaction, mirroring test 1's shape exactly but for
    // the LBP arm: composing via getSupplierCommissionTotals means an
    // unsettled model-1 row's estimate must not leak into
    // serviceCommissionsLBP any more than it does into serviceCommissionsUSD.
    const fsId = insertFs(db, {
      currency: "LBP",
      commission: 45000,
      commissionModel: 1,
      isSettled: 0,
      createdAt: "2026-06-10 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-10 12:00:00");

    const pl = financialRepo.getMonthlyPL("2026-06");
    expect(pl.serviceCommissionsLBP).toBe(0);
    expect(pl.netProfitLBP).toBe(0);
  });

  it("2a. the ENTERED commission (bills-only-shaped settlement) is reported in the SETTLEMENT month, USD — never the creation month", () => {
    const ledgerId = 501;
    const fsId = insertFs(db, {
      commission: 0.5, // stale creation-time estimate — must never surface
      commissionModel: 1,
      isSettled: 1,
      settlementId: ledgerId,
      createdAt: "2026-06-10 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-10 12:00:00");
    // No allocation rows at all => NOT cashlessCommissionBatch(source_id) is
    // true => this settlement lands in the billsOnly bucket.
    insertSettlementTxn(db, {
      settlementLedgerId: ledgerId,
      profitUsd: 2.0, // real, operator-entered figure — deliberately != 0.5
      createdAt: "2026-07-05 09:00:00",
    });

    const june = financialRepo.getMonthlyPL("2026-06");
    expect(june.serviceCommissionsUSD).toBe(0);

    const july = financialRepo.getMonthlyPL("2026-07");
    expect(july.serviceCommissionsUSD).toBe(2.0);
    expect(july.serviceCommissionsLBP).toBe(0);
    expect(july.netProfitUSD).toBe(2.0);
  });

  it("2b. the ENTERED commission (cashless-shaped settlement via settlement_commission_allocations) is reported in the SETTLEMENT month, USD — never the creation month", () => {
    const ledgerId = 502;
    const fsId = insertFs(db, {
      commission: 0.5,
      commissionModel: 1,
      isSettled: 1,
      settlementId: ledgerId,
      createdAt: "2026-06-11 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-11 12:00:00");
    insertSettlementTxn(db, {
      settlementLedgerId: ledgerId,
      profitUsd: 2.0,
      createdAt: "2026-07-06 09:00:00",
    });
    // A non-BILL allocation row => cashlessCommissionBatch is true => this
    // settlement is excluded from billsOnly and sourced from allocations
    // instead (no debt row exists, so allocationNotDebtPending passes).
    insertAllocation(db, {
      settlementLedgerId: ledgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      commissionUsd: 2.0,
      createdAt: "2026-07-06 09:00:00",
    });

    const june = financialRepo.getMonthlyPL("2026-06");
    expect(june.serviceCommissionsUSD).toBe(0);

    const july = financialRepo.getMonthlyPL("2026-07");
    expect(july.serviceCommissionsUSD).toBe(2.0);
    expect(july.serviceCommissionsLBP).toBe(0);
  });

  it("3a. LBP twin (bills-only-shaped): the entered commission lands in LBP in the settlement month, and never leaks into USD", () => {
    const ledgerId = 503;
    const fsId = insertFs(db, {
      currency: "LBP",
      commission: 45000,
      commissionModel: 1,
      isSettled: 1,
      settlementId: ledgerId,
      createdAt: "2026-06-12 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-12 12:00:00");
    insertSettlementTxn(db, {
      settlementLedgerId: ledgerId,
      profitLbp: 180000,
      createdAt: "2026-07-07 09:00:00",
    });

    const june = financialRepo.getMonthlyPL("2026-06");
    expect(june.serviceCommissionsLBP).toBe(0);
    expect(june.serviceCommissionsUSD).toBe(0);

    const july = financialRepo.getMonthlyPL("2026-07");
    expect(july.serviceCommissionsLBP).toBe(180000);
    expect(july.serviceCommissionsUSD).toBe(0); // no leak into USD
    expect(july.netProfitLBP).toBe(180000);
    expect(july.netProfitUSD).toBe(0);
  });

  it("3b. LBP twin (cashless-shaped via settlement_commission_allocations): the entered commission lands in LBP in the settlement month, and never leaks into USD", () => {
    const ledgerId = 504;
    const fsId = insertFs(db, {
      currency: "LBP",
      commission: 45000,
      commissionModel: 1,
      isSettled: 1,
      settlementId: ledgerId,
      createdAt: "2026-06-13 12:00:00",
    });
    insertFsTransaction(db, fsId, "2026-06-13 12:00:00");
    insertSettlementTxn(db, {
      settlementLedgerId: ledgerId,
      profitLbp: 180000,
      createdAt: "2026-07-08 09:00:00",
    });
    insertAllocation(db, {
      settlementLedgerId: ledgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      commissionLbp: 180000,
      createdAt: "2026-07-08 09:00:00",
    });

    const june = financialRepo.getMonthlyPL("2026-06");
    expect(june.serviceCommissionsLBP).toBe(0);

    const july = financialRepo.getMonthlyPL("2026-07");
    expect(july.serviceCommissionsLBP).toBe(180000);
    expect(july.serviceCommissionsUSD).toBe(0); // no leak into USD
    expect(july.netProfitLBP).toBe(180000);
  });

  it("4. a refunded LEGACY (commission_model=0) row is excluded; its non-refunded twin still contributes (proves the gate, not just a zero)", () => {
    const refundedId = insertFs(db, {
      commission: 3,
      commissionModel: 0,
      isSettled: 1,
      isRefunded: 1,
      createdAt: "2026-08-10 10:00:00",
    });
    insertFsTransaction(db, refundedId, "2026-08-10 10:00:00");

    const liveId = insertFs(db, {
      commission: 3,
      commissionModel: 0,
      isSettled: 1,
      isRefunded: 0,
      createdAt: "2026-08-11 10:00:00",
    });
    insertFsTransaction(db, liveId, "2026-08-11 10:00:00");

    const pl = financialRepo.getMonthlyPL("2026-08");
    // If notRefunded("fs") were dropped, this would read 6 (both rows summed).
    expect(pl.serviceCommissionsUSD).toBe(3);
  });

  it("5. a refunded sale item is excluded from salesProfitUSD; the live item's margin still counts", () => {
    const saleId = insertSale(db, {
      finalAmountUsd: 150,
      paidUsd: 150,
      createdAt: "2026-08-05 14:00:00",
    });
    insertSaleItem(db, {
      saleId,
      soldPriceUsd: 100,
      costPriceSnapshotUsd: 60, // live margin: 40
      isRefunded: 0,
    });
    insertSaleItem(db, {
      saleId,
      soldPriceUsd: 50,
      costPriceSnapshotUsd: 30, // refunded margin: 20 — must NOT count
      isRefunded: 1,
    });

    const pl = financialRepo.getMonthlyPL("2026-08");
    // If notRefunded("si") were dropped, this would read 60 (40 + 20).
    expect(pl.salesProfitUSD).toBe(40);
  });

  // LIRA-159: only a POSITIVE local UTC offset can demonstrate this property
  // (see the module-scope LOCAL_OFFSET_HOURS note above) — under UTC or a
  // negative offset, local time cannot precede UTC time, so no crossing can
  // exist BY DEFINITION. Skip cleanly rather than asserting something hollow
  // in that environment; `it`/`it.skip` is jest's own conditional-test
  // idiom (ProfitRepository.localBusinessDay.test.ts's beforeAll guard
  // THROWS unconditionally instead — not reused here because a genuinely
  // non-positive offset is an environment limitation, not a bug, and should
  // report as SKIPPED, not FAILED).
  (LOCAL_OFFSET_HOURS > 0 ? it : it.skip)(
    "6. local-vs-UTC month boundary: a row whose UTC calendar month differs from its LOCAL calendar month is counted in the LOCAL month (via the expenses arm)",
    () => {
      // Build the UTC-equivalent instant for "00:01 local time on the 1st of
      // the CURRENT local month" using SQLite's own local<->UTC conversion
      // (mirrors ProfitRepository.localBusinessDay.test.ts's proven
      // technique — no hand-rolled offset math). 00:01:00 (not 01:00:00) is
      // used so the crossing holds under ANY positive offset down to one
      // minute — see the module-scope comment above for the measured
      // Windows-vs-Linux numbers this was picked to survive.
      const probe = db
        .prepare(
          `SELECT
             datetime(date('now','localtime','start of month') || ' 00:01:00', 'utc') AS ts,
             strftime('%Y-%m', date('now','localtime','start of month') || ' 00:01:00') AS localMonth`,
        )
        .get() as { ts: string; localMonth: string };
      const utcMonth = db.prepare(`SELECT strftime('%Y-%m', ?) AS m`).get(
        probe.ts,
      ) as { m: string };

      if (utcMonth.m === probe.localMonth) {
        // This branch is now reached ONLY when LOCAL_OFFSET_HOURS > 0 (that
        // positivity is exactly why this test was registered with `it`
        // instead of `it.skip`) — so a failure to cross here is NOT an
        // environment limitation, it is a genuine defect in the local<->UTC
        // conversion this test exercises. Keep this a hard failure.
        throw new Error(
          "SQLite 'localtime' did not cross a month boundary from the " +
            `constructed instant, despite a measured POSITIVE local UTC ` +
            `offset of ${LOCAL_OFFSET_HOURS}h. This is a real defect, not an ` +
            "environment limitation — do not weaken this assertion.",
        );
      }

      insertExpense(db, { amountUsd: 12.5, expenseDate: probe.ts });

      const localPl = financialRepo.getMonthlyPL(probe.localMonth);
      expect(localPl.expensesUSD).toBe(12.5);

      const utcPl = financialRepo.getMonthlyPL(utcMonth.m);
      expect(utcPl.expensesUSD).toBe(0);
    },
  );
});
