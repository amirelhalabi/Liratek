/**
 * NOT RUN — proven at the end-of-batch gate (OWNER_NOTES_REMAINING_BUILD.md
 * #14 slice 2 batch process rule: implement first, verify at the end).
 *
 * ProfitRepository.getSalesDetail / getRechargeDetail +
 * ProfitService.getModuleDetail — the Profits page "Show transactions"
 * drill-down (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2).
 *
 * Owner requirement under test: "counted rows add up EXACTLY to the module
 * row; a greyed 'not counted yet' section with a reason per sale." This file
 * proves that reconciliation for BOTH slice-2 modules (SALE,
 * RECHARGE_<carrier>) against the SAME repository methods that feed the By
 * Module totals row (`getSalesRevCost`/`getSalesProfit`/
 * `getRechargesByCarrier` — rule 14, shared `saleRecognitionWeight`/
 * `partnerCoverageRatio`/`notDebtPending` fragments), and proves each
 * not-counted row carries a reason.
 *
 * Rule 17 note: this is new reporting, not a bug fix — there is no pre-fix
 * buggy build to run these tests against. The guard this file actually
 * provides is architectural: it is written against `getSalesDetail`/
 * `getRechargeDetail` calling the SAME exported fragments
 * (`saleRecognitionWeight`, `partnerCoverageRatio`, `notDebtPending`) the
 * totals queries call — a hand-copied second predicate (rule 14 violation)
 * would desync the two sides of this file's own reconciliation assertions
 * the moment the weighting diverges, which is the failure mode this test
 * exists to catch on every future edit to either query.
 *
 * PROF-DD-FIX (review round, 2026-09-24) — this file was extended to close
 * every finding the round-0 review made BY READING (n14_review_r0.json).
 * Unlike the paragraph above, several of these DO have a rule-17 pre-fix
 * shape: the SALE describe block's own `beforeEach` already exercises the
 * NET (discount/refund) branch, so B1 (an ambiguous-column SQLite error)
 * would have failed EVERY test in that block before its fix, and M1's new
 * `seedRefundedSaleWithResidualProfit` sale would have been silently absent
 * from `detail.counted`/`not_counted` before `getRefundedSalesDetail`
 * existed. `is_refunded` was added to the fixture's `expenses` table (it was
 * missing entirely) so m1's `activeExpense("e")` gate has a real column to
 * read, and a new recharge (r5) + a dedicated test prove a REVERSED auto fee
 * expense stops showing its `fee_note`. Two new standalone describe blocks
 * cover M4 (the "Customer still owes" reason's figures) and m6
 * (`items_summary` excluding a fully-refunded line whose `is_refunded` flag
 * was never flipped — see `seedRefundedSaleWithResidualProfit`'s own doc
 * comment on why that flag only moves on a WHOLE-sale void).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { runWithTenant } from "../../db/tenantContext";

const FROM = "2026-09-01 00:00:00";
const TO = "2026-09-30 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER,
      total_amount_usd REAL NOT NULL DEFAULT 0,
      discount_usd REAL NOT NULL DEFAULT 0,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      sold_price_usd REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT,
      source_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by saleRecognitionWeight/partnerCoverageRatio/
    -- hasPartnerObligation.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL DEFAULT 1,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL DEFAULT 'DEBIT',
      covered_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by notDebtPending.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL DEFAULT 1,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      amount REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      phone_number TEXT,
      client_name TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      -- PROF-DD-FIX (review round, m1) - real schema column (create_db.sql);
      -- the generic void/refund path flips THIS, never status, on an
      -- auto-fee expense reversed via the Transactions viewer. Missing here
      -- would (a) make activeExpense('e')'s notRefunded reference a
      -- non-existent column and (b) hide the exact regression m1 fixes.
      is_refunded INTEGER NOT NULL DEFAULT 0,
      source_ref_table TEXT,
      source_ref_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO products (id, tenant_id, name) VALUES (1, 1, 'Charger')`).run();
}

function seedSale(
  db: Database.Database,
  opts: { finalUsd: number; paidUsd: number; soldPriceUsd: number; costUsd: number },
): number {
  const res = db
    .prepare(
      `INSERT INTO sales (tenant_id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, status, created_at)
       VALUES (1, NULL, ?, 0, ?, ?, 0, 'completed', '2026-09-10 10:00:00')`,
    )
    .run(opts.finalUsd, opts.finalUsd, opts.paidUsd);
  const saleId = Number(res.lastInsertRowid);
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
     VALUES (1, ?, 1, 1, ?, ?, 0, 0)`,
  ).run(saleId, opts.soldPriceUsd, opts.costUsd);
  return saleId;
}

function seedSaleTransaction(
  db: Database.Database,
  saleId: number,
  profitUsd: number,
): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, ?, 0, '2026-09-10 10:00:00')`,
  ).run(saleId, profitUsd);
}

/**
 * PROF-DD-FIX (review round, M1) — a sale `SalesRepository.refundSaleItem`
 * has flipped to `status = 'refunded'` (every line's remaining quantity hit
 * 0) but whose SALE + REFUND transaction rows net to a NONZERO residual
 * (kept change, a stamp residual). `getSalesProfit` (the By Module total)
 * counts this sale via its own `status IN ('completed', 'refunded')` arm;
 * before this fix `getSalesDetail` had no way to surface it at all (its
 * `sale_agg` CTE gates on `status = 'completed'` only — see `saleAggBody`'s
 * own doc comment for why that gate exists).
 */
