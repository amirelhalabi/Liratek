/**
 * LIRA-158 Phase 2a — read path: stop the estimate reaching reports.
 *
 * Phase 0/1 (already shipped: migration v161 +
 * FinancialServiceRepository.ts ~:1918 + SupplierRepository.ts ~:1465) fixed
 * the STAMP (`transactions.profit_usd`/`profit_lbp`): an AT_SETTLEMENT row
 * (`commission_model = 1`) now stamps 0 for the commission TERM at creation,
 * and the real, operator-entered commission is recognised instead on the
 * SUPPLIER_SETTLEMENT transaction at settlement time (period re-assigned,
 * D7 — `ProfitRepository.getSupplierCommissionTotals`).
 *
 * This phase fixes the COLUMN read side: `financial_services.commission`
 * itself still holds the stale creation-time estimate for a model-1 row
 * FOREVER (never corrected back — D6), and was being read directly, ungated
 * by model, by six ProfitRepository queries plus
 * FinancialServiceRepository.getAnalytics. Without this fix a settled
 * model-1 row's estimate would be double-counted (once here, once via the
 * settlement stamp); a WHISH/BILL row's column is force-zeroed to 0 and was
 * never the issue for THIS column, but the OMT/WHISH SEND/RECEIVE estimate
 * absolutely was.
 *
 * `embeddedCommission()` / `ProfitRepository._hasCommissionModelColumn()`
 * and `FinancialServiceRepository._hasCommissionModelColumn()` close that
 * gap: only a LEGACY (`commission_model = 0`) row's `commission` column is
 * trusted as real going forward; a model-1 row's estimate no longer reaches
 * any report covered by this phase.
 *
 * Fixture pattern copied from ProfitRepository.commissionGates.test.ts /
 * ProfitRepository.tenantIsolation.test.ts (in-memory better-sqlite3 +
 * `__LIRATEK_TEST_DB__` + `runWithTenant`) and
 * FinancialServiceRepository.tenantIsolation.test.ts (for the getAnalytics
 * "today" bucket, which keys off `DATE('now','localtime')`, not a fixed
 * constant).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-08-30 10:00:00";
const FROM = "2026-08-30 00:00:00";
const TO = "2026-08-30 23:59:59";

// =============================================================================
// Fixtures
// =============================================================================

/**
 * The post-v148 shape: `financial_services` carries `commission_model`.
 * Includes every table `embeddedCommission`'s call sites touch even when
 * empty — `partner_ledger`/`debt_ledger` back the `notPartnerPending`/
 * `notDebtPending` NOT EXISTS subqueries `getRealizedCommissionTotals` runs
 * unconditionally; a missing table (not just a missing column) kills the
 * whole file in SETUP (LIRA-158_COMMISSION_REPORTING_PLAN.md §5).
 */
