/**
 * Refund kept change (owner decision 2026-10-07): a refund of $20.12 where
 * the cashier hands back $20 lets the shop keep the $0.12 as profit — capped
 * below $1 / 100,000 LBP, in the refund's own currency, from cash or wallet
 * (drawer) money only — never a customer account or gift card. It is NOT
 * a partial refund: the item side (stock, REFUND amount, debt) is the full
 * refund; only the cash handed back is short, and the shortfall lands in the
 * REFUND row's own profit stamp (−original profit + kept), so the Profits
 * page shows it once and an undo negates it with everything else.
 *
 * Server authority: `resolveKeptChange` (payer "payout") checks every claim;
 * the refund path adds its own preconditions (drawer legs only, one currency,
 * a money-IN original).
 *
 * Real production schema (create_db.sql + migrations), real writers.
 *
 * Rule 17: written BEFORE the fix, against signatures that accepted
 * `keptChange` / `kept_change_*` and ignored them. Failure text recorded in
 * the change report.
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { getDebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { ProfitService } from "../../services/ProfitService";
import {
  REFUND_KEPT_CHANGE_META,
  sessionItemRefundSchema,
} from "../../validators/transaction";
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

function sale(
  productId: number,
  price: number,
  extra: Partial<SaleRequest>,
): SaleRequest {
  return {
    client_id: null,
    items: [{ product_id: productId, quantity: 1, price }],
    total_amount: price,
    discount: 0,
    final_amount: price,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function saleTxn(saleId: number): { id: number; profit_usd: number } {
  return db
    .prepare(
      `SELECT id, profit_usd FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(saleId) as { id: number; profit_usd: number };
}

function txnRow(id: number) {
  return db
    .prepare(
      `SELECT type, amount_usd, amount_lbp, profit_usd, profit_lbp FROM transactions WHERE id = ?`,
    )
    .get(id) as {
    type: string;
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
  };
}

function refundCount(): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'REFUND'`)
      .get() as { n: number }
  ).n;
}

function cashSale(price: number, cost: number, currency: "USD" | "LBP") {
  const productId = addProduct(currency === "USD" ? price : price / RATE, cost);
  const r = new SalesRepository().processSale(
    sale(productId, currency === "USD" ? price : price / RATE, {
      payments: [{ method: "CASH", currency_code: currency, amount: price }],
    }),
    USER_ID,
  );
  expect(r.success).toBe(true);
  return { saleId: r.id!, productId, ...saleTxn(r.id!) };
}

function grossProfit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary(FROM, TO);
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

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

describe("refund kept change — whole-transaction refund (Transactions page)", () => {
  it("USD: $20.12 sale refunded with $20 cash keeps $0.12 as profit, drawer −$20, Profits +$0.12 once", () => {
    const { id, profit_usd, productId } = cashSale(20.12, 10, "USD");
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);
    const stockBefore = (
      db
        .prepare(`SELECT stock_quantity AS q FROM products WHERE id = ?`)
        .get(productId) as { q: number }
    ).q;

    const refundId = getTransactionRepository().refundTransaction(id, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      keptChange: { usd: 0.12 },
    });

    const after = snapshotLedgers(db);
    const d = ledgerDeltas(before, after);
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|USD"))!;
    expectPostings(before, after, { drawers: { [cashKey]: -20 } });

    // Full refund on the item side — not a partial refund.
    const refund = txnRow(refundId);
    expect(refund.type).toBe("REFUND");
    expect(refund.amount_usd).toBeCloseTo(-20.12, 6);
    expect(r6(refund.profit_usd)).toBe(r6(-profit_usd + 0.12));
    expect(refund.profit_lbp).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT stock_quantity AS q FROM products WHERE id = ?`)
          .get(productId) as { q: number }
      ).q,
    ).toBe(stockBefore + 1);

    const profitAfter = grossProfit();
    expect(r6(profitAfter.usd - profitBefore.usd)).toBe(r6(-profit_usd + 0.12));
    expect(profitAfter.lbp - profitBefore.lbp).toBe(0);
  });

  it("POS \"Refund Sale\" (refundBySaleId): same $0.12 kept, drawer −$20", () => {
    const { saleId, profit_usd } = cashSale(20.12, 10, "USD");
    const before = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundBySaleId(saleId, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      keptChange: { usd: 0.12 },
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(Object.values(d.drawers).map(r6)).toEqual([-20]);
    expect(r6(txnRow(refundId).profit_usd)).toBe(r6(-profit_usd + 0.12));
  });

  it("LBP: 1,800,000 LBP sale refunded with 1,750,000 LBP keeps 50,000 LBP in the LBP profit stamp", () => {
    const { id, profit_usd } = cashSale(1_800_000, 10, "LBP");
    const before = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundTransaction(id, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 1_750_000 }],
      keptChange: { lbp: 50_000 },
    });
    const after = snapshotLedgers(db);
    const d = ledgerDeltas(before, after);
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|LBP"))!;
    expectPostings(before, after, { drawers: { [cashKey]: -1_750_000 } });
    const refund = txnRow(refundId);
    expect(r6(refund.profit_usd)).toBe(r6(-profit_usd));
    expect(refund.profit_lbp).toBe(50_000);
  });

  it("debt repayment: $20.12 repayment refunded with $20 cash keeps $0.12, Profits +$0.12 once", () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Debtor', '70123456')`,
        )
        .run().lastInsertRowid,
    );
    getDebtRepository().addRepayment({
      client_id: clientId,
      amount_usd: 20.12,
      amount_lbp: 0,
      created_by: USER_ID,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
    });
    const repaymentId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'DEBT_REPAYMENT' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { id: number }
    ).id;
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);

    const refundId = getTransactionRepository().refundTransaction(
      repaymentId,
      USER_ID,
      {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
        keptChange: { usd: 0.12 },
      },
    );

    const d = ledgerDeltas(before, snapshotLedgers(db));
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|USD"))!;
    expect(r6(d.drawers[cashKey])).toBe(-20);
    expect(d.debt[`${clientId}|USD`]).toBeCloseTo(20.12, 6);
    expect(r6(txnRow(refundId).profit_usd)).toBe(0.12);
    expect(r6(grossProfit().usd - profitBefore.usd)).toBe(0.12);
  });

  it("wallet: $20.12 sale refunded with $20 through WHISH keeps $0.12, Whish drawer −$20, Profits +$0.12 once", () => {
    // Owner decision 2026-10-07: kept change may come from any DRAWER money
    // (cash or wallet), never an account or gift card.
    const { id, profit_usd } = cashSale(20.12, 10, "USD");
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundTransaction(id, USER_ID, {
      refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 20 }],
      keptChange: { usd: 0.12 },
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": -20 },
    });
    expect(r6(txnRow(refundId).profit_usd)).toBe(r6(-profit_usd + 0.12));
    expect(r6(grossProfit().usd - profitBefore.usd)).toBe(
      r6(-profit_usd + 0.12),
    );
  });

  it("no kept change → unchanged: the full refund goes back and the stamp is the plain negation", () => {
    const { id, profit_usd } = cashSale(20.12, 10, "USD");
    const before = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundTransaction(id, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(Object.values(d.drawers).map(r6)).toEqual([-20.12]);
    expect(r6(txnRow(refundId).profit_usd)).toBe(r6(-profit_usd));
  });

  describe("refusals write nothing", () => {
    function expectRefused(
      txnId: number,
      opts: Parameters<
        ReturnType<typeof getTransactionRepository>["refundTransaction"]
      >[2],
      message: RegExp,
    ): void {
      const before = snapshotLedgers(db);
      const refunds = refundCount();
      expect(() =>
        getTransactionRepository().refundTransaction(txnId, USER_ID, opts),
      ).toThrow(message);
      expectPostings(before, snapshotLedgers(db), {});
      expect(refundCount()).toBe(refunds);
    }

    it("tampered: claims $0.20 kept when only $0.12 is short", () => {
      const { id } = cashSale(20.12, 10, "USD");
      expectRefused(
        id,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { usd: 0.2 },
        },
        /payment legs do not reconcile/,
      );
    });

    it("tampered inside the reconcile tolerance: claims $0.16 kept when only $0.12 is short", () => {
      const { id } = cashSale(20.12, 10, "USD");
      expectRefused(
        id,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { usd: 0.16 },
        },
        /more than the amount left unpaid/,
      );
    });

    it("phantom: claims $0.03 kept on an exact refund", () => {
      const { id } = cashSale(20.12, 10, "USD");
      expectRefused(
        id,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
          keptChange: { usd: 0.03 },
        },
        /keep change applies only when the payout is short/,
      );
    });

    it("cap: $1.00 short is not a small leftover", () => {
      const { id } = cashSale(21, 10, "USD");
      expectRefused(
        id,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { usd: 1 },
        },
        /must be a small leftover/,
      );
    });

    it("other currency: LBP kept on a USD refund", () => {
      const { id } = cashSale(20.12, 10, "USD");
      expectRefused(
        id,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          keptChange: { lbp: 10_000 },
        },
        /must be in the payout currency \(USD\)/,
      );
    });

    // Owner decision 2026-10-07: a wallet return line (OMT/WHISH) MAY keep
    // change now — see the accepted "wallet" case above. Only a line that
    // moves no drawer (customer account, gift card) still refuses it.
    it.each(["CUSTOMER_ACCOUNT", "GIFT_CARD"])(
      "%s return line (moves no drawer): kept change refused",
      (method) => {
        const { id } = cashSale(20.12, 10, "USD");
        expectRefused(
          id,
          {
            refundLegs: [{ method, currencyCode: "USD", amount: 20 }],
            keptChange: { usd: 0.12 },
          },
          /cash or wallet/,
        );
      },
    );

    it("no return lines (default mirror refund): kept change refused", () => {
      const { id } = cashSale(20.12, 10, "USD");
      expectRefused(
        id,
        { keptChange: { usd: 0.12 } },
        /needs the payment lines/,
      );
    });

    it("mixed-currency original: kept change refused", () => {
      const productId = addProduct(20, 10);
      const r = new SalesRepository().processSale(
        sale(productId, 20, {
          payments: [
            { method: "CASH", currency_code: "USD", amount: 10 },
            { method: "CASH", currency_code: "LBP", amount: 10 * RATE },
          ],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      expectRefused(
        saleTxn(r.id!).id,
        {
          refundLegs: [
            { method: "CASH", currencyCode: "USD", amount: 10 },
            { method: "CASH", currencyCode: "LBP", amount: 10 * RATE - 5_000 },
          ],
          keptChange: { lbp: 5_000 },
        },
        /refund in one currency/,
      );
    });

    it("OMT SEND (LIRA-272): no longer refused — the kept part is stamped on the refund's own keys the Profits page reads", () => {
      // Was "refused — the Profits page never reads an FS refund's stamp".
      // LIRA-272 made the Profits page read it (refund kept change on every
      // module, ProfitRepository.refundKeptChangeModules.test.ts), so the
      // guard is now that the refund is accepted AND carries the dedicated
      // keys that reader uses — never only the copied kept_change_* names.
      new FinancialServiceRepository().createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
      } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE type = 'FINANCIAL_SERVICE' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { id: number }
      ).id;
      const refundId = getTransactionRepository().refundTransaction(
        txnId,
        USER_ID,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 104.5 }],
          keptChange: { usd: 0.5 },
        },
      );
      const meta = JSON.parse(
        (
          db
            .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
            .get(refundId) as { metadata_json: string }
        ).metadata_json,
      ) as Record<string, unknown>;
      expect(meta[REFUND_KEPT_CHANGE_META.usd]).toBe(0.5);
      expect(meta[REFUND_KEPT_CHANGE_META.lbp]).toBe(0);
    });

    it("payout original (OMT RECEIVE): the customer hands money back, so kept change refused", () => {
      const fsRepo = new FinancialServiceRepository();
      fsRepo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        exchangeRate: RATE,
      } as Parameters<typeof fsRepo.createTransaction>[0]);
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE source_table = 'financial_services' AND type = 'FINANCIAL_SERVICE' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { id: number }
      ).id;
      expectRefused(
        txnId,
        {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 99.5 }],
          keptChange: { usd: 0.5 },
        },
        // LIRA-272: FINANCIAL_SERVICE is an allowed type now, so the
        // money-direction check is what refuses it.
        /cannot keep change on a refund that takes money back from the customer/,
      );
    });
  });
});

describe("refund kept change — session basket item refund", () => {
  function sessionSale(price: number) {
    const productId = addProduct(price, 10);
    const sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Walk-in",
      started_by: "admin",
    });
    const r = new SalesRepository().processSale(
      sale(productId, price, { deferPayment: true }),
      USER_ID,
    );
    expect(r.success).toBe(true);
    const saleId = r.id!;
    const { id: txnId, profit_usd } = saleTxn(saleId);
    getCustomerSessionRepository().linkTransaction(
      sessionId,
      "sale",
      saleId,
      price,
      0,
      0,
      0,
      txnId,
    );
    new SessionPaymentService().recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: price }],
      exchangeRate: RATE,
      userId: USER_ID,
    });
    const saleItemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
        .get(saleId) as { id: number }
    ).id;
    return { sessionId, txnId, saleItemId, profit_usd };
  }

  it("keeps $0.12 of a $20.12 item refund as profit; undo nets drawers and profit to 0", () => {
    const { sessionId, txnId, saleItemId, profit_usd } = sessionSale(20.12);
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);

    // Field names from the shared schema (rule 24).
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      saleItemId,
      quantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      kept_change_usd: 0.12,
    });
    const res = getTransactionRepository().refundSessionBasketItem({
      ...payload,
      userId: USER_ID,
    });

    const after = snapshotLedgers(db);
    const d = ledgerDeltas(before, after);
    const cashKey = Object.keys(d.drawers).find((k) => k.endsWith("|USD"))!;
    expectPostings(before, after, { drawers: { [cashKey]: -20 } });
    const refund = txnRow(res.refundTransactionId);
    expect(r6(refund.profit_usd)).toBe(r6(-profit_usd + 0.12));
    const link = db
      .prepare(
        `SELECT profit_usd, profit_lbp FROM customer_session_transactions WHERE unified_transaction_id = ?`,
      )
      .get(res.refundTransactionId) as { profit_usd: number; profit_lbp: number };
    expect(r6(link.profit_usd)).toBe(r6(-profit_usd + 0.12));

    const profitAfter = grossProfit();
    expect(r6(profitAfter.usd - profitBefore.usd)).toBe(r6(-profit_usd + 0.12));

    const undoId = getTransactionRepository().undoSessionBasketItemRefund({
      refundTransactionId: res.refundTransactionId,
      userId: USER_ID,
    });
    expectPostings(before, snapshotLedgers(db), {});
    // The undo's own stamp negates the refund's, kept change included, so
    // refund + undo nets to 0 per currency at the row level.
    const undo = txnRow(undoId);
    expect(undo.type).toBe("REFUND_UNDO");
    expect(r6(refund.profit_usd + undo.profit_usd)).toBe(0);
    expect(r6(refund.profit_lbp + undo.profit_lbp)).toBe(0);
    // NOT asserted: the Profits page total after the undo. Measured
    // separately with NO kept change, a session item refund's REFUND_UNDO
    // row is not counted by ProfitService.getSummary at all (gross stays at
    // the refunded level) — a pre-existing gap, reported, not pinned here.
  });

  it("wallet: a WHISH return line keeps $0.12 of a $20.12 item refund", () => {
    const { sessionId, txnId, saleItemId, profit_usd } = sessionSale(20.12);
    const before = snapshotLedgers(db);
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      saleItemId,
      quantity: 1,
      refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 20 }],
      kept_change_usd: 0.12,
    });
    const res = getTransactionRepository().refundSessionBasketItem({
      ...payload,
      userId: USER_ID,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": -20 },
    });
    expect(r6(txnRow(res.refundTransactionId).profit_usd)).toBe(
      r6(-profit_usd + 0.12),
    );
  });

  it("tampered kept on a session item refund is refused and writes nothing", () => {
    const { sessionId, txnId, saleItemId } = sessionSale(20.12);
    const before = snapshotLedgers(db);
    const refunds = refundCount();
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      saleItemId,
      quantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      kept_change_usd: 0.5,
    });
    expect(() =>
      getTransactionRepository().refundSessionBasketItem({
        ...payload,
        userId: USER_ID,
      }),
    ).toThrow(/payment legs do not reconcile/);
    expectPostings(before, snapshotLedgers(db), {});
    expect(refundCount()).toBe(refunds);
  });
});
