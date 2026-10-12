/**
 * LIRA-309 phase 5 (US3) — recharging a line the shop holds FOR SALE.
 *
 * Owner rules (2026-10-11):
 * - The recharge's cost is added to the line's cost AND selling price (no
 *   expense that day). $15/$25 + $3 of days → $18/$28, profit still $10.
 * - Three sources: MTC/Alfa days from a shop line, credit transferred from a
 *   shop line, and a card from the iPick/Katsh balance.
 * - Undo by void: newest recharge first, refused once the line is sold;
 *   every ledger nets to 0 per currency.
 *
 * Covers quickstart C2–C11 (specs/309-phone-lines-management/quickstart.md)
 * on a full database built from create_db.sql + migrations.
 *
 * Written before the recharge existed; first run failed with
 * "service.recharge is not a function".
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository, getTransactionRepository } from "../../repositories/TransactionRepository";
import { resetStockBatchRepository, getStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetResaleLineRepository } from "../../repositories/ResaleLineRepository";
import { resetCarrierLineRepository } from "../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../repositories/CarrierLineMovementRepository";
import { resetExpenseRepository } from "../../repositories/ExpenseRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetServiceProviderRepository } from "../../repositories/ServiceProviderRepository";
import { resetCarrierLineService } from "../CarrierLineService";
import { ResaleLineService, resetResaleLineService } from "../ResaleLineService";
import { snapshotLedgers } from "../../repositories/testHelpers/postingAssert";
import { localDay } from "../../utils/localDate";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_000;
const TODAY = localDay();

function inDays(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetTransactionRepository();
  resetStockBatchRepository();
  resetResaleLineRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetExpenseRepository();
  resetPaymentMethodRepository();
  resetServiceProviderRepository();
  resetCarrierLineService();
  resetResaleLineService();
}

interface Fixture {
  productId: number;
  batchId: number;
  shopLineId: number;
  alfaCardId: number;
  mtcCardId: number;
}

/** Alfa for-sale line 70444202 at $15/$25 (stock 1, one batch @ $15),
 *  expiring in 2 days; Alfa shop line 03222875 (primary, $20 credit, 60
 *  days left) whose credits ARE the Alfa drawer ($20); iPick Alfa 7.58 card
 *  (770,000 LBP, $7.58 + 30 days) and an MTC card. */
function seed(db: Database.Database, opts: { lineExpiry?: string | null } = {}): Fixture {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, min_stock_level)
         VALUES (1, '70444202', 'Alfa line 70 444 202', 'Product', 'Phone Lines', 15, 25, 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  const batchId = getStockBatchRepository().createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 1,
    unit_cost_usd: 15,
    books_debt: false,
    created_by: USER_ID,
  });
  db.prepare(
    `INSERT INTO resale_lines (tenant_id, product_id, carrier, credits, validity_expires_at, created_at, updated_at)
     VALUES (1, ?, 'alfa', 0, ?, '2026-10-01', '2026-10-01')`,
  ).run(productId, opts.lineExpiry === undefined ? inDays(2) : opts.lineExpiry);
  const shopLineId = Number(
    db
      .prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
         VALUES (1, 'alfa', '03222875', 20, ?, 1, 1)`,
      )
      .run(inDays(60)).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'Alfa', 'USD', 20)
     ON CONFLICT DO UPDATE SET balance = 20`,
  ).run();
  const alfaCardId = Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, 'iPick', 'alfa', 'Prepaid', '7.58', 770000, 800000, 7.58, 30)`,
      )
      .run().lastInsertRowid,
  );
  const mtcCardId = Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, 'iPick', 'mtc', 'Prepaid', '4.5', 466000, 500000, 4.5, 30)`,
      )
      .run().lastInsertRowid,
  );
  return { productId, batchId, shopLineId, alfaCardId, mtcCardId };
}