function seedRefundedSaleWithResidualProfit(
  db: Database.Database,
  opts: {
    finalUsd: number;
    paidUsd: number;
    saleProfitUsd: number;
    refundProfitUsd: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO sales (tenant_id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, status, created_at)
       VALUES (1, NULL, ?, 0, ?, ?, 0, 'refunded', '2026-09-12 11:00:00')`,
    )
    .run(opts.finalUsd, opts.finalUsd, opts.paidUsd);
  const saleId = Number(res.lastInsertRowid);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, ?, 0, '2026-09-12 11:00:00')`,
  ).run(saleId, opts.saleProfitUsd);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
     VALUES (1, 'REFUND', 'ACTIVE', 'sales', ?, ?, 0, '2026-09-12 12:00:00')`,
  ).run(saleId, opts.refundProfitUsd);
  return saleId;
}

function seedPartnerLedger(
  db: Database.Database,
  refTable: string,
  referenceId: number,
  ratio: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
     VALUES (1, 1, 'FOR_TEST', ?, ?, 100, 'USD', 'DEBIT', ?, '2026-09-10 10:00:00')`,
  ).run(refTable, referenceId, 100 * ratio);
}

function seedRecharge(
  db: Database.Database,
  carrier: string,
  price: number,
  cost: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO recharges (tenant_id, carrier, currency_code, amount, price, cost, phone_number, is_refunded, created_at)
       VALUES (1, ?, 'USD', ?, ?, ?, '71000000', 0, '2026-09-10 10:00:00')`,
    )
    .run(carrier, price, price, cost);
  return Number(res.lastInsertRowid);
}

function seedRechargeTransaction(
  db: Database.Database,
  rId: number,
  profitUsd: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(rId, profitUsd);
  return Number(res.lastInsertRowid);
}

describe("Profits drill-down (PROF-DD, #14 slice 2) — SALE reconciliation", () => {
  let db: Database.Database;
  let repo: ProfitRepository;
  let service: ProfitService;

  beforeEach(() => {
    db = new Database(":memory:");
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    createSchema(db);
    repo = new ProfitRepository();
    service = new ProfitService(repo);

    // Sale 1: fully paid, no partner obligation -> weight 1.0.
    const s1 = seedSale(db, {
      finalUsd: 50,
      paidUsd: 50,
      soldPriceUsd: 50,
      costUsd: 30,
    });
    seedSaleTransaction(db, s1, 20);

    // Sale 2: unpaid, no partner obligation -> weight 0.0 (not counted).
    const s2 = seedSale(db, {
      finalUsd: 50,
      paidUsd: 0,
      soldPriceUsd: 50,
      costUsd: 30,
    });
    seedSaleTransaction(db, s2, 20);

    // Sale 3: for-partner, 50% settled -> weight 0.5 (partial, still counted).
    const s3 = seedSale(db, {
      finalUsd: 50,
      paidUsd: 0,
      soldPriceUsd: 50,
      costUsd: 30,
    });
    seedSaleTransaction(db, s3, 20);
    seedPartnerLedger(db, "sales", s3, 0.5);

    // Sale 4 (PROF-DD-FIX M1): fully paid, then item-refunded down to
    // status = 'refunded' — SALE (20) + REFUND (-15) nets to a residual +5.
    // getSalesProfit counts it (status IN ('completed','refunded'));
    // getSalesRevCost does NOT (its sale_agg gates on 'completed' only), so
    // this sale contributes 0 to revenue/cost but +5 to profit — exactly
    // the split this fixture proves getSalesDetail now reproduces.
    seedRefundedSaleWithResidualProfit(db, {
      finalUsd: 40,
      paidUsd: 40,
      saleProfitUsd: 20,
      refundProfitUsd: -15,
    });
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getSalesRevCost/getSalesProfit's own totals (the By Module row's source)", () => {
    const totals = runWithTenant(1, () => repo.getSalesRevCost(FROM, TO));
    const profitTotals = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
    const detail = runWithTenant(1, () => service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"));

    const sumRevenue = detail.counted.reduce((s, r) => s + r.amount_usd * (r.counted_pct / 100), 0);
    const sumCost = detail.counted.reduce((s, r) => s + r.cost_usd * (r.counted_pct / 100), 0);

    expect(sumRevenue).toBeCloseTo(totals.revenue_usd, 6);
    expect(sumCost).toBeCloseTo(totals.cost_usd, 6);
    expect(detail.counted_total_profit_usd).toBeCloseTo(profitTotals.profit_usd, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(profitTotals.profit_lbp, 6);

    // Sanity on the actual figures (weight 1.0 + 0.5 + 1.0, sale 2 excluded):
    // revenue 50 + 25 = 75 (sale 4 contributes 0 — no sale_agg row for a
    // 'refunded' sale), cost 30 + 15 = 45, profit 20 + 10 + 5 = 35 (sale 4's
    // residual IS counted here, via getSalesProfit's 'refunded' arm).
    expect(totals.revenue_usd).toBeCloseTo(75, 6);
    expect(totals.cost_usd).toBeCloseTo(45, 6);
    expect(profitTotals.profit_usd).toBeCloseTo(35, 6);
  });

  it("the unpaid sale (weight 0) is in not_counted with a 'customer still owes' reason, never silently dropped", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );

    // s1, s3 (partial), s4 (M1's fully-refunded-but-residual sale) counted;
    // s2 (unpaid) not counted.
    expect(detail.counted).toHaveLength(3);
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/still owes/i);
    expect(detail.not_counted[0].counted_pct).toBe(0);
  });

  it("the 50%-partner-settled sale is counted at 50%, with a reason naming the partial coverage (not silently rendered as 100%)", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );
    const partial = detail.counted.find((r) => r.counted_pct === 50);
    expect(partial).toBeDefined();
    expect(partial!.reason).toMatch(/50%/);
    expect(partial!.counted_profit_usd).toBeCloseTo(10, 6);

    const full = detail.counted.find(
      (r) => r.counted_pct === 100 && r.amount_usd === 50,
    );
    expect(full).toBeDefined();
    expect(full!.reason).toBeNull();
  });

  it("PROF-DD-FIX M1: a fully item-refunded sale (status = 'refunded') with a nonzero residual profit still appears, with revenue/cost 0", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );
    // Identified by its own profit (5 = 20 - 15), unique in this fixture —
    // never by row position (rule 15).
    const refundedRow = detail.counted.find(
      (r) => r.profit_usd === 5 && r.amount_usd === 0,
    );
    expect(refundedRow).toBeDefined();
    expect(refundedRow!.cost_usd).toBe(0);
    expect(refundedRow!.counted_pct).toBe(100);
    expect(refundedRow!.counted_profit_usd).toBeCloseTo(5, 6);
    expect(refundedRow!.reason).toBeNull();
  });
});

describe("Profits drill-down (PROF-DD, #14 slice 2) — M4: 'Customer still owes' reason", () => {
  let db: Database.Database;
  let repo: ProfitRepository;
  let service: ProfitService;

  beforeEach(() => {
    db = new Database(":memory:");
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    createSchema(db);
    repo = new ProfitRepository();
    service = new ProfitService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("uses final_amount_usd (post-discount) and the LBP-inclusive paid total — NOT the pre-discount total_amount_usd / USD-only paid_usd", () => {
    // $100 sale, $10 discount -> final_amount_usd 90. Paid entirely in LBP
    // (4,050,000 at a 90,000 snapshot rate = exactly $45 — half of $90, so
    // this sale is genuinely NOT fully paid, but paid_usd alone reads $0).
    const res = db
      .prepare(
        `INSERT INTO sales (tenant_id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, status, created_at)
         VALUES (1, NULL, 100, 10, 90, 0, 4050000, 90000, 'completed', '2026-09-15 10:00:00')`,
      )
      .run();
    const saleId = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
       VALUES (1, ?, 1, 1, 100, 60, 0, 0)`,
    ).run(saleId);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 40, 0, '2026-09-15 10:00:00')`,
    ).run(saleId);

    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );

    expect(detail.counted).toHaveLength(0);
    expect(detail.not_counted).toHaveLength(1);
    const row = detail.not_counted[0];
    // Pre-fix this read "paid $0.00 of $100.00" (paid_usd, total_amount_usd).
    expect(row.reason).toBe("Customer still owes — paid $45.00 of $90.00.");
  });
});

describe("Profits drill-down (PROF-DD, #14 slice 2) — m6: items_summary excludes fully-refunded lines", () => {
  let db: Database.Database;
  let repo: ProfitRepository;
  let service: ProfitService;

  beforeEach(() => {
    db = new Database(":memory:");
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    createSchema(db);
    repo = new ProfitRepository();
    service = new ProfitService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("a line whose FULL quantity is refunded via refunded_quantity (SalesRepository.refundSaleItem never flips sale_items.is_refunded for a partial-sale refund) is left out, not shown as 'Name x0'", () => {
    db.prepare(
      `INSERT INTO products (id, tenant_id, name) VALUES (2, 1, 'Screen Protector')`,
    ).run();
    const res = db
      .prepare(
        `INSERT INTO sales (tenant_id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, status, created_at)
         VALUES (1, NULL, 60, 0, 60, 60, 0, 'completed', '2026-09-15 10:00:00')`,
      )
      .run();
    const saleId = Number(res.lastInsertRowid);
    // Line 1 (Charger, product id 1): quantity 1, fully refunded via
    // refunded_quantity — is_refunded stays 0 (that column is a WHOLE-SALE
    // void marker only; see TransactionRepository's own doc comment).
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
       VALUES (1, ?, 1, 1, 50, 30, 0, 1)`,
    ).run(saleId);
    // Line 2 (Screen Protector): untouched.
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, is_refunded, refunded_quantity)
       VALUES (1, ?, 2, 1, 10, 5, 0, 0)`,
    ).run(saleId);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 5, 0, '2026-09-15 10:00:00')`,
    ).run(saleId);

    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );

    expect(detail.counted).toHaveLength(1);
    const row = detail.counted[0];
    expect(row.detail).toBe("Screen Protector x1");
    expect(row.detail).not.toMatch(/Charger/);
  });
});

