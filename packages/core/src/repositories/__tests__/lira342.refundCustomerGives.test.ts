
/**
 * LIRA-342 — refund: net default + the customer gives change back (owner
 * decision 2026-10-25). CornerTech: a sale paid IN Cash $55 with OUT Cash
 * 250,000 LBP change @90,000 → net $52.22. Refunding it as $52.22 must work;
 * and if the customer hands the 250,000 LBP back, the shop hands back the
 * full $55 — the LBP is an IN line on the REFUND row (its own drawer), the
 * claim (`added_change_usd`, in the hand-back currency) raises the refund
 * legs' target, profit stays that of a plain $52.22 refund.
 *
 * Rule 17: written before the server change; failure recorded in the report.
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
  sessionItemRefundSchema,
  transactionRefundSchema,
} from "../../validators/transaction";
import {
  expectPostings,
  ledgerDeltas,
  snapshotLedgers,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 90000;
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
});

const r2 = (n: number) => Math.round(n * 100) / 100;

function cornerTechSale() {
  // net = 55 - 250000/90000 = 52.2222…
  const price = 55 - 250000 / RATE;
  const productId = addProduct(price, 30);
  const r = new SalesRepository().processSale(
    sale(productId, price, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 55 },
        { method: "CASH", currency_code: "LBP", amount: 250000, direction: "OUT" },
      ],
    }),
    USER_ID,
  );
  expect(r.success).toBe(true);
  return { saleId: r.id!, ...saleTxn(r.id!) };
}

function lbpSale() {
  // LBP-paid mirror (rule 28d): IN 2,000,000 LBP, OUT $2 change → net 1,820,000 LBP ($20.22)
  const price = (2000000 - 2 * RATE) / RATE;
  const productId = addProduct(price, 10);
  const r = new SalesRepository().processSale(
    sale(productId, price, {
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 2000000 },
        { method: "CASH", currency_code: "USD", amount: 2, direction: "OUT" },
      ],
    }),
    USER_ID,
  );
  expect(r.success).toBe(true);
  return { saleId: r.id!, ...saleTxn(r.id!) };
}

type Body = Parameters<typeof transactionRefundSchema.parse>[0];
function refund(id: number, body: Omit<Body, "transactionId">) {
  // Field names from the shared schema (rule 24).
  const p = transactionRefundSchema.parse({ transactionId: id, ...body });
  return getTransactionRepository().refundTransaction(id, USER_ID, {
    refundLegs: p.refundLegs ?? undefined,
    exchangeRate: p.exchangeRate ?? undefined,
    addedChange: p.addedChange ?? undefined,
  } as Parameters<ReturnType<typeof getTransactionRepository>["refundTransaction"]>[2]);
}

function drawerDelta(before: ReturnType<typeof snapshotLedgers>, cur: string) {
  const d = ledgerDeltas(before, snapshotLedgers(db));
  return Object.entries(d.drawers)
    .filter(([k]) => k.endsWith(`|${cur}`))
    .reduce((s, [, v]) => s + (v as number), 0);
}

describe("LIRA-342 — generic refund", () => {
  it("(a) CornerTech refunded as Cash $52.22 at the sale rate is accepted", () => {
    const { id, profit_usd } = cornerTechSale();
    const before = snapshotLedgers(db);
    const refundId = refund(id, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 52.22 }],
      exchangeRate: RATE,
    });
    expect(r2(drawerDelta(before, "USD"))).toBe(-52.22);
    expect(drawerDelta(before, "LBP")).toBe(0);
    expect(r6(txnRow(refundId).profit_usd)).toBe(r6(-profit_usd));
  });

  it("(b) $55 out + customer returns 250,000 LBP (claim $2.78) → USD −55, LBP +250,000, profit as (a)", () => {
    const { id, profit_usd } = cornerTechSale();
    const profitBefore = grossProfit();
    const before = snapshotLedgers(db);
    const refundId = refund(id, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 55 }],
      exchangeRate: RATE,
      addedChange: {
        added_change_usd: 2.78,
        customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 250000 }],
      },
    });
    expect(r2(drawerDelta(before, "USD"))).toBe(-55);
    expect(drawerDelta(before, "LBP")).toBe(250000);
    const row = txnRow(refundId);
    expect(r2(row.amount_usd)).toBe(-52.22);
    expect(r6(row.profit_usd)).toBe(r6(-profit_usd));
    expect(r6(grossProfit().usd - profitBefore.usd)).toBe(r6(-profit_usd));
    const pays = db
      .prepare(`SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`)
      .all(refundId) as Array<{ currency_code: string; amount: number }>;
    expect(pays.find((p) => p.currency_code === "LBP")?.amount).toBe(250000);
  });

  it("(c) claim over the $5 cap is refused, nothing written", () => {
    const { id } = cornerTechSale();
    const n = refundCount();
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 58.22 }],
        exchangeRate: RATE,
        addedChange: {
          added_change_usd: 6,
          customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
        },
      }),
    ).toThrow(/at most \$5/);
    expect(refundCount()).toBe(n);
  });

  it("(d) claim without customer lines, or with an account line, is refused", () => {
    const { id } = cornerTechSale();
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 55 }],
        exchangeRate: RATE,
        addedChange: { added_change_usd: 2.78 },
      }),
    ).toThrow(/doesn't match/);
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 55 }],
        exchangeRate: RATE,
        addedChange: {
          added_change_usd: 2.78,
          customerPayments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 250000 },
          ],
        },
      }),
    ).toThrow(/account/);
    expect(refundCount()).toBe(0);
  });

  it("(d2) a claim that does not match the customer's lines is refused", () => {
    const { id } = cornerTechSale();
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 56 }],
        exchangeRate: RATE,
        addedChange: {
          added_change_usd: 3.78,
          customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 250000 }],
        },
      }),
    ).toThrow(/doesn't match/);
  });

  it("(e) no claim: handing back $55 is still refused; lines without a claim are refused", () => {
    const { id } = cornerTechSale();
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 55 }],
        exchangeRate: RATE,
      }),
    ).toThrow(/do not match/);
    expect(() =>
      refund(id, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 52.22 }],
        exchangeRate: RATE,
        addedChange: {
          customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 250000 }],
        },
      }),
    ).toThrow(/added change/);
    expect(refundCount()).toBe(0);
  });

  it("LBP-paid mirror: hand back 2,000,000 LBP, customer returns $2 (claim 180,000 LBP)", () => {
    const { id, profit_usd } = lbpSale();
    const before = snapshotLedgers(db);
    const refundId = refund(id, {
      refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 2000000 }],
      exchangeRate: RATE,
      addedChange: {
        added_change_lbp: 180000,
        customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      },
    });
    expect(drawerDelta(before, "LBP")).toBe(-2000000);
    expect(r2(drawerDelta(before, "USD"))).toBe(2);
    expect(r6(txnRow(refundId).profit_usd)).toBe(r6(-profit_usd));
  });
});

describe("LIRA-342 — session basket item refund", () => {
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
    const saleId = r.id!;
    const { id: txnId, profit_usd } = saleTxn(saleId);
    getCustomerSessionRepository().linkTransaction(sessionId, "sale", saleId, price, 0, 0, 0, txnId);
    new SessionPaymentService().recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: price }],
      exchangeRate: RATE,
      userId: USER_ID,
    });
    const saleItemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as { id: number }
    ).id;
    return { sessionId, txnId, saleItemId, profit_usd };
  }

  it("(f) $20 item: customer gives 90,000 LBP, shop hands $21; undo nets every drawer to 0", () => {
    const { sessionId, txnId, saleItemId, profit_usd } = sessionSale(20);
    const before = snapshotLedgers(db);
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      saleItemId,
      quantity: 1,
      exchangeRate: RATE,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 21 }],
      added_change_usd: 1,
      customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 90000 }],
    });
    const res = getTransactionRepository().refundSessionBasketItem({
      ...payload,
      userId: USER_ID,
    });
    expect(r2(drawerDelta(before, "USD"))).toBe(-21);
    expect(drawerDelta(before, "LBP")).toBe(90000);
    expect(r6(txnRow(res.refundTransactionId).profit_usd)).toBe(r6(-profit_usd));
    getTransactionRepository().undoSessionBasketItemRefund({
      refundTransactionId: res.refundTransactionId,
      userId: USER_ID,
    });
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("(f2) no claim: $21 still refused; claim over cap refused", () => {
    const { sessionId, txnId, saleItemId } = sessionSale(20);
    const base = { sessionId, transactionId: txnId, saleItemId, quantity: 1, exchangeRate: RATE };
    expect(() =>
      getTransactionRepository().refundSessionBasketItem({
        ...sessionItemRefundSchema.parse({
          ...base,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 21 }],
        }),
        userId: USER_ID,
      }),
    ).toThrow();
    expect(() =>
      getTransactionRepository().refundSessionBasketItem({
        ...sessionItemRefundSchema.parse({
          ...base,
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 26 }],
          added_change_usd: 6,
          customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
        }),
        userId: USER_ID,
      }),
    ).toThrow(/at most \$5/);
    expect(refundCount()).toBe(0);
  });
});
