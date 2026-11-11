/**
 * Extra charges on the client's account are held until the client pays
 * (owner decision 2026-11-11, Cornertech report: a phone sold on account
 * with a $190 basket extra showed the $190 under Profits > By module >
 * Extra charges while nothing had been collected).
 *
 * LIRA-319 recognised an extra the moment it was booked ("rows with
 * status = 'ACTIVE'", research R2) — no debt gate, unlike every module's
 * own profit (`notDebtPending`) and a sale's margin (`saleFullyPaid`). This
 * suite pins the corrected rule on the three writers that can put an extra
 * on the account:
 *
 *   - a standalone module row (recharge) — its '<Module> Debt' row gates it;
 *   - a POS sale — `sales.paid_usd` gates it, like the sale's own margin;
 *   - a session basket's EXTRA_CHARGE row — its member share of the
 *     'Session Debt' row gates it, released with the basket's repayment.
 *
 * Real writers (`RechargeRepository.processRecharge`, `SalesRepository
 * .processSale`, `SessionCheckoutService.checkout`, `DebtRepository
 * .addRepayment`) + the real fresh schema (`electron-app/create_db.sql`).
 *
 * Proven failing-first (rule 17): before the gate, every "held" assertion
 * below reported the full extra.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SessionCheckoutService } from "../../services/SessionCheckoutService";
import { CustomerSessionRepository } from "../CustomerSessionRepository";
import { RechargeRepository } from "../RechargeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { resetRechargeService } from "../../services/RechargeService";
import { resetRechargeRepository } from "../RechargeRepository";
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { saleProcessSchema } from "../../validators/sale";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CREATE_DB_SQL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetClientRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetSessionPaymentService();
  resetRechargeService();
  resetRechargeRepository();
  resetDebtRepository();
  resetSettingsRepository();
  resetSalesRepository();
  resetVoucherRepository();
}

function wideRange(): { from: string; to: string } {
  const now = Date.now();
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: d(now - 3 * 86_400_000), to: d(now + 3 * 86_400_000) };
}

/** The Profits "Extra charges" line (USD), straight from the totals query. */
function extraChargesUsd(): number {
  const { from, to } = wideRange();
  return new ProfitRepository().getExtraChargeTotals(from, to).profit_usd;
}

/** The same line as Profits > By module shows it. */
function extraChargesByModuleUsd(): number {
  const { from, to } = wideRange();
  const rows = new ProfitService(new ProfitRepository()).getByModule(from, to);
  return rows
    .filter((r) => r.module === "EXTRA_CHARGE")
    .reduce((sum, r) => sum + (r.profit_usd ?? 0), 0);
}

/** What the extra rows themselves carry — proves the stamp exists even
 *  while the line reads 0. */
function extraStampUsd(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(extra_usd), 0) AS e FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { e: number };
  return row.e;
}

const RECHARGE_FORM = {
  provider: "MTC",
  type: "CREDIT_TRANSFER",
  amount: 20,
  cost: 15,
  price: 20,
  currency: "USD",
};

const RATE = 90_000;
let clientId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetAll();
  clientId = Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Basket Client', '70111222')`,
      )
      .run().lastInsertRowid,
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetAll();
  resetTenantContext();
  db.close();
});

function repay(amountUsd: number): number {
  const { id } = new DebtRepository().addRepayment({
    client_id: clientId,
    amount_usd: amountUsd,
    amount_lbp: 0,
    created_by: 1,
  });
  const row = db
    .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
    .get(id) as { transaction_id: number };
  return row.transaction_id;
}

function recharge(
  payments: { method: string; currencyCode: string; amount: number }[],
): void {
  const res = new RechargeRepository().processRecharge({
    ...RECHARGE_FORM,
    clientId,
    userId: 1,
    extra_usd: 1,
    payments,
  } as never);
  expect(res.success).toBe(true);
}

let productSeq = 0;
function addProduct(): number {
  productSeq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Accessory', 5, 6, 10)`,
      )
      .run(`Cable ${productSeq}`).lastInsertRowid,
  );
}

/** A $6 item (cost $5) + $1 extra, as CheckoutModal sends it. */
function posSale(
  payments: { method: string; currency_code: string; amount: number }[],
): number {
  const request = saleProcessSchema.parse({
    client_id: clientId,
    items: [{ product_id: addProduct(), quantity: 1, price: 6 }],
    total_amount: 6,
    discount: 0,
    final_amount: 6,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    extra_usd: 1,
    payments,
  }) as SaleRequest;
  const res = new SalesRepository().processSale(request, 1);
  expect(res.success).toBe(true);
  return res.id!;
}

