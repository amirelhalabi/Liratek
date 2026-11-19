/**
 * LIRA-402 — the payout-mode payment box at Session Checkout.
 *
 * Owner (2026-11-19): a payout-only basket (an exchange + a Whish App
 * receive) showed no payment form — no Split, no second currency, no
 * "− Less | + Extra". The checkout now shows the payout box; its lines go
 * out as `OUT / PAYOUT / GENERAL` legs, "+ Extra" travels as
 * `rounding_given_*` and "− Less" as `kept_change_*`, booked exactly as the
 * standalone payout screens book them (a "Change rounding" expense / kept
 * change as profit, $5 / 450,000 LBP cap).
 *
 * Every payload goes through the REAL schema (`sessionCheckoutSchema`, rule
 * 24 — field names from the schema) and the REAL `SessionCheckoutService`
 * on the real create_db.sql + migrations.
 *
 * Rule 17 — run against the unfixed core first (failures recorded in
 * specs/402-session-payout-payment-form/tasks.md notes and the ticket
 * report).
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
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetExchangeService } from "../ExchangeService";
import { resetExchangeRepository } from "../../repositories/ExchangeRepository";
import { resetExchangeLotRepository } from "../../repositories/ExchangeLotRepository";
import { getTransactionRepository } from "../../repositories/TransactionRepository";
import {
  sessionCheckoutSchema,
  type SessionCheckoutPayload,
} from "../../validators/session";
import type { ExchangeSubmitPayload } from "../../validators/exchange";
import {
  buildSessionCheckoutLegs,
  payoutBoxMethodFor,
} from "../../utils/sessionCheckoutLegs";

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
  resetFinancialServiceRepository();
  resetExchangeService();
  resetExchangeRepository();
  resetExchangeLotRepository();
}

const RATE = 89_000;

/** A Whish App RECEIVE as the Recharge page puts it in a session: the shop
 *  pays the customer `payout` (cart amount negative), the $fee is taken from
 *  the payout. */
function whishAppReceive(id: string, payout: number, fee: number) {
  return {
    id,
    module: "whish_app",
    label: "Whish App RECEIVE",
    amount: -payout,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: payout + fee,
      currency: "USD",
      commission: fee,
      whishFee: fee,
      includingFees: false,
      cashoutMethod: "CASH",
    },
  } satisfies CheckoutCartItem;
}

