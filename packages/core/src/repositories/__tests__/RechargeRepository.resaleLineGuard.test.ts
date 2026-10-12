/**
 * LIRA-309 phase 6 (US4, C12) — a customer recharge may not target a phone
 * line the shop holds FOR SALE and has not sold yet. Booking it as a customer
 * sale would record fake revenue; the shop recharges its own line through the
 * internal recharge (Phone Lines → Recharge), which adds the cost to the line.
 * The REST route is directly callable, so the guard lives in the repository,
 * next to the existing `isShopOwnLine` re-check.
 *
 * Written before the guard; first run failed (the customer recharge on the
 * for-sale number succeeded).
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
import { RechargeRepository, resetRechargeRepository } from "../RechargeRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetResaleLineRepository } from "../ResaleLineRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

const GUARD =
  "This is your line for sale — use Recharge on the Phone Lines page (or the Recharge line panel on Mobile Recharge).";

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

describe("processRecharge — refuses a customer recharge on an unsold for-sale line (LIRA-309)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let productId: number;

  beforeEach(() => {
    resetRechargeRepository();
    resetTransactionRepository();
    resetResaleLineRepository();
    resetCarrierLineRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new RechargeRepository();
    productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, barcode, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (1, '03555101', 'MTC line 03 555 101', 'Product', 'Phone Lines', 15, 25, 1)`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'MTC', 'USD', 100) ON CONFLICT DO UPDATE SET balance = 100`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const sale = (phone: string) =>
    repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      paid_by_method: "CASH",
      phoneNumber: phone,
      userId: 1,
    });

  const txnCount = () =>
    (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n;

  it("refuses it however the number is typed, writing nothing", () => {
    const before = txnCount();
    for (const typed of ["03555101", "+961 3 555 101", "03-555-101"]) {
      expect(sale(typed)).toEqual({ success: false, error: GUARD });
    }
    expect(txnCount()).toBe(before);
  });

  it("allows it once the line is sold (stock 0) — it is the buyer's number now", () => {
    db.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).run(productId);
    const r = sale("+961 3 555 101");
    expect(r).not.toEqual({ success: false, error: GUARD });
  });

  it("leaves an ordinary customer number alone", () => {
    const r = sale("03999999");
    expect(r).not.toEqual({ success: false, error: GUARD });
  });
});