type CartItem = {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
};
type Leg = { method: string; currency_code: string; amount: number };

/** An $8 item (cost $5) inside the basket. */
function saleItem(): CartItem {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Phone', 'Accessory', 5, 8, 10)`,
      )
      .run().lastInsertRowid,
  );
  return {
    id: "cart-sale-1",
    module: "pos",
    label: "Sale",
    amount: 8,
    currency: "USD",
    formData: {
      client_id: null,
      items: [{ product_id: productId, quantity: 1, price: 8 }],
      total_amount: 8,
      discount: 0,
      final_amount: 8,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: RATE,
      status: "completed",
    },
    ipcChannel: "sales:process",
  };
}

/** Checks out a one-sale basket with a $2 basket extra. */
async function checkoutBasket(
  payments: Leg[],
): Promise<{ sessionId: number; saleTxnId: number }> {
  const sessionId = new CustomerSessionRepository(db).createSession({
    customer_name: "Basket Client",
    customer_phone: "70111222",
    started_by: "admin",
    user_id: 1,
  });
  const result = await new SessionCheckoutService().checkout(
    {
      sessionId,
      cartItems: [saleItem()],
      payments,
      exchangeRate: RATE,
      userId: 1,
      extra_usd: 2,
    } as never,
    { username: "admin" },
  );
  expect((result as { error?: string }).error).toBeUndefined();
  expect(result.success).toBe(true);
  const sale = db
    .prepare(
      `SELECT cst.unified_transaction_id AS id
         FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id
        WHERE cst.session_id = ? AND t.type = 'SALE'`,
    )
    .get(sessionId) as { id: number };
  return { sessionId, saleTxnId: sale.id };
}

describe("standalone recharge with a $1 extra", () => {
  it("control: paid cash → Extra charges 1 (the read path sees extras at all)", () => {
    recharge([{ method: "CASH", currencyCode: "USD", amount: 21 }]);
    expect(extraStampUsd()).toBeCloseTo(1, 2);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
    expect(extraChargesByModuleUsd()).toBeCloseTo(1, 2);
  });

  it("on the account → held at 0; half repaid stays held; fully repaid → 1", () => {
    recharge([{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 21 }]);
    expect(extraStampUsd()).toBeCloseTo(1, 2);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    expect(extraChargesByModuleUsd()).toBeCloseTo(0, 2);
    repay(10);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    repay(11);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
    expect(extraChargesByModuleUsd()).toBeCloseTo(1, 2);
  });

  it("the drill-down lists only what the line counts", () => {
    recharge([{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 21 }]);
    const { from, to } = wideRange();
    expect(new ProfitRepository().getExtraChargeDetail(from, to)).toHaveLength(
      0,
    );
    repay(21);
    expect(new ProfitRepository().getExtraChargeDetail(from, to)).toHaveLength(
      1,
    );
  });

  it("rule 20: voiding the repayment re-holds the extra", () => {
    recharge([{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 21 }]);
    const repaymentTxnId = repay(21);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
    new TransactionRepository().voidTransaction(repaymentTxnId, 1);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
  });
});

describe("POS sale $6 + $1 extra", () => {
  it("control: paid cash → 1", () => {
    posSale([{ method: "CASH", currency_code: "USD", amount: 7 }]);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
  });

  it("all on the account → held at 0 until the $7 is repaid; the sale's own $1 margin releases with it", () => {
    // Second defect found with the first (2026-11-11): the repayment
    // allocation stopped at `final_amount_usd` ($6), so `sales.paid_usd`
    // never covered the extra and the sale read "still owing $1" forever —
    // its margin AND its extra were held for good. See
    // `saleNetExtraUsdEquiv`.
    posSale([{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 7 }]);
    const { from, to } = wideRange();
    const salesProfit = () =>
      new ProfitRepository().getSalesProfit(from, to).profit_usd;
    expect(extraStampUsd()).toBeCloseTo(1, 2);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    expect(salesProfit()).toBeCloseTo(0, 2);
    repay(6);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    expect(salesProfit()).toBeCloseTo(0, 2);
    repay(1);
    const sale = db.prepare(`SELECT paid_usd FROM sales`).get() as {
      paid_usd: number;
    };
    expect(sale.paid_usd).toBeCloseTo(7, 2);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
    expect(salesProfit()).toBeCloseTo(1, 2);
    // Nothing fell through to the client's balance line.
    expect(
      new DebtRepository().getClientBalance(clientId).balance_usd,
    ).toBeCloseTo(0, 2);
  });

  it("$6 cash + $1 on the account (the extra itself is the debt) → held until the $1 is repaid", () => {
    posSale([
      { method: "CASH", currency_code: "USD", amount: 6 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 1 },
    ]);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    repay(1);
    expect(extraChargesUsd()).toBeCloseTo(1, 2);
  });

  it("void of a held sale: the line stays 0, never negative", () => {
    const saleId = posSale([
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 7 },
    ]);
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number };
    new TransactionRepository().voidTransaction(txn.id, 1);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
  });
});

