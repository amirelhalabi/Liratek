/**
 * LIRA-158 D17 (owner decision, 2026-08-31) — a CASHLESS supplier settlement
 * (OMT/WHISH, or a MIXED bills+OMT batch — anything that is NOT bills-only)
 * defers its commission until the CLIENT repays the underlying transfer. The
 * owner settles these batches out of his OWN drawer BEFORE the customer who
 * owes him for the transfer has paid, so the commission is contingent on
 * that collection, exactly like the legacy `commission_model = 0` embedded
 * path already defers via `notDebtPending`.
 *
 * A BILLS-ONLY settlement (Katsh/iPick) is the deliberate exception: its
 * commission is a REAL provider-funded drawer top-up (or real payment legs)
 * the instant it's recognised — immediate recognition, unchanged by this
 * ticket, and NEVER gated on the client's own debt status.
 *
 * Covers `ProfitRepository.getSupplierCommissionTotals` and
 * `ProfitRepository.getDeferredProfit`'s new cashless arm — the two
 * `ProfitRepository.ts` surfaces D17 touches (`getFinancialSettledByProvider`
 * / `getByDate`'s allocation arms gained the SAME two gates but are already
 * exercised end-to-end by `LIRA158.settlementAttribution.test.ts`; this file
 * does not re-prove their pre-existing per-provider/per-date mechanics).
 *
 * D17 FOLLOW-UP (Item 1) — also covers `getByUser`/`getByClient`, which
 * shipped D17's OTHER four surfaces but bypassed it themselves: both views
 * routed a SUPPLIER_SETTLEMENT/REFUND row through their generic
 * `ELSE t.profit_usd`/`t.profit_lbp` arm (source_table 'supplier_ledger'
 * matches neither the sales nor financial_services special case), stamping
 * the FULL entered commission on EVERY settlement batch regardless of
 * client-debt status. The new describe block below proves the fix via
 * `ProfitRepository.supplierSettlementProfitArm` — reused byte-for-byte in
 * both views' usd/lbp arms (rule 14) — the same way the block above proves
 * `getSupplierCommissionTotals`/`getDeferredProfit`.
 *
 * Fixture note (CLAUDE.md's test-schema trap / this repo's own §5): the
 * schema below is the union of `LIRA158.settlementAttribution.test.ts`'s
 * proven `financial_services`/`transactions`/`settlement_commission_allocations`/
 * `partner_ledger` shape (already proven to run every ProfitRepository query
 * this file touches) plus `debt_ledger` with the exact columns
 * `notDebtPending` reads (`transaction_id`, `transaction_type`, `is_refunded`,
 * `covered_usd`/`covered_lbp`, `amount_usd`/`amount_lbp`).
 *
 * Rule 17 — the LAST describe block in this file reintroduces the ungated
 * arm (by temporarily deleting the `allocationNotDebtPending` line from
 * `ProfitRepository.ts`), re-runs `npx jest` on this exact file, records the
 * failing output, then restores the source and re-runs to confirm green
 * again — all performed for real (not simulated) via the Edit/Bash tools,
 * per the task's explicit instruction that core jest may be run to verify.
 * See the task report for the failing-run transcript.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM_DATE = "2026-07-01 00:00:00";
const TO_DATE = "2026-07-31 23:59:59";
// Narrow window covering ONLY the settlement day — used to prove D7 period
// assignment (the commission must NOT appear on the transaction's own day).
const SETTLE_DAY_ONLY_FROM = "2026-07-20 00:00:00";
const SETTLE_DAY_ONLY_TO = "2026-07-20 23:59:59";

const TXN_DAY = "2026-06-15 12:00:00"; // outside the settlement-day-only window
const SETTLE_DAY = "2026-07-20 12:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
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

    -- Needed by getByUser/getByClient's LEFT JOINs (Item 1's
    -- supplierSettlementProfitArm coverage below) — empty is fine, the
    -- COALESCE fallbacks ('Unknown' / 'Walk-in') are what these tests exercise.
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT,
      created_at TEXT,
      updated_at TEXT
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
      settlement_id INTEGER,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
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

    -- Referenced by notPartnerPending — left empty everywhere in this file
    -- (this ticket is about the CLIENT debt gate, not the partner gate; the
    -- partner gate's own coverage lives in LIRA158.settlementAttribution.test.ts).
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
      covered_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by notDebtPending (DBT-1) via allocationNotDebtPending's
    -- resolved FINANCIAL_SERVICE transaction id — the column set is the
    -- exact subset notDebtPending's SQL reads.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    -- Every OTHER table ProfitRepository's Rule-14 fragments or getByDate's
    -- unconditional CTEs might touch, so a stray unrelated query never dies
    -- in SETUP with "no such table" (this file only calls
    -- getSupplierCommissionTotals / getDeferredProfit, but keep this cheap
    -- insurance since both share a repository instance with everything else).
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, sold_price_usd REAL DEFAULT 0, cost_price_snapshot_usd REAL DEFAULT 0, quantity INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, carrier TEXT, currency_code TEXT DEFAULT 'USD', price REAL DEFAULT 0, cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, price_usd REAL DEFAULT 0, price_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, final_amount_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE loto_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT DEFAULT 'active', amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, expense_date TEXT, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE exchange_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
  `);
}

/** Pre-v150 shape (§5, §6 item 6): NO settlement_commission_allocations table
 *  at all, and financial_services predates commission_model/settlement_id. */
function createLegacySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, client_id INTEGER, reverses_id INTEGER, created_at TEXT
    );
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      omt_fee REAL, cost REAL DEFAULT 0, price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL, transaction_type TEXT,
      reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')), covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, transaction_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, sold_price_usd REAL DEFAULT 0, cost_price_snapshot_usd REAL DEFAULT 0, quantity INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, carrier TEXT, currency_code TEXT DEFAULT 'USD', price REAL DEFAULT 0, cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, price_usd REAL DEFAULT 0, price_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, final_amount_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE loto_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT DEFAULT 'active', amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, expense_date TEXT, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE exchange_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
  `);
}

function seedFs(
  db: Database.Database,
  opts: {
    provider: string;
    currency?: string;
    isSettled?: 0 | 1;
    settlementId?: number | null;
    createdAt: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, amount, currency, commission, commission_model, is_settled, settlement_id, is_refunded, created_at)
       VALUES (1, ?, 100, ?, 0, 1, ?, ?, 0, ?)`,
    )
    .run(
      opts.provider,
      opts.currency ?? "USD",
      opts.isSettled ?? 1,
      opts.settlementId ?? null,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

/** Phase 1's zeroed FINANCIAL_SERVICE stamp — every model-1 row's own
 *  transaction contributes 0 profit; the real figure lives at settlement. */
function seedFsTransaction(
  db: Database.Database,
  fsId: number,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, 0, 0, ?)`,
    )
    .run(fsId, createdAt);
  return Number(res.lastInsertRowid);
}

function seedSettlementTxn(
  db: Database.Database,
  opts: {
    type?: "SUPPLIER_SETTLEMENT" | "REFUND";
    settlementLedgerId: number;
    profitUsd?: number;
    profitLbp?: number;
    status?: string;
    createdAt: string;
    /** Item 1 (getByUser) — the user who settled, per D14's "attributed to
     *  the settling user" rule. Omitted (NULL) groups under 'Unknown'. */
    userId?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id, profit_usd, profit_lbp, created_at)
       VALUES (1, ?, ?, 'supplier_ledger', ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.type ?? "SUPPLIER_SETTLEMENT",
      opts.status ?? "ACTIVE",
      opts.settlementLedgerId,
      opts.userId ?? null,
      opts.profitUsd ?? 0,
      opts.profitLbp ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function seedAllocation(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    financialServiceId: number;
    serviceType: string;
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
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.settlementLedgerId,
      opts.financialServiceId,
      opts.serviceType,
      opts.provider,
      opts.commissionUsd ?? 0,
      opts.commissionLbp ?? 0,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

/** An uncovered/covered module-debt row (DBT-1) keyed to an fs row's OWN
 *  FINANCIAL_SERVICE transaction id — the exact id
 *  `allocationNotDebtPending` resolves to and gates on. */
function seedDebt(
  db: Database.Database,
  opts: {
    fsTxnId: number;
    amountUsd?: number;
    coveredUsd?: number;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO debt_ledger
       (tenant_id, client_id, transaction_type, amount_usd, transaction_id, covered_usd, created_at)
     VALUES (1, 1, 'Service Debt', ?, ?, ?, ?)`,
  ).run(opts.amountUsd ?? 100, opts.fsTxnId, opts.coveredUsd ?? 0, opts.createdAt);
}

