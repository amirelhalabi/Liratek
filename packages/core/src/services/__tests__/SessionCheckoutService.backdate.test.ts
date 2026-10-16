/**
 * Bug #4 (TRANSACTION_DETAIL_AUDIT.md §3) — a customer-session basket can be
 * backdated.
 *
 * Model: the checkout carries ONE optional `transaction_time` (the time the
 * cashier set on the session checkout window). It is applied to every row
 * that checkout writes — each replayed item (unless the item carries its
 * own time, which wins), the basket's own rows (extra / kept change /
 * waived), the basket payment lines, the basket debt and the session links —
 * so one backdated checkout lands on ONE day, never split between the
 * chosen day (items) and today (payment lines). Rule 27: the time is the
 * client's; the server's clock is only the fallback when none is sent.
 *
 * Rule 17: run before the change and seen failing (the checkout ignored the
 * time; every row was stamped with "now").
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
import { sessionCheckoutSchema } from "../../validators/session";

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
}

/** Two days ago, 09:30 UTC — a time the cashier picked on the window. */
const PICKED = "2026-10-14T09:30:00.000Z";
const PICKED_SQL = "2026-10-14 09:30:00";
/** A different backdated time set on ONE item when it was added. */
const ITEM_TIME = "2026-10-13T15:00:00.000Z";
const ITEM_TIME_SQL = "2026-10-13 15:00:00";

function serviceItem(
  id: string,
  priceUsd: number,
  extra: Record<string, unknown> = {},
): CheckoutCartItem {
  return {
    id,
    module: "custom_service",
    label: `Service: ${id}`,
    amount: priceUsd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: `glass ${id}`,
      cost_usd: 5,
      price_usd: priceUsd,
      cost_lbp: 0,
      price_lbp: 0,
      ...extra,
    },
  };
}

