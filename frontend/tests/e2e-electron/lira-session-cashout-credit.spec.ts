/**
 * Session cash-out settled to CUSTOMER_ACCOUNT books a real store credit that
 * reduces the customer's balance and shows on the Debts Payments side.
 *
 * Owner-decided (2026-07-06): when a customer-session basket is paid on
 * account, a cash-out (Binance/OMT/Whish RECEIVE) is the customer settling
 * what they owe — it must book a CREDIT (session-linked) on their account,
 * not be handed over as cash. Before, v1.29.0 netted the payout into a cash
 * payout, so it never appeared as a payment.
 *
 * This drives the real checkout IPC with the legs the on-account
 * SessionCheckoutModal now emits — a CUSTOMER_ACCOUNT IN leg for the charge
 * and a CUSTOMER_ACCOUNT OUT leg for the cash-out payout — then verifies:
 *   1. balance: the charge is a debt, the payout is a credit (session-linked);
 *   2. Debts UI: the Payments table shows a Credit Deposit row whose eye button
 *      opens the basket's PAYOUTS (the −$40 cash-out).
 *
 * Rule 17: proven to FAIL pre-fix (the credit carried no session_id, so no
 * eye button rendered on the Payments row).
 */

import { test, expect, navigateTo } from "./fixtures";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    session: {
      start: (d: {
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
    debt: {
      getDebtors: () => Promise<
        Array<{
          client_id?: number;
          id?: number;
          full_name?: string;
          client_name?: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
      getClientBalance: (id: number) => Promise<{
        success?: boolean;
        data?: { balance_usd: number; balance_lbp: number };
      }>;
    };
  };
};

test.describe("Session cash-out → account credit (Debts Payments side)", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("on-account Binance cash-out books a session credit shown on the Payments side", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L-CACredit ${ts}`;
    const PHONE = `70${String(ts).slice(-6)}`;
    const LBP_CHARGE = 500_000;
    const PAYOUT = 40;

    await closeAllActiveSessions(appPage);

    const setup = await appPage.evaluate(
      async ({ name, phone, lbpCharge, payout }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        const sessionId =
          started.sessionId ?? (await w.api.session.getActive()).session?.id;
        if (!sessionId) return { ok: false, error: "no session", id: 0 };

        // Legs the on-account SessionCheckoutModal now emits: the charge as a
        // CUSTOMER_ACCOUNT IN leg, and the cash-out payout as a CUSTOMER_ACCOUNT
        // OUT leg (→ ONE session credit) instead of a CASH OUT payout.
        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "e2e-cac-charge",
              module: "custom_service",
              label: "E2E On-Account Charge",
              amount: lbpCharge,
              currency: "LBP",
              ipcChannel: "custom-services:add",
              formData: {
                description: "E2E On-Account Charge",
                cost_usd: 0,
                cost_lbp: 0,
                price_usd: 0,
                price_lbp: lbpCharge,
                paid_by: "CUSTOMER_ACCOUNT",
              },
            },
            {
              id: "e2e-cac-binance",
              module: "binance_receive",
              label: "Binance RECEIVE $40",
              amount: -payout,
              currency: "USD",
              ipcChannel: "financial:create",
              formData: {
                provider: "BINANCE",
                serviceType: "RECEIVE",
                amount: payout,
                currency: "USDT",
                commission: 0,
                cashoutMethod: "CUSTOMER_ACCOUNT",
              },
            },
          ],
          paidByMethod: "CUSTOMER_ACCOUNT",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: lbpCharge,
              direction: "IN",
            },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: payout,
              direction: "OUT",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });
        if (!checkout.success) {
          return { ok: false, error: checkout.error ?? "checkout", id: 0 };
        }

        const row = (await w.api.debt.getDebtors()).find(
          (r) => (r.full_name ?? r.client_name) === name,
        );
        const id = row?.client_id ?? row?.id ?? 0;
        const bal = (await w.api.debt.getClientBalance(id)).data ?? null;
        return { ok: true, error: null as string | null, id, bal };
      },
      { name: CLIENT, phone: PHONE, lbpCharge: LBP_CHARGE, payout: PAYOUT },
    );

    expect(setup.error).toBeNull();
    expect(setup.ok).toBe(true);

    // Balance: the LBP charge is a debt; the cash-out is a USD CREDIT (negative).
    expect(setup.bal?.balance_lbp).toBeCloseTo(LBP_CHARGE, 0);
    expect(setup.bal?.balance_usd).toBeCloseTo(-PAYOUT, 2);

    // ── Debts UI: Payments side shows the credit with a basket eye button ──
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    await appPage.getByPlaceholder("Search client...").fill(CLIENT);
    await appPage.locator("button").filter({ hasText: CLIENT }).first().click();

    // The payments-side "Credit Deposit" row carries an eye button (its credit
    // is session-linked). Pre-fix the credit had no session_id → no eye button.
    await expect(appPage.getByText("Credit Deposit").first()).toBeVisible({
      timeout: 10_000,
    });
    const eyeButtons = appPage.getByTitle("View Basket Items");
    // Two now: the purchases-side Session Debt eye and the payments-side credit eye.
    await expect(eyeButtons).toHaveCount(2, { timeout: 10_000 });

    // Payments-side eye (last in DOM: right table) → PAYOUTS modal shows the
    // −$40 cash-out and NOT the LBP charge (that's a purchase, not a payout).
    await eyeButtons.last().click();
    await expect(appPage.getByText(/Session #\d+ Basket/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText("-$40.00")).toBeVisible({ timeout: 5_000 });
    await expect(appPage.getByText("+500,000 LBP")).toHaveCount(0);

    // Close (click the overlay outside the centered card), then open the
    // Purchases-side eye (first in DOM: left table) → CHARGES modal shows the
    // LBP charge and NOT the −$40 cash-out (it moved to the payments side).
    await appPage.mouse.click(8, 8);
    await expect(appPage.getByText(/Session #\d+ Basket/)).toHaveCount(0, {
      timeout: 5_000,
    });
    await eyeButtons.first().click();
    await expect(appPage.getByText(/Session #\d+ Basket/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText("+500,000 LBP")).toBeVisible({
      timeout: 5_000,
    });
    await expect(appPage.getByText("-$40.00")).toHaveCount(0);
  });
});
