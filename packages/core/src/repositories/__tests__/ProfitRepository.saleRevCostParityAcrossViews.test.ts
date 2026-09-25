/**
 * REV lane (2026-09-24, owner decision (a), OWNER_NOTES_2026-09-21.md §6.9)
 * — "Sale revenue and cost become net of discounts and refunded items, so
 * the row adds up to the ledger profit" EVERYWHERE it is shown, not just on
 * `getSalesRevCost`/`getByModule` (the pre-existing PA-4.23 (a) fix, proved
 * by `ProfitRepository.salesRevCostNetOfDiscountAndRefund.test.ts`).
 *
 * Before this fix: `getByDate`'s `daily_sales` CTE summed the GROSS
 * `si.sold_price_usd × si.quantity` / `si.cost_price_snapshot_usd ×
 * si.quantity` (ignoring `refunded_quantity` and `discount_usd` entirely),
 * and `getByUser`/`getByClient`'s SALE-row `revenue_usd` arm summed
 * `s2.final_amount_usd` (SALE) + `t.amount_usd` (REFUND) — the refund
 * subtracted at GROSS `sold_price_usd`, never pro-rated for the sale's own
 * discount the way `SalesRepository.refundSaleItem`'s own profit give-back
 * is. Only Overview/By Module (`getSalesRevCost`) were net.
 *
 * Drives the REAL writers end to end (rule 17 + the owner's own
 * instruction): `SalesRepository.processSale` (with a discount) then
 * `.refundSaleItem` (a partial per-item refund) — the SAME scenario
 * `salesRevCostNetOfDiscountAndRefund.test.ts` proves for getSalesRevCost —
 * on TWO DIFFERENT CALENDAR DAYS, so `getByDate`'s per-day split is also
 * exercised (a bug in the per-day GROUP BY, e.g. leaking day 2's discount
 * into day 1, would not be caught by a single-day case).
 *
 * RED (pre-fix, actually observed by reverting this lane's ProfitRepository
 * changes with `git apply -R` and re-running this file, then restoring with
 * `git apply`): getByDate's day 1 row read revenue_usd 100 / cost_usd 60
 * (gross, no discount/refund netting) instead of 45 / 30. getByUser/
 * getByClient's combined revenue_usd read 120 instead of 125 — the OLD
 * SALE-row expression (`s2.final_amount_usd` = 90, already net of the flat
 * $10 discount) summed with the REFUND row's GROSS `t.amount_usd` (-50, the
 * refunded line's un-pro-rated `sold_price_usd`) gives day 1 = 90 - 50 = 40,
 * + day 2's 80 = 120; the fix's day 1 = 45 (the discount's OWN pro-rata
 * share on the REMAINING line, not the refunded one) + 80 = 125.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import {
  resetTransactionRepository,
  getTransactionRepository,
} from "../TransactionRepository.js";
import { ProfitService } from "../../services/ProfitService.js";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext.js";

const DAY1 = "2026-09-10";
const DAY2 = "2026-09-11";
const FROM_DT = "2026-09-10 00:00:00";
const TO_DT = "2026-09-11 23:59:59";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ProfitRepository's saleRecognitionWeight/saleHasPartnerObligation
    -- fragments reference partner_ledger unconditionally (not schema-drift
    -- guarded) — left empty so every sale is treated as plain customer-paid.
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
      notes TEXT, user_id INTEGER, settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      maintenance_part_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Every other module getByDate/getByUser/getByClient unconditionally
    -- JOIN — empty tables (rows are the point of proof, not the module
    -- fixtures — mirrors ProfitRepository.partnerProportional.sales.test.ts's
    -- own createSchema, which needs the same full module set even though
    -- only the sales columns are exercised there too).
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      omt_fee REAL, cost REAL DEFAULT 0, price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, carrier TEXT, currency_code TEXT DEFAULT 'USD', price REAL DEFAULT 0, cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, price_usd REAL DEFAULT 0, price_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, final_amount_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );
    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0, unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE loto_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT DEFAULT 'active', amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, expense_date TEXT, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE exchange_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
  `);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'cashier')`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Charger', 30, 50)`,
  ).run();
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'General', 'USD', 0), (1, 'General', 'LBP', 0)`,
  ).run();
  return db;
}

/** Stamp every row this sale wrote (sales + its transactions, SALE and any
 *  REFUND) onto ONE calendar day, mirroring the REAL-writer time-pinning
 *  precedent `ProfitRepository.financialWaitingForRepayment.test.ts` already
 *  established (the real writers only ever stamp CURRENT_TIMESTAMP). */