function createSchemaWithCommissionModel(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

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
      commission_model INTEGER NOT NULL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    -- Referenced by notPartnerPending (PFT-6), unconditionally, even for a
    -- row with no partner involvement. Left empty: NOT EXISTS passes every
    -- row, matching this suite's "no partner rows" scenarios exactly.
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

    -- Referenced by notDebtPending (DBT-1), unconditionally. Left empty:
    -- NOT EXISTS passes every row.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

/**
 * The pre-v148 shape: NO `commission_model` column at all — matches ~30
 * existing fixtures (ProfitRepository.commissionGates.test.ts,
 * .tenantIsolation.test.ts, .partnerPendingCorrelation.test.ts,
 * ProfitService.transactionBased.test.ts). This is the schema-drift case
 * `ProfitRepository._hasCommissionModelColumn()` must degrade gracefully
 * against instead of throwing "no such column: commission_model".
 * Otherwise identical to {@link createSchemaWithCommissionModel}.
 */
function createSchemaWithoutCommissionModel(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

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
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

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
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

/** Insert a financial_services row on the WITH-commission_model schema. */
function insertFs(
  db: Database.Database,
  row: {
    provider: string;
    currency?: string;
    commission: number;
    commissionModel: number;
    isSettled: number;
    createdAt?: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, cost, price, created_at)
       VALUES (1, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(
      row.provider,
      row.currency ?? "USD",
      row.commission,
      row.commissionModel,
      row.isSettled,
      row.createdAt ?? D,
    );
  return Number(result.lastInsertRowid);
}

/** Insert a financial_services row on the WITHOUT-commission_model (legacy) schema. */
function insertFsLegacySchema(
  db: Database.Database,
  row: {
    provider: string;
    currency?: string;
    commission: number;
    isSettled: number;
    createdAt?: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, currency, commission, is_settled, is_refunded, cost, price, created_at)
       VALUES (1, ?, ?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(
      row.provider,
      row.currency ?? "USD",
      row.commission,
      row.isSettled,
      row.createdAt ?? D,
    );
  return Number(result.lastInsertRowid);
}

/** Insert the FINANCIAL_SERVICE transaction a `financial_services` row needs
 *  for getRealizedCommissionTotals's JOIN (source_table/source_id/type). */
function insertFsTxn(
  db: Database.Database,
  fsId: number,
  createdAt: string = D,
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, ?)`,
    )
    .run(fsId, createdAt);
  return Number(result.lastInsertRowid);
}

function useTestDb(db: Database.Database): void {
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as Record<string, unknown>)
    .__LIRATEK_TEST_DB__;
}

// =============================================================================
// Case 1 + 2 — getRealizedCommissionTotals
// =============================================================================

describe("LIRA-158 Phase 2a — getRealizedCommissionTotals", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchemaWithCommissionModel(db);
    useTestDb(db);
    repo = new ProfitRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
  });

  it("a settled model-1 row's estimate contributes 0; a settled model-0 row's commission still counts (D3 cutover)", () => {
    // Case 1: AT_SETTLEMENT (commission_model = 1). Pre-fix this row ALONE
    // contributed 0.50 / count 1 to this method — the estimate that Phase 1
    // already zeroed out of the profit STAMP, but that this method still
    // read straight off the fs.commission COLUMN, ungated by model.
    const model1Id = insertFs(db, {
      provider: "OMT",
      commission: 0.5,
      commissionModel: 1,
      isSettled: 1,
    });
    insertFsTxn(db, model1Id);

    // Case 2: legacy EMBEDDED (commission_model = 0). Must read EXACTLY as
    // it did before this fix — same formula that wrote it (D3 cutover, not
    // restatement).
    const model0Id = insertFs(db, {
      provider: "OMT",
      commission: 0.5,
      commissionModel: 0,
      isSettled: 1,
    });
    insertFsTxn(db, model0Id);

    const realized = runWithTenant(1, () =>
      repo.getRealizedCommissionTotals(FROM, TO),
    );

    // Breaks if `embeddedCommission("fs", this._hasCommissionModelColumn())`
    // is removed from getRealizedCommissionTotals's WHERE
    // (ProfitRepository.ts): total_usd would read 1.00 and count 2 — the
    // model-1 estimate double-counted alongside its real, settlement-time
    // commission (getSupplierCommissionTotals).
    expect(realized.total_usd).toBe(0.5);
    expect(realized.total_lbp).toBe(0);
    expect(realized.count).toBe(1);
  });
});

// =============================================================================
// Case 3 — getPendingCommissionTotals / getPendingCommissionByProvider
// =============================================================================

describe("LIRA-158 Phase 2a — getPendingCommissionTotals / getPendingCommissionByProvider", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchemaWithCommissionModel(db);
    useTestDb(db);
    repo = new ProfitRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
  });

  it("a pending model-1 row contributes 0 to both queries; a pending model-0 row still contributes its estimate", () => {
    // AT_SETTLEMENT, unsettled — no per-row estimate is ever true for this
    // model (real commission isn't known until settlement, D15/Phase 2b).
    insertFs(db, {
      provider: "OMT",
      commission: 0.75,
      commissionModel: 1,
      isSettled: 0,
    });
    // Legacy EMBEDDED, unsettled — must stay exactly as it read pre-fix.
    insertFs(db, {
      provider: "WHISH",
      commission: 1.25,
      commissionModel: 0,
      isSettled: 0,
    });

    const pending = runWithTenant(1, () =>
      repo.getPendingCommissionTotals(FROM, TO),
    );
    // Breaks if `embeddedCommission("financial_services", ...)` is removed
    // from getPendingCommissionTotals's WHERE: total_usd would read 2.00,
    // count 2 (the OMT model-1 row counted alongside WHISH).
    expect(pending.total_usd).toBe(1.25);
    expect(pending.total_lbp).toBe(0);
    expect(pending.count).toBe(1);

    const byProvider = runWithTenant(1, () =>
      repo.getPendingCommissionByProvider(FROM, TO),
    );
    // Post-Phase-3 (D15) contract: the outer WHERE only filters on
    // `is_settled = 0`, not `commission > 0`, so BOTH providers surface —
    // a provider whose pending rows are ALL model-1 (OMT here) still
    // appears, carrying `total_usd: 0` (the estimate is never trusted) and
    // `awaiting_settlement_count > 0` (the count IS knowable). If the
    // model-1 row were filtered out of the outer WHERE instead of just its
    // dollar figure, OMT would vanish from this list entirely and the UI
    // could never show "N transactions awaiting settlement" for it — which
    // is exactly the regression this assertion pins.
    const byProviderSorted = [...byProvider].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    );
    expect(byProviderSorted).toEqual([
      {
        provider: "OMT",
        total_usd: 0,
        count: 0,
        awaiting_settlement_count: 1,
      },
      {
        provider: "WHISH",
        total_usd: 1.25,
        count: 1,
        awaiting_settlement_count: 0,
      },
    ]);
  });
});

// =============================================================================
// Case 4 — schema-drift guard
// =============================================================================

describe("LIRA-158 Phase 2a — schema-drift guard (no commission_model column)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchemaWithoutCommissionModel(db);
    useTestDb(db);
    repo = new ProfitRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
  });

  it("returns the legacy (pre-fix) numbers and throws nothing against a fixture without commission_model", () => {
    const settledId = insertFsLegacySchema(db, {
      provider: "OMT",
      commission: 2,
      isSettled: 1,
    });
    insertFsTxn(db, settledId);
    insertFsLegacySchema(db, {
      provider: "OMT",
      commission: 3,
      isSettled: 0,
    });

    // Breaks if `_hasCommissionModelColumn()`'s PRAGMA guard (or its
    // "1 = 1" degradation branch in `embeddedCommission`) is removed from
    // ProfitRepository.ts: this call throws
    // "SqliteError: no such column: commission_model" and dies in SETUP —
    // exactly the failure mode that would silently break every one of the
    // ~30 real fixtures still on this pre-v148 shape (e.g.
    // ProfitRepository.tenantIsolation.test.ts,
    // ProfitRepository.partnerPendingCorrelation.test.ts,
    // ProfitService.transactionBased.test.ts), reading as a broken
    // assertion in each of them rather than as this one schema gap.
    expect(() =>
      runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO)),
    ).not.toThrow();

    const realized = runWithTenant(1, () =>
      repo.getRealizedCommissionTotals(FROM, TO),
    );
    expect(realized.total_usd).toBe(2);
    expect(realized.count).toBe(1);

    const pending = runWithTenant(1, () =>
      repo.getPendingCommissionTotals(FROM, TO),
    );
    expect(pending.total_usd).toBe(3);
    expect(pending.count).toBe(1);
  });
});

// =============================================================================
// Case 5 — FinancialServiceRepository.getAnalytics
// =============================================================================

describe("LIRA-158 Phase 2a — FinancialServiceRepository.getAnalytics", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchemaWithCommissionModel(db);
    useTestDb(db);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
  });

  it("today's settled commission excludes a model-1 row's estimate but keeps a model-0 row's", () => {
    // getAnalytics keys "today" off DATE(created_at) = DATE('now','localtime')
    // (FinancialServiceRepository.ts) — a fixed constant like `D` above would
    // flake near local midnight, so seed against the DB's own 'now' the same
    // way FinancialServiceRepository.tenantIsolation.test.ts does.
    const today = db
      .prepare(`SELECT DATE('now', 'localtime') as d`)
      .get() as { d: string };
    const todayAt = `${today.d} 10:00:00`;

    insertFs(db, {
      provider: "OMT",
      commission: 0.5,
      commissionModel: 1,
      isSettled: 1,
      createdAt: todayAt,
    });
    insertFs(db, {
      provider: "OMT",
      commission: 0.3,
      commissionModel: 0,
      isSettled: 1,
      createdAt: todayAt,
    });

    const analytics = runWithTenant(1, () => repo.getAnalytics());

    // Breaks if `modelZeroOnly` is removed from getAnalytics's todayStats
    // CASE WHEN (FinancialServiceRepository.ts): today.commission would read
    // 0.8 — the model-1 estimate double-counted alongside the real
    // commission Phase 1 already recognises separately at settlement.
    expect(analytics.today.commission).toBe(0.3);
    // COUNT(*) must stay unrestricted by model — both rows were created
    // today regardless of which one's commission counts.
    expect(analytics.today.count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // LIRA-163 — awaiting_settlement_count (today/month/byProvider)
  // ---------------------------------------------------------------------------

  it("LIRA-163: today.awaiting_settlement_count counts only STILL-UNSETTLED model-1 rows, and byProvider carries the same per-provider count", () => {
    const today = db
      .prepare(`SELECT DATE('now', 'localtime') as d`)
      .get() as { d: string };
    const todayAt = `${today.d} 10:00:00`;

    // Counts: unsettled model-1 (OMT).
    insertFs(db, {
      provider: "OMT",
      commission: 2,
      commissionModel: 1,
      isSettled: 0,
      createdAt: todayAt,
    });
    // Does NOT count: SETTLED model-1 (its real commission was already
    // recognised on the SUPPLIER_SETTLEMENT transaction, a different
    // report — getSupplierCommissionTotals — so it is no longer "awaiting"
    // anything, even though this method's own `commission` field still
    // reads 0 for it, same as before this row settled).
    insertFs(db, {
      provider: "OMT",
      commission: 1,
      commissionModel: 1,
      isSettled: 1,
      createdAt: todayAt,
    });
    // Does NOT count: unsettled but LEGACY (model-0) — its commission is
    // already a known dollar figure (embeddedCommission's own scope), not
    // an unknown awaiting settlement.
    insertFs(db, {
      provider: "WHISH",
      commission: 0.75,
      commissionModel: 0,
      isSettled: 0,
      createdAt: todayAt,
    });

    const analytics = runWithTenant(1, () => repo.getAnalytics());

    // Breaks if `atSettlementCommission`/the `is_settled = 0` condition is
    // dropped from getAnalytics's todayStats CASE WHEN: would read 2 (both
    // model-1 rows, settled or not) instead of 1.
    expect(analytics.today.awaiting_settlement_count).toBe(1);
    expect(analytics.today.count).toBe(3);

    const omtRow = analytics.byProvider.find((p) => p.provider === "OMT");
    const whishRow = analytics.byProvider.find((p) => p.provider === "WHISH");
    expect(omtRow?.awaiting_settlement_count).toBe(1);
    expect(whishRow?.awaiting_settlement_count).toBe(0);
  });

  it("LIRA-163: month.awaiting_settlement_count mirrors the today scope for the current month bound", () => {
    const monthAt = db
      .prepare(
        `SELECT strftime('%Y-%m-15 10:00:00', 'now', 'localtime') as d`,
      )
      .get() as { d: string };

    insertFs(db, {
      provider: "OMT",
      commission: 1.2,
      commissionModel: 1,
      isSettled: 0,
      createdAt: monthAt.d,
    });
    insertFs(db, {
      provider: "OMT",
      commission: 0.4,
      commissionModel: 0,
      isSettled: 0,
      createdAt: monthAt.d,
    });

    const analytics = runWithTenant(1, () => repo.getAnalytics());

    expect(analytics.month.awaiting_settlement_count).toBe(1);
    expect(analytics.month.count).toBe(2);
    expect(analytics.month.commission).toBe(0);
    expect(analytics.month.pending_commission).toBe(0.4);
  });
});
