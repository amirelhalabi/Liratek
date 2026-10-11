/**
 * LIRA-310 T020 — Waive at the session basket checkout.
 *
 * The customer is a little short; the cashier taps Waive. The checkout sends
 * `waived_usd/waived_lbp` as a CLAIM. The server verifies it with the one
 * kept-change helper (customer reduction) against the basket's own net
 * charge — it must equal the real gap and sit at or under $5 / 450,000 LBP —
 * then books a `WAIVED_SHORTFALL` sibling row shaped exactly like
 * KEPT_CHANGE: amount 0, profit −waived, linked to the session with kind
 * "waived_shortfall", the session's name on it. The items themselves and
 * what any counterparty is owed are untouched.
 *
 * Reversal (rule 20): `voidSessionBasket` / `refundSessionBasket` already
 * loop over the session's linked members, so the sibling is swept with the
 * basket — drawers, debt_ledger and the Profits total all net to 0.
 *
 * Real schema (create_db.sql) via the debtItemDb helper; profit is read
 * through the Profits page's own reader (`ProfitService.getSummary`).
 *
 * Rule 17: written before the schema/service learned `waived_*`; the red
 * run is recorded under T020 in specs/310-waive-everywhere/tasks.md.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  drawers,
  addClient,
} from "../../repositories/testHelpers/debtItemDb";
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
import { resetSessionPaymentService } from "../SessionPaymentService";
import { getProfitService, resetProfitService } from "../ProfitService";
import { sessionCheckoutSchema } from "../../validators/session";
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
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  service = new SessionCheckoutService();
  sessionRepo = new CustomerSessionRepository(db);
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** A $20 OMT SEND with no fee or commission: the basket's net charge is
 *  exactly $20. */
function sendItem(amount = 20) {
  return {
    id: "cart-1",
    module: "omt",
    label: "OMT Send",
    amount,
    currency: "USD",
    formData: {
      provider: "OMT",
      serviceType: "SEND",
      amount,
      currency: "USD",
      commission: 0,
      omtFee: 0,
    },
    ipcChannel: "financial:create",
  };
}

/** The new claim fields, typed loosely so the file runs against the
 *  unchanged `CheckoutRequest` (red for the right reason). */
type WaiveRequest = CheckoutRequest & {
  waived_usd?: number;
  waived_lbp?: number;
};

function newSession(name = "Jean Dupont"): number {
  return sessionRepo.createSession({
    customer_name: name,
    started_by: "admin",
    user_id: 1,
  });
}

async function checkout(
  sessionId: number,
  o: Partial<WaiveRequest> = {},
): Promise<{ success: boolean; error?: string }> {
  const req: WaiveRequest = {
    sessionId,
    cartItems: [sendItem()],
    exchangeRate: RATE,
    userId: 1,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 17, direction: "IN" },
    ],
    waived_usd: 3,
    ...o,
  };
  return service.checkout(req, { username: "admin" });
}

function waivedRow(sessionId: number) {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, exchange_rate, metadata_json, status
         FROM transactions
        WHERE type = 'WAIVED_SHORTFALL' AND source_table = 'customer_sessions' AND source_id = ?`,
    )
    .get(sessionId) as
    | {
        id: number;
        amount_usd: number;
        amount_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        client_name: string | null;
        exchange_rate: number | null;
        metadata_json: string;
        status: string;
      }
    | undefined;
}

function grossProfit(): { usd: number; lbp: number } {
  resetProfitRepository();
  resetProfitService();
  const t = getProfitService().getSummary(FROM, TO).totals;
  return { usd: t.gross_profit_usd, lbp: t.gross_profit_lbp };
}

function debtTotals(): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger`,
    )
    .get() as { usd: number; lbp: number };
}

