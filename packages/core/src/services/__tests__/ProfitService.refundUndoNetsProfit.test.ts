/**
 * LIRA-273 — undoing a refund must put the Profits page back where it was
 * before the refund.
 *
 * An admin "Undo refund" writes a REFUND_UNDO row carrying the exact negation
 * of the REFUND's profit stamp (SalesRepository.undoSaleItemRefund,
 * TransactionRepository.undoSessionBasketItemRefund). Owner-measured bug: the
 * Profits page counted the REFUND but not the REFUND_UNDO, so a $13.12-profit
 * sale read $3 after an item refund and STILL $3 after the undo.
 *
 * Asserted on every Profits surface that counts a REFUND: Overview
 * (getSummary — also what the day close reads), By Module, By Date,
 * By Cashier (getByUser) and By Client.
 *
 * Whole-sale refund: there is no "undo" for a whole-transaction refund in the
 * codebase (only the two item-level undos above exist), so there is nothing
 * to guard for that case.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: written before the fix and run against the unfixed code first
 * (Overview/By Module/By Date stayed at the refunded level; By Cashier/By
 * Client counted the undo's price as extra revenue and as a second
 * transaction). Added AFTER the fix, never seen failing (not proven
 * failing-first): the refund/undo being done by a second user (ADMIN_ID —
 * pins By Cashier attribution to the seller) and the Sales drill-down total
 * (`saleDetailCountedUsd`).
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
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../../repositories/SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetProductUnitRepository } from "../../repositories/ProductUnitRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetVoucherRepository } from "../../repositories/VoucherRepository";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetRateRepository } from "../../repositories/RateRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetProfitRepository } from "../../repositories/ProfitRepository";
import { resetDebtService } from "../DebtService";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../SessionPaymentService";
import { ProfitService } from "../ProfitService";
import { sessionItemRefundSchema } from "../../validators/transaction";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
/** A second cashier/admin who performs the refund AND the undo — so By
 *  Cashier must keep both rows on the SELLER (user 1), the same place the
 *  refund itself is attributed (refundOriginalJoin). */
const ADMIN_ID = 2;
const RATE = 89500;
const FROM = "2000-01-01";
const TO = "2100-01-01";

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetVoucherRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetSupplierRepository();
  resetProfitRepository();
  resetDebtService();
  resetSessionPaymentService();
}

let db: Database.Database;
let seq = 0;

function addProduct(price: number, cost: number): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(`Product ${seq}`, cost, price).lastInsertRowid,
  );
}

/** Two-line sale: line A ($13.12 sold, $3 cost → $10.12 margin) is the one
 *  refunded; line B ($5 sold, $2 cost → $3 margin) stays. */
function saleRequest(extra: Partial<SaleRequest>): SaleRequest {
  const a = addProduct(13.12, 3);
  const b = addProduct(5, 2);
  return {
    client_id: null,
    items: [
      { product_id: a, quantity: 1, price: 13.12 },
      { product_id: b, quantity: 1, price: 5 },
    ],
    total_amount: 18.12,
    discount: 0,
    final_amount: 18.12,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function saleTxnId(saleId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number }
  ).id;
}