describe("session basket: $8 phone + $2 basket extra", () => {
  it("control: paid cash → 2", async () => {
    await checkoutBasket([
      { method: "CASH", currency_code: "USD", amount: 10 },
    ]);
    expect(extraChargesUsd()).toBeCloseTo(2, 2);
  });

  it("all on the account → held; sales absorb the repayment first; the extra releases with the last dollar", async () => {
    await checkoutBasket([
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
    ]);
    expect(extraStampUsd()).toBeCloseTo(2, 2);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    expect(extraChargesByModuleUsd()).toBeCloseTo(0, 2);
    repay(8); // sales first — the phone is paid, the extra is still owed
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
    repay(2);
    expect(extraChargesUsd()).toBeCloseTo(2, 2);
    expect(extraChargesByModuleUsd()).toBeCloseTo(2, 2);
  });

  it("partly on account: $5 cash + $5 account → the debt sits on the phone (sales absorb it first), so the extra is paid by the cash and counts now", async () => {
    // Existing attribution rule (LIRA-258 / LIRA-304, `SessionPaymentService
    // .backfillSaleSettlement`): a basket's account part lands on its SALE
    // members first. Here the $5 debt is the phone's ($3 of $8 paid), the
    // extra member owes nothing — the phone's MARGIN is held, its extra is
    // not. Pinned so a change to that attribution shows up here.
    const { sessionId } = await checkoutBasket([
      { method: "CASH", currency_code: "USD", amount: 5 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 },
    ]);
    const extraMember = db
      .prepare(
        `SELECT owed_usd FROM customer_session_transactions WHERE session_id = ? AND transaction_type = 'extra_charge'`,
      )
      .get(sessionId) as { owed_usd: number };
    expect(extraMember.owed_usd).toBeCloseTo(0, 2);
    const sale = db
      .prepare(`SELECT paid_usd, final_amount_usd FROM sales`)
      .get() as { paid_usd: number; final_amount_usd: number };
    expect(sale.paid_usd).toBeCloseTo(3, 2);
    expect(extraChargesUsd()).toBeCloseTo(2, 2);
    repay(5);
    expect(extraChargesUsd()).toBeCloseTo(2, 2);
  });

  it("the phone's own margin stays held while its share is owed, and is released by the repayment", async () => {
    await checkoutBasket([
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
    ]);
    const { from, to } = wideRange();
    const salesProfit = () =>
      new ProfitRepository().getSalesProfit(from, to).profit_usd;
    expect(salesProfit()).toBeCloseTo(0, 2);
    repay(10);
    expect(salesProfit()).toBeCloseTo(3, 2);
  });

  it("voiding a held basket: the line stays 0, never negative", async () => {
    const { sessionId } = await checkoutBasket([
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
    ]);
    new TransactionRepository().voidSessionBasket(sessionId, 1);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
  });

  it("refunding the phone out of a held basket: the extra share given back never shows as a negative line", async () => {
    const { sessionId, saleTxnId } = await checkoutBasket([
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
    ]);
    const res = new TransactionRepository().refundSessionBasketItem({
      sessionId,
      transactionId: saleTxnId,
      userId: 1,
      exchangeRate: RATE,
    });
    expect(res.refundTransactionId).toBeGreaterThan(0);
    // The phone was the whole basket: its refund hands back the whole $2 extra.
    expect(extraStampUsd()).toBeCloseTo(0, 2);
    expect(extraChargesUsd()).toBeCloseTo(0, 2);
  });
});
