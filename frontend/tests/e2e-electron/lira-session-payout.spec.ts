/**
 * E2E: Session basket PAYOUTS — money the shop hands OUT must be recorded.
 *
 * Regression guard for the "cashout/payout lost in a session basket" bug. Two
 * payout flows that previously dropped (or risked double-counting) the General
 * drawer debit during a customer-session checkout:
 *
 *   (a) Binance RECEIVE — the shop receives crypto (USDT) into its Binance
 *       drawer and pays the customer cash out. The cash payout is NOT a
 *       customer-paid leg, so the basket recorder has no leg for it. The
 *       FinancialServiceRepository now self-posts it even in deferred (session)
 *       mode: General/USD is debited by (amount − commission). Before the fix
 *       this leg was skipped and the payout was lost (delta 0).
 *
 *   (b) Loto cash prize — the loto item DEFERS its own General −prize payout in
 *       session mode (to avoid a double-count). Instead the Session Checkout
 *       emits ONE net cash-OUT leg for the negative basket total, and the basket
 *       recorder posts General −prize exactly once.
 *
 * Driven through real main-process IPC (window.api.session.checkout).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

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
        itemCount?: number;
        error?: string;
      }>;
    };
    dashboard: { getDrawerBalances: () => Promise<unknown> };
  };
};

test.describe("Session basket payouts — money handed out is recorded", () => {
  test("Binance RECEIVE in a session debits General by the payout (un-deferred)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // dashboard.getDrawerBalances() → { generalDrawer: { usd, lbp }, omtDrawer: {...} }
      const generalUsd = (raw: unknown): number =>
        (raw as { generalDrawer?: { usd?: number } })?.generalDrawer?.usd ?? 0;

      // Start (or reuse) a customer session.
      const started = await w.api.session.start({
        customer_name: "E2E Payout Customer",
        customer_phone: "03999222",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      const beforeGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );

      // Binance RECEIVE: $100 USDT in, $2 fee → shop pays customer $98 cash out.
      // It is a NEGATIVE-amount cart item (money leaves the basket) and carries
      // NO customer-paid leg, so payments is empty. The repo self-posts the
      // General/USD −$98 payout even in deferred (session) mode.
      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [
          {
            id: "e2e-binance-receive",
            module: "binance_receive",
            label: "Binance RECEIVE $100",
            amount: -98,
            currency: "USDT",
            ipcChannel: "financial:create",
            formData: {
              provider: "BINANCE",
              serviceType: "RECEIVE",
              amount: 100,
              currency: "USDT",
              commission: 2,
              cashoutMethod: "CASH",
            },
          },
        ],
        paidByMethod: "CASH",
        payments: [],
        exchangeRate: 90000,
        userId: 1,
      });

      const afterGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        generalDelta: Math.round((afterGeneral - beforeGeneral) * 100) / 100,
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);

    // Payout RECORDED: General/USD fell by exactly the cash paid out
    // (payout = amount − commission = 100 − 2 = 98). Before the fix this was 0.
    expect(result.generalDelta).toBeCloseTo(-98, 2);
  });

  test("Loto cash prize payout posts to General once via the basket OUT leg", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // dashboard.getDrawerBalances() → { generalDrawer: { usd, lbp }, omtDrawer: {...} }
      const generalLbp = (raw: unknown): number =>
        (raw as { generalDrawer?: { lbp?: number } })?.generalDrawer?.lbp ?? 0;

      // Start (or reuse) a customer session.
      const started = await w.api.session.start({
        customer_name: "E2E Loto Prize Customer",
        customer_phone: "03999333",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      const beforeGeneral = generalLbp(
        await w.api.dashboard.getDrawerBalances(),
      );

      // Loto cash prize of 1,000,000 LBP. The loto item DEFERS its own General
      // −prize payout in session mode; the basket OUT leg below is what posts it
      // (General −1,000,000 exactly once — no double-count).
      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [
          {
            id: "e2e-loto-prize",
            module: "loto_prize",
            label: "Loto cash prize 1,000,000 LBP",
            amount: -1000000,
            currency: "LBP",
            ipcChannel: "loto:cash-prize:create",
            formData: {
              prize_amount: 1000000,
              prize_date: "2026-06-19",
            },
          },
        ],
        paidByMethod: "CASH",
        payments: [
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 1000000,
            direction: "OUT",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      const afterGeneral = generalLbp(
        await w.api.dashboard.getDrawerBalances(),
      );

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        generalDelta: Math.round(afterGeneral - beforeGeneral),
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);

    // Posted ONCE: General/LBP fell by exactly the prize. A double-post (loto
    // item self-posting AND the basket leg) would show −2,000,000.
    expect(result.generalDelta).toBe(-1000000);
  });
});

export type _PayoutSpecPage = Page;
