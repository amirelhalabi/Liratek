/**
 * E2E: Operator-edited exchange rate is recorded on session transactions.
 *
 * The Session Checkout modal exposes an editable USD→LBP rate. That rate must be
 * stamped on the transactions created by the basket (transactions.exchange_rate),
 * so the viewer shows "@ <rate>" matching what the operator actually used.
 *
 * Uses one OMT (base-system) financial SEND — financial transactions thread the
 * operator rate through createTransaction({ exchange_rate }).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RATE = 91234; // a distinct, non-default value

type TxnRow = {
  type: string;
  session_id: number | null;
  exchange_rate: number | null;
};

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number }>;
      getActive: () => Promise<{ success: boolean; session?: { id: number } }>;
      checkout: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    transactions: {
      getRecent: (limit?: number, filters?: unknown) => Promise<TxnRow[]>;
    };
  };
};

test.describe("Session checkout — operator exchange rate stamped", () => {
  test("edited rate is recorded on the session's transaction", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async (rate) => {
      const w = window as unknown as Api;

      const started = await w.api.session.start({
        customer_name: "E2E Rate Customer",
        customer_phone: "03999222",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) sessionId = (await w.api.session.getActive()).session?.id;

      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [
          {
            id: "e2e-omt-rate",
            module: "omt_system",
            label: "OMT SEND",
            amount: 52,
            currency: "USD",
            ipcChannel: "financial:create",
            formData: {
              provider: "OMT",
              serviceType: "SEND",
              amount: 50,
              currency: "USD",
              commission: 0,
              omtServiceType: "INTRA",
              omtFee: 2,
            },
          },
        ],
        paidByMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 52, direction: "IN" },
        ],
        exchangeRate: rate,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const rows = recent.filter((t) => t.session_id === sessionId);

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        rates: rows.map((r) => r.exchange_rate),
      };
    }, RATE);

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.rates.length).toBeGreaterThan(0);
    for (const r of result.rates) {
      expect(Math.round(r ?? 0)).toBe(RATE);
    }
  });

  // Non-financial paths now thread the operator rate too (previously NULL):
  // custom-service / loto. One item each, asserted the same way.

  test("edited rate is recorded on a custom-service session transaction", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async (rate) => {
      const w = window as unknown as Api;
      const started = await w.api.session.start({
        customer_name: "E2E Rate CS",
        customer_phone: "03999223",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) sessionId = (await w.api.session.getActive()).session?.id;

      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [
          {
            id: "e2e-cs-rate",
            module: "custom_service",
            label: "E2E CS Rate",
            amount: 25,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: {
              description: "E2E CS Rate",
              cost_usd: 0,
              cost_lbp: 0,
              price_usd: 25,
              price_lbp: 0,
              paid_by: "CASH",
            },
          },
        ],
        paidByMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 25, direction: "IN" },
        ],
        exchangeRate: rate,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const rows = recent.filter((t) => t.session_id === sessionId);
      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        rates: rows.map((r) => r.exchange_rate),
      };
    }, RATE);

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.rates.length).toBeGreaterThan(0);
    for (const r of result.rates) {
      expect(Math.round(r ?? 0)).toBe(RATE);
    }
  });

  test("edited rate is recorded on a loto-ticket session transaction", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async (rate) => {
      const w = window as unknown as Api;
      const started = await w.api.session.start({
        customer_name: "E2E Rate Loto",
        customer_phone: "03999224",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) sessionId = (await w.api.session.getActive()).session?.id;

      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [
          {
            id: "e2e-loto-rate",
            module: "loto_ticket",
            label: "E2E Loto Rate",
            amount: 100000,
            currency: "LBP",
            ipcChannel: "loto:sell",
            formData: {
              sale_amount: 100000,
              sale_date: "2026-06-19",
              payment_method: "CASH",
              currency: "LBP",
            },
          },
        ],
        paidByMethod: "CASH",
        payments: [
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 100000,
            direction: "IN",
          },
        ],
        exchangeRate: rate,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const rows = recent.filter((t) => t.session_id === sessionId);
      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        rates: rows.map((r) => r.exchange_rate),
      };
    }, RATE);

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.rates.length).toBeGreaterThan(0);
    for (const r of result.rates) {
      expect(Math.round(r ?? 0)).toBe(RATE);
    }
  });
});

export type _ExchangeRateSpecPage = Page;