function product(db: Database.Database, id: number) {
  return db
    .prepare(`SELECT cost_price_usd AS cost, selling_price_usd AS price, stock_quantity AS stock FROM products WHERE id = ?`)
    .get(id) as { cost: number; price: number; stock: number };
}
function batchCost(db: Database.Database, id: number): number {
  return (db.prepare(`SELECT unit_cost_usd AS c FROM product_stock_batches WHERE id = ?`).get(id) as { c: number }).c;
}
function resaleLine(db: Database.Database, productId: number) {
  return db
    .prepare(`SELECT credits, validity_expires_at AS expiry FROM resale_lines WHERE product_id = ?`)
    .get(productId) as { credits: number; expiry: string | null };
}
function shopLine(db: Database.Database, id: number) {
  return db
    .prepare(`SELECT credits, validity_expires_at AS expiry FROM carrier_lines WHERE id = ?`)
    .get(id) as { credits: number; expiry: string | null };
}
function fullState(db: Database.Database, f: Fixture) {
  return {
    ledgers: snapshotLedgers(db),
    product: product(db, f.productId),
    batch: batchCost(db, f.batchId),
    line: resaleLine(db, f.productId),
    shop: shopLine(db, f.shopLineId),
    expenses: (db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n,
  };
}

describe("ResaleLineService.recharge (LIRA-309 phase 5)", () => {
  let db: Database.Database;
  let service: ResaleLineService;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    service = new ResaleLineService();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const days = (productId: number, n = 30, cost = 3) =>
    service.recharge(
      { product_id: productId, source: "DAYS", days: n, days_cost_usd: cost, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );

  it("C2 — DAYS: cost and price +$3, batch +$3, line +30 days, shop line −30 days −$3, Alfa drawer −$3, no expense", () => {
    const f = seed(db);
    const before = snapshotLedgers(db);
    const result = days(f.productId);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(product(db, f.productId)).toMatchObject({ cost: 18, price: 28, stock: 1 });
    expect(batchCost(db, f.batchId)).toBe(18);
    expect(resaleLine(db, f.productId)).toEqual({ credits: 0, expiry: inDays(32) });
    expect(shopLine(db, f.shopLineId)).toEqual({ credits: 17, expiry: inDays(30) });

    const after = snapshotLedgers(db);
    expect(after.drawers["Alfa|USD"] - before.drawers["Alfa|USD"]).toBeCloseTo(-3, 6);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n).toBe(0);

    const txn = db
      .prepare(`SELECT type, profit_usd, profit_lbp, exchange_rate FROM transactions WHERE id = ?`)
      .get(result.data.transaction_id) as { type: string; profit_usd: number; profit_lbp: number; exchange_rate: number };
    expect(txn).toMatchObject({ type: "LINE_RECHARGE", profit_usd: 0, profit_lbp: 0, exchange_rate: RATE });
    expect(result.data.cost_usd).toBe(3);
  });

  it("C3 — once sold, the sale is costed at the raised batch cost ($18 → profit $10 at $28)", () => {
    const f = seed(db);
    days(f.productId);
    const take = getStockBatchRepository().consume(f.productId, 1, {
      reason: "SALE",
      fallbackUnitCostUsd: 18,
    });
    expect(take.weightedUnitCostUsd).toBe(18);
    expect(28 - take.weightedUnitCostUsd).toBe(10);
  });

  it("C4 — voiding the recharge before the sale puts every balance and the line back", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const r = days(f.productId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(fullState(db, f)).toEqual(before);
  });

  it("C5 — voiding after the line is sold is refused", () => {
    const f = seed(db);
    const r = days(f.productId);
    if (!r.success) throw new Error(r.error);
    getStockBatchRepository().consume(f.productId, 1, { reason: "SALE", fallbackUnitCostUsd: 18 });
    db.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).run(f.productId);
    expect(() =>
      getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID),
    ).toThrow("Refund the sale of this line first.");
  });

  it("C6 — newest recharge first: the older one is refused until the newer is undone", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const first = days(f.productId, 10, 1);
    const second = days(f.productId, 10, 1);
    if (!first.success || !second.success) throw new Error("setup");
    expect(() =>
      getTransactionRepository().voidTransaction(first.data.transaction_id, USER_ID),
    ).toThrow("Undo the newer recharge of this line first.");
    getTransactionRepository().voidTransaction(second.data.transaction_id, USER_ID);
    getTransactionRepository().voidTransaction(first.data.transaction_id, USER_ID);
    expect(fullState(db, f)).toEqual(before);
  });

  it("C11 — a manual price edit after the recharge is kept: void subtracts the recharge cost", () => {
    const f = seed(db);
    const r = days(f.productId);
    if (!r.success) throw new Error(r.error);
    db.prepare(`UPDATE products SET selling_price_usd = 27 WHERE id = ?`).run(f.productId);
    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(product(db, f.productId)).toMatchObject({ cost: 15, price: 24 });
  });

  it("C7 — CARD: iPick −770,000 LBP, line +$7.58 credit and +30 days, cost/price +$8.65, Alfa drawer untouched; void nets to 0", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const r = service.recharge(
      { product_id: f.productId, source: "CARD", mobile_service_item_id: f.alfaCardId, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const after = snapshotLedgers(db);
    expect(after.drawers["iPick|LBP"] - (before.ledgers.drawers["iPick|LBP"] ?? 0)).toBe(-770000);
    expect(after.drawers["Alfa|USD"]).toBe(before.ledgers.drawers["Alfa|USD"]);
    expect(r.data.cost_usd).toBe(8.65);
    expect(product(db, f.productId)).toMatchObject({ cost: 23.65, price: 33.65 });
    expect(resaleLine(db, f.productId)).toEqual({ credits: 7.58, expiry: inDays(32) });

    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(fullState(db, f)).toEqual(before);
  });

  it("CARD refusals: another carrier's card, and a card with no cost", () => {
    const f = seed(db);
    const wrongCarrier = service.recharge(
      { product_id: f.productId, source: "CARD", mobile_service_item_id: f.mtcCardId, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(wrongCarrier).toEqual({ success: false, error: "Use an Alfa card or line for this Alfa number." });
    db.prepare(`UPDATE mobile_service_items SET cost_lbp = 0 WHERE id = ?`).run(f.alfaCardId);
    const noCost = service.recharge(
      { product_id: f.productId, source: "CARD", mobile_service_item_id: f.alfaCardId, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(noCost).toEqual({ success: false, error: "Enter what this recharge cost before saving." });
  });

  it("C8 — SHOP_LINE_CREDIT $2: shop line and Alfa drawer −$2.16 (with 1 SMS fee), line +$2, cost +$2.07, no SMS expense; void nets to 0", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const r = service.recharge(
      { product_id: f.productId, source: "SHOP_LINE_CREDIT", credits: 2, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(shopLine(db, f.shopLineId).credits).toBeCloseTo(17.84, 6);
    const after = snapshotLedgers(db);
    expect(after.drawers["Alfa|USD"] - before.ledgers.drawers["Alfa|USD"]).toBeCloseTo(-2.16, 6);
    expect(resaleLine(db, f.productId).credits).toBe(2);
    // 2 × 85,000 / 89,000 + 0.16 = 2.0701… → $2.07
    expect(r.data.cost_usd).toBe(2.07);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n).toBe(0);

    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(fullState(db, f)).toEqual(before);
  });

  it("refuses a line that is lost, sold, or has no carrier saved", () => {
    const lost = seed(db, { lineExpiry: inDays(-10) });
    expect(days(lost.productId)).toEqual({
      success: false,
      error: "This line has expired past its grace period and can no longer be recharged.",
    });
    db.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).run(lost.productId);
    expect(days(lost.productId)).toEqual({ success: false, error: "This line is not in stock." });
  });

  // Not proven failing-first: both guard existing behaviour the recharge
  // reuses (the carrier-line sell addback and the one-unit batch rule).
  //
  // U1 corrected (2026-10-13): undoing a DAYS sale on a shop line adds the
  // days back onto the line's CURRENT expiry (CarrierLineRepository.
  // reverseMovement, sell branch), so it is safe in any order. A later days
  // sale on the same shop line does NOT block undoing the recharge, and is
  // kept intact. The earlier spec assumption (a refusal) was wrong.
  it("U1 — undoing a DAYS recharge after a later days sale on the shop line keeps that later sale", () => {
    const f = seed(db);
    const r = days(f.productId, 10, 1);
    if (!r.success) throw new Error(r.error);
    const later = getTransactionRepository().createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 1,
      user_id: USER_ID,
      amount_usd: 0,
      amount_lbp: 0,
      summary: "later days sale",
      metadata_json: {},
    });
    const moved = require("../CarrierLineService").getCarrierLineService().applyMovement({
      carrierLineId: f.shopLineId,
      creditsDelta: 0,
      validityDaysDelta: -5,
      reason: "DAYS_SALE",
      transactionId: later,
      today: TODAY,
    });
    expect(moved.success).toBe(true);
    expect(shopLine(db, f.shopLineId).expiry).toBe(inDays(45)); // 60 − 10 − 5

    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    // The recharge's 10 days come back; the later 5-day sale stays.
    expect(shopLine(db, f.shopLineId).expiry).toBe(inDays(55));
    expect(product(db, f.productId)).toMatchObject({ cost: 15, price: 25 });
    expect(resaleLine(db, f.productId).expiry).toBe(inDays(2));
  });

  it("refuses a line with more than one unit in stock", () => {
    const f = seed(db);
    db.prepare(`UPDATE products SET stock_quantity = 2 WHERE id = ?`).run(f.productId);
    db.prepare(`UPDATE product_stock_batches SET quantity = 2, quantity_remaining = 2 WHERE id = ?`).run(f.batchId);
    expect(days(f.productId)).toEqual({
      success: false,
      error: "This line has more than one unit in stock; fix its stock first.",
    });
    expect(product(db, f.productId)).toMatchObject({ cost: 15, price: 25 });
  });

  // Owner decisions 2026-10-13 (written before the change; first run failed
  // with the old "has only 0 days left" / "has only $… credit" refusals).
  it("DAYS from a shop line with no expiry asks to set the expiry first", () => {
    const f = seed(db);
    db.prepare(`UPDATE carrier_lines SET validity_expires_at = NULL WHERE id = ?`).run(f.shopLineId);
    expect(days(f.productId)).toEqual({
      success: false,
      error: "Set the expiry of shop line 03222875 first (Phone Lines → Shop lines).",
    });
  });

  it("DAYS needing more days than the shop line has is refused", () => {
    const f = seed(db);
    expect(days(f.productId, 90, 3)).toEqual({
      success: false,
      error: "Shop line 03222875 has only 60 days left.",
    });
  });

  it("SHOP_LINE_CREDIT is allowed when the shop line is low, like a credit sale", () => {
    const f = seed(db);
    db.prepare(`UPDATE carrier_lines SET credits = 1 WHERE id = ?`).run(f.shopLineId);
    const r = service.recharge(
      { product_id: f.productId, source: "SHOP_LINE_CREDIT", credits: 2, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(r.success).toBe(true);
    expect(shopLine(db, f.shopLineId).credits).toBeCloseTo(-1.16, 6);
  });
});