function firstSaleItemId(saleId: number): number {
  return (
    db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1`)
      .get(saleId) as { id: number }
  ).id;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const sum = <T>(rows: T[], pick: (r: T) => number) =>
  r6(rows.reduce((s, r) => s + (pick(r) || 0), 0));

/** Every Profits surface that counts a REFUND, as plain USD/LBP figures. */
function surfaces() {
  const svc = new ProfitService();
  const summary = svc.getSummary(FROM, TO);
  const byModule = svc.getByModule(FROM, TO);
  const byDate = svc.getByDate(FROM, TO);
  const byUser = svc.getByUser(FROM, TO);
  const byClient = svc.getByClient(FROM, TO, 1000);
  const saleDetail = svc.getModuleDetail("SALE", FROM, TO);
  return {
    saleDetailCountedUsd: r6(saleDetail.counted_total_profit_usd),
    overviewGrossUsd: r6(summary.totals.gross_profit_usd),
    overviewGrossLbp: r6(summary.totals.gross_profit_lbp),
    overviewSalesUsd: r6(summary.sales.profit_usd),
    byModuleUsd: sum(byModule, (r) => r.profit_usd),
    byModuleLbp: sum(byModule, (r) => r.profit_lbp),
    byDateUsd: sum(byDate, (r) => r.profit_usd),
    byDateLbp: sum(byDate, (r) => r.profit_lbp),
    byUserUsd: sum(byUser, (r) => r.profit_usd),
    byUserLbp: sum(byUser, (r) => r.profit_lbp),
    byClientUsd: sum(byClient, (r) => r.profit_usd),
    byClientLbp: sum(byClient, (r) => r.profit_lbp),
    // Revenue too: the undo must not add the refunded line's price a
    // second time on top of the sale's own (net-of-refund) revenue.
    overviewRevenueUsd: r6(summary.totals.gross_revenue_usd),
    byModuleRevenueUsd: sum(byModule, (r) => r.revenue_usd),
    byDateRevenueUsd: sum(byDate, (r) => r.revenue_usd),
    // Per cashier / per client rows: who it is attributed to, revenue,
    // profit, and the "Avg Profit/Txn" denominator (a REFUND is not a
    // recognised transaction; neither is its undo).
    byUserRows: byUser.map((u) => ({
      user_id: u.user_id,
      revenue_usd: r6(u.revenue_usd),
      profit_usd: r6(u.profit_usd),
      recognized_transaction_count: u.recognized_transaction_count,
    })),
    byClientRows: byClient.map((c) => ({
      client_name: c.client_name,
      revenue_usd: r6(c.revenue_usd),
      profit_usd: r6(c.profit_usd),
      recognized_transaction_count: c.recognized_transaction_count,
    })),
  };
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (?, 1, 'manager', '', 'admin', 1)`,
  ).run(ADMIN_ID);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-273 — refund then undo nets every Profits surface back to the pre-refund value", () => {
  it("POS per-item refund (Sale page) then Undo refund", () => {
    const r = new SalesRepository().processSale(
      saleRequest({
        payments: [{ method: "CASH", currency_code: "USD", amount: 18.12 }],
      }),
      USER_ID,
    );
    expect(r.success).toBe(true);
    const saleId = r.id!;

    const beforeRefund = surfaces();
    // Sanity: the sale's margin is on every surface.
    expect(beforeRefund.overviewGrossUsd).toBe(13.12);
    expect(beforeRefund.byModuleUsd).toBe(13.12);
    expect(beforeRefund.byDateUsd).toBe(13.12);
    expect(beforeRefund.byUserUsd).toBe(13.12);
    expect(beforeRefund.byClientUsd).toBe(13.12);

    const salesRepo = new SalesRepository();
    const refundId = salesRepo.refundSaleItem({
      saleId,
      saleItemId: firstSaleItemId(saleId),
      refundQuantity: 1,
      userId: ADMIN_ID,
    });
    const afterRefund = surfaces();
    expect(afterRefund.overviewGrossUsd).toBe(3);

    salesRepo.undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: ADMIN_ID,
    });
    expect(surfaces()).toEqual(beforeRefund);
  });

  it("session (customer basket) item refund then Undo refund", () => {
    const sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Walk-in",
      started_by: "admin",
    });
    const r = new SalesRepository().processSale(
      saleRequest({ deferPayment: true }),
      USER_ID,
    );
    expect(r.success).toBe(true);
    const saleId = r.id!;
    const txnId = saleTxnId(saleId);
    getCustomerSessionRepository().linkTransaction(
      sessionId,
      "sale",
      saleId,
      18.12,
      0,
      0,
      0,
      txnId,
    );
    new SessionPaymentService().recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 18.12 }],
      exchangeRate: RATE,
      userId: USER_ID,
    });

    const beforeRefund = surfaces();
    expect(beforeRefund.overviewGrossUsd).toBe(13.12);

    // Field names from the shared schema (rule 24).
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      saleItemId: firstSaleItemId(saleId),
      quantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 13.12 }],
    });
    const res = getTransactionRepository().refundSessionBasketItem({
      ...payload,
      userId: ADMIN_ID,
    });
    expect(surfaces().overviewGrossUsd).toBe(3);

    getTransactionRepository().undoSessionBasketItemRefund({
      refundTransactionId: res.refundTransactionId,
      userId: ADMIN_ID,
    });
    expect(surfaces()).toEqual(beforeRefund);
  });
});
