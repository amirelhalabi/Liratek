/**
 * Session Debt detail modal (eye icon) — signed amounts + payout visibility.
 *
 * Owner-reported (2026-07-05): in the SessionDebtDetailModal the amounts had no
 * +/- signs, and a Binance cash-out (RECEIVE, a negative payout) showed NO
 * amount at all. Root cause: a real checked-out session clears its cart
 * (SessionContext.cartClear), so the modal falls to its TRANSACTIONS path,
 * which rendered amounts only when `amount_* > 0` (hiding the negative payout)
 * and never printed a sign. The session basket view (SessionFloatingWindow)
 * shows signed, customer-perspective amounts; the modal must match.
 *
 * This drives the real Debts-page UI. It checks out a MIXED basket WITHOUT
 * cartAdd (so session_cart_items stays empty → the modal uses the transactions
 * path, exactly like a real closed session): an LBP charge on CUSTOMER_ACCOUNT
 * (creates the one Session Debt row + the eye icon) and a Binance RECEIVE
 * payout (the negative USD transaction). Then it opens the modal and asserts
 * the payout renders as "-$40.00" and the charge as a signed "+…".
 *
 * Rule 17: proven to FAIL pre-fix (the "-$40.00" text is absent — the payout
 * row rendered with no amount).
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
  };
};

test.describe("Session Debt modal — signed amounts + payout visibility", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("payout (Binance RECEIVE) shows -$ and charges show a sign in the modal", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L-Signs Customer ${ts}`;
    const PHONE = `70${String(ts).slice(-6)}`;
    const LBP_CHARGE = 500_000;
    const BINANCE_PAYOUT = 40; // shop pays customer $40 (session txn amount_usd = -40)

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
        if (!sessionId) return { ok: false, error: "no session" };

        // Mixed basket, checked out WITHOUT cartAdd → session_cart_items stays
        // empty → the modal reads the transactions path (real closed-session).
        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "e2e-signs-charge",
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
              id: "e2e-signs-binance",
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
                cashoutMethod: "CASH",
              },
            },
          ],
          paidByMethod: "SPLIT",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: lbpCharge,
              direction: "IN",
            },
            {
              method: "CASH",
              currency_code: "USD",
              amount: payout,
              direction: "OUT",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });

        return {
          ok: checkout.success,
          error: checkout.error ?? null,
          sessionId,
        };
      },
      { name: CLIENT, phone: PHONE, lbpCharge: LBP_CHARGE, payout: BINANCE_PAYOUT },
    );

    expect(setup.error).toBeNull();
    expect(setup.ok).toBe(true);

    // ── Drive the real Debts page UI ──────────────────────────────────────
    // Bounce through "/" for a fresh Debts mount — an earlier spec in the same
    // worker can leave a detail modal open, whose overlay would block clicks.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    const search = appPage.getByPlaceholder("Search client...");
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(CLIENT);
    await appPage
      .locator("button")
      .filter({ hasText: CLIENT })
      .first()
      .click();

    await expect(
      appPage.getByText("Session Debt", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    const eyeButton = appPage.getByTitle("View Basket Items");
    await expect(eyeButton).toBeVisible({ timeout: 10_000 });
    await eyeButton.click();

    // Modal is open (transactions path — cart was never persisted).
    await expect(appPage.getByText(/Session #\d+ Basket/)).toBeVisible({
      timeout: 10_000,
    });

    // The Binance payout renders as a NEGATIVE dollar amount — pre-fix this was
    // absent entirely (the `amount_usd > 0` guard hid the negative payout).
    await expect(appPage.getByText("-$40.00")).toBeVisible({ timeout: 5_000 });

    // The LBP charge renders WITH a sign — pre-fix it was unsigned "500,000 LBP".
    await expect(appPage.getByText("+500,000 LBP")).toBeVisible({
      timeout: 5_000,
    });
  });
});