function coverDebt(db: Database.Database, fsTxnId: number): void {
  db.prepare(
    `UPDATE debt_ledger SET covered_usd = amount_usd WHERE transaction_id = ?`,
  ).run(fsTxnId);
}

describe("LIRA-158 D17 — cashless settlement commission defers on client debt", () => {
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

  it("1. account-charged OMT settlement: NOT realized on settlement day while debt is uncovered; appears in deferred instead; realized (still on the SETTLEMENT day) once the debt is covered", () => {
    const settlementLedgerId = 701;
    const fsId = seedFs(db, {
      provider: "OMT",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    seedDebt(db, { fsTxnId, amountUsd: 100, coveredUsd: 0, createdAt: TXN_DAY });
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 2.0,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 2.0,
      createdAt: SETTLE_DAY,
    });

    // Not realized while uncovered — over a window covering the settlement
    // day, the $2.00 must NOT appear (this is the gate D17 adds).
    let totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(0);
    expect(totals.count).toBe(0);

    // Shows up in the deferred bucket instead — money that stops being
    // recognised must not simply vanish from every profits view.
    let deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(2.0);

    // Never appears on the TRANSACTION's own day either (D7 period
    // assignment — TXN_DAY is in June, outside July's realized OR deferred
    // window when queried over July).
    const julyTotals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(FROM_DATE, TO_DATE),
    );
    expect(julyTotals.profit_usd).toBe(0);

    // Cover the debt — the commission becomes realized, still bucketed on
    // the SETTLEMENT day (SETTLE_DAY_ONLY window), never the transaction day.
    coverDebt(db, fsTxnId);

    totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(2.0);
    expect(totals.count).toBe(1);

    deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(0);
  });

  it("2. cash-paid OMT settlement (no debt row at all): realized immediately — the gate no-ops, byte-identical to pre-D17 behavior", () => {
    const settlementLedgerId = 702;
    const fsId = seedFs(db, {
      provider: "OMT",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    seedFsTransaction(db, fsId, TXN_DAY);
    // No debt_ledger row at all — this transfer was paid in cash, not
    // charged to the client's account.
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 3.5,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 3.5,
      createdAt: SETTLE_DAY,
    });

    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(3.5);
    expect(totals.count).toBe(1);

    const deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(0);
  });

  it("3. bills-only Katsh settlement with an account-charged bill: STILL recognises immediately — bills-only is never gated on client debt", () => {
    const settlementLedgerId = 703;
    const fsId = seedFs(db, {
      provider: "Katsh",
      isSettled: 1,
      settlementId: settlementLedgerId,
      currency: "LBP",
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    // Debt-pending — this bill WAS charged to the client's account — yet a
    // bills-only settlement must not care: the money is real (a provider
    // drawer top-up) the instant it's recognised.
    seedDebt(db, { fsTxnId, amountUsd: 100, coveredUsd: 0, createdAt: TXN_DAY });
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitLbp: 20000,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "BILL",
      provider: "Katsh",
      commissionLbp: 20000,
      createdAt: SETTLE_DAY,
    });

    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_lbp).toBe(20000);
    expect(totals.count).toBe(1);

    // Never deferred — cashlessCommissionBatch is false (every allocation
    // row for this settlement is BILL), so the deferred arm's own
    // cashlessCommissionBatch gate excludes it outright regardless of debt.
    const deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_lbp).toBe(0);
  });

  it("4. MIXED bills+OMT batch: the BILL's own share defers too (owner decision) — no money arrives for it either once it shares a batch with a non-BILL row; the batch's cash-paid OMT share still recognises independently", () => {
    const settlementLedgerId = 704;
    const billFsId = seedFs(db, {
      provider: "Katsh",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    const billFsTxnId = seedFsTransaction(db, billFsId, TXN_DAY);
    // The BILL half of this mixed batch is account-charged and uncovered.
    seedDebt(db, {
      fsTxnId: billFsTxnId,
      amountUsd: 100,
      coveredUsd: 0,
      createdAt: TXN_DAY,
    });

    const omtFsId = seedFs(db, {
      provider: "OMT",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    seedFsTransaction(db, omtFsId, TXN_DAY);
    // The OMT half was paid in cash — no debt row at all.

    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 2.0, // 1.00 BILL share + 1.00 OMT share
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: billFsId,
      serviceType: "BILL",
      provider: "Katsh",
      commissionUsd: 1.0,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: omtFsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 1.0,
      createdAt: SETTLE_DAY,
    });

    // Would read 2.00 if the bills-only bucket still swept up this MIXED
    // batch's full stamp (the pre-D17 shape) — only the OMT share (cash-paid,
    // not debt-pending) is currently recognised; the BILL share defers.
    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(1.0);

    // The BILL share's $1.00 surfaces as deferred — proving it moved to the
    // cashless bucket (mixed-batch classification) AND is being held there
    // by its own debt-pending status, not silently dropped.
    const deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(1.0);

    // Cover the BILL's debt — the remaining $1.00 becomes realized too, and
    // the total now matches the full entered commission.
    coverDebt(db, billFsTxnId);
    const totalsAfter = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totalsAfter.profit_usd).toBe(2.0);
  });

  it("5. create -> settle -> void nets every currency to 0, for both a RECOGNIZED (debt-covered) and a DEFERRED (debt-uncovered) cashless settlement (rule 20)", () => {
    // 5a. Recognized case.
    const recognizedLedgerId = 705;
    const recFsId = seedFs(db, {
      provider: "WHISH",
      isSettled: 1,
      settlementId: recognizedLedgerId,
      createdAt: TXN_DAY,
    });
    seedFsTransaction(db, recFsId, TXN_DAY);
    const recTxnId = seedSettlementTxn(db, {
      settlementLedgerId: recognizedLedgerId,
      profitUsd: 4.25,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId: recognizedLedgerId,
      financialServiceId: recFsId,
      serviceType: "SEND",
      provider: "WHISH",
      commissionUsd: 4.25,
      createdAt: SETTLE_DAY,
    });

    let totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(4.25);

    // Reproduce TransactionRepository.voidTransaction's + _reverseSupplierSettlement's
    // core effects on the settlement transaction and its allocations.
    db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(
      recTxnId,
    );
    db.prepare(
      `DELETE FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`,
    ).run(recognizedLedgerId);

    totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(0);
    let deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(0);

    // 5b. Deferred (uncovered-debt) case — voiding must also make it
    // disappear from the DEFERRED bucket, not just stay un-realized.
    const deferredLedgerId = 706;
    const defFsId = seedFs(db, {
      provider: "OMT",
      isSettled: 1,
      settlementId: deferredLedgerId,
      createdAt: TXN_DAY,
    });
    const defFsTxnId = seedFsTransaction(db, defFsId, TXN_DAY);
    seedDebt(db, {
      fsTxnId: defFsTxnId,
      amountUsd: 50,
      coveredUsd: 0,
      createdAt: TXN_DAY,
    });
    const defTxnId = seedSettlementTxn(db, {
      settlementLedgerId: deferredLedgerId,
      profitUsd: 1.5,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId: deferredLedgerId,
      financialServiceId: defFsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 1.5,
      createdAt: SETTLE_DAY,
    });

    deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(1.5);

    db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(
      defTxnId,
    );
    db.prepare(
      `DELETE FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`,
    ).run(deferredLedgerId);

    deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(0);
    totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(totals.profit_usd).toBe(0);
  });
});