describe("Profits drill-down (PROF-DD, #14 slice 2) — RECHARGE_<carrier> reconciliation", () => {
  let db: Database.Database;
  let repo: ProfitRepository;
  let service: ProfitService;

  beforeEach(() => {
    db = new Database(":memory:");
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    createSchema(db);
    repo = new ProfitRepository();
    service = new ProfitService(repo);

    // Recharge 1: clean, fully counted.
    const r1 = seedRecharge(db, "MTC", 20, 10);
    seedRechargeTransaction(db, r1, 10);

    // Recharge 2: debt-pending (Recharge Debt not repaid) -> excluded
    // entirely by getRechargesByCarrier's own WHERE (notDebtPending).
    const r2 = seedRecharge(db, "MTC", 15, 8);
    const r2TxnId = seedRechargeTransaction(db, r2, 7);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Recharge Debt', 15, 0, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(r2TxnId);

    // Recharge 3: for-partner, 50% settled.
    const r3 = seedRecharge(db, "MTC", 30, 12);
    seedRechargeTransaction(db, r3, 18);
    seedPartnerLedger(db, "recharges", r3, 0.5);

    // Recharge 4: clean, with a linked auto SMS-fee expense (shown NEXT TO
    // the row, never subtracted).
    const r4 = seedRecharge(db, "MTC", 25, 10);
    seedRechargeTransaction(db, r4, 15);
    db.prepare(
      `INSERT INTO expenses (tenant_id, description, status, amount_usd, amount_lbp, is_refunded, source_ref_table, source_ref_id, created_at)
       VALUES (1, 'SMS cost: 1 x $0.32 (MTC credit transfer)', 'active', 0.32, 0, 0, 'recharges', ?, '2026-09-10 10:00:00')`,
    ).run(r4);

    // Recharge 5 (PROF-DD-FIX m1): clean, with its auto SMS-fee expense
    // reversed via the generic Transactions-viewer void path — which sets
    // `expenses.is_refunded = 1` and leaves `status` untouched at 'active'
    // (see `activeExpense`'s own doc comment). Before m1's fix this query
    // hand-wrote `e.status = 'active'` only, so a reversed fee kept showing
    // "(booked in expenses)" forever.
    const r5 = seedRecharge(db, "MTC", 22, 9);
    seedRechargeTransaction(db, r5, 13);
    db.prepare(
      `INSERT INTO expenses (tenant_id, description, status, amount_usd, amount_lbp, is_refunded, source_ref_table, source_ref_id, created_at)
       VALUES (1, 'SMS cost: 1 x $0.32 (MTC credit transfer)', 'active', 0.32, 0, 1, 'recharges', ?, '2026-09-10 10:00:00')`,
    ).run(r5);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getRechargesByCarrier's own MTC totals (the By Module row's source)", () => {
    const totals = runWithTenant(1, () => repo.getRechargesByCarrier(FROM, TO));
    const mtc = totals.find((r) => r.carrier === "MTC");
    expect(mtc).toBeDefined();

    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );

    expect(detail.counted_total_profit_usd).toBeCloseTo(mtc!.profit_usd, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(mtc!.profit_lbp, 6);

    // Sanity: r1 (10, full) + r3 (18 * 0.5 = 9) + r4 (15, full) + r5 (13,
    // full) = 47. r2 (debt-pending) contributes 0.
    expect(mtc!.profit_usd).toBeCloseTo(47, 6);
  });

  it("the debt-pending recharge is entirely excluded from getRechargesByCarrier AND appears in not_counted with a Recharge Debt reason", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );

    expect(detail.counted).toHaveLength(4);
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].counted_pct).toBe(0);
    expect(detail.not_counted[0].reason).toMatch(/Recharge Debt/);
  });

  it("the linked auto SMS-fee expense is shown next to its recharge (fee_note), never subtracted from that row's profit", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );
    const withFee = detail.counted.find((r) => r.fee_note !== null);
    expect(withFee).toBeDefined();
    expect(withFee!.fee_note).toMatch(/-\$0\.32/);
    expect(withFee!.fee_note).toMatch(/booked in expenses/);
    // Full profit, unreduced by the $0.32 fee.
    expect(withFee!.profit_usd).toBeCloseTo(15, 6);
    expect(withFee!.counted_profit_usd).toBeCloseTo(15, 6);
  });

  it("PROF-DD-FIX m1: a REVERSED auto fee expense (is_refunded = 1, status still 'active') no longer shows a fee_note", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );
    // r5 is the only recharge whose price is 22 (unique among this fixture's
    // rows) — identified by amount, not position (rule 15).
    const r5Row = detail.counted.find((r) => r.amount_usd === 22);
    expect(r5Row).toBeDefined();
    expect(r5Row!.fee_note).toBeNull();
    // The reversed fee never touched r5's own profit either way.
    expect(r5Row!.profit_usd).toBeCloseTo(13, 6);
  });

  it("the 50%-partner-settled recharge is counted at 50%, with a reason naming the partial coverage", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );
    const partial = detail.counted.find((r) => r.counted_pct === 50);
    expect(partial).toBeDefined();
    expect(partial!.reason).toMatch(/50%/);
    expect(partial!.counted_profit_usd).toBeCloseTo(9, 6);
  });
});

describe("ProfitService.getModuleDetail — module dispatch (#14 slice 2 boundary)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;
  let service: ProfitService;

  beforeEach(() => {
    db = new Database(":memory:");
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    createSchema(db);
    repo = new ProfitRepository();
    service = new ProfitService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("throws a clear 'not built yet' error for a module outside SALE/RECHARGE_<carrier> (slice 3), never a silent empty list", () => {
    expect(() =>
      runWithTenant(1, () =>
        service.getModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
      ),
    ).toThrow(/slice 3/);
  });
});
