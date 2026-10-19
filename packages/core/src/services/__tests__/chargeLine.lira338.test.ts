/**
 * LIRA-338 — "Charge to shop line" from the iPick / Katsh / Whish App grids
 * can target ANY active line of the card's carrier (owner, 2026-10-19):
 *
 * - a shop line other than the main one (self-charge, TELECOM_SELF_CHARGE);
 * - a Whish App MTC/Alfa card, paid from the Whish App LBP balance;
 * - never a turned-off shop line (the server used to accept one);
 * - a line held for sale, through the LIRA-309 CARD recharge, now also from
 *   a Whish App card.
 *
 * Written before the change (rule 17).
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
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetStockBatchRepository, getStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetResaleLineRepository } from "../../repositories/ResaleLineRepository";
import { resetCarrierLineRepository } from "../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../repositories/CarrierLineMovementRepository";
import { resetExpenseRepository } from "../../repositories/ExpenseRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetServiceProviderRepository } from "../../repositories/ServiceProviderRepository";
import { resetMobileServiceItemRepository } from "../../repositories/MobileServiceItemRepository";
import { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
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
  resetMobileServiceItemRepository();
  resetCarrierLineService();
  resetResaleLineService();
}

function addLine(db: Database.Database, phone: string, opts: { primary?: boolean; active?: boolean } = {}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, credits, validity_expires_at, is_active, is_primary)
         VALUES (1, 'alfa', ?, 20, ?, ?, ?)`,
      )
      .run(phone, inDays(60), opts.active === false ? 0 : 1, opts.primary ? 1 : 0).lastInsertRowid,
  );
}

function addCard(db: Database.Database, provider: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, ?, 'alfa', 'Prepaid', '7.58', 765007, 800000, 7.58, 30)`,
      )
      .run(provider).lastInsertRowid,
  );
}

function lineCredits(db: Database.Database, id: number): number {
  return (db.prepare(`SELECT credits FROM carrier_lines WHERE id = ?`).get(id) as { credits: number }).credits;
}

describe("LIRA-338 — charge a card to any active line", () => {
  let db: Database.Database;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("charges a chosen shop line that is not the main one", () => {
    const main = addLine(db, "03222875", { primary: true });
    const second = addLine(db, "03444111");
    const card = addCard(db, "iPick");
    const res = new FinancialServiceRepository().selfChargeTelecomItem({
      mobileServiceItemId: card,
      carrierLineId: second,
      client_day: TODAY,
    });
    expect(res.carrierLineId).toBe(second);
    expect(lineCredits(db, second)).toBeCloseTo(27.58, 6);
    expect(lineCredits(db, main)).toBe(20);
  });

  it("a Whish App card is paid from the Whish App LBP balance", () => {
    const line = addLine(db, "03222875", { primary: true });
    const card = addCard(db, "WHISH_APP");
    const before = snapshotLedgers(db);
    new FinancialServiceRepository().selfChargeTelecomItem({
      mobileServiceItemId: card,
      carrierLineId: line,
      client_day: TODAY,
    });
    const after = snapshotLedgers(db);
    expect((after.drawers["Whish_App|LBP"] ?? 0) - (before.drawers["Whish_App|LBP"] ?? 0)).toBe(-765007);
    expect(lineCredits(db, line)).toBeCloseTo(27.58, 6);
  });

  it("refuses a turned-off shop line", () => {
    addLine(db, "03222875", { primary: true });
    const off = addLine(db, "03444111", { active: false });
    const card = addCard(db, "Katsh");
    expect(() =>
      new FinancialServiceRepository().selfChargeTelecomItem({
        mobileServiceItemId: card,
        carrierLineId: off,
        client_day: TODAY,
      }),
    ).toThrow("Shop line 03444111 is turned off.");
    expect(lineCredits(db, off)).toBe(20);
  });

  it("a Whish App card recharges a line held for sale; the cost goes into the line", () => {
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, min_stock_level)
           VALUES (1, '70444202', 'Alfa line', 'Product', 'Phone Lines', 15, 25, 1, 0)`,
        )
        .run().lastInsertRowid,
    );
    getStockBatchRepository().createBatch({
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
    ).run(productId, inDays(2));
    const card = addCard(db, "WHISH_APP");
    const before = snapshotLedgers(db);
    const r = new ResaleLineService().recharge(
      { product_id: productId, source: "CARD", mobile_service_item_id: card, exchange_rate: RATE, client_day: TODAY },
      USER_ID,
    );
    expect(r).toMatchObject({ success: true, data: { cost_usd: 8.6 } }); // 765,007 / 89,000
    const after = snapshotLedgers(db);
    expect((after.drawers["Whish_App|LBP"] ?? 0) - (before.drawers["Whish_App|LBP"] ?? 0)).toBe(-765007);
    expect(after.drawers["iPick|LBP"] ?? 0).toBe(before.drawers["iPick|LBP"] ?? 0);
  });
});
