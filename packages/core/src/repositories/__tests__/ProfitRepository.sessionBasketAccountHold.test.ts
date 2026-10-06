/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN.md 2.9 / POSTING_MAP.md G17 (Unverified
 * → verify first). An on-account recharge INSIDE a session basket: the
 * basket's CUSTOMER_ACCOUNT portion is ONE 'Session Debt' debt_ledger row
 * (transaction_id NULL, session_id set), so `notDebtPending` — which matches
 * module debt rows by `debt_ledger.transaction_id` — has nothing to match.
 *
 * Control: the SAME recharge sold standalone on CUSTOMER_ACCOUNT books a
 * 'Recharge Debt' row keyed by its transaction id and its profit is held back
 * (DBT-1). The basket case is the one under test.
 *
 * Real writers (`SessionCheckoutService.checkout`, `RechargeRepository
 * .processRecharge`) + the real fresh schema (`electron-app/create_db.sql`).
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SessionCheckoutService } from "../../services/SessionCheckoutService";
import { CustomerSessionRepository } from "../CustomerSessionRepository";
import { RechargeRepository } from "../RechargeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { resetRechargeService } from "../../services/RechargeService";
import { resetRechargeRepository } from "../RechargeRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { DebtRepository } from "../DebtRepository";
import { TransactionRepository } from "../TransactionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { MIGRATIONS } from "../../db/migrations";
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

function rechargeProfitUsd(): number {
  const { from, to } = wideRange();
  const rows = new ProfitService(new ProfitRepository()).getByModule(from, to);
  // Module key is RECHARGE_<carrier> (ProfitService.getByModule).
  return rows
    .filter((r) => r.module.startsWith("RECHARGE_"))
    .reduce((sum, r) => sum + (r.profit_usd ?? 0), 0);
}

