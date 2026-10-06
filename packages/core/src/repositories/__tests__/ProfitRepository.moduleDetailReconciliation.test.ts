/**
 * LIRA-233 (#14 slice 3 review round, finding 10) — this header used to say
 * "NOT RUN — proven at the end-of-batch gate", written when this file was
 * first drafted under the #14 slice 2 batch process rule (implement first,
 * verify at the end of the batch). That gate has long since run — this file
 * is now part of the standard test suite, exercised on every push, and is
 * one of the files this ticket's own review explicitly re-runs. Stale
 * self-description left correcting, not deleting, per rule 14 (don't leave
 * a doc comment that lies about the file's own status).
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
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT,
      source_id INTEGER,
      -- LIRA-233 (#14 slice 3): client_name/client_phone feed the
      -- KEPT_CHANGE/COUNTERPARTY_DISCOUNT/SUPPLIER_COMMISSION(bills-only)
      -- detail queries' counterpart columns; reverses_id feeds
      -- keptChangeSource's own REFUND branch (LIRA-201c).
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, session_id INTEGER /* LIRA-258 / G17 */
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

    -- LIRA-233 (#14 slice 3) — financial_services + settlement_commission_allocations,
    -- referenced by getFinancialServiceDetail/getFinancialSettledByProvider.
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      service_type TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      payment_method_fee REAL NOT NULL DEFAULT 0,
      client_name TEXT,
      phone_number TEXT,
      is_settled INTEGER NOT NULL DEFAULT 1,
      commission_model INTEGER NOT NULL DEFAULT 0,
      settlement_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      description TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      client_name TEXT,
      phone_number TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_name TEXT,
      device_name TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      final_amount_lbp REAL NOT NULL DEFAULT 0,
      parts_cost_usd REAL NOT NULL DEFAULT 0,
      parts_price_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Received',
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      ticket_number TEXT,
      sale_amount REAL NOT NULL DEFAULT 0,
      client_name TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      from_currency TEXT,
      to_currency TEXT,
      amount_in REAL NOT NULL DEFAULT 0,
      amount_out REAL NOT NULL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
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

// =============================================================================
// LIRA-233 (#14 slice 3) — seed helpers for the remaining modules.
// =============================================================================

function seedFinancialService(
  db: Database.Database,
  opts: {
    provider: string;
    currency: string;
    cost?: number;
    price?: number;
    commissionModel?: number;
    isSettled?: number;
    settlementId?: number | null;
    clientName?: string | null;
    paymentMethodFee?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, cost, price, payment_method_fee, client_name, is_settled, commission_model, settlement_id, is_refunded, created_at)
       VALUES (1, ?, 'SEND', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(
      opts.provider,
      opts.price ?? 0,
      opts.currency,
      opts.cost ?? 0,
      opts.price ?? 0,
      opts.paymentMethodFee ?? 0,
      opts.clientName ?? null,
      opts.isSettled ?? 1,
      opts.commissionModel ?? 0,
      opts.settlementId ?? null,
    );
  return Number(res.lastInsertRowid);
}

function seedFsTransaction(
  db: Database.Database,
  fsId: number,
  profitUsd: number,
  profitLbp = 0,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, '2026-09-10 10:00:00')`,
    )
    .run(fsId, profitUsd, profitLbp);
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
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, '2026-09-11 09:00:00')`,
    )
    .run(
      opts.settlementLedgerId,
      opts.financialServiceId,
      opts.serviceType,
      opts.provider,
      opts.commissionUsd ?? 0,
      opts.commissionLbp ?? 0,
    );
  return Number(res.lastInsertRowid);
}