function pinSaleDay(db: Database.Database, saleId: number, day: string): void {
  const at = `${day} 10:00:00`;
  db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(at, saleId);
  db.prepare(
    `UPDATE transactions SET created_at = ? WHERE source_table = 'sales' AND source_id = ?`,
  ).run(at, saleId);
}

describe("ProfitRepository — sale revenue/cost net of discount+refund, parity across getByDate/getByUser/getByClient (REV lane, 2026-09-24)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let profitRepo: ProfitRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    salesRepo = new SalesRepository();
    profitRepo = new ProfitRepository();

    // Day 1: 2 x $50 = $100 pre-discount, $10 discount -> $90 tendered.
    // cost_price_snapshot_usd = $30/unit. One of the two lines is then
    // partially (fully) refunded — the SAME scenario
    // salesRevCostNetOfDiscountAndRefund.test.ts proves nets to
    // revenue 45 / cost 30 / profit 15 for getSalesRevCost.
    const day1 = salesRepo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 50 },
          { product_id: 1, quantity: 1, price: 50 },
        ],
        total_amount: 100,
        discount: 10,
        final_amount: 90,
        payment_usd: 90,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(day1.success).toBe(true);
    const day1SaleId = day1.id!;
    const day1ItemIds = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
        .all(day1SaleId) as { id: number }[]
    ).map((r) => r.id);
    salesRepo.refundSaleItem({
      saleId: day1SaleId,
      saleItemId: day1ItemIds[0],
      refundQuantity: 1,
      userId: 1,
    });
    pinSaleDay(db, day1SaleId, DAY1);

    // Day 2: undiscounted, unrefunded control — 2 x $40, cost $30/unit ->
    // revenue 80 / cost 60 / profit 20 (matches the "stays exact" control
    // case in salesRevCostNetOfDiscountAndRefund.test.ts).
    const day2 = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 40 }],
        total_amount: 80,
        discount: 0,
        final_amount: 80,
        payment_usd: 80,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(day2.success).toBe(true);
    pinSaleDay(db, day2.id!, DAY2);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("getByDate: each day's revenue_usd/cost_usd is net, and matches that day's own profit_usd (revenue - cost = profit)", () => {
    const rows = runWithTenant(1, () =>
      profitRepo.getByDate(DAY1, DAY2, FROM_DT, TO_DT),
    );
    const d1 = rows.find((r) => r.date === DAY1);
    const d2 = rows.find((r) => r.date === DAY2);
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();

    // Day 1 — discounted + one refunded line: net, not gross (100 / 60).
    expect(d1!.revenue_usd).toBeCloseTo(45, 6);
    expect(d1!.cost_usd).toBeCloseTo(30, 6);
    expect(d1!.profit_usd).toBeCloseTo(15, 6);
    expect(d1!.revenue_usd - d1!.cost_usd).toBeCloseTo(d1!.profit_usd, 6);

    // Day 2 — undiscounted, unrefunded control: unchanged by the fix.
    expect(d2!.revenue_usd).toBeCloseTo(80, 6);
    expect(d2!.cost_usd).toBeCloseTo(60, 6);
    expect(d2!.profit_usd).toBeCloseTo(20, 6);
    expect(d2!.revenue_usd - d2!.cost_usd).toBeCloseTo(d2!.profit_usd, 6);

    // REV-V4 (verifier round-1 fix, 2026-09-24) — the OLD assertion here
    // (`expect(d1!.revenue_usd).not.toBeCloseTo(d1!.revenue_usd + 1, 1)`) was
    // a tautology: a value is never close to itself + 1, so it could never
    // fail no matter what the query returned. A REAL no-leakage check:
    // re-querying day 1 ALONE (a [DAY1, DAY1] window) must produce the exact
    // same day-1 figures as the combined [DAY1, DAY2] window's day-1 row —
    // if day 2's discount/refund-free sale ever leaked into day 1's
    // GROUP BY bucket (or vice versa), narrowing the window would change the
    // number and this would fail.
    const day1AloneRows = runWithTenant(1, () =>
      profitRepo.getByDate(
        DAY1,
        DAY1,
        "2026-09-10 00:00:00",
        "2026-09-10 23:59:59",
      ),
    );
    const d1Alone = day1AloneRows.find((r) => r.date === DAY1);
    expect(d1Alone).toBeDefined();
    expect(d1Alone!.revenue_usd).toBeCloseTo(d1!.revenue_usd, 6);
    expect(d1Alone!.cost_usd).toBeCloseTo(d1!.cost_usd, 6);
    expect(d1Alone!.profit_usd).toBeCloseTo(d1!.profit_usd, 6);
  });

  // REV-V4 (verifier round-1 fix, 2026-09-24) — the spec's actual claim,
  // "Overview = Σ By Module = Σ By Date = Σ By Cashier = Σ By Client for
  // revenue AND profit", was never asserted as an equality for PROFIT or for
  // By Module at all — only revenue, and only across getByDate/getByUser/
  // getByClient/getSalesRevCost. This test closes both gaps.
  it("cross-view parity: Overview profit (getSalesProfit) equals Σ getByDate = Σ getByUser = Σ getByClient profit, and By Module (ProfitService.getByModule) matches on both revenue and profit", () => {
    const overviewProfit = runWithTenant(1, () =>
      profitRepo.getSalesProfit(FROM_DT, TO_DT),
    );
    const overviewRevCost = runWithTenant(1, () =>
      profitRepo.getSalesRevCost(FROM_DT, TO_DT),
    );

    const dateRows = runWithTenant(1, () =>
      profitRepo.getByDate(DAY1, DAY2, FROM_DT, TO_DT),
    );
    const userRows = runWithTenant(1, () => profitRepo.getByUser(FROM_DT, TO_DT));
    const clientRows = runWithTenant(1, () =>
      profitRepo.getByClient(FROM_DT, TO_DT, 50),
    );

    const sumDateProfit = dateRows.reduce((s, r) => s + r.profit_usd, 0);
    const sumUserProfit = userRows.reduce((s, r) => s + r.profit_usd, 0);
    const sumClientProfit = clientRows.reduce((s, r) => s + r.profit_usd, 0);

    // 35 = the SAME ledger figure salesRevCostNetOfDiscountAndRefund.test.ts
    // and this file's other tests already pin (15 day 1 + 20 day 2).
    expect(overviewProfit.profit_usd).toBeCloseTo(35, 6);
    expect(sumDateProfit).toBeCloseTo(overviewProfit.profit_usd, 6);
    expect(sumUserProfit).toBeCloseTo(overviewProfit.profit_usd, 6);
    expect(sumClientProfit).toBeCloseTo(overviewProfit.profit_usd, 6);

    // By Module — a SEPARATE code path (ProfitService, not ProfitRepository
    // directly) that also calls getSalesRevCost/getSalesProfit, so this is a
    // weaker "does the service layer forward the same numbers" check rather
    // than an independent re-derivation — still closes the "By Module is
    // never even called" gap the reviewer found.
    const profitService = new ProfitService(profitRepo);
    const moduleRows = runWithTenant(1, () =>
      profitService.getByModule(DAY1, DAY2),
    );
    const saleModuleRow = moduleRows.find((r) => r.module === "SALE");
    expect(saleModuleRow).toBeDefined();
    expect(saleModuleRow!.revenue_usd).toBeCloseTo(overviewRevCost.revenue_usd, 6);
    expect(saleModuleRow!.cost_usd).toBeCloseTo(overviewRevCost.cost_usd, 6);
    expect(saleModuleRow!.profit_usd).toBeCloseTo(overviewProfit.profit_usd, 6);
  });

  it("getByUser: the SALE row's revenue_usd is net across both days, and equals the ledger's profit_usd totals reconciliation", () => {
    const rows = runWithTenant(1, () => profitRepo.getByUser(FROM_DT, TO_DT));
    expect(rows).toHaveLength(1);
    // 45 (day 1, net) + 80 (day 2) = 125 — NOT 90 - 50 + 80 = 120 (the
    // pre-fix reading: the SALE row's final_amount_usd, 90, already net of
    // the flat $10 discount, summed with the REFUND row's own GROSS
    // amount_usd, -50 — the refunded line's un-pro-rated sold_price_usd,
    // never given its own $5 share of the discount the way the net formula
    // does — see this file's own header for the actually-observed RED run).
    expect(rows[0].revenue_usd).toBeCloseTo(125, 6);
    // PROFIT is unchanged by this fix — it was already ledger-true.
    expect(rows[0].profit_usd).toBeCloseTo(35, 6);
  });

  it("getByClient: the walk-in group's revenue_usd is net across both days (mirrors getByUser)", () => {
    const rows = runWithTenant(1, () =>
      profitRepo.getByClient(FROM_DT, TO_DT, 50),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].client_name).toBe("Walk-in");
    expect(rows[0].revenue_usd).toBeCloseTo(125, 6);
    expect(rows[0].profit_usd).toBeCloseTo(35, 6);
  });

  it("cross-check: getByDate's Σ revenue_usd/cost_usd over both days equals getSalesRevCost's own combined total (single source of truth, rule 14)", () => {
    const dateRows = runWithTenant(1, () =>
      profitRepo.getByDate(DAY1, DAY2, FROM_DT, TO_DT),
    );
    const sumRevenue = dateRows.reduce((s, r) => s + r.revenue_usd, 0);
    const sumCost = dateRows.reduce((s, r) => s + r.cost_usd, 0);

    const revCost = runWithTenant(1, () =>
      profitRepo.getSalesRevCost(FROM_DT, TO_DT),
    );
    expect(sumRevenue).toBeCloseTo(revCost.revenue_usd, 6);
    expect(sumCost).toBeCloseTo(revCost.cost_usd, 6);
    expect(revCost.revenue_usd).toBeCloseTo(125, 6);
    expect(revCost.cost_usd).toBeCloseTo(90, 6);
  });
});

