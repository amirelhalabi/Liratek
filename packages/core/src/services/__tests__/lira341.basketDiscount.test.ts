/**
 * LIRA-341 — a basket DISCOUNT at the session checkout.
 *
 * Owner decisions (2026-10-25): the mirror of the LIRA-319 basket extra and
 * the LIRA-310 waive. The checkout sends `discount_usd/discount_lbp`; the
 * server caps it at the basket's own shop PROFIT (the sum of the profit
 * stamps its items wrote), refuses it next to an extra or a waive, and books
 * ONE standalone `BASKET_DISCOUNT` row (amount 0, profit −discount,
 * session-linked) — operator-typed, so NOT `is_auto` (rule 26). What the
 * customer owes is the basket charge minus the discount (kept change and the
 * nothing-to-collect check read the reduced charge). Profits shows it on its
 * own "Session discounts" By Module line; net profit drops by it.
 *
 * Reversal (rule 20): refunding ONE item leaves the discount whole; the
 * whole-basket void/refund sweeps it with the basket — every ledger and the
 * Profits total net to 0 per currency.
 *
 * Rule 17 — failing-first, recorded 2026-10-25 against the unchanged code:
 *   `npx jest src/services/__tests__/lira340.basketDiscount.test.ts`
 *   → 11 failed, 2 passed (13). The failures were the right ones: no
 *   BASKET_DISCOUNT row was booked (row undefined), the over-cap and
 *   discount+extra checkouts were ACCEPTED (success true), kept change on
 *   the reduced charge was refused, the schema accepted discount_usd: −1,
 *   and getSummary had no `session_discounts`. The 2 that passed: "no
 *   discount → no row" (true before and after) and "discount + waive"
 *   (refused then only because the waive claim didn't match the gap; its
 *   exact-message assertion, DISCOUNT_AND_WAIVE_MESSAGE, was added after
 *   the fix — not proven failing-first).
 *   The last four cases (cross-view parity, on account, OMT SEND, two
 *   single-item refunds) were added after the fix — not proven failing-first.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../../repositories/testHelpers/debtItemDb";
import {
  snapshotLedgers,
  expectPostings,
} from "../../repositories/testHelpers/postingAssert";
import {
  SessionCheckoutService,
  type CheckoutRequest,
} from "../SessionCheckoutService";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetSalesRepository } from "../../repositories/SalesRepository";
import { resetProfitRepository } from "../../repositories/ProfitRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetCustomServiceService } from "../CustomServiceService";
import { getProfitService, resetProfitService } from "../ProfitService";
import { sessionCheckoutSchema } from "../../validators/session";
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  DISCOUNT_AND_WAIVE_MESSAGE,
} from "../../validators/common";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const RATE = 89_000; // debtItemDb pins every rate to this
const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
let service: SessionCheckoutService;
let sessionRepo: CustomerSessionRepository;

function resetAll(): void {
  resetTransactionRepository();
  resetClientRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetSessionPaymentService();
  resetSalesRepository();
  resetProfitRepository();
  resetProfitService();
  resetCustomServiceRepository();
  resetCustomServiceService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  service = new SessionCheckoutService();
  sessionRepo = new CustomerSessionRepository(db);
  // A phone sold at $294 with a $250 cost → the sale's profit is $44.
  db.prepare(
    `INSERT INTO products (id, tenant_id, name, item_type, cost_price_usd, stock_quantity)
     VALUES (901, 1, 'Phone', 'Accessory', 250, 10)`,
  ).run();
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

function saleItem(price = 294) {
  return {
    id: "cart-sale",
    module: "pos",
    label: "Sale",
    amount: price,
    currency: "USD",
    formData: {
      client_id: null,
      items: [{ product_id: 901, quantity: 1, price }],
      total_amount: price,
      discount: 0,
      final_amount: price,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: RATE,
      status: "completed",
    },
    ipcChannel: "sales:process",
  };
}

function serviceItem(
  id: string,
  o: { price_usd?: number; cost_usd?: number; price_lbp?: number; cost_lbp?: number },
  currency: "USD" | "LBP" = "USD",
) {
  return {
    id,
    module: "custom_service",
    label: `Service ${id}`,
    amount: currency === "LBP" ? (o.price_lbp ?? 0) : (o.price_usd ?? 0),
    currency,
    formData: { description: `Service ${id}`, ...o },
    ipcChannel: "custom-services:add",
  };
}

/** The new fields, typed loosely so the file runs against the unchanged
 *  `CheckoutRequest` (red for the right reason). */
type DiscountRequest = CheckoutRequest & {
  discount_usd?: number;
  discount_lbp?: number;
};