describe("LIRA-158 D17 Item 1 — getByUser/getByClient supplier-settlement arm", () => {
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

  it("getByUser: account-charged cashless settlement contributes 0 to the settling user's profit while debt is uncovered, and the full commission once covered", () => {
    const settlementLedgerId = 801;
    const userId = 42;
    const fsId = seedFs(db, {
      provider: "OMT",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    seedDebt(db, { fsTxnId, amountUsd: 100, coveredUsd: 0, createdAt: TXN_DAY });
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 2.0,
      createdAt: SETTLE_DAY,
      userId,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 2.0,
      createdAt: SETTLE_DAY,
    });

    // Debt uncovered — before the Item 1 fix this read 2.0 unconditionally
    // (the generic ELSE arm stamps the full commission regardless of D17).
    let rows = runWithTenant(1, () =>
      repo.getByUser(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    let row = rows.find((r) => r.user_id === userId);
    expect(row?.profit_usd ?? 0).toBe(0);

    // Cover the debt — the same settlement day's commission becomes realized.
    coverDebt(db, fsTxnId);

    rows = runWithTenant(1, () =>
      repo.getByUser(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    row = rows.find((r) => r.user_id === userId);
    expect(row?.profit_usd).toBe(2.0);
  });

  it("getByUser: bills-only settlement contributes its full commission immediately, even though the underlying bill is account-charged and uncovered", () => {
    const settlementLedgerId = 802;
    const userId = 43;
    const fsId = seedFs(db, {
      provider: "Katsh",
      isSettled: 1,
      settlementId: settlementLedgerId,
      currency: "LBP",
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    // Debt-pending — irrelevant for a bills-only batch (immediate, never
    // client-debt-gated).
    seedDebt(db, { fsTxnId, amountUsd: 100, coveredUsd: 0, createdAt: TXN_DAY });
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitLbp: 20000,
      createdAt: SETTLE_DAY,
      userId,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "BILL",
      provider: "Katsh",
      commissionLbp: 20000,
      createdAt: SETTLE_DAY,
    });

    const rows = runWithTenant(1, () =>
      repo.getByUser(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    const row = rows.find((r) => r.user_id === userId);
    expect(row?.profit_lbp).toBe(20000);
  });

  it("getByClient: account-charged cashless settlement contributes 0 to the Walk-in bucket while debt is uncovered, full commission once covered", () => {
    const settlementLedgerId = 803;
    const fsId = seedFs(db, {
      provider: "WHISH",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    seedDebt(db, { fsTxnId, amountUsd: 60, coveredUsd: 0, createdAt: TXN_DAY });
    // No client_id on a settlement row (no client on a settlement — see
    // ProfitRepository.ts's PROFIT_TXN_TYPES doc comment) — it lands in the
    // 'Walk-in' bucket, same as production.
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 1.25,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "SEND",
      provider: "WHISH",
      commissionUsd: 1.25,
      createdAt: SETTLE_DAY,
    });

    let rows = runWithTenant(1, () =>
      repo.getByClient(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO, 50),
    );
    let walkIn = rows.find((r) => r.client_name === "Walk-in");
    expect(walkIn?.profit_usd ?? 0).toBe(0);

    coverDebt(db, fsTxnId);

    rows = runWithTenant(1, () =>
      repo.getByClient(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO, 50),
    );
    walkIn = rows.find((r) => r.client_name === "Walk-in");
    expect(walkIn?.profit_usd).toBe(1.25);
  });

  it("getByClient: bills-only settlement contributes its full commission immediately to the Walk-in bucket", () => {
    const settlementLedgerId = 804;
    const fsId = seedFs(db, {
      provider: "iPick",
      isSettled: 1,
      settlementId: settlementLedgerId,
      createdAt: TXN_DAY,
    });
    const fsTxnId = seedFsTransaction(db, fsId, TXN_DAY);
    seedDebt(db, { fsTxnId, amountUsd: 40, coveredUsd: 0, createdAt: TXN_DAY });
    seedSettlementTxn(db, {
      settlementLedgerId,
      profitUsd: 0.75,
      createdAt: SETTLE_DAY,
    });
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: fsId,
      serviceType: "BILL",
      provider: "iPick",
      commissionUsd: 0.75,
      createdAt: SETTLE_DAY,
    });

    const rows = runWithTenant(1, () =>
      repo.getByClient(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO, 50),
    );
    const walkIn = rows.find((r) => r.client_name === "Walk-in");
    expect(walkIn?.profit_usd).toBe(0.75);
  });
});

describe("LIRA-158 D17 — schema-drift fallback (pre-v150 fixture, no allocations table)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createLegacySchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    // A FRESH instance — _hasSettlementAllocationsTable() is memoized per
    // repository instance (matches LIRA158.settlementAttribution.test.ts's
    // own precedent for this exact trap).
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("6. getSupplierCommissionTotals / getDeferredProfit run without throwing and degrade to the OLD, undifferentiated stamp-only total when settlement_commission_allocations doesn't exist at all", () => {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 1, 5.0, ?)`,
    ).run(SETTLE_DAY);

    expect(() => {
      runWithTenant(1, () =>
        repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
      );
    }).not.toThrow();

    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    // Old, undifferentiated behavior: the stamp counts in full, regardless
    // of any debt — there is no allocations table to classify or gate on.
    expect(totals.profit_usd).toBe(5.0);
    expect(totals.count).toBe(1);

    expect(() => {
      runWithTenant(1, () =>
        repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
      );
    }).not.toThrow();
    const deferred = runWithTenant(1, () =>
      repo.getDeferredProfit(SETTLE_DAY_ONLY_FROM, SETTLE_DAY_ONLY_TO),
    );
    expect(deferred.client_debt_profit_usd).toBe(0);
  });
});