/**
 * REV-V1 (verifier round-1 fix, 2026-09-24) — MEASURED defect this guards:
 * void a $90 (2 x $50, $10 discount) sale and Overview (`getSalesRevCost`)/
 * By Date (`getByDate`) correctly read 0 (both already gated on
 * `sales.status = 'completed'`, and voiding sets it to `'cancelled'`), but
 * By Cashier (`getByUser`)/By Client (`getByClient`) kept reading 90: their
 * SALE-row revenue branch (`saleRevenueUsdCaseBranch`) re-derived the sale's
 * full net figure from the UNCHANGED `sales`/`sale_items` rows for the
 * void's ACTIVE reversal row (still `type = 'SALE'`, per
 * `isVoidReversalRow`'s doc comment — NOT excluded by this branch's own
 * `t.type = 'SALE'` check, and not negated either), with no `status =
 * 'completed'` gate of its own to stop it. Fixed by sharing `saleAggBody`
 * (rule 14) across all three query shapes — see that function's own doc
 * comment.
 *
 * Rule 17: proven failing-first against the pre-fix `saleRevenueUsdCaseBranch`
 * (temporarily reverted to its byte-for-byte pre-fix body, both variants) —
 * `getByUser`/`getByClient`'s combined `revenue_usd` read 90 instead of 0;
 * reverted back to the fix afterward. See this file's own git history/PR
 * description for the actually-observed RED run's numbers.
 */
