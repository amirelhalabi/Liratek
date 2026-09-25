/**
 * OWNER_NOTES_2026-09-21.md §6 — Lane LP (Pending Profit tab), executed
 * against a real in-memory better-sqlite3 DB (rule 28: prove it by running
 * it, not by reading the query).
 *
 *  - PA-3.2 (round 2, LP-1/LP-2): `getPendingSaleProfit` used to WEIGHT a
 *    for-partner sale's `potential_profit_usd` by
 *    `(1 - saleRecognitionWeight("s"))` instead of excluding the row. That
 *    zeroed the PROFIT figure for a fully-settled partner sale but left the
 *    row itself in the list at its FULL `outstanding_usd`, still counted in
 *    `totals.count`/`total_outstanding_usd` — a phantom row a fully-settled
 *    partner sale can never leave. It also double-counted against
 *    `getDeferredProfit`'s own `partnerRow` bucket, which already carries
 *    the exact same uncovered share (LP-2). Fixed by EXCLUDING every
 *    for-partner sale from this query outright
 *    (`AND NOT saleHasPartnerObligation("s")`, the same named EXISTS
 *    fragment `saleRecognitionWeight` itself calls — rule 14, no pasted
 *    EXISTS): a for-partner sale's pending share now lives in exactly one
 *    place, the Deferred card's partner bucket, at every coverage level (0%,
 *    partial, or 100%) — not just at the two ends.
 *  - PA-3.3: `potential_profit_usd` ignored `sales.discount_usd`, overstating
 *    every discounted sale's pending profit by the discount amount (the
 *    REALIZED stamp already subtracts it — SalesRepository.ts
 *    `saleProfitUsd -= sale.discount`).
 *  - PA-3.8: the query filtered by the tab's date range, so an unpaid sale
 *    older than the (30-day default) window silently vanished from a view
 *    whose whole point is "what's still owed, right now".
 *  - PA-3.7: `getUnsettledCommissions` is model-0 (legacy) only — a shop
 *    fully cut over to AT_SETTLEMENT (commission_model = 1) providers had
 *    ZERO rows in that list, invisibly hiding every post-cutover pending
 *    OMT/WHISH/BILL commission from this tab. `ProfitService.getPendingProfit`
 *    now surfaces that as a COUNT (never a fabricated dollar figure), read
 *    from `getPendingCommissionTotals` (LP-3 — see that method's own test
 *    coverage in `ProfitService.getPendingProfit.pa37pa416.test.ts`;
 *    `getUnsettledCommissions` itself went back to its plain row-list shape
 *    so the "awaiting settlement" count has exactly ONE query answering it,
 *    not two that could drift apart).
 *
 * RED proof (rule 17), actually run (2026-09-23, round 2): with the two
 * tests below rewritten to assert `toHaveLength(0)` FIRST, then run against
 * the round-1 code (weighting, no exclusion clause) — `npx jest
 * ProfitRepository.pendingTabFixes --maxWorkers=1` reported "Tests: 2 failed,
 * 8 passed, 10 total", failing exactly the two partner-sale cases
 * ("a FULLY partner-settled sale is EXCLUDED …": expected length 0, received
 * length 1, row `{sale_id:2, outstanding_usd:200, potential_profit_usd:0}`;
 * "a PARTIALLY partner-covered sale is ALSO excluded …": expected length 0,
 * received length 1, row `{sale_id:3, outstanding_usd:150,
 * potential_profit_usd:60}`) while the other 8 cases (discount, no-date-bound,
 * ordinary-unpaid-sale control, and all 4 `getUnsettledCommissions` cases)
 * still passed. `AND NOT ${saleHasPartnerObligation("s")}` was then added to
 * the query and `npx jest ProfitRepository.pendingTabFixes --maxWorkers=1`
 * reported "Tests: 10 passed, 10 total".
 *
 * Round-1 RED proof (2026-09-23, kept for history): with `getPendingSaleProfit`
 * reverted to sum item margins with no discount subtraction and no
 * `(1 - saleRecognitionWeight)` factor, plus a literal 2026-09 date bound
 * re-added to its WHERE clause, "Tests: 6 failed, 4 passed, 10 total" — see
 * git history of this file for the exact assertions that existed at the time.
 *
 * LP-3 RED proof (2026-09-23): the `getUnsettledCommissions` describe block
 * below was rewritten to call `repo.getUnsettledCommissions(FROM, TO)` and
 * index straight into the result (`rows[0].provider`) instead of
 * destructuring `{ rows, model1_awaiting_settlement_count }`, THEN run
 * against the still-old (`{ rows, model1_awaiting_settlement_count }`)
 * return type. `npx jest ProfitRepository.pendingTabFixes --maxWorkers=1`
 * failed the whole suite at compile time — ts-jest TS7053 on both indexing
 * sites ("Property '0' does not exist on type '{ rows:
 * UnsettledCommissionRow[]; model1_awaiting_settlement_count: number; }'"),
 * i.e. the new tests are incompatible with the old shape by construction.
 * `getUnsettledCommissions` was then changed to return
 * `UnsettledCommissionRow[]` directly and `npx jest
 * ProfitRepository.pendingTabFixes --maxWorkers=1` reported "Tests: 11
 * passed, 11 total" (the discount/partner/date-bound describe block above,
 * unaffected by this change, kept its own 6 passes; the
 * `getUnsettledCommissions` block's 5 — one new "zero-commission" control
 * case was added — all newly passed).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-09-23 10:00:00";
// Well outside any typical 30-day default window ending around D.
const OLD_D = "2026-01-01 09:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0,
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
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      created_at TEXT
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );
    -- Referenced by saleRecognitionWeight/partnerCoverageRatio (PFT-6). Left
    -- empty for a non-partner sale, so the NOT EXISTS/COALESCE default (1.0
    -- for saleFullyPaid, 0.0 for a plain unpaid sale) applies unchanged.
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
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      omt_fee REAL,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );
  `);
}

function seedSale(
  db: Database.Database,
  opts: {
    id: number;
    finalAmountUsd: number;
    discountUsd?: number;
    paidUsd?: number;
    createdAt?: string;
    itemSoldUsd: number;
    itemCostUsd: number;
    itemQty?: number;
  },
): void {
  db.prepare(
    `INSERT INTO sales (id, tenant_id, status, final_amount_usd, discount_usd, paid_usd, paid_lbp, created_at)
     VALUES (?, 1, 'completed', ?, ?, ?, 0, ?)`,
  ).run(
    opts.id,
    opts.finalAmountUsd,
    opts.discountUsd ?? 0,
    opts.paidUsd ?? 0,
    opts.createdAt ?? D,
  );
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, product_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, ?, NULL, ?, ?, ?, 0)`,
  ).run(opts.id, opts.itemSoldUsd, opts.itemCostUsd, opts.itemQty ?? 1);
}

function seedPartnerObligation(
  db: Database.Database,
  saleId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount)
     VALUES (1, 1, 'FOR_SUPPLIER', 'sales', ?, ?, 'USD', 'CREDIT', ?)`,
  ).run(saleId, amount, coveredAmount);
}

describe("ProfitRepository.getPendingSaleProfit — PA-3.2 / PA-3.3 / PA-3.8", () => {
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

  it("PA-3.3: subtracts the sale discount from potential_profit_usd", () => {
    // Margin = (100 - 50) * 1 = 50; discount 10 -> expect 40.
    // RED (pre-fix): potential_profit_usd came back 50 (discount ignored).
    seedSale(db, {
      id: 1,
      finalAmountUsd: 90,
      discountUsd: 10,
      paidUsd: 0,
      itemSoldUsd: 100,
      itemCostUsd: 50,
    });

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(1);
    expect(rows[0].potential_profit_usd).toBeCloseTo(40, 2);
  });

  it("LP-1/LP-2 (round 2): a FULLY partner-settled sale is EXCLUDED entirely, not just zeroed — it must not appear in the row list, count, or outstanding total", () => {
    // Margin = 150 - 100 = 50, paid_usd = 0 (for-partner sale — the
    // customer never pays one directly). Partner has covered 100% of their
    // 200 obligation, so getSalesProfit/getByUser/getByClient already
    // recognise this row's profit at its FULL weight (saleRecognitionWeight
    // = 1.0). Round-1 zeroed potential_profit_usd but LEFT the row (and its
    // full $200 outstanding_usd) in the list forever — a phantom row that
    // inflated totals.count/total_outstanding_usd (ProfitService sums these
    // straight off this row list) and double-counted against
    // getDeferredProfit's own partnerRow bucket (LP-2). This row must now be
    // GONE, not just zero-profit.
    seedSale(db, {
      id: 2,
      finalAmountUsd: 200,
      paidUsd: 0,
      itemSoldUsd: 150,
      itemCostUsd: 100,
    });
    seedPartnerObligation(db, 2, 200, 200);

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(0);
  });

  it("LP-1/LP-2 (round 2): a PARTIALLY partner-covered sale is ALSO excluded entirely — its uncovered share lives only in the Deferred card", () => {
    // Margin = 100, partner has covered 40 of a 100 obligation. Any
    // for-partner sale (any coverage level, including 0%) is now out of
    // this query's scope by construction — its pending share, whatever
    // fraction it is, is exclusively getDeferredProfit's partnerRow bucket
    // (owned by lane LO), never this one. Two independent buckets showing
    // the SAME uncovered dollar is the exact double-count LP-2 reported.
    seedSale(db, {
      id: 3,
      finalAmountUsd: 150,
      paidUsd: 0,
      itemSoldUsd: 150,
      itemCostUsd: 50,
    });
    seedPartnerObligation(db, 3, 100, 40);

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(0);
  });

  it("PA-3.2: an ordinary (non-partner) unpaid sale is completely unaffected — still its full margin", () => {
    seedSale(db, {
      id: 4,
      finalAmountUsd: 80,
      paidUsd: 20,
      itemSoldUsd: 80,
      itemCostUsd: 50,
    });

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(1);
    expect(rows[0].potential_profit_usd).toBeCloseTo(30, 2);
  });

  it("PA-3.8: an unpaid sale far outside any typical date window still appears — pending means as of now", () => {
    // RED (pre-fix): getPendingSaleProfit(fromDt, toDt) required a date
    // range and this row (created 2026-01-01) fell outside a window like
    // 2026-08-24..2026-09-23 (a 30-day default ending near D) — 0 rows.
    seedSale(db, {
      id: 5,
      finalAmountUsd: 40,
      paidUsd: 0,
      createdAt: OLD_D,
      itemSoldUsd: 40,
      itemCostUsd: 25,
    });

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(1);
    expect(rows[0].sale_id).toBe(5);
    expect(rows[0].potential_profit_usd).toBeCloseTo(15, 2);
  });

  it("a fully-paid sale never appears (unaffected baseline)", () => {
    seedSale(db, {
      id: 6,
      finalAmountUsd: 50,
      paidUsd: 50,
      itemSoldUsd: 50,
      itemCostUsd: 30,
    });

    const rows = runWithTenant(1, () => repo.getPendingSaleProfit());

    expect(rows).toHaveLength(0);
  });
});

describe("ProfitRepository.getUnsettledCommissions — PA-3.7 / LP-3 (plain row-list shape)", () => {
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

  const FROM = "2026-09-01 00:00:00";
  const TO = "2026-09-30 23:59:59";

  function insertFs(opts: {
    provider: string;
    commission: number;
    commissionModel: number;
    createdAt?: string;
  }): void {
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, created_at)
       VALUES (1, ?, 'USD', ?, ?, 0, 0, ?)`,
    ).run(opts.provider, opts.commission, opts.commissionModel, opts.createdAt ?? D);
  }

  /**
   * LP-3: `getUnsettledCommissions` used to hand-rebuild the SAME
   * "model-1 row awaiting settlement" window `getPendingCommissionTotals`
   * already computes (is_settled=0 / notRefunded / dateRange / tenant +
   * atSettlementCommission) as a second, independent query bolted onto this
   * one's return value — two queries answering one question, free to drift
   * apart (rule 14). `ProfitService.getPendingProfit` now reads that count
   * from `getPendingCommissionTotals` directly (see
   * `ProfitService.getPendingProfit.pa37pa416.test.ts`), so this method went
   * back to its plain array shape — nothing here computes that count any
   * more.
   */
  it("a legacy (model-0) unsettled row appears in the returned array", () => {
    insertFs({ provider: "WHISH", commission: 2, commissionModel: 0 });

    const rows = runWithTenant(1, () => repo.getUnsettledCommissions(FROM, TO));

    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("WHISH");
  });

  it("a model-1 (AT_SETTLEMENT) row with commission = 0 (force-zeroed) is invisible in the returned array — its count is `getPendingCommissionTotals`'s job now, not this method's", () => {
    // Mirrors production: a plain OMT/WHISH SEND/RECEIVE model-1 row's
    // `commission` column is force-zeroed at write time — the real
    // commission does not exist until settlement, so it must never appear
    // in this legacy-commission row list.
    insertFs({ provider: "OMT", commission: 0, commissionModel: 1 });

    const rows = runWithTenant(1, () => repo.getUnsettledCommissions(FROM, TO));

    expect(rows).toHaveLength(0);
  });

  it("mixes both without the model-1 row leaking into the legacy list", () => {
    insertFs({ provider: "WHISH", commission: 3, commissionModel: 0 });
    insertFs({ provider: "OMT", commission: 0, commissionModel: 1 });
    insertFs({ provider: "OMT", commission: 0, commissionModel: 1 });

    const rows = runWithTenant(1, () => repo.getUnsettledCommissions(FROM, TO));

    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("WHISH");
  });

  it("a settled row (is_settled = 1) never appears", () => {
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, created_at)
       VALUES (1, 'OMT', 'USD', 5, 1, 1, 0, ?)`,
    ).run(D);

    const rows = runWithTenant(1, () => repo.getUnsettledCommissions(FROM, TO));

    expect(rows).toHaveLength(0);
  });

  it("a zero-commission legacy row is excluded (matches getPendingCommissionTotals's own `commission > 0` gate)", () => {
    insertFs({ provider: "WHISH", commission: 0, commissionModel: 0 });

    const rows = runWithTenant(1, () => repo.getUnsettledCommissions(FROM, TO));

    expect(rows).toHaveLength(0);
  });
});