function seedCustomService(
  db: Database.Database,
  opts: { priceUsd: number; costUsd: number; clientName?: string | null },
): number {
  const res = db
    .prepare(
      `INSERT INTO custom_services (tenant_id, description, cost_usd, cost_lbp, price_usd, price_lbp, status, client_name, is_refunded, created_at)
       VALUES (1, 'Screen repair', ?, 0, ?, 0, 'completed', ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(opts.costUsd, opts.priceUsd, opts.clientName ?? null);
  return Number(res.lastInsertRowid);
}

function seedCustomServiceTransaction(
  db: Database.Database,
  csId: number,
  profitUsd: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'CUSTOM_SERVICE', 'ACTIVE', 'custom_services', ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(csId, profitUsd);
  return Number(res.lastInsertRowid);
}

function seedMaintenance(
  db: Database.Database,
  opts: {
    finalAmountUsd: number;
    costUsd: number;
    partsPriceUsd?: number;
    partsCostUsd?: number;
    status?: string;
    clientName?: string | null;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO maintenance (tenant_id, client_name, device_name, cost_usd, cost_lbp, final_amount_usd, final_amount_lbp, parts_cost_usd, parts_price_usd, status, is_refunded, created_at)
       VALUES (1, ?, 'iPhone 12', ?, 0, ?, 0, ?, ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(
      opts.clientName ?? null,
      opts.costUsd,
      opts.finalAmountUsd,
      opts.partsCostUsd ?? 0,
      opts.partsPriceUsd ?? 0,
      opts.status ?? "Delivered",
    );
  return Number(res.lastInsertRowid);
}

function seedMaintenanceTransaction(
  db: Database.Database,
  mId: number,
  profitUsd: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'MAINTENANCE', 'ACTIVE', 'maintenance', ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(mId, profitUsd);
  return Number(res.lastInsertRowid);
}

function seedLotoTicket(
  db: Database.Database,
  opts: { saleAmount: number; ticketNumber?: string; clientName?: string | null },
): number {
  const res = db
    .prepare(
      `INSERT INTO loto_tickets (tenant_id, ticket_number, sale_amount, client_name, is_refunded, created_at)
       VALUES (1, ?, ?, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(opts.ticketNumber ?? "T1", opts.saleAmount, opts.clientName ?? null);
  return Number(res.lastInsertRowid);
}

function seedLotoTransaction(
  db: Database.Database,
  ltId: number,
  profitLbp: number,
  profitUsd = 0,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, ?, ?, '2026-09-10 10:00:00')`,
    )
    .run(ltId, profitUsd, profitLbp);
  return Number(res.lastInsertRowid);
}

/**
 * LIRA-233 (#14 slice 3 review round, follow-up) — the owner's ACTUAL
 * contract, re-stated after the finding-3 fix broke it: "the LISTED counted
 * rows add up exactly to the module total" — i.e. summing every row's own
 * `counted_profit_usd`/`_lbp` OVER `detail.counted` (the array the UI
 * literally renders and could foot a total from) must equal
 * `detail.counted_total_profit_usd`/`_lbp` EXACTLY. The By Module row's own
 * Count matching `detail.counted.length` is a SEPARATE, lower-priority
 * nice-to-have (finding 3) — this helper checks the sum contract only, for
 * whichever currency is asked.
 */
function sumCounted(
  detail: { counted: Array<{ counted_profit_usd: number; counted_profit_lbp: number }> },
  currency: "usd" | "lbp",
): number {
  const key = currency === "usd" ? "counted_profit_usd" : "counted_profit_lbp";
  return detail.counted.reduce((sum, r) => sum + r[key], 0);
}

function seedExchange(
  db: Database.Database,
  opts: {
    fromCurrency: string;
    toCurrency: string;
    amountIn: number;
    amountOut: number;
    leg1ProfitUsd: number;
    clientName?: string | null;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO exchange_transactions (tenant_id, from_currency, to_currency, amount_in, amount_out, leg1_profit_usd, leg2_profit_usd, client_name, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, ?, 0, ?, 0, '2026-09-10 10:00:00')`,
    )
    .run(
      opts.fromCurrency,
      opts.toCurrency,
      opts.amountIn,
      opts.amountOut,
      opts.leg1ProfitUsd,
      opts.clientName ?? null,
    );
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

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly, including the SALE+REFUND residual pair", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
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

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("RECHARGE_MTC", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
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

  it("throws a clear 'not built yet' error for a module outside the registry (slice 3), never a silent empty list", () => {
    expect(() =>
      runWithTenant(1, () =>
        service.getModuleDetail(
          "SOME_FUTURE_MODULE",
          "2026-09-01",
          "2026-09-30",
        ),
      ),
    ).toThrow(/slice 3/);
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — FINANCIAL_SERVICE_<provider> reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    // fs1: recognized (legacy model 0, settled), no partner/debt -> full weight.
    const fs1 = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 20,
      commissionModel: 0,
      isSettled: 1,
    });
    seedFsTransaction(db, fs1, 5);

    // fs2: NOT recognized (legacy model 0, unsettled) -> excluded from
    // totals, not_counted here with a "not yet settled" reason.
    const fs2 = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 15,
      commissionModel: 0,
      isSettled: 0,
    });
    seedFsTransaction(db, fs2, 3);

    // fs3: AT_SETTLEMENT (model 1) -> recognized unconditionally, its own
    // stamp is 0 (real system behavior — commission arrives via the
    // allocation below, not on the transfer's own transaction).
    const fs3 = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 30,
      commissionModel: 1,
      isSettled: 1,
      settlementId: 900,
    });
    seedFsTransaction(db, fs3, 0);
    seedAllocation(db, {
      settlementLedgerId: 900,
      financialServiceId: fs3,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 8,
    });

    // fs4: recognized, 50%-partner-settled -> weight 0.5.
    const fs4 = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 25,
      commissionModel: 0,
      isSettled: 1,
    });
    seedFsTransaction(db, fs4, 6);
    seedPartnerLedger(db, "financial_services", fs4, 0.5);

    // fs5: recognized, debt-pending ('Service Debt' uncovered) -> weight 0.
    const fs5 = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 18,
      commissionModel: 0,
      isSettled: 1,
    });
    const fs5TxnId = seedFsTransaction(db, fs5, 4);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Service Debt', 18, 0, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(fs5TxnId);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getFinancialSettledByProvider's own OMT totals (base arm + settlement-allocation arm)", () => {
    const totals = runWithTenant(1, () =>
      repo.getFinancialSettledByProvider(FROM, TO),
    );
    const omt = totals.find((r) => r.provider === "OMT");
    expect(omt).toBeDefined();

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );

    expect(detail.counted_total_profit_usd).toBeCloseTo(omt!.profit_usd, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(omt!.profit_lbp, 6);
    // 5 (fs1) + 6*0.5=3 (fs4) + 8 (allocation) = 16; fs2 (unsettled) and fs5
    // (debt-pending) excluded; fs3's own transfer-arm stamp is 0.
    expect(omt!.profit_usd).toBeCloseTo(16, 6);
  });

  it("the unsettled row and the debt-pending row are both in not_counted with a reason, never silently dropped", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    expect(detail.not_counted).toHaveLength(2);
    const notRecognized = detail.not_counted.find((r) =>
      r.reason?.includes("not yet settled"),
    );
    expect(notRecognized).toBeDefined();
    const debtPending = detail.not_counted.find((r) =>
      r.reason?.includes("Service Debt"),
    );
    expect(debtPending).toBeDefined();
  });

  it("the 50%-partner-settled row is counted at 50%, and the cashless settlement allocation appears as its own labeled row", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    const partial = detail.counted.find((r) => r.counted_pct === 50);
    expect(partial).toBeDefined();
    expect(partial!.counted_profit_usd).toBeCloseTo(3, 6);

    const allocationRow = detail.counted.find((r) =>
      r.detail?.includes("settlement allocation"),
    );
    expect(allocationRow).toBeDefined();
    expect(allocationRow!.profit_usd).toBeCloseTo(8, 6);
    expect(allocationRow!.reason).toBeNull();
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

/**
 * LIRA-233 (#14 slice 3 review round) — findings 2, 5, 6, 7, 8.
 *
 * Rule 17 honesty note: these were NOT written failing-first. The repository/
 * service fixes for these findings were implemented in the same review pass
 * before these specific guard cases were drafted, so — like the block above,
 * and unlike the frontend's `Profits.moduleDetailDrilldownSlice3.test.tsx`
 * additions for findings 2/4/9, which WERE run red against the pre-fix
 * `Profits.tsx` first — these only prove the fix is correct NOW, not that it
 * was proven broken before. Recorded here plainly rather than staged as a
 * "proof" (rule 17's own corollary: never re-break finished code just to
 * manufacture a red run).
 */
describe("Profits drill-down (LIRA-233, #14 slice 3 review round) — FINANCIAL_SERVICE_<provider> findings 2/5/6/7/8", () => {
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

  it("finding 6: a third-currency (EUR) transfer is not_counted with a currency reason, and never changes the counted sum", () => {
    const fsEur = seedFinancialService(db, {
      provider: "OMT",
      currency: "EUR",
      price: 12,
      commissionModel: 0,
      isSettled: 1,
    });
    seedFsTransaction(db, fsEur, 7);
    const fsUsd = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 20,
      commissionModel: 0,
      isSettled: 1,
    });
    seedFsTransaction(db, fsUsd, 5);

    const totals = runWithTenant(1, () =>
      repo.getFinancialSettledByProvider(FROM, TO),
    );
    const omt = totals.find((r) => r.provider === "OMT")!;
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );

    // EUR row contributes 0 to both the totals query's own bucketed SUM and
    // this drill-down — the reconciliation invariant holds regardless of
    // where the EUR row is displayed.
    expect(detail.counted_total_profit_usd).toBeCloseTo(omt.profit_usd, 6);
    expect(omt.profit_usd).toBeCloseTo(5, 6);

    const eurRow = detail.not_counted.find((r) => r.id === fsEur);
    expect(eurRow).toBeDefined();
    expect(eurRow!.reason).toBe(
      "This transfer's currency isn't tracked as USD or LBP.",
    );
  });

  it("finding 7: an unrecognized provider (SUYOOL) gets the correct reason — not the 'not yet settled' text a KNOWN-but-unsettled provider gets", () => {
    const fsUnknown = seedFinancialService(db, {
      provider: "SUYOOL",
      currency: "USD",
      price: 10,
      commissionModel: 0,
      isSettled: 0,
    });
    seedFsTransaction(db, fsUnknown, 4);

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_SUYOOL",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).not.toMatch(/not yet settled/i);
    expect(detail.not_counted[0].reason).toMatch(/isn't recognized/i);
  });

  it("finding 8: a commission-provider transfer whose allocation IS in this date range gets a 'booked separately' note", () => {
    const fs = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 30,
      commissionModel: 1,
      isSettled: 1,
      settlementId: 900,
    });
    seedFsTransaction(db, fs, 0);
    seedAllocation(db, {
      settlementLedgerId: 900,
      financialServiceId: fs,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 8,
    });

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    const transferRow = detail.counted.find(
      (r) => r.source === "financial_service_transfer",
    );
    expect(transferRow).toBeDefined();
    expect(transferRow!.fee_note).toMatch(/booked separately/i);
    expect(transferRow!.fee_note_kind).toBe("info");
  });

  it("finding 8: a commission-provider transfer with NO in-range allocation gets a 'counted when the supplier settles' note instead", () => {
    const fs = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 30,
      commissionModel: 1,
      isSettled: 1,
      settlementId: 900,
    });
    seedFsTransaction(db, fs, 0);
    // No allocation row at all — neither unsettled nor out-of-range can be
    // told apart further without a second query (see the fix's own doc
    // comment); both read as "counted when the supplier settles".

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    const transferRow = detail.counted.find(
      (r) => r.source === "financial_service_transfer",
    );
    expect(transferRow).toBeDefined();
    expect(transferRow!.fee_note).toMatch(
      /commission is counted when the supplier settles/i,
    );
  });

  it("finding 5: a USD transfer's LBP kept-change stamp shows as a note, mirroring LOTO — never folded into the bucketed profit", () => {
    const fs = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 20,
      commissionModel: 0,
      isSettled: 1,
    });
    seedFsTransaction(db, fs, 5, 45000);

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    const row = detail.counted.find(
      (r) => r.id === fs && r.source === "financial_service_transfer",
    );
    expect(row).toBeDefined();
    expect(row!.fee_note).toMatch(/kept change/i);
    expect(row!.fee_note_kind).toBe("info");
    // The kept-change LBP stamp never enters the bucketed profit_lbp (fs
    // currency is USD) — matches the totals query's own bucketing exactly.
    expect(row!.profit_lbp).toBe(0);
  });

  it("finding 2: a transfer row and an allocation row CAN share the same numeric id (independent PK sequences) — distinguishable by source", () => {
    const fs = seedFinancialService(db, {
      provider: "OMT",
      currency: "USD",
      price: 30,
      commissionModel: 1,
      isSettled: 1,
      settlementId: 900,
    });
    seedFsTransaction(db, fs, 0);
    const allocId = seedAllocation(db, {
      settlementLedgerId: 900,
      financialServiceId: fs,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 8,
    });
    // Both are the FIRST row ever inserted into their own table on this
    // fresh in-memory db — SQLite's AUTOINCREMENT sequences are independent
    // per table, so both land on id 1. This is the exact collision finding
    // 2 is about, not a contrived id.
    expect(fs).toBe(allocId);

    const rows = runWithTenant(1, () =>
      repo.getFinancialServiceDetail("OMT", FROM, TO),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(rows[1].id);
    expect([rows[0].source, rows[1].source].sort()).toEqual([
      "settlement_allocation",
      "transfer",
    ]);

    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "FINANCIAL_SERVICE_OMT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    // The PUBLIC `source` the UI keys rows by is distinct too (rows[0].id
    // === rows[1].id, but detail rows must still both be present and
    // distinguishable — a bare `key={r.id}` would collide).
    const publicSources = detail.counted.map((r) => r.source).sort();
    expect(publicSources).toEqual([
      "financial_service_allocation",
      "financial_service_transfer",
    ]);
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — CUSTOM_SERVICE reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    const cs1 = seedCustomService(db, { priceUsd: 40, costUsd: 20 });
    seedCustomServiceTransaction(db, cs1, 20);

    const cs2 = seedCustomService(db, { priceUsd: 30, costUsd: 15 });
    const cs2Txn = seedCustomServiceTransaction(db, cs2, 15);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Custom Service Debt', 30, 0, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(cs2Txn);

    const cs3 = seedCustomService(db, { priceUsd: 50, costUsd: 25 });
    seedCustomServiceTransaction(db, cs3, 25);
    seedPartnerLedger(db, "custom_services", cs3, 0.5);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getCustomServicesTotals' own totals", () => {
    const totals = runWithTenant(1, () =>
      repo.getCustomServicesTotals(FROM, TO),
    );
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("CUSTOM_SERVICE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(totals.profit_lbp, 6);
    // 20 (cs1) + 25*0.5=12.5 (cs3); cs2 excluded (debt-pending).
    expect(totals.profit_usd).toBeCloseTo(32.5, 6);
  });

  it("the debt-pending job is not_counted with a reason", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("CUSTOM_SERVICE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/Custom Service Debt/);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("CUSTOM_SERVICE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — MAINTENANCE reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    // m1: delivered, with a parts/labour split.
    const m1 = seedMaintenance(db, {
      finalAmountUsd: 100,
      costUsd: 30,
      partsPriceUsd: 20,
      partsCostUsd: 10,
    });
    seedMaintenanceTransaction(db, m1, 60);

    // m2: delivered, debt-pending -> entirely excluded (no partner
    // weighting exists on this module at all).
    const m2 = seedMaintenance(db, { finalAmountUsd: 50, costUsd: 20 });
    const m2Txn = seedMaintenanceTransaction(db, m2, 30);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Maintenance Debt', 50, 0, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(m2Txn);

    // m3: not yet delivered -> excluded entirely by maintenanceCompleted,
    // both from totals AND from the detail query (never appears at all).
    const m3 = seedMaintenance(db, {
      finalAmountUsd: 75,
      costUsd: 25,
      status: "In_Progress",
    });
    seedMaintenanceTransaction(db, m3, 50);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getMaintenanceTotals' own totals", () => {
    const totals = runWithTenant(1, () => repo.getMaintenanceTotals(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("MAINTENANCE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(totals.profit_lbp, 6);
    // Only m1 counted (60); m2 debt-pending, m3 not delivered.
    expect(totals.profit_usd).toBeCloseTo(60, 6);
  });

  it("the parts/labour split matches ProfitByModule's own per-row derivation", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("MAINTENANCE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted).toHaveLength(1);
    const row = detail.counted[0];
    expect(row.parts_profit_usd).toBeCloseTo(10, 6);
    expect(row.labour_profit_usd).toBeCloseTo(50, 6);
  });

  it("the debt-pending job is not_counted with a reason; the not-yet-delivered job never appears at all", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("MAINTENANCE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/Maintenance Debt/);
    const allRows = [...detail.counted, ...detail.not_counted];
    expect(allRows.find((r) => r.amount_usd === 75)).toBeUndefined();
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("MAINTENANCE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — LOTO reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    const l1 = seedLotoTicket(db, { saleAmount: 100000, ticketNumber: "L1" });
    seedLotoTransaction(db, l1, 4450);

    // l2: carries USD-side kept change (off-currency stamp).
    const l2 = seedLotoTicket(db, { saleAmount: 50000, ticketNumber: "L2" });
    seedLotoTransaction(db, l2, 2225, 0.5);

    // l3: debt-pending -> excluded.
    const l3 = seedLotoTicket(db, { saleAmount: 20000, ticketNumber: "L3" });
    const l3Txn = seedLotoTransaction(db, l3, 890);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Loto Debt', 0, 20000, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(l3Txn);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows' profit_lbp sums EXACTLY to getLotoTotals' own profit_lbp; profit_usd is always 0", () => {
    const totals = runWithTenant(1, () => repo.getLotoTotals(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_lbp).toBeCloseTo(totals.profit_lbp, 6);
    expect(detail.counted_total_profit_usd).toBe(0);
    // l1 (4450) + l2 (2225) = 6675; l3 excluded (debt-pending).
    expect(totals.profit_lbp).toBeCloseTo(6675, 6);
  });

  it("off-currency kept change is reported via fee_note, never folded into profit_usd/counted_profit_usd", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
    );
    const withKept = detail.counted.find((r) => r.fee_note !== null);
    expect(withKept).toBeDefined();
    expect(withKept!.fee_note).toMatch(/kept change/);
    expect(withKept!.profit_usd).toBe(0);
    expect(withKept!.counted_profit_usd).toBe(0);
  });

  it("the debt-pending ticket is not_counted with a reason", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/Loto Debt/);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — EXCHANGE reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    // e1: clean, fully counted (no partner obligation).
    seedExchange(db, {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 9000000,
      leg1ProfitUsd: 5,
    });

    // e2: 50%-partner-settled.
    const e2 = seedExchange(db, {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 200,
      amountOut: 18000000,
      leg1ProfitUsd: 10,
    });
    seedPartnerLedger(db, "exchange_transactions", e2, 0.5);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getExchangeTotals' own profit_usd", () => {
    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("EXCHANGE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    // 5 (e1, full) + 10*0.5=5 (e2, 50% partner) = 10.
    expect(totals.profit_usd).toBeCloseTo(10, 6);
  });

  it("the 50%-partner-settled exchange is counted at 50%, with a reason naming the partial coverage; cost is derived as amount - profit", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("EXCHANGE", "2026-09-01", "2026-09-30"),
    );
    const partial = detail.counted.find((r) => r.counted_pct === 50);
    expect(partial).toBeDefined();
    expect(partial!.reason).toMatch(/50%/);
    expect(partial!.counted_profit_usd).toBeCloseTo(5, 6);
    // amount_usd 200, profit_usd 10 -> cost 190.
    expect(partial!.cost_usd).toBeCloseTo(190, 6);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("EXCHANGE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — PM_FEE reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    seedFinancialService(db, {
      provider: "OMT_APP",
      currency: "USD",
      paymentMethodFee: 0.5,
    });
    seedFinancialService(db, {
      provider: "OMT_APP",
      currency: "LBP",
      paymentMethodFee: 45000,
    });
    // A third-currency fee -> not tracked as USD/LBP, dropped from both
    // totals buckets (matches getPmFeeTotals' own GROUP BY fs.currency).
    seedFinancialService(db, {
      provider: "OMT_APP",
      currency: "EUR",
      paymentMethodFee: 3,
    });
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getPmFeeTotals' own USD+LBP totals", () => {
    const totals = runWithTenant(1, () => repo.getPmFeeTotals(FROM, TO));
    const usdTotal = totals.find((r) => r.currency_code === "USD")?.total ?? 0;
    const lbpTotal = totals.find((r) => r.currency_code === "LBP")?.total ?? 0;
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("PM_FEE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(usdTotal, 6);
    expect(detail.counted_total_profit_lbp).toBeCloseTo(lbpTotal, 6);
    expect(usdTotal).toBeCloseTo(0.5, 6);
    expect(lbpTotal).toBeCloseTo(45000, 6);
  });

  it("a third-currency fee is not_counted with a reason, never silently dropped", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("PM_FEE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/USD or LBP/);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("PM_FEE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — KEPT_CHANGE reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'KEPT_CHANGE', 'ACTIVE', 'customer_sessions', 1, 0.5, 0, '2026-09-10 10:00:00')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 0.3, 0, '2026-09-11 10:00:00')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getDebtRepaymentProfit's own totals (no partner/debt gate — every row 100% counted)", () => {
    const totals = runWithTenant(1, () => repo.getDebtRepaymentProfit(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("KEPT_CHANGE", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    expect(detail.not_counted).toHaveLength(0);
    expect(totals.profit_usd).toBeCloseTo(0.8, 6);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("KEPT_CHANGE", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — COUNTERPARTY_DISCOUNT reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 1, -5, 0, '2026-09-10 10:00:00')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'supplier_ledger', 1, 2, 0, '2026-09-11 10:00:00')`,
    ).run();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getCounterpartyDiscountTotals' own signed totals", () => {
    const totals = runWithTenant(1, () =>
      repo.getCounterpartyDiscountTotals(FROM, TO),
    );
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "COUNTERPARTY_DISCOUNT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    expect(detail.not_counted).toHaveLength(0);
    expect(totals.profit_usd).toBeCloseTo(-3, 6);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "COUNTERPARTY_DISCOUNT",
        "2026-09-01",
        "2026-09-30",
      ),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — SUPPLIER_COMMISSION (bills-only) reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    // Bills-only settlement (no allocation rows reference its source_id) —
    // real money, counted here.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 777, 12, 0, '2026-09-10 10:00:00')`,
    ).run();

    // Cashless settlement (an allocation row with service_type != 'BILL'
    // references its source_id) — already counted under
    // FINANCIAL_SERVICE_<provider>'s allocation arm; must NOT double-list.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 778, 9, 0, '2026-09-10 11:00:00')`,
    ).run();
    seedAllocation(db, {
      settlementLedgerId: 778,
      financialServiceId: 1,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 9,
    });
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getSupplierCommissionTotals' own bills_only figures", () => {
    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(FROM, TO),
    );
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SUPPLIER_COMMISSION", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(
      totals.bills_only_profit_usd,
      6,
    );
    expect(totals.bills_only_profit_usd).toBeCloseTo(12, 6);
  });

  it("does not double-list the cashless settlement's commission (already under FINANCIAL_SERVICE_<provider>)", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SUPPLIER_COMMISSION", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted).toHaveLength(1);
    expect(detail.counted[0].profit_usd).toBeCloseTo(12, 6);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SUPPLIER_COMMISSION", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});

/**
 * LIRA-233 (#14 slice 3 review round, finding 3 — TWICE fixed).
 *
 * Round 1 (not proven failing-first — written after the
 * `keptChangeCountEligible`/`supplierCommissionCountEligible` fix, same
 * honesty note as the FINANCIAL_SERVICE_<provider> block above) split
 * `counted`/`not_counted` by whether a row was one of the By Module row's
 * own `count` events, while still summing EVERY row (including a
 * `not_counted` REFUND reversal) into `counted_total_profit_*`. That broke
 * the owner's higher-priority contract: "the LISTED counted rows add up
 * exactly to the module total" — a `not_counted` REFUND reversal's negated
 * money vanished from the visible `counted` list but not from the displayed
 * total.
 *
 * Round 2 (coordinator-directed follow-up, THIS round — genuinely
 * failing-first): the `expect(sumCounted(...)).toBeCloseTo(counted_total...)`
 * assertions below were added to the two round-1 tests and RUN against the
 * round-1 code FIRST. Both failed (KEPT_CHANGE: received 3, expected 2;
 * SUPPLIER_COMMISSION: received 6, expected 3 — recorded in this round's own
 * report). `ProfitService.buildKeptChangeModuleDetail`/
 * `buildSupplierCommissionModuleDetail` were then changed to split on REAL
 * MONEY (`profit_usd !== 0 || profit_lbp !== 0`) instead of `count_eligible`
 * — a REFUND reversal with a nonzero profit is now counted (clearly labeled
 * "Kept-change reversal"/"Settlement reversal"), and both tests' `counted`/
 * `not_counted` length expectations below were updated to match the
 * corrected (and now intentional) shape: `counted.length` can exceed the
 * totals query's own `count` by the number of reversal rows — an ACCEPTED
 * mismatch (the sum rule wins over Count parity, coordinator's explicit
 * ruling) — while Σ(counted) === counted_total_profit_* holds exactly.
 */
describe("Profits drill-down (LIRA-233, #14 slice 3 review round) — count parity (finding 3)", () => {
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

  it("KEPT_CHANGE: a REFUND reversal is counted (labeled as a reversal); only the $0 repayment is not_counted; Σ(counted) equals the displayed total exactly", () => {
    // A: nonzero DEBT_REPAYMENT — a real count event.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 2, 0, '2026-09-10 10:00:00')`,
    ).run();
    // B: $0 DEBT_REPAYMENT — no kept change on this one, not a count event.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 2, 0, 0, '2026-09-11 10:00:00')`,
    ).run();
    // C: nonzero standalone KEPT_CHANGE — a real count event.
    const cRes = db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
         VALUES (1, 'KEPT_CHANGE', 'ACTIVE', 'customer_sessions', 1, 1, 0, '2026-09-12 10:00:00')`,
      )
      .run();
    const cId = Number(cRes.lastInsertRowid);
    // D: REFUND reversing C — a real SUM contributor (nets C to 0), but NOT
    // its own count event (the repayment already counted once, as C).
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, reverses_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'customer_sessions', 1, ?, -1, 0, '2026-09-12 11:00:00')`,
    ).run(cId);

    const totals = runWithTenant(1, () => repo.getDebtRepaymentProfit(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("KEPT_CHANGE", "2026-09-01", "2026-09-30"),
    );

    // totals.count (the By Module row's own Count) still counts EVENTS
    // (A, C) — 2. detail.counted now counts REAL-MONEY ROWS (A, C, D — the
    // REFUND reversal D is real money too) — 3, one more than totals.count.
    // That mismatch is ACCEPTED (coordinator's explicit ruling: the sum rule
    // wins over Count parity).
    expect(totals.count).toBe(2); // A and C only, by DEFINITION of "event"
    expect(detail.counted).toHaveLength(3); // A, C, D — every nonzero row
    expect(detail.not_counted).toHaveLength(1); // B only — the genuine $0 row
    const reversalRow = detail.counted.find((r) => r.profit_usd === -1);
    expect(reversalRow).toBeDefined();
    expect(reversalRow!.detail).toBe("Kept-change reversal");
    expect(reversalRow!.reason).toBeNull();
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    expect(totals.profit_usd).toBeCloseTo(2, 6); // 2 + 0 + 1 - 1
    // Owner's ACTUAL contract: Σ(detail.counted[]) must equal
    // counted_total_profit_usd — the UI can only foot a total from the rows
    // it actually lists. This now holds by CONSTRUCTION (accumulation
    // happens only when a row is pushed to `counted`).
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });

  it("SUPPLIER_COMMISSION (bills-only): a REFUND reversal is counted (labeled 'Settlement reversal'); only the $0 settlement is not_counted; Σ(counted) equals the displayed total exactly", () => {
    // A: nonzero bills-only settlement — a real count event.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 501, 6, 0, '2026-09-10 10:00:00')`,
    ).run();
    // B: $0 settlement — not a count event.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 502, 0, 0, '2026-09-11 10:00:00')`,
    ).run();
    // C: REFUND reversal — a real SUM contributor, not its own count event.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'supplier_ledger', 503, -3, 0, '2026-09-12 10:00:00')`,
    ).run();

    const totals = runWithTenant(1, () => repo.getSupplierCommissionTotals(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("SUPPLIER_COMMISSION", "2026-09-01", "2026-09-30"),
    );

    // totals.bills_only_count counts EVENTS (A) — 1. detail.counted counts
    // REAL-MONEY ROWS (A, C — the REFUND reversal C is real money too) — 2,
    // one more than totals.bills_only_count. Accepted mismatch (same ruling
    // as KEPT_CHANGE above).
    expect(totals.bills_only_count).toBe(1); // A only, by DEFINITION of "event"
    expect(detail.counted).toHaveLength(2); // A and C — every nonzero row
    expect(detail.not_counted).toHaveLength(1); // B only — the genuine $0 row
    const reversalRow = detail.counted.find((r) => r.profit_usd === -3);
    expect(reversalRow).toBeDefined();
    expect(reversalRow!.detail).toBe("Settlement reversal");
    expect(reversalRow!.reason).toBeNull();
    expect(detail.counted_total_profit_usd).toBeCloseTo(
      totals.bills_only_profit_usd,
      6,
    );
    expect(totals.bills_only_profit_usd).toBeCloseTo(3, 6); // 6 + 0 - 3
    // Owner's ACTUAL contract: Σ(detail.counted[]) must equal
    // counted_total_profit_usd — holds by CONSTRUCTION now.
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });

  it("COUNTERPARTY_DISCOUNT: unaffected by the finding-3 follow-up (no split, no REFUND ever exists) — a $0 discount row still counts, matching Count exactly", () => {
    // A: nonzero discount.
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 1, -5, 0, '2026-09-10 10:00:00')`,
    ).run();
    // B: a $0 discount — COUNTERPARTY_DISCOUNT is NON_REVERSIBLE (no REFUND
    // row ever exists) and its own build method never splits at all (always
    // 100% counted), so this STILL counts (unlike KEPT_CHANGE/
    // SUPPLIER_COMMISSION above, which only exclude a genuine $0 row).
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 2, 0, 0, '2026-09-11 10:00:00')`,
    ).run();

    const totals = runWithTenant(1, () =>
      repo.getCounterpartyDiscountTotals(FROM, TO),
    );
    const detail = runWithTenant(1, () =>
      service.getModuleDetail(
        "COUNTERPARTY_DISCOUNT",
        "2026-09-01",
        "2026-09-30",
      ),
    );

    expect(totals.count).toBe(2);
    expect(detail.counted).toHaveLength(totals.count);
    expect(detail.not_counted).toHaveLength(0);
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
  });
});