describe("ProfitRepository — void-reversal SALE row revenue parity across every view (REV-V1, 2026-09-24)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let profitRepo: ProfitRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    salesRepo = new SalesRepository();
    profitRepo = new ProfitRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("Overview, By Date, By Cashier and By Client all read 0 revenue/profit for a VOIDED discounted sale", () => {
    const sale = salesRepo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 50 },
          { product_id: 1, quantity: 1, price: 50 },
        ],
        total_amount: 100,
        discount: 10,
        final_amount: 90,
        payment_usd: 90,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(sale.success).toBe(true);
    const saleId = sale.id!;
    pinSaleDay(db, saleId, DAY1);

    const saleTxnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .all(saleId) as { id: number }[]
    )[0].id;

    runWithTenant(1, () => getTransactionRepository().voidTransaction(saleTxnId, 1));
    // `voidTransaction` INSERTs its reversal row with `created_at DEFAULT
    // CURRENT_TIMESTAMP` (today's real date, outside this test's DAY1
    // window) — re-pin it onto DAY1 the same way the original SALE row was
    // pinned, or getByUser/getByClient would emit NO row at all (window
    // mismatch) regardless of whether the bug this test guards is present,
    // silently proving nothing either way.
    pinSaleDay(db, saleId, DAY1);

    const overview = runWithTenant(1, () =>
      profitRepo.getSalesRevCost(FROM_DT, TO_DT),
    );
    const overviewProfit = runWithTenant(1, () =>
      profitRepo.getSalesProfit(FROM_DT, TO_DT),
    );
    const dateRows = runWithTenant(1, () =>
      profitRepo.getByDate(DAY1, DAY1, "2026-09-10 00:00:00", "2026-09-10 23:59:59"),
    );
    const userRows = runWithTenant(1, () => profitRepo.getByUser(FROM_DT, TO_DT));
    const clientRows = runWithTenant(1, () =>
      profitRepo.getByClient(FROM_DT, TO_DT, 50),
    );

    expect(overview.revenue_usd).toBeCloseTo(0, 6);
    expect(overview.cost_usd).toBeCloseTo(0, 6);
    expect(overviewProfit.profit_usd).toBeCloseTo(0, 6);

    const d1 = dateRows.find((r) => r.date === DAY1);
    expect(d1?.revenue_usd ?? 0).toBeCloseTo(0, 6);
    expect(d1?.profit_usd ?? 0).toBeCloseTo(0, 6);

    // getByUser/getByClient may legitimately emit NO row at all once every
    // source of activity nets to zero — summing (rather than indexing row
    // [0]) treats "no row" and "a row reading exactly 0" as the same correct
    // outcome, matching rule 15's "assert deltas, not row identity/position".
    const userRevenue = userRows.reduce((s, r) => s + r.revenue_usd, 0);
    const userProfit = userRows.reduce((s, r) => s + r.profit_usd, 0);
    const clientRevenue = clientRows.reduce((s, r) => s + r.revenue_usd, 0);
    const clientProfit = clientRows.reduce((s, r) => s + r.profit_usd, 0);
    expect(userRevenue).toBeCloseTo(0, 6);
    expect(userProfit).toBeCloseTo(0, 6);
    expect(clientRevenue).toBeCloseTo(0, 6);
    expect(clientProfit).toBeCloseTo(0, 6);
  });
});

