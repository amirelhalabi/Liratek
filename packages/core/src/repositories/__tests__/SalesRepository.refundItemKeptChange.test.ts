/**
 * Refund kept change on the POS per-item refund (owner decision
 * 2026-10-07) — the SAME rules the whole-sale refund already follows
 * (`TransactionRepository.refundKeptChange.test.ts`): a $20.12 item handed
 * back as $20 cash lets the shop keep the $0.12 as profit — cash only, one
 * currency, the refund's own currency, under $1 / 100,000 LBP, checked by
 * `resolveKeptChange` (payer "payout"), refused on a FOR-partner sale.
 *
 * It is NOT a partial refund: the item side (stock, REFUND amount,
 * refunded_quantity) is the full refund; only the cash handed back is short,
 * and the shortfall lands in the REFUND row's own profit stamp (−item profit
 * + kept, per currency). "Undo refund" negates that stamp, so refund + undo
 * nets drawers AND profit to 0 per currency.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 *
 * Rule 17: written BEFORE the fix, against a `refundSaleItem` signature that
 * accepted `keptChange` and ignored it. Failure text recorded in the change
 * report.
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
} from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { ProfitService } from "../../services/ProfitService";
import { saleRefundItemSchema } from "../../validators/sale";
import {
  expectPostings,
  ledgerDeltas,
  snapshotLedgers,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
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

function stockOf(productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity AS q FROM products WHERE id = ?`)
      .get(productId) as { q: number }
  ).q;
}

function txnRow(id: number) {
  return db
    .prepare(
      `SELECT type, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json FROM transactions WHERE id = ?`,
    )
    .get(id) as {
    type: string;
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string | null;
  };
}

function refundCount(): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'REFUND'`)
      .get() as { n: number }
  ).n;
}

function grossProfit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary(FROM, TO);
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Two-line cash sale: line A (the one refunded) at `priceA`, line B $5.
 * `currency` is the tender's currency; LBP tender is the USD total × RATE.
 */
function twoLineCashSale(priceA: number, costA: number, currency: "USD" | "LBP") {
  const a = addProduct(priceA, costA);
  const b = addProduct(5, 2);
  const total = priceA + 5;
  const req: SaleRequest = {
    client_id: null,
    items: [
      { product_id: a, quantity: 1, price: priceA },
      { product_id: b, quantity: 1, price: 5 },
    ],
    total_amount: total,
    discount: 0,
    final_amount: total,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    payments: [
      {
        method: "CASH",
        currency_code: currency,
        amount: currency === "USD" ? total : total * RATE,
      },
    ],
  };
  const r = new SalesRepository().processSale(req, USER_ID);
  expect(r.success).toBe(true);
  const saleId = r.id!;
  const itemA = (
    db
      .prepare(
        `SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?`,
      )
      .get(saleId, a) as { id: number }
  ).id;
  return { saleId, itemA, productA: a };
}

/** The per-item refund's payload, parsed through the SHARED schema so the
 *  field names come from it (rule 24); `keptChange` is mapped to the
 *  repository's `{usd, lbp}` exactly as the IPC handler / REST route do. */
function refundItem(input: Record<string, unknown>): number {
  const p = saleRefundItemSchema.parse(input);
  return new SalesRepository().refundSaleItem({
    saleId: p.saleId,
    saleItemId: p.saleItemId,
    refundQuantity: p.refundQuantity,
    refundLegs: p.refundLegs,
    exchangeRate: p.exchangeRate,
    keptChange: p.keptChange
      ? { usd: p.keptChange.kept_change_usd, lbp: p.keptChange.kept_change_lbp }
      : undefined,
    userId: USER_ID,
  });
}

/** What the item's own profit share is with no kept change — measured by
 *  a plain refund on an identical sale (never hand-computed). */