describe("Profits drill-down (LIRA-233, #14 slice 3) — TOPUP_BUYBACK reconciliation — not proven failing-first (rule 17, finding 11)", () => {
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

    const r1 = seedRecharge(db, "MTC", 0, 0);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 2, 0, '2026-09-10 10:00:00')`,
    ).run(r1);

    const r2 = seedRecharge(db, "MTC", 0, 0);
    const r2Res = db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
         VALUES (1, 'RECHARGE_TOPUP', 'ACTIVE', 'recharges', ?, 3, 0, '2026-09-10 10:00:00')`,
      )
      .run(r2);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
       VALUES (1, 1, 'Recharge Debt', 3, 0, ?, 0, 0, 0, '2026-09-10 10:00:00')`,
    ).run(Number(r2Res.lastInsertRowid));

    const r3 = seedRecharge(db, "MTC", 0, 0);
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'RECHARGE_TOPUP', 'ACTIVE', 'recharges', ?, 4, 0, '2026-09-10 10:00:00')`,
    ).run(r3);
    seedPartnerLedger(db, "recharges", r3, 0.5);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counted rows add up EXACTLY to getTopupBuybackProfit's own totals", () => {
    const totals = runWithTenant(1, () => repo.getTopupBuybackProfit(FROM, TO));
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("TOPUP_BUYBACK", "2026-09-01", "2026-09-30"),
    );
    expect(detail.counted_total_profit_usd).toBeCloseTo(totals.profit_usd, 6);
    // 2 (r1, buyback) + 4*0.5=2 (r3, 50% partner) = 4; r2 excluded (Recharge
    // Debt uncovered).
    expect(totals.profit_usd).toBeCloseTo(4, 6);
  });

  it("the debt-pending top-up is not_counted with a reason", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("TOPUP_BUYBACK", "2026-09-01", "2026-09-30"),
    );
    expect(detail.not_counted).toHaveLength(1);
    expect(detail.not_counted[0].reason).toMatch(/Recharge Debt/);
  });

  it("owner's sum contract: Σ(detail.counted[].counted_profit_usd/_lbp) equals counted_total_profit_usd/_lbp exactly", () => {
    const detail = runWithTenant(1, () =>
      service.getModuleDetail("TOPUP_BUYBACK", "2026-09-01", "2026-09-30"),
    );
    expect(sumCounted(detail, "usd")).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
    expect(sumCounted(detail, "lbp")).toBeCloseTo(
      detail.counted_total_profit_lbp,
      6,
    );
  });
});
