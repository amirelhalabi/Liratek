/**
 * LIRA-380 — an exchange added to a customer session is a basket line.
 *
 * Owner (2026-11-11): "The cash should move only when we do the payment of
 * the customer session" and "The rate of the session should not affect the
 * rate of the exchange transaction". So:
 *  - nothing is written (transactions / exchange_transactions / payments /
 *    lots) while the line waits in the basket;
 *  - the checkout replays it through the exchange service in deferred mode:
 *    ONE EXCHANGE row linked to the session, no payment legs of its own for
 *    its USD/LBP sides, the basket's pooled legs carry the money, lots are
 *    consumed then, the booked margin is stamped;
 *  - the exchange keeps its own rate and amounts although the checkout's
 *    rate differs;
 *  - the session link carries both customer sides (given +, received −).
 *
 * Rule 17: run against the unfixed checkout first — it refused the line
 * ("Unknown IPC channel for session checkout: exchange:add-transaction").
 *
 * Real schema: create_db.sql + migrations (wrong-number fixture DB).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  buildDb,
  drawer,
  resetAll as resetFixture,
} from "../../repositories/testHelpers/wrongNumberDb";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository";
import {
  getSessionCheckoutService,
  resetSessionCheckoutService,
  type CheckoutCartItem,
  type CheckoutRequest,
} from "../SessionCheckoutService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetCustomServiceService } from "../CustomServiceService";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetDebtService } from "../DebtService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import {
  getExchangeService,
  resetExchangeService,
} from "../ExchangeService";
import { resetExchangeRepository } from "../../repositories/ExchangeRepository";
import { resetExchangeLotRepository } from "../../repositories/ExchangeLotRepository";
import { getTransactionRepository } from "../../repositories/TransactionRepository";
import type { ExchangeSubmitPayload } from "../../validators/exchange";
import { exchangeNotDebtPending } from "../../repositories/ProfitRepository";

function resetAll(): void {
  resetFixture();
  resetCustomerSessionRepository();
  resetSessionCheckoutService();
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomServiceService();
  resetCustomServiceRepository();
  resetClientRepository();
  resetDebtService();
  resetDebtRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetSettingsRepository();
  resetExchangeService();
  resetExchangeRepository();
  resetExchangeLotRepository();
}

const CHECKOUT_RATE = 90_000; // the session's own rate — differs on purpose

function chargerLine(): CheckoutCartItem {
  return {
    id: "charger",
    module: "custom_service",
    label: "Charger",
    amount: 20,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "charger",
      cost_usd: 12,
      price_usd: 20,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

/** The exchange payload exactly as the Exchange page builds it in session
 *  mode (no payment lines of its own). */
function exchangeLine(
  id: string,
  payload: ExchangeSubmitPayload,
  cart: { amount: number; currency: "USD" | "LBP" },
): CheckoutCartItem {
  return {
    id,
    module: "exchange",
    label: `Exchange ${id}`,
    amount: cart.amount,
    currency: cart.currency,
    ipcChannel: "exchange:add-transaction",
    formData: payload as unknown as Record<string, unknown>,
  };
}

const USD_TO_LBP: ExchangeSubmitPayload = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8_950_000,
  leg1Rate: 89_500,
  leg1MarketRate: 89_750,
  leg1ProfitUsd: 0.28,
  totalProfitUsd: 0.28,
  note: "Exchange USD → LBP",
};

const LBP_TO_USD: ExchangeSubmitPayload = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 9_000_000,
  amountOut: 100,
  leg1Rate: 90_000,
  leg1MarketRate: 89_750,
  leg1ProfitUsd: 0.28,
  totalProfitUsd: 0.28,
  note: "Exchange LBP → USD",
};

