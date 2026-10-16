/**
 * LIRA-329 T037 — the rows a customer-session checkout writes for the WHOLE
 * basket (the extra, the kept change, the waived gap) say which session
 * they belong to, what they are, and how the customer paid AS THE CHECKOUT
 * WINDOW SENT IT (`paidByMethod`: suspected bug #5 — the server used to
 * drop it; the money still goes by the payment lines, unchanged). They keep
 * the session customer's name AND phone.
 *
 * Also: a non-Mobile-Recharge basket item (here a Custom Service) records
 * the session that paid for it (`paid_in_session`), the same way Phase 4
 * did for Mobile Recharge.
 *
 * Money: each row's amount/profit is asserted at today's values first
 * (FR-008). Expected details go through the kind's own schema (rule 24).
 * Rule 17: run before the change and seen failing.
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
import { sessionSiblingDetailsSchema } from "../../validators/transactionDetails";

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

interface Row {
  amount_usd: number;
  profit_usd: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function serviceItem(priceUsd: number): CheckoutCartItem {
  return {
    id: "cs1",
    module: "custom_service",
    label: "Service: screen glass",
    amount: priceUsd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "screen glass",
      cost_usd: 5,
      price_usd: priceUsd,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

describe("LIRA-329 — session checkout siblings and items keep their details", () => {
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

  function row(type: string): Row {
    return db
      .prepare(
        `SELECT amount_usd, profit_usd, client_name, client_phone, metadata_json
           FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(type) as Row;
  }

  function meta(r: Row): Record<string, unknown> {
    return JSON.parse(r.metadata_json) as Record<string, unknown>;
  }

  function expectSibling(r: Row, expected: Record<string, unknown>): void {
    expect(sessionSiblingDetailsSchema.parse(expected)).toEqual(expected);
    expect(meta(r).details).toEqual(expected);
  }

  function session(): number {
    return getCustomerSessionRepository().createSession({
      customer_name: "Rana Aziz",
      customer_phone: "71222333",
      started_by: "admin",
      user_id: 1,
    });
  }

  it("the extra and the kept change: session, role, the method as sent, the customer's name and phone; the item records its session", async () => {
    const sessionId = session();
    const result = await getSessionCheckoutService().checkout(
      {
        sessionId,
        cartItems: [serviceItem(20)],
        // What the checkout window sends: its primary method. The money
        // goes by the lines below.
        paidByMethod: "WHISH",
        payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
        exchangeRate: 89_500,
        extra_usd: 2,
        kept_change_usd: 3,
        userId: 1,
      },
      { username: "admin" },
    );
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const extra = row("EXTRA_CHARGE");
    const kept = row("KEPT_CHANGE");
    const item = row("CUSTOM_SERVICE");
    // FR-008 — today's money.
    expect(extra.amount_usd).toBe(2);
    expect(extra.profit_usd).toBe(0);
    expect(kept.amount_usd).toBe(0);
    expect(kept.profit_usd).toBe(3);
    expect(item.amount_usd).toBe(20);

    for (const r of [extra, kept]) {
      expect(r.client_name).toBe("Rana Aziz");
      expect(r.client_phone).toBe("71222333");
    }
    expectSibling(extra, {
      v: 1,
      kind: "session_sibling",
      sessionId,
      role: "EXTRA",
      paidByMethod: "WHISH",
    });
    expectSibling(kept, {
      v: 1,
      kind: "session_sibling",
      sessionId,
      role: "KEPT_CHANGE",
      paidByMethod: "WHISH",
    });
    // The basket owns the money: the rows record the session, and the kept
    // row the change the customer left.
    expect(meta(extra).payment_snapshot).toEqual({
      lines: [],
      session_id: sessionId,
    });
    expect(meta(kept).payment_snapshot).toEqual({
      lines: [],
      kept: { usd: 3 },
      session_id: sessionId,
    });

    expect(meta(item).details).toMatchObject({
      kind: "custom_service",
      paid_in_session: sessionId,
    });
    expect(meta(item).payment_snapshot).toEqual({
      lines: [],
      session_id: sessionId,
    });
  });

  it("the waived gap: session, role and the method as sent, the customer's name and phone", async () => {
    // The hard case for the phone: a client already holds it under another
    // name, so the session links to that client and the row's resolver
    // (which copies a phone only under the client's own name) cannot
    // supply it — only the session can.
    db.prepare(
      `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'R. Aziz (old)', '71222333')`,
    ).run();
    const sessionId = session();
    const result = await getSessionCheckoutService().checkout(
      {
        sessionId,
        cartItems: [serviceItem(20)],
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currency_code: "USD", amount: 18 }],
        exchangeRate: 89_500,
        waived_usd: 2,
        userId: 1,
      },
      { username: "admin" },
    );
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const waived = row("WAIVED_SHORTFALL");
    // FR-008 — today's money.
    expect(waived.amount_usd).toBe(0);
    expect(waived.profit_usd).toBe(-2);
    expect(waived.client_name).toBe("Rana Aziz");
    expect(waived.client_phone).toBe("71222333");
    expectSibling(waived, {
      v: 1,
      kind: "session_sibling",
      sessionId,
      role: "WAIVED",
      paidByMethod: "CASH",
    });
  });
});
