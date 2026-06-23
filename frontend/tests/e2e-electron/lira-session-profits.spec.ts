/**
 * E2E: Transaction-based profit counts a session item's profit.
 *
 * Profit is now sourced from transactions.profit_usd (kept in sync with the
 * source tables). A custom service sold for $40 with $10 cost contributes $30
 * profit, which must appear in profits.getSummary for the period — even when the
 * service was created through a customer-session basket checkout (deferred
 * payment) rather than a direct sale.
 *
 * Asserts a DELTA (before/after the checkout) so it's robust against the shared
 * e2e database accumulating other test data.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const PRICE = 40;
const COST = 10;
const PROFIT = PRICE - COST; // 30

type Summary = { custom_services?: { profit_usd?: number } };

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
    profits: { summary: (from: string, to: string) => Promise<Summary> };
  };
};

test.describe("Session checkout — profit counted (transaction-based)", () => {
  test("a $30-profit custom service raises the period's custom-service profit by $30", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ price, cost }) => {
        const w = window as unknown as Api;
        const today = new Date().toISOString().slice(0, 10);
        const customProfit = (s: Summary) => s.custom_services?.profit_usd ?? 0;

        const before = customProfit(await w.api.profits.summary(today, today));

        const started = await w.api.session.start({
          customer_name: "E2E Profit Customer",
          customer_phone: "03999333",
          started_by: "admin",
        });
        let sessionId = started.sessionId;
        if (!sessionId)
          sessionId = (await w.api.session.getActive()).session?.id;

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "e2e-profit-svc",
              module: "custom_service",
              label: "E2E Profit Svc",
              amount: price,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: "E2E Profit Svc",
                cost_usd: cost,
                cost_lbp: 0,
                price_usd: price,
                price_lbp: 0,
                paid_by: "CASH",
              },
            },
          ],
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: price,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });

        const after = customProfit(await w.api.profits.summary(today, today));

        return {
          checkoutOk: checkout.success,
          checkoutError: checkout.error ?? null,
          delta: Math.round((after - before) * 100) / 100,
        };
      },
      { price: PRICE, cost: COST },
    );

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.delta).toBeCloseTo(PROFIT, 2);
  });
});

export type _ProfitsSpecPage = Page;
