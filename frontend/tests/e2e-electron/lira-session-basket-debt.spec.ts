/**
 * E2E: A CUSTOMER_ACCOUNT basket creates exactly ONE debt entry.
 *
 * When a session basket is paid (wholly or partly) on the customer's account,
 * the basket recorder must create a SINGLE debt-ledger entry for the whole
 * on-account portion — not one per item. We verify the session client's debt
 * total rises by exactly the on-account amount (a per-item double-entry would
 * inflate it).
 *
 * The session is started with a name + phone, which auto-creates the client; the
 * basket recorder resolves that client for the debt entry.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const PHONE = "03999444";
const AMOUNT = 35;

type Client = { id: number; phone_number: string | null };

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
    clients: { getAll: (search?: string) => Promise<Client[]> };
    debt: { getClientTotal: (clientId: number) => Promise<number> };
  };
};

test.describe("Session checkout — one debt entry for CUSTOMER_ACCOUNT basket", () => {
  test("on-account custom service raises the client's debt by exactly the amount", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ phone, amount }) => {
        const w = window as unknown as Api;

        const started = await w.api.session.start({
          customer_name: "E2E Debt Customer",
          customer_phone: phone,
          started_by: "admin",
        });
        let sessionId = started.sessionId;
        if (!sessionId)
          sessionId = (await w.api.session.getActive()).session?.id;

        const clients = await w.api.clients.getAll("");
        const clientId = clients.find((c) => c.phone_number === phone)?.id;

        const debtBefore =
          clientId != null ? await w.api.debt.getClientTotal(clientId) : 0;

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "e2e-debt-svc",
              module: "custom_service",
              label: "E2E Debt Svc",
              amount,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: "E2E Debt Svc",
                cost_usd: 5,
                cost_lbp: 0,
                price_usd: amount,
                price_lbp: 0,
                paid_by: "CUSTOMER_ACCOUNT",
              },
            },
          ],
          paidByMethod: "CUSTOMER_ACCOUNT",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });

        const debtAfter =
          clientId != null ? await w.api.debt.getClientTotal(clientId) : 0;

        return {
          checkoutOk: checkout.success,
          checkoutError: checkout.error ?? null,
          clientFound: clientId != null,
          debtDelta: Math.round((debtAfter - debtBefore) * 100) / 100,
        };
      },
      { phone: PHONE, amount: AMOUNT },
    );

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.clientFound).toBe(true);
    // Exactly one debt entry of $AMOUNT (a per-item double-entry would be 2×).
    expect(result.debtDelta).toBeCloseTo(AMOUNT, 2);
  });
});

export type _BasketDebtSpecPage = Page;