function rechargeStampUsd(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions WHERE type = 'RECHARGE'`,
    )
    .get() as { p: number };
  return row.p;
}

const RECHARGE_FORM = {
  provider: "MTC",
  type: "CREDIT_TRANSFER",
  amount: 20,
  cost: 15,
  price: 20,
  currency: "USD",
};

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

describe("G17 — on-account recharge profit hold", () => {
  it("harness control: a cash recharge's profit IS counted (the read path sees recharges at all)", () => {
    const res = new RechargeRepository().processRecharge({
      ...RECHARGE_FORM,
      clientId,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
    } as never);
    expect(res.success).toBe(true);
    expect(rechargeStampUsd()).toBeGreaterThan(0);
    expect(rechargeProfitUsd()).toBeCloseTo(rechargeStampUsd(), 2);
  });

  it("control: a standalone recharge charged to the account is held back", () => {
    const res = new RechargeRepository().processRecharge({
      ...RECHARGE_FORM,
      clientId,
      userId: 1,
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 }],
    } as never);
    expect(res.success).toBe(true);
    // Stamp sanity: the recharge does carry a profit; it is just not counted.
    expect(rechargeStampUsd()).toBeGreaterThan(0);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
  });

  type CartItem = {
    id: string;
    module: string;
    label: string;
    amount: number;
    currency: string;
    formData: Record<string, unknown>;
    ipcChannel: string;
  };
  type Leg = {
    method: string;
    currency_code: string;
    amount: number;
    voucher_code?: string;
  };

  function rechargeItem(n: number): CartItem {
    return {
      id: `cart-recharge-${n}`,
      module: "recharge_mtc",
      label: "MTC credit",
      amount: 20,
      currency: "USD",
      formData: { ...RECHARGE_FORM },
      ipcChannel: "recharge:process",
    };
  }

  function saleItem(): CartItem {
    db.prepare(
      `INSERT INTO products (id, tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
       VALUES (1, 1, 'Cable', 'Accessory', 5, 8, 10)`,
    ).run();
    return {
      id: "cart-sale-1",
      module: "pos",
      label: "Sale",
      amount: 8,
      currency: "USD",
      formData: {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 8 }],
        total_amount: 8,
        discount: 0,
        final_amount: 8,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: 90000,
        status: "completed",
      },
      ipcChannel: "sales:process",
    };
  }

  async function checkoutBasket(
    cartItems: CartItem[],
    payments: Leg[],
  ): Promise<{ success: boolean; sessionId: number; error?: string }> {
    const sessionId = new CustomerSessionRepository(db).createSession({
      customer_name: "Basket Client",
      customer_phone: "70111222",
      started_by: "admin",
      user_id: 1,
    });
    const result = await new SessionCheckoutService().checkout(
      { sessionId, cartItems, payments, exchangeRate: 90000, userId: 1 } as never,
      { username: "admin" },
    );
    return {
      success: result.success,
      sessionId,
      error: (result as { error?: string }).error,
    };
  }

  /** Checks out a one-recharge basket paid fully on CUSTOMER_ACCOUNT. */
  async function checkoutOnAccountBasket(): Promise<{
    success: boolean;
    sessionId: number;
  }> {
    return checkoutBasket(
      [rechargeItem(1)],
      [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 }],
    );
  }

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

  function sessionDebtCoveredUsd(sessionId: number): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(covered_usd), 0) AS c FROM debt_ledger
         WHERE session_id = ? AND transaction_type = 'Session Debt'`,
      )
      .get(sessionId) as { c: number };
    return row.c;
  }

  function sessionRechargeTxnIds(sessionId: number): number[] {
    return (
      db
        .prepare(
          `SELECT cst.unified_transaction_id AS id
           FROM customer_session_transactions cst
           JOIN transactions t ON t.id = cst.unified_transaction_id
           WHERE cst.session_id = ? AND t.type = 'RECHARGE'
           ORDER BY cst.id ASC`,
        )
        .all(sessionId) as { id: number }[]
    ).map((r) => r.id);
  }

  it("basket precondition: checkout succeeds and books ONE unlinked Session Debt row, no Recharge Debt", async () => {
    const { success, sessionId } = await checkoutOnAccountBasket();
    expect(success).toBe(true);
    const debts = db
      .prepare(
        `SELECT transaction_type, amount_usd, transaction_id, session_id FROM debt_ledger WHERE client_id = ?`,
      )
      .all(clientId);
    expect(debts).toEqual([
      {
        transaction_type: "Session Debt",
        amount_usd: 20,
        transaction_id: null,
        session_id: sessionId,
      },
    ]);
    expect(rechargeStampUsd()).toBeGreaterThan(0);
  });

  // G17 VERIFIED REAL (2026-10-06): as a plain `it` this failed with
  // "Expected: 0, Received: 5" — the basket recharge's full $5 profit counts
  // although nothing was collected. Kept as `it.failing` (passes ONLY while
  // the gap exists) because the fix is blocked on an owner decision, not on
  // code: a 'Session Debt' row never receives FIFO repayment coverage
  // (DebtRepository._coverServiceDebtsFIFO excludes it by design), so a hold
  // keyed on its `covered_*` would never release after the client repays,
  // and basket debt has no per-item attribution (SessionPaymentService
  // .backfillSaleSettlement allocates it to SALE members first). The
  // preconditions live in the plain test above so a broken harness cannot
  // hide here; this body only asserts the profit. When the gap is fixed,
  // jest reports this as unexpectedly passing — flip it to a plain `it`.
  it("G17: a recharge inside a session basket paid fully on account is held back too", async () => {
    await checkoutOnAccountBasket();
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
  });

  // ---------------------------------------------------------------------------
  // LIRA-258 fix — repayment releases the basket hold (binary, like a
  // standalone module-debt charge row: notDebtPending is all-or-nothing).
  // ---------------------------------------------------------------------------

  it("control: a standalone on-account recharge half repaid stays fully held (the hold is binary)", () => {
    const res = new RechargeRepository().processRecharge({
      ...RECHARGE_FORM,
      clientId,
      userId: 1,
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 }],
    } as never);
    expect(res.success).toBe(true);
    repay(10);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(10);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("basket repayment: half repaid stays held (same as standalone), fully repaid realises all profit", async () => {
    const { success, sessionId } = await checkoutOnAccountBasket();
    expect(success).toBe(true);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(10);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(10, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(10);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(20, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("partly on account: a basket recharge paid half cash / half account is held until the account half is repaid", async () => {
    const { success } = await checkoutBasket(
      [rechargeItem(1)],
      [
        { method: "CASH", currency_code: "USD", amount: 10 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
      ],
    );
    expect(success).toBe(true);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(10);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("sale + recharge on account: sales absorb the account debt first, the recharge is held until the rest is repaid, the sale is not double-held", async () => {
    const { success, sessionId, error } = await checkoutBasket(
      [saleItem(), rechargeItem(1)],
      [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 28 }],
    );
    expect(error).toBeUndefined();
    expect(success).toBe(true);
    // The sale's $8 share of the Session Debt is tracked by sales.paid_usd,
    // so it is pre-covered on the Session Debt row at checkout.
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(8, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);

    repay(8); // sales first — the sale is now paid, the recharge still held
    const sale = db
      .prepare(`SELECT paid_usd, final_amount_usd FROM sales`)
      .get() as { paid_usd: number; final_amount_usd: number };
    expect(sale.paid_usd).toBeCloseTo(sale.final_amount_usd, 2);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(8, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);

    repay(20);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(28, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("gift card: a basket recharge paid with a gift card still counts immediately (prepaid value, never repaid)", async () => {
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, expiry_date, status, created_by)
       VALUES (1, 'GIFT-G17', ?, 'Basket Client', 20, 'USD', '2099-12-31', 'pending', 1)`,
    ).run(clientId);
    const { success, error } = await checkoutBasket(
      [rechargeItem(1)],
      [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount: 20,
          voucher_code: "GIFT-G17",
        },
      ],
    );
    expect(error).toBeUndefined();
    expect(success).toBe(true);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("rule 20: voiding the repayment gives the coverage back to its checkout value and re-holds the profit", async () => {
    const { sessionId } = await checkoutOnAccountBasket();
    const repaymentTxnId = repay(20);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
    new TransactionRepository().voidTransaction(repaymentTxnId, 1);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(0, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
  });

  it("rule 20: a voided basket's Session Debt never absorbs a later repayment meant for another debt", async () => {
    const { sessionId } = await checkoutOnAccountBasket();
    new TransactionRepository().voidSessionBasket(sessionId, 1);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    // A later standalone on-account recharge, then the client repays it.
    const res = new RechargeRepository().processRecharge({
      ...RECHARGE_FORM,
      clientId,
      userId: 1,
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 }],
    } as never);
    expect(res.success).toBe(true);
    repay(20);
    expect(sessionDebtCoveredUsd(sessionId)).toBeCloseTo(0, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("sale refund in a mixed basket: refunding the (pre-covered) sale never releases the recharge before the client has paid for it", async () => {
    const { success, sessionId } = await checkoutBasket(
      [saleItem(), rechargeItem(1)],
      [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 28 }],
    );
    expect(success).toBe(true);
    const saleTxn = db
      .prepare(`SELECT id FROM transactions WHERE type = 'SALE'`)
      .get() as { id: number };
    const saleItemRow = db.prepare(`SELECT id FROM sale_items`).get() as {
      id: number;
    };
    new TransactionRepository().refundSessionBasketItem({
      sessionId,
      transactionId: saleTxn.id,
      saleItemId: saleItemRow.id,
      quantity: 1,
      userId: 1,
    });
    const balance = () =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS b FROM debt_ledger WHERE client_id = ?`,
          )
          .get(clientId) as { b: number }
      ).b;
    expect(balance()).toBeCloseTo(20, 2); // only the recharge is still owed
    repay(12);
    expect(balance()).toBeCloseTo(8, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(8);
    expect(balance()).toBeCloseTo(0, 2);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });

  it("item refund: refunding one of two on-account recharges, then repaying the rest, realises the survivor", async () => {
    const { success, sessionId } = await checkoutBasket(
      [rechargeItem(1), rechargeItem(2)],
      [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 40 }],
    );
    expect(success).toBe(true);
    const [first] = sessionRechargeTxnIds(sessionId);
    new TransactionRepository().refundSessionBasketItem({
      sessionId,
      transactionId: first,
      userId: 1,
    });
    expect(rechargeProfitUsd()).toBeCloseTo(0, 2);
    repay(20);
    expect(rechargeProfitUsd()).toBeCloseTo(5, 2);
  });
});

describe("G17 — migration v192 (from now on only)", () => {
  it("marks every existing Session Debt row fully covered (past baskets unchanged) and down() restores 0; the member index is created and dropped", () => {
    const v192 = MIGRATIONS.find((m) => m.version === 192)!;
    expect(v192.name).toBe("session_debt_repayment_coverage");
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, session_id)
       VALUES (1, ?, 'Session Debt', 20, 450000, NULL),
              (1, ?, 'Recharge Debt', 20, 0, NULL)`,
    ).run(clientId, clientId);
    const covered = () =>
      db
        .prepare(
          `SELECT transaction_type AS t, covered_usd AS u, covered_lbp AS l FROM debt_ledger ORDER BY id`,
        )
        .all();
    const hasIndex = () =>
      !!db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_customer_session_transactions_unified'`,
        )
        .get();

    // Fresh schema (create_db.sql) already declares the index.
    expect(hasIndex()).toBe(true);
    v192.down!(db);
    expect(hasIndex()).toBe(false);
    v192.up(db);
    expect(hasIndex()).toBe(true);
    expect(covered()).toEqual([
      { t: "Session Debt", u: 20, l: 450000 },
      { t: "Recharge Debt", u: 0, l: 0 },
    ]);
    v192.down!(db);
    expect(covered()).toEqual([
      { t: "Session Debt", u: 0, l: 0 },
      { t: "Recharge Debt", u: 0, l: 0 },
    ]);
  });
});