function newSession(name = "Jean Dupont"): number {
  return sessionRepo.createSession({
    customer_name: name,
    started_by: "admin",
    user_id: 1,
  });
}

/** Default: $294 phone, $8 discount, paid $286 cash. */
async function checkout(
  sessionId: number,
  o: Partial<DiscountRequest> = {},
): Promise<{ success: boolean; error?: string }> {
  const req: DiscountRequest = {
    sessionId,
    cartItems: [saleItem()],
    exchangeRate: RATE,
    userId: 1,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 286, direction: "IN" },
    ],
    discount_usd: 8,
    ...o,
  };
  return service.checkout(req, { username: "admin" });
}

type DiscountRow = {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_name: string | null;
  metadata_json: string;
  status: string;
};

function discountRow(sessionId: number): DiscountRow | undefined {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, metadata_json, status
         FROM transactions
        WHERE type = 'BASKET_DISCOUNT' AND source_table = 'customer_sessions' AND source_id = ?`,
    )
    .get(sessionId) as DiscountRow | undefined;
}

function summary() {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getSummary(FROM, TO) as ReturnType<
    ReturnType<typeof getProfitService>["getSummary"]
  > & {
    session_discounts?: { profit_usd: number; profit_lbp: number; count: number };
  };
}

function byModule() {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getByModule(FROM, TO);
}

describe("session checkout — basket discount (LIRA-341)", () => {
  it("$294 phone + $8 discount, paid $286: accepted, ONE BASKET_DISCOUNT row (amount 0, profit −8), no debt", async () => {
    const before = snapshotLedgers(db);
    const sessionId = newSession();
    const result = await checkout(sessionId);
    expect(result).toMatchObject({ success: true });

    const row = discountRow(sessionId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: -8,
      profit_lbp: 0,
      client_name: "Jean Dupont",
      status: "ACTIVE",
    });
    const meta = JSON.parse(row!.metadata_json) as Record<string, unknown>;
    expect(meta).toMatchObject({ session_id: sessionId, discount_usd: 8 });
    // Operator-typed, never a hidden auto row (rule 26).
    expect(meta.is_auto).toBeUndefined();

    const link = db
      .prepare(
        `SELECT transaction_type, amount_usd, amount_lbp, profit_usd FROM customer_session_transactions
          WHERE session_id = ? AND unified_transaction_id = ?`,
      )
      .get(sessionId, row!.id) as {
      transaction_type: string;
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
    };
    expect(link).toMatchObject({
      transaction_type: "basket_discount",
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: -8,
    });

    // Only the $286 the customer paid moved; nothing on any account.
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 286 },
    });
  });

  it("the discount reduces what is owed: paid $290 on $294 − $8, $4 kept → accepted", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 290, direction: "IN" },
      ],
      kept_change_usd: 4,
    });
    expect(result).toMatchObject({ success: true });
    expect(discountRow(sessionId)?.profit_usd).toBe(-8);
  });

  it("refuses a discount above the basket's profit ($45 > $44) and books nothing", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      discount_usd: 45,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 249, direction: "IN" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/profit/i);
    expect(discountRow(sessionId)).toBeUndefined();
  });

  it("refuses a discount together with an extra", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      extra_usd: 2,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 288, direction: "IN" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(DISCOUNT_AND_EXTRA_MESSAGE);
    expect(discountRow(sessionId)).toBeUndefined();
  });

  it("refuses a discount together with a waive (one reduction only)", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      waived_usd: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 285, direction: "IN" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(DISCOUNT_AND_WAIVE_MESSAGE);
    expect(discountRow(sessionId)).toBeUndefined();
  });

  it("mixed basket (phone + service): the cap is the SUM of both profits", async () => {
    // Phone $44 profit + service $20 − $5 = $15 → cap $59.
    const items = [
      saleItem(),
      serviceItem("svc", { price_usd: 20, cost_usd: 5 }),
    ];
    const okSession = newSession();
    expect(
      await checkout(okSession, {
        cartItems: items,
        discount_usd: 59,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 255, direction: "IN" },
        ],
      }),
    ).toMatchObject({ success: true });
    expect(discountRow(okSession)?.profit_usd).toBe(-59);

    const overSession = newSession("Other");
    const over = await checkout(overSession, {
      cartItems: [
        saleItem(),
        serviceItem("svc2", { price_usd: 20, cost_usd: 5 }),
      ],
      discount_usd: 59.5,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 254.5, direction: "IN" },
      ],
    });
    expect(over.success).toBe(false);
    expect(discountRow(overSession)).toBeUndefined();
  });

  it("LBP basket: 100,000 LBP discount on a 900,000 LBP service (600,000 profit), paid 800,000", async () => {
    const before = snapshotLedgers(db);
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      cartItems: [
        serviceItem("lbp", { price_lbp: 900_000, cost_lbp: 300_000 }, "LBP"),
      ],
      discount_usd: undefined,
      discount_lbp: 100_000,
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 800_000, direction: "IN" },
      ],
    });
    expect(result).toMatchObject({ success: true });
    expect(discountRow(sessionId)).toMatchObject({
      profit_usd: 0,
      profit_lbp: -100_000,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": 800_000 },
    });

    const overSession = newSession("Other");
    const over = await checkout(overSession, {
      cartItems: [
        serviceItem("lbp2", { price_lbp: 900_000, cost_lbp: 300_000 }, "LBP"),
      ],
      discount_usd: undefined,
      discount_lbp: 600_001,
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 299_999, direction: "IN" },
      ],
    });
    expect(over.success).toBe(false);
  });

  it("refunding ONE item leaves the discount row whole", async () => {
    const sessionId = newSession();
    expect(
      await checkout(sessionId, {
        cartItems: [
          serviceItem("a", { price_usd: 20, cost_usd: 5 }),
          serviceItem("b", { price_usd: 10, cost_usd: 2 }),
        ],
        discount_usd: 3,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 27, direction: "IN" },
        ],
      }),
    ).toMatchObject({ success: true });
    const member = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'CUSTOM_SERVICE' AND reverses_id IS NULL ORDER BY id ASC LIMIT 1`,
      )
      .get() as { id: number };
    getTransactionRepository().refundSessionBasketItem({
      sessionId,
      transactionId: member.id,
      userId: 1,
    });
    const row = discountRow(sessionId);
    expect(row).toMatchObject({ status: "ACTIVE", profit_usd: -3 });
    const refundsOfDiscount = db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE reverses_id = ?`)
      .get(row?.id ?? -1) as { n: number };
    expect(refundsOfDiscount.n).toBe(0);
  });

  it.each(["void", "refund"] as const)(
    "basket %s: every ledger, the Profits total and Session discounts net to 0 per currency",
    async (how) => {
      const before = snapshotLedgers(db);
      const profitBefore = summary().totals;
      const sessionId = newSession();
      expect(await checkout(sessionId)).toMatchObject({ success: true });
      // Not vacuous: the discount is in the books before the reversal.
      expect(summary().session_discounts?.profit_usd).toBe(-8);

      const txnRepo = getTransactionRepository();
      if (how === "void") txnRepo.voidSessionBasket(sessionId, 1);
      else txnRepo.refundSessionBasket(sessionId, 1);

      expectPostings(before, snapshotLedgers(db), {});
      const after = summary();
      expect(after.totals.gross_profit_usd).toBeCloseTo(
        profitBefore.gross_profit_usd,
        6,
      );
      expect(after.totals.gross_profit_lbp).toBeCloseTo(
        profitBefore.gross_profit_lbp,
        6,
      );
      expect(after.session_discounts?.profit_usd ?? 0).toBeCloseTo(0, 6);
    },
  );

  it("Profits: By Module has 'Session discounts' −8 and net profit is sale profit − 8", async () => {
    const netBefore = summary().totals.net_profit_usd;
    const sessionId = newSession();
    expect(await checkout(sessionId)).toMatchObject({ success: true });

    const s = summary();
    expect(s.session_discounts).toMatchObject({ profit_usd: -8, count: 1 });
    expect(s.totals.net_profit_usd - netBefore).toBeCloseTo(44 - 8, 6);

    const line = byModule().find((r) => r.module === "SESSION_DISCOUNT");
    expect(line).toMatchObject({ label: "Session discounts", profit_usd: -8 });
  });

  it("the schema declares discount_usd / discount_lbp with no default; negative refused (rules 22/23)", () => {
    const base = { sessionId: 1, cartItems: [saleItem()], userId: 1 };
    expect(
      sessionCheckoutSchema.safeParse({ ...base, discount_usd: -1 }).success,
    ).toBe(false);
    const parsed = sessionCheckoutSchema.safeParse({
      ...base,
      discount_usd: 8,
      discount_lbp: 0,
    });
    expect(parsed.success && parsed.data).toMatchObject({
      discount_usd: 8,
      discount_lbp: 0,
    });
    const absent = sessionCheckoutSchema.parse(base) as Record<string, unknown>;
    expect("discount_usd" in absent).toBe(false);
  });

  it("no regression: a basket with no discount books no BASKET_DISCOUNT row", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      discount_usd: undefined,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 294, direction: "IN" },
      ],
    });
    expect(result).toMatchObject({ success: true });
    expect(discountRow(sessionId)).toBeUndefined();
  });

  it("cross-view parity: By Date / By Cashier / By Client / By Module each sum to the Overview gross profit — after checkout and after the basket refund", async () => {
    const sessionId = newSession();
    expect(await checkout(sessionId)).toMatchObject({ success: true });
    const assertParity = (label: string) => {
      const gross = summary().totals.gross_profit_usd;
      resetProfitRepository();
      resetProfitService();
      const ps = getProfitService();
      const sum = (rows: { profit_usd: number }[]) =>
        rows.reduce((a, r) => a + r.profit_usd, 0);
      expect([label, "date", sum(ps.getByDate(FROM, TO))]).toEqual([label, "date", gross]);
      expect([label, "user", sum(ps.getByUser(FROM, TO))]).toEqual([label, "user", gross]);
      expect([label, "client", sum(ps.getByClient(FROM, TO, 1000))]).toEqual([label, "client", gross]);
      expect([label, "module", sum(ps.getByModule(FROM, TO))]).toEqual([label, "module", gross]);
    };
    expect(summary().totals.gross_profit_usd).toBeCloseTo(36, 6);
    assertParity("after checkout");
    getTransactionRepository().refundSessionBasket(sessionId, 1);
    expect(summary().totals.gross_profit_usd).toBeCloseTo(0, 6);
    assertParity("after basket refund");
  });

  it("on account: $286 on CUSTOMER_ACCOUNT → a $286 basket debt; the void nets the debt ledger (and every ledger) to 0", async () => {
    db.prepare(
      `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (77, 1, 'Jean Dupont', '03123456')`,
    ).run();
    const before = snapshotLedgers(db);
    const sessionId = newSession();
    expect(
      await checkout(sessionId, {
        clientId: 77,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 286, direction: "IN" },
        ],
      }),
    ).toMatchObject({ success: true });
    const debt = db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE session_id = ?`,
      )
      .get(sessionId) as { usd: number };
    expect(debt.usd).toBeCloseTo(286, 6);
    expect(discountRow(sessionId)?.profit_usd).toBe(-8);
    getTransactionRepository().voidSessionBasket(sessionId, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("OMT SEND item: its commission is not stamped at checkout, so the cap is the phone's $44 alone (measured; written after the fix)", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      cartItems: [
        saleItem(),
        {
          id: "cart-omt",
          module: "omt",
          label: "OMT Send",
          amount: 20,
          currency: "USD",
          formData: {
            provider: "OMT",
            serviceType: "SEND",
            amount: 20,
            currency: "USD",
            commission: 3,
            omtFee: 0,
          },
          ipcChannel: "financial:create",
        },
      ],
      discount_usd: 44,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 270, direction: "IN" },
      ],
    });
    const omt = db
      .prepare(
        `SELECT profit_usd, profit_lbp FROM transactions WHERE type = 'FINANCIAL_SERVICE' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { profit_usd: number; profit_lbp: number } | undefined;
    // Measured 2026-10-25: an OMT SEND's commission is NOT on its row at
    // checkout (it is recognized at settlement), so it adds 0 to the cap —
    // the cap here is the phone's $44 alone. Open owner question.
    expect(result).toMatchObject({ success: true });
    expect(omt).toMatchObject({ profit_usd: 0, profit_lbp: 0 });
  });

  it("single-item refunds of both items hand back exactly the $27 paid, never $30 (measured; written after the fix)", async () => {
    const sessionId = newSession();
    expect(
      await checkout(sessionId, {
        cartItems: [
          serviceItem("a", { price_usd: 20, cost_usd: 5 }),
          serviceItem("b", { price_usd: 10, cost_usd: 2 }),
        ],
        discount_usd: 3,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 27, direction: "IN" },
        ],
      }),
    ).toMatchObject({ success: true });
    const generalUsd = () =>
      (snapshotLedgers(db).drawers["General|USD"] ?? 0) as number;
    const afterCheckout = generalUsd();
    const ids = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'CUSTOM_SERVICE' AND reverses_id IS NULL ORDER BY id ASC`,
        )
        .all() as { id: number }[]
    ).map((r) => r.id);
    for (const id of ids) {
      getTransactionRepository().refundSessionBasketItem({
        sessionId,
        transactionId: id,
        userId: 1,
      });
    }
    const returned = afterCheckout - generalUsd();
    // Measured 2026-10-25: both refunds together hand back exactly the $27
    // paid (the item refund pays back by what was collected), not $30.
    expect(returned).toBeCloseTo(27, 6);
    expect(discountRow(sessionId)).toMatchObject({ status: "ACTIVE", profit_usd: -3 });
  });
});

