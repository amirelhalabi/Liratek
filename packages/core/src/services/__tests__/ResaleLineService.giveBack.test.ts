/**
 * LIRA-337 — giving part of a for-sale line's credit back to a shop line
 * before the sale (specs/337-give-credit-back/spec.md, owner 2026-10-18).
 *
 * Worked example: Alfa line at $20 cost / $25 price with $15 credit; buyer
 * keeps $9; credit sold at 100,000 LBP/$1; rate 89,500; credit cost rate
 * 89,500 → line sends $5.68 + $0.32 fee, shop line $20 → $25.68, price
 * $25 → $18.30, cost $20 → $14.32. Void nets every balance to 0.
 *
 * Written before the give-back existed (rule 17).
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
const RATE = 89_500;
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
  mtcShopLineId: number;
}

function seed(db: Database.Database): Fixture {
  db.prepare(`DELETE FROM system_settings WHERE tenant_id = 1 AND key_name = 'alfa_credit_cost_lbp'`).run();
  db.prepare(`INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'alfa_credit_cost_lbp', '89500')`).run();
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, min_stock_level)
         VALUES (1, '70444202', 'Alfa line 70 444 202', 'Product', 'Phone Lines', 20, 25, 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  const batchId = getStockBatchRepository().createBatch({
    product_id: productId,
    supplier_id: null,
    quantity: 1,
    unit_cost_usd: 20,
    books_debt: false,
    created_by: USER_ID,
  });
  db.prepare(
    `INSERT INTO resale_lines (tenant_id, product_id, carrier, credits, validity_expires_at, created_at, updated_at)
     VALUES (1, ?, 'alfa', 15, ?, '2026-10-01', '2026-10-01')`,
  ).run(productId, inDays(20));
  const shopLineId = Number(
    db
      .prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
         VALUES (1, 'alfa', '03222875', 20, ?, 1, 1)`,
      )
      .run(inDays(60)).lastInsertRowid,
  );
  const mtcShopLineId = Number(
    db
      .prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
         VALUES (1, 'mtc', '03111222', 10, ?, 1, 1)`,
      )
      .run(inDays(60)).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'Alfa', 'USD', 20)
     ON CONFLICT DO UPDATE SET balance = 20`,
  ).run();
  return { productId, batchId, shopLineId, mtcShopLineId };
}

function product(db: Database.Database, id: number) {
  return db
    .prepare(`SELECT cost_price_usd AS cost, selling_price_usd AS price, stock_quantity AS stock FROM products WHERE id = ?`)
    .get(id) as { cost: number; price: number; stock: number };
}
function batchCost(db: Database.Database, id: number): number {
  return (db.prepare(`SELECT unit_cost_usd AS c FROM product_stock_batches WHERE id = ?`).get(id) as { c: number }).c;
}
function lineCredits(db: Database.Database, productId: number): number {
  return (db.prepare(`SELECT credits FROM resale_lines WHERE product_id = ?`).get(productId) as { credits: number }).credits;
}
function shopCredits(db: Database.Database, id: number): number {
  return (db.prepare(`SELECT credits FROM carrier_lines WHERE id = ?`).get(id) as { credits: number }).credits;
}
function fullState(db: Database.Database, f: Fixture) {
  return {
    ledgers: snapshotLedgers(db),
    product: product(db, f.productId),
    batch: batchCost(db, f.batchId),
    line: lineCredits(db, f.productId),
    shop: shopCredits(db, f.shopLineId),
    expenses: (db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n,
  };
}

describe("ResaleLineService.giveBack (LIRA-337)", () => {
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

  const giveBack = (productId: number, kept = 9, extra: Record<string, unknown> = {}) =>
    service.giveBack(
      {
        product_id: productId,
        credits_kept: kept,
        credit_sell_price_lbp: 100_000,
        exchange_rate: RATE,
        client_day: TODAY,
        ...extra,
      },
      USER_ID,
    );

  it("worked example: line $9 / $18.30 / $14.32, shop line and Alfa drawer +$5.68, no expense", () => {
    const f = seed(db);
    const before = snapshotLedgers(db);
    const r = giveBack(f.productId);
    expect(r).toMatchObject({
      success: true,
      data: {
        credits_sent: 5.68,
        sms_fee_usd: 0.32,
        price_drop_usd: 6.7,
        cost_drop_usd: 5.68,
        line: { credits: 9, price_usd: 18.3, cost_usd: 14.32 },
      },
    });
    if (!r.success) return;

    expect(product(db, f.productId)).toMatchObject({ cost: 14.32, price: 18.3, stock: 1 });
    expect(batchCost(db, f.batchId)).toBe(14.32);
    expect(lineCredits(db, f.productId)).toBe(9);
    expect(shopCredits(db, f.shopLineId)).toBeCloseTo(25.68, 6);
    const after = snapshotLedgers(db);
    expect(after.drawers["Alfa|USD"] - before.drawers["Alfa|USD"]).toBeCloseTo(5.68, 6);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n).toBe(0);

    const txn = db
      .prepare(`SELECT type, amount_usd, profit_usd, profit_lbp FROM transactions WHERE id = ?`)
      .get(r.data.transaction_id) as { type: string; amount_usd: number; profit_usd: number; profit_lbp: number };
    expect(txn).toEqual({ type: "LINE_CREDIT_GIVE_BACK", amount_usd: 5.68, profit_usd: 0, profit_lbp: 0 });
  });

  it("once sold, the sale is costed at the lowered batch cost (profit $3.98 at $18.30)", () => {
    const f = seed(db);
    giveBack(f.productId);
    const take = getStockBatchRepository().consume(f.productId, 1, { reason: "SALE", fallbackUnitCostUsd: 14.32 });
    expect(take.weightedUnitCostUsd).toBe(14.32);
    expect(Math.round((18.3 - take.weightedUnitCostUsd) * 100) / 100).toBe(3.98);
  });

  it("void before the sale puts every balance and the line back", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const r = giveBack(f.productId);
    if (!r.success) throw new Error(r.error);
    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(fullState(db, f)).toEqual(before);
  });

  it("refund before the sale also puts everything back", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const r = giveBack(f.productId);
    if (!r.success) throw new Error(r.error);
    getTransactionRepository().refundTransaction(r.data.transaction_id, USER_ID);
    expect(fullState(db, f).product).toEqual(before.product);
    expect(fullState(db, f).line).toBe(before.line);
    expect(fullState(db, f).batch).toBe(before.batch);
  });

  it("void after the line is sold is refused", () => {
    const f = seed(db);
    const r = giveBack(f.productId);
    if (!r.success) throw new Error(r.error);
    getStockBatchRepository().consume(f.productId, 1, { reason: "SALE", fallbackUnitCostUsd: 14.32 });
    db.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).run(f.productId);
    expect(() => getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID)).toThrow(
      "Refund the sale of this line first.",
    );
  });

  it("newest first across recharges and give-backs", () => {
    const f = seed(db);
    const before = fullState(db, f);
    const recharge = service.recharge(
      { product_id: f.productId, source: "DAYS", days: 10, days_cost_usd: 1, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    const back = giveBack(f.productId);
    if (!recharge.success || !back.success) throw new Error("setup");
    expect(() => getTransactionRepository().voidTransaction(recharge.data.transaction_id, USER_ID)).toThrow(
      "Undo the newer recharge of this line first.",
    );
    getTransactionRepository().voidTransaction(back.data.transaction_id, USER_ID);
    getTransactionRepository().voidTransaction(recharge.data.transaction_id, USER_ID);
    expect(fullState(db, f).product).toEqual(before.product);
    expect(fullState(db, f).line).toBe(before.line);
    expect(fullState(db, f).batch).toBe(before.batch);
  });

  it("an older give-back waits for a newer recharge", () => {
    const f = seed(db);
    const back = giveBack(f.productId);
    const recharge = service.recharge(
      { product_id: f.productId, source: "DAYS", days: 10, days_cost_usd: 1, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    if (!recharge.success || !back.success) throw new Error("setup");
    expect(() => getTransactionRepository().voidTransaction(back.data.transaction_id, USER_ID)).toThrow(
      "Undo the newer recharge of this line first.",
    );
  });

  it("void is allowed when the shop line has spent the credit (it may go below zero)", () => {
    const f = seed(db);
    const r = giveBack(f.productId);
    if (!r.success) throw new Error(r.error);
    db.prepare(`UPDATE carrier_lines SET credits = 1 WHERE id = ?`).run(f.shopLineId);
    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);
    expect(shopCredits(db, f.shopLineId)).toBeCloseTo(-4.68, 6);
  });

  it("refusals", () => {
    const f = seed(db);
    expect(giveBack(f.productId, 15)).toEqual({
      success: false,
      error: "The buyer must keep less credit than the line has.",
    });
    expect(giveBack(f.productId, 14.84)).toEqual({
      success: false,
      error: "Too little credit to cover the SMS fee.",
    });
    expect(giveBack(f.productId, 9, { carrier_line_id: f.mtcShopLineId })).toEqual({
      success: false,
      error: "Use an Alfa card or line for this Alfa number.",
    });
    expect(giveBack(f.productId, 9, { credit_sell_price_lbp: 10_000_000 })).toEqual({
      success: false,
      error: "This line's price would go below zero.",
    });
    db.prepare(`UPDATE resale_lines SET carrier = 'alfa' WHERE product_id = ?`).run(f.productId);
    db.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).run(f.productId);
    expect(giveBack(f.productId)).toEqual({ success: false, error: "This line is not in stock." });
    // Nothing was written by any refusal.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM resale_line_give_backs`).get() as { n: number }).n).toBe(0);
  });
});