function plainItemRefundProfit(priceA: number, costA: number, currency: "USD" | "LBP") {
  const { saleId, itemA } = twoLineCashSale(priceA, costA, currency);
  const id = refundItem({ saleId, saleItemId: itemA, refundQuantity: 1 });
  return txnRow(id).profit_usd;
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("refund kept change — POS per-item refund (refundSaleItem)", () => {
  it("USD: $20.12 item refunded with $20 cash keeps $0.12 as profit; undo nets drawers and profit to 0", () => {
    const plainProfit = plainItemRefundProfit(20.12, 10, "USD");
    const { saleId, itemA, productA } = twoLineCashSale(20.12, 10, "USD");
    const stockBefore = stockOf(productA);
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);

    const refundId = refundItem({
      saleId,
      saleItemId: itemA,
      refundQuantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      keptChange: { kept_change_usd: 0.12 },
    });

    const after = snapshotLedgers(db);
    const d = ledgerDeltas(before, after);
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|USD"))!;
    expectPostings(before, after, { drawers: { [cashKey]: -20 } });

    // Full refund on the item side — not a partial refund.
    const refund = txnRow(refundId);
    expect(refund.type).toBe("REFUND");
    expect(refund.amount_usd).toBeCloseTo(-20.12, 6);
    expect(r6(refund.profit_usd)).toBe(r6(plainProfit + 0.12));
    expect(refund.profit_lbp).toBe(0);
    expect(stockOf(productA)).toBe(stockBefore + 1);
    const meta = JSON.parse(refund.metadata_json ?? "{}");
    expect(meta.kept_change_usd).toBe(0.12);
    expect(meta.kept_change_lbp).toBe(0);

    // Profits page moves by the refund's own stamp, kept included, once.
    expect(r6(grossProfit().usd - profitBefore.usd)).toBe(
      r6(plainProfit + 0.12),
    );

    const undoId = new SalesRepository().undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: USER_ID,
    });
    expectPostings(before, snapshotLedgers(db), {});
    const undo = txnRow(undoId);
    expect(r6(refund.profit_usd + undo.profit_usd)).toBe(0);
    expect(r6(refund.profit_lbp + undo.profit_lbp)).toBe(0);
    // NOT asserted: the Profits page total after the undo. Measured with NO
    // kept change at all (plain $20.12 item refund + undo): gross went
    // 13.12 → 3 → 3 — `ProfitService.getSummary` does not count an item
    // refund's REFUND_UNDO row. Pre-existing gap, reported, not pinned here.
    expect(stockOf(productA)).toBe(stockBefore);
  });

  it("LBP: kept 50,000 LBP lands in the LBP profit stamp; undo nets it to 0", () => {
    const plainProfit = plainItemRefundProfit(20, 10, "LBP");
    const { saleId, itemA } = twoLineCashSale(20, 10, "LBP");
    const before = snapshotLedgers(db);

    const itemLbp = 20 * RATE; // 1,790,000
    const refundId = refundItem({
      saleId,
      saleItemId: itemA,
      refundQuantity: 1,
      refundLegs: [
        { method: "CASH", currencyCode: "LBP", amount: itemLbp - 50_000 },
      ],
      keptChange: { kept_change_lbp: 50_000 },
    });

    const after = snapshotLedgers(db);
    const d = ledgerDeltas(before, after);
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|LBP"))!;
    expectPostings(before, after, {
      drawers: { [cashKey]: -(itemLbp - 50_000) },
    });
    const refund = txnRow(refundId);
    expect(r6(refund.profit_usd)).toBe(r6(plainProfit));
    expect(refund.profit_lbp).toBe(50_000);

    const undoId = new SalesRepository().undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: USER_ID,
    });
    expectPostings(before, snapshotLedgers(db), {});
    const undo = txnRow(undoId);
    expect(r6(refund.profit_usd + undo.profit_usd)).toBe(0);
    expect(refund.profit_lbp + undo.profit_lbp).toBe(0);
  });

  it("undo negates the refund's LBP profit stamp too (not only USD)", () => {
    // Isolates the undo half: a REFUND row carrying an LBP profit stamp (the
    // shape an LBP kept-change item refund writes) must be fully negated by
    // "Undo refund", or the kept LBP stays on the Profits page forever.
    const { saleId, itemA } = twoLineCashSale(20, 10, "USD");
    const refundId = refundItem({ saleId, saleItemId: itemA, refundQuantity: 1 });
    db.prepare(`UPDATE transactions SET profit_lbp = 50000 WHERE id = ?`).run(
      refundId,
    );
    const undoId = new SalesRepository().undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: USER_ID,
    });
    expect(txnRow(undoId).profit_lbp).toBe(-50_000);
  });

  it("no kept change → unchanged: full item amount back, plain negated stamp, no kept metadata", () => {
    const plainProfit = plainItemRefundProfit(20.12, 10, "USD");
    const { saleId, itemA } = twoLineCashSale(20.12, 10, "USD");
    const before = snapshotLedgers(db);
    const refundId = refundItem({
      saleId,
      saleItemId: itemA,
      refundQuantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(Object.values(d.drawers).map(r6)).toEqual([-20.12]);
    const refund = txnRow(refundId);
    expect(r6(refund.profit_usd)).toBe(r6(plainProfit));
    expect(JSON.parse(refund.metadata_json ?? "{}").kept_change_usd).toBe(
      undefined,
    );
  });

  describe("refusals write nothing", () => {
    function expectRefused(input: Record<string, unknown>, message: RegExp) {
      const before = snapshotLedgers(db);
      const refunds = refundCount();
      expect(() => refundItem(input)).toThrow(message);
      expectPostings(before, snapshotLedgers(db), {});
      expect(refundCount()).toBe(refunds);
    }

    it("tampered: claims $0.50 kept when only $0.12 is short", () => {
      const { saleId, itemA } = twoLineCashSale(20.12, 10, "USD");
      expectRefused(
        {
          saleId,
          saleItemId: itemA,
          refundQuantity: 1,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { kept_change_usd: 0.5 },
        },
        /payment legs do not reconcile/,
      );
    });

    it("cap: $1.00 short is not a small leftover", () => {
      const { saleId, itemA } = twoLineCashSale(21, 10, "USD");
      expectRefused(
        {
          saleId,
          saleItemId: itemA,
          refundQuantity: 1,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { kept_change_usd: 1 },
        },
        /must be a small leftover/,
      );
    });

    it("other currency: LBP kept on a USD refund", () => {
      const { saleId, itemA } = twoLineCashSale(20.12, 10, "USD");
      expectRefused(
        {
          saleId,
          saleItemId: itemA,
          refundQuantity: 1,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { kept_change_lbp: 10_000 },
        },
        /must be in the payout currency \(USD\)/,
      );
    });

    it("non-cash return line: kept change refused", () => {
      const { saleId, itemA } = twoLineCashSale(20.12, 10, "USD");
      expectRefused(
        {
          saleId,
          saleItemId: itemA,
          refundQuantity: 1,
          refundLegs: [{ method: "OMT", currencyCode: "USD", amount: 20 }],
          keptChange: { kept_change_usd: 0.12 },
        },
        /only to a cash refund/,
      );
    });

    it("no return lines (default mirror refund): kept change refused", () => {
      const { saleId, itemA } = twoLineCashSale(20.12, 10, "USD");
      expectRefused(
        {
          saleId,
          saleItemId: itemA,
          refundQuantity: 1,
          keptChange: { kept_change_usd: 0.12 },
        },
        /needs the payment lines/,
      );
    });

    it("FOR-partner sale: kept change refused (no counter cash — exact amount only)", () => {
      const partnerId = Number(
        db
          .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P')`)
          .run().lastInsertRowid,
      );
      const a = addProduct(20.12, 10);
      const r = new SalesRepository().processSale(
        {
          client_id: null,
          items: [{ product_id: a, quantity: 1, price: 20.12 }],
          total_amount: 20.12,
          discount: 0,
          final_amount: 20.12,
          payment_usd: 0,
          payment_lbp: 0,
          exchange_rate: RATE,
          status: "completed",
          payments: [],
          partnerId,
          partnerMode: "FOR",
        },
        USER_ID,
      );
      expect(r.success).toBe(true);
      const itemId = (
        db
          .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
          .get(r.id!) as { id: number }
      ).id;
      expectRefused(
        {
          saleId: r.id!,
          saleItemId: itemId,
          refundQuantity: 1,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { kept_change_usd: 0.12 },
        },
        /kept change|keep change|partner/i,
      );
    });
  });
});