function charge(id: string, usd: number): CheckoutCartItem {
  return {
    id,
    module: "custom_service",
    label: "Charger",
    amount: usd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "charger",
      cost_usd: usd / 2,
      price_usd: usd,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

/** LBP → USD exchange: the customer gives 9,000,000 LBP and takes $100. */
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

function exchangeLine(): CheckoutCartItem {
  return {
    id: "ex",
    module: "exchange",
    label: "Exchange 9,000,000 LBP → $100",
    amount: 9_000_000,
    currency: "LBP",
    ipcChannel: "exchange:add-transaction",
    formData: LBP_TO_USD as unknown as Record<string, unknown>,
  };
}

type Leg = NonNullable<SessionCheckoutPayload["payments"]>[number];
const OUT = (method: string, currency: string, amount: number): Leg => ({
  method,
  currency_code: currency,
  amount,
  direction: "OUT",
  kind: "PAYOUT",
  payoutOrigin: "GENERAL",
});
const IN = (method: string, currency: string, amount: number): Leg => ({
  method,
  currency_code: currency,
  amount,
  direction: "IN",
});

describe("LIRA-402 — payout-mode payment box at Session Checkout", () => {
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

  function session(items: CheckoutCartItem[]): number {
    const id = getCustomerSessionRepository().createSession({
      customer_name: "Walk-in",
      started_by: "admin",
      user_id: 1,
    });
    for (const item of items) {
      getCustomerSessionRepository().addCartItem(id, {
        item_id: item.id,
        module: item.module,
        label: item.label,
        amount: item.amount,
        currency: item.currency,
        form_data: JSON.stringify(item.formData),
        ipc_channel: item.ipcChannel,
      });
    }
    return id;
  }

  /** Through the real schema, then the real service. */
  async function checkout(
    sessionId: number,
    items: CheckoutCartItem[],
    extra: Partial<SessionCheckoutPayload>,
  ) {
    const payload: SessionCheckoutPayload = {
      sessionId,
      cartItems: items,
      paidByMethod: "CASH",
      exchangeRate: RATE,
      userId: 1,
      ...extra,
    };
    const parsed = sessionCheckoutSchema.parse(payload);
    return getSessionCheckoutService().checkout(
      parsed as unknown as CheckoutRequest,
      { username: "admin" },
    );
  }

  function general() {
    return {
      usd: drawer(db, "General", "USD"),
      lbp: drawer(db, "General", "LBP"),
    };
  }

  function roundingExpenses(sessionId: number) {
    return db
      .prepare(
        `SELECT e.amount_usd, e.amount_lbp, e.category, t.status
           FROM expenses e
           JOIN transactions t ON t.source_table = 'expenses' AND t.source_id = e.id
          WHERE e.source_ref_table = 'customer_sessions' AND e.source_ref_id = ?
            AND t.reverses_id IS NULL`,
      )
      .all(sessionId) as Array<{
      amount_usd: number;
      amount_lbp: number;
      category: string;
      status: string;
    }>;
  }

  function keptRows(): Array<{ profit_usd: number; profit_lbp: number }> {
    return db
      .prepare(
        `SELECT profit_usd, profit_lbp FROM transactions WHERE type = 'KEPT_CHANGE'`,
      )
      .all() as Array<{ profit_usd: number; profit_lbp: number }>;
  }

  // ── Table-driven variants (rule 28d) ──────────────────────────────────
  const variants: Array<{
    name: string;
    items: () => CheckoutCartItem[];
    payments: Leg[];
    extra?: Partial<SessionCheckoutPayload>;
    delta: { usd: number; lbp: number };
  }> = [
    {
      name: "payout-only: Whish App receive $199 paid $199 cash",
      items: () => [whishAppReceive("w", 199, 2)],
      payments: [OUT("CASH", "USD", 199)],
      delta: { usd: -199, lbp: 0 },
    },
    {
      name: "payout in LBP: $199 paid 17,711,000 LBP",
      items: () => [whishAppReceive("w", 199, 2)],
      payments: [OUT("CASH", "LBP", 17_711_000)],
      delta: { usd: 0, lbp: -17_711_000 },
    },
    {
      name: "split USD + LBP: $150 + 4,361,000 LBP",
      items: () => [whishAppReceive("w", 199, 2)],
      payments: [OUT("CASH", "USD", 150), OUT("CASH", "LBP", 4_361_000)],
      delta: { usd: -150, lbp: -4_361_000 },
    },
    {
      name: "mixed, payout > charge: $20 charger + $100 receive → $80 out",
      items: () => [charge("c", 20), whishAppReceive("w", 100, 1)],
      payments: [OUT("CASH", "USD", 80)],
      delta: { usd: -80, lbp: 0 },
    },
    {
      name: "mixed, charge > payout (unchanged): $150 charger + $100 receive → $50 in",
      items: () => [charge("c", 150), whishAppReceive("w", 100, 1)],
      payments: [IN("CASH", "USD", 50)],
      delta: { usd: 50, lbp: 0 },
    },
    {
      name: "exchange + receive: 9,000,000 LBP → $100 exchange + $199 receive → $197.88 net out",
      items: () => [exchangeLine(), whishAppReceive("w", 199, 2)],
      // The customer gives 9,000,000 LBP (= $101.12 at the checkout's
      // 89,000) and takes $100 + $199: the screen nets the lira against the
      // cash payout, so $299 − $101.12 = $197.88 goes out.
      payments: [OUT("CASH", "USD", 197.88)],
      delta: { usd: -197.88, lbp: 0 },
    },
  ];

  it.each(variants)("$name", async (v) => {
    const items = v.items();
    const sessionId = session(items);
    const before = general();
    const result = await checkout(sessionId, items, {
      payments: v.payments,
      ...(v.extra ?? {}),
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const after = general();
    expect(after.usd - before.usd).toBeCloseTo(v.delta.usd, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(v.delta.lbp, 0);
  });

  // ── "+ Extra" — the payout rounded up ──────────────────────────────────
  it("+ Extra $0.50 on a $199 payout: drawer −$199.50, one 'Change rounding' expense of $0.50 linked to the session", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const before = general();
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "USD", 199.5)],
      rounding_given_usd: 0.5,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(general().usd - before.usd).toBeCloseTo(-199.5, 2);
    expect(roundingExpenses(sessionId)).toEqual([
      expect.objectContaining({
        amount_usd: 0.5,
        amount_lbp: 0,
        category: "Change rounding",
      }),
    ]);
  });

  it("+ Extra in LBP on an LBP payout: 20,000 LBP rounding booked in LBP", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "LBP", 17_731_000)],
      rounding_given_lbp: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(roundingExpenses(sessionId)).toEqual([
      expect.objectContaining({ amount_usd: 0, amount_lbp: 20_000 }),
    ]);
  });

  it("+ Extra above $5 is refused and nothing is written", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const before = general();
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "USD", 205)],
      rounding_given_usd: 6,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\$5 \/ 450,000 LBP/);
    expect(general()).toEqual(before);
  });

  it("+ Extra that the lines do not carry is refused", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "USD", 199)],
      rounding_given_usd: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("+ Extra on a customer-account payout is refused (account money is not rounded)", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Rana Aziz",
      customer_phone: "71222333",
      started_by: "admin",
      user_id: 1,
    });
    const result = await checkout(sessionId, items, {
      payments: [OUT("CUSTOMER_ACCOUNT", "USD", 199.5)],
      rounding_given_usd: 0.5,
    });
    expect(result.success).toBe(false);
  });

  // ── "− Less" — the shop keeps a little ─────────────────────────────────
  it("− Less $0.50 on a $199 payout: drawer −$198.50 and $0.50 kept as profit", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const before = general();
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "USD", 198.5)],
      kept_change_usd: 0.5,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(general().usd - before.usd).toBeCloseTo(-198.5, 2);
    expect(keptRows()).toEqual([{ profit_usd: 0.5, profit_lbp: 0 }]);
  });

  it("− Less that does not match the lines is refused", async () => {
    const items = [whishAppReceive("w", 199, 2)];
    const sessionId = session(items);
    const result = await checkout(sessionId, items, {
      payments: [OUT("CASH", "USD", 198.5)],
      kept_change_usd: 2,
    });
    expect(result.success).toBe(false);
  });

  // ── Reversal owner (rule 20) ────────────────────────────────────────────
  it.each(["void", "refund"] as const)(
    "basket %s after a + Extra checkout nets every ledger to 0 and voids the rounding expense",
    async (how) => {
      const items = [whishAppReceive("w", 199, 2)];
      const sessionId = session(items);
      const before = general();
      const result = await checkout(sessionId, items, {
        payments: [OUT("CASH", "USD", 150), OUT("CASH", "LBP", 4_405_500)],
        rounding_given_usd: 0.5,
      });
      expect(result.error).toBeUndefined();
      const repo = getTransactionRepository();
      if (how === "void") repo.voidSessionBasket(sessionId, 1);
      else repo.refundSessionBasket(sessionId, 1);
      const after = general();
      expect(after.usd - before.usd).toBeCloseTo(0, 2);
      expect(after.lbp - before.lbp).toBeCloseTo(0, 0);
      const exp = roundingExpenses(sessionId);
      expect(exp).toHaveLength(1);
      expect(exp[0].status).toBe("VOIDED");
    },
  );

  // ── The screen's own builder (rule 22) ─────────────────────────────────
  const ZERO = { usd: 0, lbp: 0 };
  const CASH = { USD: "CASH", LBP: "CASH" };

  it("builder, payout mode: box lines → OUT/PAYOUT/GENERAL (the legs the variants above send)", () => {
    expect(
      buildSessionCheckoutLegs({
        mode: "payout",
        collectLines: [],
        returnLines: [],
        payoutLines: [
          { method: "CASH", currencyCode: "USD", amount: 150 },
          { method: "CASH", currencyCode: "LBP", amount: 4_361_000 },
        ],
        payoutMethod: CASH,
        systemPayout: ZERO,
        exchangePayout: { usd: 100, lbp: 0 },
        generalPayoutLeg: { usd: 99, lbp: 0 },
      }),
    ).toEqual([OUT("CASH", "USD", 150), OUT("CASH", "LBP", 4_361_000)]);
  });

  it("builder, collect mode: byte-identical to the pre-LIRA-402 legs", () => {
    expect(
      buildSessionCheckoutLegs({
        mode: "collect",
        collectLines: [{ method: "CASH", currencyCode: "USD", amount: 120 }],
        returnLines: [{ method: "CASH", currencyCode: "LBP", amount: 90_000 }],
        payoutLines: [{ method: "CASH", currencyCode: "USD", amount: 999 }],
        payoutMethod: CASH,
        systemPayout: { usd: 0, lbp: 0 },
        exchangePayout: { usd: 0, lbp: 8_950_000 },
        generalPayoutLeg: ZERO,
      }),
    ).toEqual([
      IN("CASH", "USD", 120),
      {
        method: "CASH",
        currency_code: "LBP",
        amount: 90_000,
        direction: "OUT",
        kind: "CHANGE",
      },
      OUT("CASH", "LBP", 8_950_000),
    ]);
  });

  it("SYSTEM payout present: the OMT receive keeps its own gross SYSTEM leg, the box pays the Whish App part", async () => {
    const omtReceive: CheckoutCartItem = {
      id: "omt",
      module: "omt_system",
      label: "OMT RECEIVE",
      amount: -100,
      currency: "USD",
      ipcChannel: "financial:create",
      formData: {
        provider: "OMT",
        serviceType: "RECEIVE",
        omtServiceType: "INTRA",
        amount: 100,
        currency: "USD",
        omtFee: 0,
        includingFees: false,
        cashoutMethod: "CASH",
      },
    };
    // OMT is the shop's base system for this case (its box is OMT_System).
    db.prepare(
      `INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT')`,
    ).run();
    const items = [omtReceive, whishAppReceive("w", 50, 1)];
    const sessionId = session(items);
    const before = general();
    const omtBefore = drawer(db, "OMT_System", "USD");
    const payments = buildSessionCheckoutLegs({
      mode: "payout",
      collectLines: [],
      returnLines: [],
      payoutLines: [
        { method: "CASH", currencyCode: "USD", amount: 40 },
        { method: "CASH", currencyCode: "LBP", amount: 890_000 },
      ],
      payoutMethod: CASH,
      systemPayout: { usd: 100, lbp: 0 },
      exchangePayout: ZERO,
      generalPayoutLeg: ZERO,
    });
    const result = await checkout(sessionId, items, { payments });
    expect(result.error).toBeUndefined();
    expect(general().usd - before.usd).toBeCloseTo(-40, 2);
    expect(general().lbp - before.lbp).toBeCloseTo(-890_000, 0);
    expect(drawer(db, "OMT_System", "USD") - omtBefore).toBeCloseTo(-100, 2);
  });

  it("payoutBoxMethodFor: the shared method per currency, else CASH", () => {
    expect(
      payoutBoxMethodFor(
        [{ method: "WHISH", currencyCode: "USD", amount: 5 }],
        "USD",
      ),
    ).toBe("WHISH");
    expect(
      payoutBoxMethodFor(
        [
          { method: "WHISH", currencyCode: "USD", amount: 5 },
          { method: "CASH", currencyCode: "USD", amount: 5 },
        ],
        "USD",
      ),
    ).toBe("CASH");
    expect(payoutBoxMethodFor([], "USD")).toBe("CASH");
  });

  // ── Single-item refund after Less / Extra (rule 20, second reversal path)
  // Measured, not designed here: what refunding the Whish App receive alone
  // asks the customer to pay back, and what stays booked.
  it.each([
    { name: "− Less $0.50", paid: 198.5, extra: { kept_change_usd: 0.5 } },
    { name: "+ Extra $0.50", paid: 199.5, extra: { rounding_given_usd: 0.5 } },
  ])(
    "item refund of the Whish App receive after $name: the customer pays back the item's $199; the basket's Less/Extra row stays",
    async ({ paid, extra }) => {
      const items = [whishAppReceive("w", 199, 2)];
      const sessionId = session(items);
      const before = general();
      const result = await checkout(sessionId, items, {
        payments: [OUT("CASH", "USD", paid)],
        ...extra,
      });
      expect(result.error).toBeUndefined();
      const memberId = (
        db
          .prepare(
            `SELECT unified_transaction_id AS id FROM customer_session_transactions
              WHERE session_id = ? AND transaction_type <> 'kept_change'
                AND unified_transaction_id IS NOT NULL`,
          )
          .all(sessionId) as Array<{ id: number }>
      )[0].id;
      const repo = getTransactionRepository();
      const preview = repo.getSessionItemRefundPreview({
        sessionId,
        transactionId: memberId,
      });
      expect(preview.remainderUsd).toBeCloseTo(199, 2);
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: memberId,
        userId: 1,
      });
      // General: paid out `paid`, took back $199.
      expect(general().usd - before.usd).toBeCloseTo(199 - paid, 2);
      // The Less (kept profit) / Extra (rounding expense) stays booked —
      // the same rule as an LBP change rounding (LIRA-334): a single-item
      // refund leaves it. With Less the shop ends +$0.50 cash and +$0.50
      // kept profit; with Extra −$0.50 cash and a $0.50 expense.
      if ("kept_change_usd" in extra) {
        expect(keptRows()).toEqual([{ profit_usd: 0.5, profit_lbp: 0 }]);
      } else {
        const exp = roundingExpenses(sessionId);
        expect(exp).toHaveLength(1);
        expect(exp[0].status).toBe("ACTIVE");
      }
    },
  );
});