/**
 * REV-V3 (verifier round-1 fix, 2026-09-24) — a regression the REV-V1 fix
 * would otherwise introduce on its own: gating `saleRevenueUsdCaseBranch` on
 * `sales.status = 'completed'` gives a fully item-refunded (or voided) sale
 * a SECOND way to make its correlated subquery return zero rows (the first
 * being `si2.is_refunded = 0` excluding every line). A bare scalar
 * `SELECT expr FROM (0-row subquery)` evaluates to SQL NULL, not 0 — MEASURED:
 * after a whole-sale `TransactionRepository.refundTransaction` (which sets
 * every `sale_items.is_refunded = 1`, not just the fix's own new gate),
 * `getByUser`/`getByClient` emitted `revenue_usd: null` (typed `number`) for
 * a user/client whose only window activity was that sale. Fixed by wrapping
 * the per-row CASE in `SUM(...)`/`COALESCE(..., 0)` instead of selecting it
 * directly off the scalar `FROM (...)` — see `saleRevenueUsdCaseBranch`'s own
 * doc comment.
 */
describe("ProfitRepository — By Cashier/By Client revenue_usd stays 0, never NULL, after a whole-sale refund (REV-V3, 2026-09-24)", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let profitRepo: ProfitRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    salesRepo = new SalesRepository();
    profitRepo = new ProfitRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("revenue_usd === 0 (not null) for the sale's only cashier/client group after a whole-sale refund", () => {
    const sale = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 50 }],
        total_amount: 50,
        discount: 0,
        final_amount: 50,
        payment_usd: 50,
        payment_lbp: 0,
        exchange_rate: 90_000,
      },
      1,
    );
    expect(sale.success).toBe(true);
    const saleId = sale.id!;
    pinSaleDay(db, saleId, DAY1);

    const saleTxnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .all(saleId) as { id: number }[]
    )[0].id;

    runWithTenant(1, () => getTransactionRepository().refundTransaction(saleTxnId, 1));

    // Sanity: refundTransaction really did flag every line (the shape this
    // regression depends on), not just this test's own assumption.
    const refundedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ? AND is_refunded = 1`,
        )
        .get(saleId) as { n: number }
    ).n;
    expect(refundedCount).toBe(1);

    const userRows = runWithTenant(1, () => profitRepo.getByUser(FROM_DT, TO_DT));
    const clientRows = runWithTenant(1, () =>
      profitRepo.getByClient(FROM_DT, TO_DT, 50),
    );

    expect(userRows).toHaveLength(1);
    expect(userRows[0].revenue_usd).toBe(0);
    expect(clientRows).toHaveLength(1);
    expect(clientRows[0].revenue_usd).toBe(0);
  });
});