describe("LIRA-380 — an exchange in a session basket books only at checkout", () => {
  let db: Database.Database;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function session(): number {
    return getCustomerSessionRepository().createSession({
      customer_name: "Rana Aziz",
      customer_phone: "71222333",
      started_by: "admin",
      user_id: 1,
    });
  }

  function addToBasket(sessionId: number, item: CheckoutCartItem): void {
    getCustomerSessionRepository().addCartItem(sessionId, {
      item_id: item.id,
      module: item.module,
      label: item.label,
      amount: item.amount,
      currency: item.currency,
      form_data: JSON.stringify(item.formData),
      ipc_channel: item.ipcChannel,
    });
  }

  function count(sql: string, ...args: unknown[]): number {
    return (db.prepare(sql).get(...args) as { n: number }).n;
  }

  async function checkout(
    sessionId: number,
    extra: Partial<CheckoutRequest> & { cartItems: CheckoutCartItem[] },
  ) {
    return getSessionCheckoutService().checkout(
      {
        sessionId,
        paidByMethod: "CASH",
        exchangeRate: CHECKOUT_RATE,
        userId: 1,
        ...extra,
      } as CheckoutRequest,
      { username: "admin" },
    );
  }

  it("story 1: charger + $100 → 8,950,000 LBP — nothing before checkout, one payment after, the exchange keeps its own rate", async () => {
    const sessionId = session();
    const items = [
      chargerLine(),
      exchangeLine("ex", USD_TO_LBP, { amount: 100, currency: "USD" }),
    ];
    for (const item of items) addToBasket(sessionId, item);
    const usdBefore = drawer(db, "General", "USD");
    const lbpBefore = drawer(db, "General", "LBP");

    // SC-001 — the basket line writes nothing.
    expect(count(`SELECT COUNT(*) AS n FROM exchange_transactions`)).toBe(0);
    expect(
      count(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'EXCHANGE'`),
    ).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);

    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 120 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const ex = db
      .prepare(
        `SELECT id, amount_in, amount_out, rate, profit_usd FROM exchange_transactions`,
      )
      .all() as Array<{
      id: number;
      amount_in: number;
      amount_out: number;
      rate: number;
      profit_usd: number;
    }>;
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({
      amount_in: 100,
      amount_out: 8_950_000,
      rate: 89_500,
    });

    const txn = db
      .prepare(
        `SELECT id, exchange_rate, profit_usd, metadata_json
           FROM transactions WHERE type = 'EXCHANGE'`,
      )
      .get() as {
      id: number;
      exchange_rate: number;
      profit_usd: number;
      metadata_json: string | null;
    };
    // Its own rate, never the checkout's 90,000.
    expect(txn.exchange_rate).toBe(89_500);
    const meta = JSON.parse(txn.metadata_json ?? "{}");
    expect(meta.details.paid_in_session).toBe(sessionId);
    // No legs of its own — the basket's pooled legs carry the money.
    expect(
      count(
        `SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`,
        txn.id,
      ),
    ).toBe(0);
    const pooled = db
      .prepare(
        `SELECT currency_code, SUM(amount) AS amt FROM payments
          WHERE session_id = ? AND transaction_id IS NULL
          GROUP BY currency_code ORDER BY currency_code`,
      )
      .all(sessionId);
    expect(pooled).toEqual([
      { currency_code: "LBP", amt: -8_950_000 },
      { currency_code: "USD", amt: 120 },
    ]);
    // The drawer moved once, by the basket's legs.
    expect(drawer(db, "General", "USD") - usdBefore).toBe(120);
    expect(drawer(db, "General", "LBP") - lbpBefore).toBe(-8_950_000);

    // Session link: both customer sides, and the booked margin in USD.
    const link = db
      .prepare(
        `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp
           FROM customer_session_transactions
          WHERE session_id = ? AND transaction_type = 'exchange'`,
      )
      .get(sessionId);
    expect(link).toEqual({
      amount_usd: 100,
      amount_lbp: -8_950_000,
      profit_usd: txn.profit_usd,
      profit_lbp: 0,
    });
  });

  it("story 2: LBP → USD — the margin is stamped in USD, the link reads 9,000,000 LBP given / $100 received", async () => {
    const sessionId = session();
    const items = [
      exchangeLine("ex", LBP_TO_USD, { amount: 9_000_000, currency: "LBP" }),
    ];
    const result = await checkout(sessionId, {
      cartItems: items,
      exchangeRate: 89_000,
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 9_000_000 },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 100,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.error).toBeUndefined();
    const txn = db
      .prepare(
        `SELECT exchange_rate, profit_usd FROM transactions WHERE type = 'EXCHANGE'`,
      )
      .get() as { exchange_rate: number; profit_usd: number };
    expect(txn.exchange_rate).toBe(90_000);
    expect(txn.profit_usd).toBeCloseTo(0.28, 6);
    const link = db
      .prepare(
        `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp
           FROM customer_session_transactions WHERE session_id = ?`,
      )
      .get(sessionId);
    expect(link).toEqual({
      amount_usd: -100,
      amount_lbp: 9_000_000,
      profit_usd: 0.28,
      profit_lbp: 0,
    });
  });

  it("story 2: USD → EUR — the lot is consumed at checkout and the realised margin is the one stamped on the link", async () => {
    // A walk-in BUY first: the shop acquires 100 EUR at $1.16.
    const buy = getExchangeService().addDirectTransaction({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    });
    expect(buy.success).toBe(true);
    const lotBefore = db
      .prepare(`SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`)
      .get() as { remaining_qty: number };
    expect(lotBefore.remaining_qty).toBe(100);

    const sessionId = session();
    const sell: ExchangeSubmitPayload = {
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 120,
      amountOut: 100,
      leg1Rate: 1.2,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    };
    const items = [exchangeLine("ex", sell, { amount: 120, currency: "USD" })];
    addToBasket(sessionId, items[0]);
    // Waiting in the basket: the lot is untouched.
    expect(
      (
        db
          .prepare(
            `SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`,
          )
          .get() as { remaining_qty: number }
      ).remaining_qty,
    ).toBe(100);
    const eurBefore = drawer(db, "General", "EUR");

    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [{ method: "CASH", currency_code: "USD", amount: 120 }],
    });
    expect(result.error).toBeUndefined();

    expect(
      (
        db
          .prepare(
            `SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`,
          )
          .get() as { remaining_qty: number }
      ).remaining_qty,
    ).toBe(0);
    // The euros left the drawer at checkout (the exchange pays them itself —
    // the basket has no EUR side).
    expect(drawer(db, "General", "EUR") - eurBefore).toBe(-100);
    const txn = db
      .prepare(
        `SELECT profit_usd FROM transactions WHERE type = 'EXCHANGE' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { profit_usd: number };
    // Realised from the lot: 120 − 116 = 4, not the screen's estimate of 2.
    expect(txn.profit_usd).toBeCloseTo(4, 6);
    const link = db
      .prepare(
        `SELECT amount_usd, amount_lbp, profit_usd FROM customer_session_transactions WHERE session_id = ?`,
      )
      .get(sessionId) as {
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
    };
    expect(link.amount_usd).toBe(120);
    expect(link.amount_lbp).toBe(0);
    expect(link.profit_usd).toBeCloseTo(4, 6);
  });

  it("a hand-built exchange line carrying its own payment lines is refused, nothing written", async () => {
    const sessionId = session();
    const items = [
      exchangeLine(
        "ex",
        {
          ...USD_TO_LBP,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 8_950_000 },
          ],
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 100 },
          ],
        },
        { amount: 100, currency: "USD" },
      ),
    ];
    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.success).toBe(false);
    // Refused by the deferred-mode guard (not by a schema shape error).
    expect(result.error).toContain("paid with the basket's payment");
    expect(result.error).toContain("payments, customerPayments");
    expect(count(`SELECT COUNT(*) AS n FROM exchange_transactions`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });

  it("SC-003: refunding the whole basket nets every ledger to 0 (drawers, lots, profit)", async () => {
    const buy = getExchangeService().addDirectTransaction({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    });
    expect(buy.success).toBe(true);
    const sessionId = session();
    const items = [
      chargerLine(),
      exchangeLine("ex", USD_TO_LBP, { amount: 100, currency: "USD" }),
      exchangeLine(
        "eur",
        {
          fromCurrency: "USD",
          toCurrency: "EUR",
          amountIn: 60,
          amountOut: 50,
          leg1Rate: 1.2,
          leg1MarketRate: 1.18,
          leg1ProfitUsd: 1,
          totalProfitUsd: 1,
        },
        { amount: 60, currency: "USD" },
      ),
    ];
    const before = {
      usd: drawer(db, "General", "USD"),
      lbp: drawer(db, "General", "LBP"),
      eur: drawer(db, "General", "EUR"),
    };
    const profitSql = `SELECT COALESCE(SUM(profit_usd), 0) AS n FROM transactions
      WHERE type IN ('EXCHANGE','CUSTOM_SERVICE','REFUND') AND status = 'ACTIVE'
        AND id > (SELECT MAX(id) FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = 1)`;
    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 180 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(count(profitSql)).not.toBe(0);
    expect(
      (
        db
          .prepare(`SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`)
          .get() as { remaining_qty: number }
      ).remaining_qty,
    ).toBe(50);

    getTransactionRepository().refundSessionBasket(sessionId, 1);

    expect(drawer(db, "General", "USD") - before.usd).toBeCloseTo(0, 6);
    expect(drawer(db, "General", "LBP") - before.lbp).toBeCloseTo(0, 6);
    expect(drawer(db, "General", "EUR") - before.eur).toBeCloseTo(0, 6);
    expect(
      (
        db
          .prepare(`SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`)
          .get() as { remaining_qty: number }
      ).remaining_qty,
    ).toBe(100);
    expect(count(profitSql)).toBeCloseTo(0, 6);
  });

  it("US3.1: a basket partly on account — the exchange carries its member share and its margin waits until repaid", async () => {
    const sessionId = session();
    const items = [
      chargerLine(),
      exchangeLine("ex", USD_TO_LBP, { amount: 100, currency: "USD" }),
    ];
    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 100 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.error).toBeUndefined();
    const debt = db
      .prepare(
        `SELECT amount_usd FROM debt_ledger WHERE session_id = ? AND transaction_type = 'Session Debt'`,
      )
      .all(sessionId) as Array<{ amount_usd: number }>;
    expect(debt).toHaveLength(1);
    const members = db
      .prepare(
        `SELECT transaction_type, owed_usd FROM customer_session_transactions
          WHERE session_id = ? ORDER BY id`,
      )
      .all(sessionId) as Array<{ transaction_type: string; owed_usd: number }>;
    const exMember = members.find((m) => m.transaction_type === "exchange");
    const owedTotal = members.reduce((n, m) => n + (m.owed_usd ?? 0), 0);
    expect(owedTotal).toBeCloseTo(debt[0].amount_usd, 2);
    expect(exMember!.owed_usd).toBeGreaterThan(0);
    // The exchange's margin is held while its share is unpaid.
    const ok = db
      .prepare(
        `SELECT ${exchangeNotDebtPending("e")} AS ok FROM exchange_transactions e`,
      )
      .get() as { ok: number };
    expect(ok.ok).toBe(0);
  });

  it("US3.3: voiding the whole basket nets every ledger to 0 and gives the lot back", async () => {
    const buy = getExchangeService().addDirectTransaction({
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 116,
      leg1Rate: 1.16,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 2,
      totalProfitUsd: 2,
    });
    expect(buy.success).toBe(true);
    const sessionId = session();
    const items = [
      chargerLine(),
      exchangeLine("ex", USD_TO_LBP, { amount: 100, currency: "USD" }),
      exchangeLine(
        "eur",
        {
          fromCurrency: "USD",
          toCurrency: "EUR",
          amountIn: 60,
          amountOut: 50,
          leg1Rate: 1.2,
          leg1MarketRate: 1.18,
          leg1ProfitUsd: 1,
          totalProfitUsd: 1,
        },
        { amount: 60, currency: "USD" },
      ),
    ];
    const before = {
      usd: drawer(db, "General", "USD"),
      lbp: drawer(db, "General", "LBP"),
      eur: drawer(db, "General", "EUR"),
    };
    const result = await checkout(sessionId, {
      cartItems: items,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 180 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 8_950_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    });
    expect(result.error).toBeUndefined();

    getTransactionRepository().voidSessionBasket(sessionId, 1);

    expect(drawer(db, "General", "USD") - before.usd).toBeCloseTo(0, 6);
    expect(drawer(db, "General", "LBP") - before.lbp).toBeCloseTo(0, 6);
    expect(drawer(db, "General", "EUR") - before.eur).toBeCloseTo(0, 6);
    expect(
      (
        db
          .prepare(`SELECT remaining_qty FROM exchange_lots WHERE currency_code = 'EUR'`)
          .get() as { remaining_qty: number }
      ).remaining_qty,
    ).toBe(100);
    const liveProfit = db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS n FROM transactions
          WHERE status = 'ACTIVE' AND type IN ('EXCHANGE','CUSTOM_SERVICE')
            AND id IN (SELECT unified_transaction_id FROM customer_session_transactions WHERE session_id = ?)`,
      )
      .get(sessionId) as { n: number };
    expect(liveProfit.n).toBeCloseTo(0, 6);
  });

});
