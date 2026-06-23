/**
 * E2E: Session basket payment — ONE payment for the whole cart, posted once.
 *
 * A customer session is a single basket the customer pays for once. Each cart
 * item is created in deferPayment mode (no customer-cash leg of its own); the
 * Session Checkout records ONE basket payment, posted to the drawer exactly once
 * and attached to every same-session transaction row.
 *
 * Uses two custom-service items (clean cash-in, no provider drawer mechanics) so
 * the "posted once / no double-count" invariant is unambiguous: two $30+$20
 * services paid with a single $50 CASH leg must raise the General/USD drawer by
 * exactly $50 (not $100), and both transaction rows must share that one payment.
 *
 * Driven through real main-process IPC (window.api.session.checkout).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type TxnRow = {
  id: number;
  type: string;
  session_id: number | null;
  payments?: Array<{
    direction: "in" | "out";
    amount: number;
    currency_code: string;
  }>;
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
        itemCount?: number;
        error?: string;
      }>;
    };
    dashboard: { getDrawerBalances: () => Promise<unknown> };
    transactions: {
      getRecent: (limit?: number, filters?: unknown) => Promise<TxnRow[]>;
    };
  };
};

test.describe("Session basket payment — one payment, posted once", () => {
  test("two custom-service items, single $50 CASH leg → General +$50, shared across rows", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // dashboard.getDrawerBalances() → { generalDrawer: { usd, lbp }, omtDrawer: {...} }
      const generalUsd = (raw: unknown): number =>
        (raw as { generalDrawer?: { usd?: number } })?.generalDrawer?.usd ?? 0;

      // Start (or reuse) a customer session.
      const started = await w.api.session.start({
        customer_name: "E2E Basket Customer",
        customer_phone: "03999111",
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

      const mkService = (label: string, price: number) => ({
        id: `e2e-${label}`,
        module: "custom_service",
        label,
        amount: price,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: label,
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: price,
          price_lbp: 0,
          paid_by: "CASH",
        },
      });

      const checkout = await w.api.session.checkout({
        sessionId,
        cartItems: [mkService("E2E Svc A", 30), mkService("E2E Svc B", 20)],
        paidByMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 50, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      const afterGeneral = generalUsd(
        await w.api.dashboard.getDrawerBalances(),
      );

      // Inspect the session's transaction rows + their (shared) basket legs.
      const recent = await w.api.transactions.getRecent(50);
      const sessionRows = recent.filter((t) => t.session_id === sessionId);
      const inTotals = sessionRows.map((t) =>
        (t.payments ?? [])
          .filter((p) => p.direction === "in")
          .reduce((s, p) => s + p.amount, 0),
      );

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        generalDelta: Math.round((afterGeneral - beforeGeneral) * 100) / 100,
        sessionRowCount: sessionRows.length,
        inTotals,
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);

    // Posted ONCE: the single $50 basket payment raised General by exactly $50
    // (a per-item double-post would show $100).
    expect(result.generalDelta).toBeCloseTo(50, 2);

    // Both items became their own session transaction…
    expect(result.sessionRowCount).toBe(2);
    // …and every session row carries the SAME basket payment (in: $50).
    for (const total of result.inTotals) {
      expect(total).toBeCloseTo(50, 2);
    }
  });
});

export type _BasketPaymentSpecPage = Page;