describe("Bug #4 — a session checkout can be backdated", () => {
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

  /** Every stored time normalised to SQLite's UTC text (ISO or not). */
  function times(sql: string, ...args: unknown[]): string[] {
    return (db.prepare(sql).all(...args) as Array<{ t: string | null }>).map(
      (r) => r.t ?? "NULL",
    );
  }

  async function checkout(
    extra: Partial<CheckoutRequest> & { cartItems: CheckoutCartItem[] },
  ) {
    const sessionId = session();
    const request = {
      sessionId,
      paidByMethod: "CASH",
      exchangeRate: 89_500,
      userId: 1,
      ...extra,
    } as CheckoutRequest;
    const result = await getSessionCheckoutService().checkout(request, {
      username: "admin",
    });
    return { sessionId, result };
  }

  it("the schema keeps the checkout's time (rule 23: never stripped on either transport)", () => {
    const parsed = sessionCheckoutSchema.parse({
      sessionId: 1,
      cartItems: [{}],
      userId: 1,
      transaction_time: PICKED,
    });
    expect(parsed.transaction_time).toBe(PICKED);
    expect(() =>
      sessionCheckoutSchema.parse({
        sessionId: 1,
        cartItems: [{}],
        userId: 1,
        transaction_time: "yesterday",
      }),
    ).toThrow();
  });

  it("every row the checkout writes carries the picked time: items, extra, kept change, payment lines, session links", async () => {
    const { sessionId, result } = await checkout({
      cartItems: [serviceItem("a", 20)],
      payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
      extra_usd: 2,
      kept_change_usd: 3,
      transaction_time: PICKED,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    // The session customer's registration (CLIENT_CREATED) is a real-time
    // event — it happens now — so only the sale's own rows are checked.
    const SALE_ROWS = `type IN ('CUSTOM_SERVICE', 'EXTRA_CHARGE', 'KEPT_CHANGE')`;
    // Money unchanged (FR-008).
    const amounts = db
      .prepare(
        `SELECT type, amount_usd, profit_usd FROM transactions WHERE ${SALE_ROWS} ORDER BY id`,
      )
      .all();
    expect(amounts).toEqual([
      { type: "CUSTOM_SERVICE", amount_usd: 20, profit_usd: 15 },
      { type: "EXTRA_CHARGE", amount_usd: 2, profit_usd: 0 },
      { type: "KEPT_CHANGE", amount_usd: 0, profit_usd: 3 },
    ]);

    expect(
      times(
        `SELECT datetime(created_at) AS t FROM transactions WHERE ${SALE_ROWS} ORDER BY id`,
      ),
    ).toEqual([PICKED_SQL, PICKED_SQL, PICKED_SQL]);
    expect(
      times(`SELECT datetime(created_at) AS t FROM custom_services`),
    ).toEqual([PICKED_SQL]);
    const legs = times(
      `SELECT datetime(created_at) AS t FROM payments WHERE session_id = ?`,
      sessionId,
    );
    expect(legs.length).toBeGreaterThan(0);
    expect(new Set(legs)).toEqual(new Set([PICKED_SQL]));
    const links = times(
      `SELECT datetime(created_at) AS t FROM customer_session_transactions WHERE session_id = ?`,
      sessionId,
    );
    expect(links.length).toBe(3);
    expect(new Set(links)).toEqual(new Set([PICKED_SQL]));
  });

  it("an item's own time wins; items without one take the checkout's", async () => {
    const { result } = await checkout({
      cartItems: [
        serviceItem("own", 10, { transaction_time: ITEM_TIME }),
        serviceItem("plain", 12),
      ],
      payments: [{ method: "CASH", currency_code: "USD", amount: 22 }],
      transaction_time: PICKED,
    });
    expect(result.error).toBeUndefined();
    expect(
      times(
        `SELECT datetime(created_at) AS t FROM transactions WHERE type = 'CUSTOM_SERVICE' ORDER BY id`,
      ),
    ).toEqual([ITEM_TIME_SQL, PICKED_SQL]);
  });

  it("the reported case — a Binance send in the basket: its own time wins, else the checkout's", async () => {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'Binance', 'USDT', 10000)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
    ).run();
    const binance = (
      id: string,
      extra: Record<string, unknown> = {},
    ): CheckoutCartItem => ({
      id,
      module: "binance_send",
      label: `Binance Send ${id}`,
      amount: 51,
      currency: "USD",
      ipcChannel: "financial:create",
      formData: {
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 50,
        currency: "USDT",
        commission: 1,
        referenceNumber: `TRX-${id}`,
        ...extra,
      },
    });
    const { result } = await checkout({
      cartItems: [
        binance("own", { transaction_time: ITEM_TIME }),
        binance("b"),
      ],
      payments: [{ method: "CASH", currency_code: "USD", amount: 102 }],
      transaction_time: PICKED,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(
      times(
        `SELECT datetime(created_at) AS t FROM transactions WHERE type = 'FINANCIAL_SERVICE' ORDER BY id`,
      ),
    ).toEqual([ITEM_TIME_SQL, PICKED_SQL]);
    expect(
      times(
        `SELECT datetime(created_at) AS t FROM financial_services WHERE provider = 'BINANCE' ORDER BY id`,
      ),
    ).toEqual([ITEM_TIME_SQL, PICKED_SQL]);
  });

  it("an item's own time is honoured even when the checkout sends none", async () => {
    const { result } = await checkout({
      cartItems: [serviceItem("own", 10, { transaction_time: ITEM_TIME })],
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
    });
    expect(result.error).toBeUndefined();
    expect(
      times(
        `SELECT datetime(created_at) AS t FROM transactions WHERE type = 'CUSTOM_SERVICE'`,
      ),
    ).toEqual([ITEM_TIME_SQL]);
  });

  it("the waived row and the basket debt (on account) carry the picked time; the debt is due 30 days after it", async () => {
    const { sessionId, result } = await checkout({
      cartItems: [serviceItem("a", 20)],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 10 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 8 },
      ],
      waived_usd: 2,
      transaction_time: PICKED,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(
      times(
        `SELECT datetime(created_at) AS t FROM transactions WHERE type = 'WAIVED_SHORTFALL'`,
      ),
    ).toEqual([PICKED_SQL]);
    const debt = db
      .prepare(
        `SELECT datetime(created_at) AS c, datetime(due_date) AS d FROM debt_ledger WHERE session_id = ?`,
      )
      .all(sessionId) as Array<{ c: string; d: string }>;
    expect(debt).toEqual([{ c: PICKED_SQL, d: "2026-11-13 09:30:00" }]);
  });

  it("change put on the customer's account carries the picked time too", async () => {
    const { sessionId, result } = await checkout({
      cartItems: [serviceItem("a", 20)],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currency_code: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      transaction_time: PICKED,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const credit = times(
      `SELECT datetime(created_at) AS t FROM debt_ledger WHERE session_id = ?`,
      sessionId,
    );
    expect(credit.length).toBeGreaterThan(0);
    expect(new Set(credit)).toEqual(new Set([PICKED_SQL]));
    // Every transaction this checkout wrote (the customer's registration
    // aside, which happens now) is on the picked day.
    expect(
      new Set(
        times(
          `SELECT datetime(created_at) AS t FROM transactions WHERE type <> 'CLIENT_CREATED'`,
        ),
      ),
    ).toEqual(new Set([PICKED_SQL]));
  });

  it("a time in the future is refused before anything is written", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { result } = await checkout({
      cartItems: [serviceItem("a", 20)],
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      transaction_time: future,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/future/i);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("no time sent: rows are stamped now, as before", async () => {
    const before = new Date(Date.now() - 60_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const { result } = await checkout({
      cartItems: [serviceItem("a", 20)],
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
    });
    expect(result.error).toBeUndefined();
    const [t] = times(
      `SELECT datetime(created_at) AS t FROM transactions WHERE type = 'CUSTOM_SERVICE'`,
    );
    expect(t >= before).toBe(true);
  });
});