describe("session checkout — Waive (LIRA-310)", () => {
  it("books a WAIVED_SHORTFALL sibling: amount 0, profit −3, linked as waived_shortfall, session name stamped", async () => {
    const profitBefore = grossProfit();
    const sessionId = newSession();
    const result = await checkout(sessionId);
    expect(result).toMatchObject({ success: true });

    const row = waivedRow(sessionId);
    expect(row).toBeDefined();
    expect(row!.amount_usd).toBe(0);
    expect(row!.amount_lbp).toBe(0);
    expect(row!.profit_usd).toBeCloseTo(-3, 6);
    expect(row!.profit_lbp).toBe(0);
    expect(row!.client_name).toBe("Jean Dupont");
    expect(row!.exchange_rate).toBe(RATE);
    expect(JSON.parse(row!.metadata_json)).toMatchObject({
      session_id: sessionId,
      waived_usd: 3,
    });

    const link = db
      .prepare(
        `SELECT transaction_type, profit_usd FROM customer_session_transactions
          WHERE session_id = ? AND unified_transaction_id = ?`,
      )
      .get(sessionId, row!.id) as { transaction_type: string; profit_usd: number };
    expect(link.transaction_type).toBe("waived_shortfall");
    expect(link.profit_usd).toBeCloseTo(-3, 6);

    // The Profits page's total drops by exactly the waived amount.
    expect(grossProfit().usd - profitBefore.usd).toBeCloseTo(-3, 6);
  });

  it.each(["void", "refund"] as const)(
    "basket %s: drawers, debt_ledger and the Profits total net to 0 per currency",
    async (how) => {
      const drawersBefore = drawers(db);
      const debtBefore = debtTotals();
      const profitBefore = grossProfit();
      const sessionId = newSession();
      expect(await checkout(sessionId)).toMatchObject({ success: true });
      // Not vacuous: the waive really is in the books before the reversal.
      expect(waivedRow(sessionId)?.profit_usd).toBeCloseTo(-3, 6);
      expect(grossProfit().usd - profitBefore.usd).toBeCloseTo(-3, 6);

      const txnRepo = getTransactionRepository();
      if (how === "void") txnRepo.voidSessionBasket(sessionId, 1);
      else txnRepo.refundSessionBasket(sessionId, 1);

      const after = drawers(db);
      for (const k of new Set([
        ...Object.keys(drawersBefore),
        ...Object.keys(after),
      ])) {
        expect([k, after[k] ?? 0]).toEqual([k, drawersBefore[k] ?? 0]);
      }
      const debt = debtTotals();
      expect(debt.usd).toBeCloseTo(debtBefore.usd, 6);
      expect(debt.lbp).toBeCloseTo(debtBefore.lbp, 6);
      const profit = grossProfit();
      expect(profit.usd).toBeCloseTo(profitBefore.usd, 6);
      expect(profit.lbp).toBeCloseTo(profitBefore.lbp, 6);
    },
  );

  it("refuses $5.01 (over the $5 cap) and books nothing", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 14.99, direction: "IN" },
      ],
      waived_usd: 5.01,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/is more than/);
    expect(waivedRow(sessionId)).toBeUndefined();
  });

  it("refuses a waived claim that is not the real gap", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, { waived_usd: 2 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not match what is left to pay/);
  });

  it("refuses waived together with kept change", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, { kept_change_usd: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/can't be combined with change kept/);
  });

  it("the schema declares waived_usd / waived_lbp: kept, and a negative claim refused (rule 23)", () => {
    expect(
      sessionCheckoutSchema.safeParse({
        sessionId: 1,
        cartItems: [sendItem()],
        userId: 1,
        waived_usd: -1,
      }).success,
    ).toBe(false);
    const parsed = sessionCheckoutSchema.safeParse({
      sessionId: 1,
      cartItems: [sendItem()],
      userId: 1,
      waived_usd: 3,
      waived_lbp: 0,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      waived_usd: 3,
      waived_lbp: 0,
    });
  });

  it("no regression: an exact basket with no claim books no WAIVED_SHORTFALL row", async () => {
    addClient(db, 7, "Someone", "03111111");
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20, direction: "IN" },
      ],
      waived_usd: undefined,
    });
    expect(result).toMatchObject({ success: true });
    expect(waivedRow(sessionId)).toBeUndefined();
  });
});

describe("session checkout — Waive vs a single-item refund (LIRA-310, rule 20)", () => {
  function serviceItem() {
    return {
      id: "cart-cs",
      module: "custom_service",
      label: "Screen fix",
      amount: 20,
      currency: "USD",
      formData: { description: "Screen fix", price_usd: 20, cost_usd: 5 },
      ipcChannel: "custom-services:add",
    };
  }

  it("refuses refunding ONE item of a waived basket (it would hand back money never paid) — the whole basket must be refunded", async () => {
    const sessionId = newSession();
    expect(
      await checkout(sessionId, { cartItems: [serviceItem()] }),
    ).toMatchObject({ success: true });
    const member = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'CUSTOM_SERVICE' AND source_table = 'custom_services' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number };
    const drawersBefore = drawers(db);
    expect(() =>
      getTransactionRepository().refundSessionBasketItem({
        sessionId,
        transactionId: member.id,
        userId: 1,
      }),
    ).toThrow(/waived/i);
    expect(drawers(db)).toEqual(drawersBefore);
  });
});
