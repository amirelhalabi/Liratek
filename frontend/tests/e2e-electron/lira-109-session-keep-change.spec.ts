/**
 * E2E: LIRA-109 (T3, KC-4) — keep-change on a session-basket checkout.
 *
 * Owner decision (2026-07-13): the simplest sound design — a STANDALONE
 * profit-only KEPT_CHANGE transaction row (amount 0: the tender is already
 * booked by the basket's payment legs), session-linked via
 * session_transactions, NOT attached to any item. Non-reversible (voiding a
 * profit-only row would desync profit from money that physically stayed in
 * the drawer). Aggregated by the "Other / kept change" profits bucket
 * alongside debt repayments.
 *
 * Rule 17: with the pre-KC-4 core dist the checkout service creates no such
 * row — the bucket delta asserts 0 instead of the kept amount (proof run
 * recorded in the plan). Rule 15: identity + delta assertions only.
 */

import { test, expect } from "./fixtures";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Api = {
  api: {
    session: {
      start: (d: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } }>;
      checkout: (d: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    profits: {
      summary: (
        f: string,
        t: string,
      ) => Promise<{
        debt_repayments?: { profit_usd: number; profit_lbp: number };
      }>;
    };
    transactions: {
      getRecent: (n: number) => Promise<
        Array<{ id: number; type: string; summary: string | null }>
      >;
      getById: (
        id: number,
      ) => Promise<{ id: number; profit_usd: number; profit_lbp: number }>;
      refund: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

test.describe("LIRA-109 — session-basket keep change", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("checkout with kept change books a standalone non-voidable KEPT_CHANGE profit row", async ({
    appPage,
  }) => {
    const ts = Date.now();
    await closeAllActiveSessions(appPage);

    const result = await appPage.evaluate(
      async ({ FROM, TO, ts }) => {
        const w = window as unknown as Api;
        const bucket = async () =>
          (await w.api.profits.summary(FROM, TO)).debt_repayments ?? {
            profit_usd: 0,
            profit_lbp: 0,
          };

        const before = await bucket();

        const started = await w.api.session.start({
          customer_name: `L109 Keep ${ts}`,
          customer_phone: `76${String(ts).slice(-6)}`,
          started_by: "admin",
        });
        const sessionId =
          started.sessionId ?? (await w.api.session.getActive()).session?.id;

        // One custom-service item ($40, cost $10) paid $47 CASH; keep $7.
        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "l109-svc",
              module: "custom_service",
              label: "L109 Svc",
              amount: 40,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: `L109 Svc ${ts}`,
                cost_usd: 10,
                cost_lbp: 0,
                price_usd: 40,
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
              amount: 47,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          kept_change_usd: 7,
          kept_change_lbp: 0,
          userId: 1,
        });
        if (!checkout.success) {
          return { ok: false, error: checkout.error ?? "checkout failed" };
        }

        const after = await bucket();

        // Identity: the standalone KEPT_CHANGE row with our amount.
        const row = (await w.api.transactions.getRecent(50)).find(
          (t) => t.type === "KEPT_CHANGE" && (t.summary ?? "").includes("$7"),
        );
        const full = row ? await w.api.transactions.getById(row.id) : null;

        // Non-reversible: the generic refund must refuse it.
        const refund = row
          ? await w.api.transactions.refund(row.id)
          : { success: true, error: null };

        return {
          ok: true,
          error: null as string | null,
          bucketDeltaUsd: after.profit_usd - before.profit_usd,
          rowFound: !!row,
          rowProfitUsd: full?.profit_usd ?? null,
          refundBlocked: refund.success === false,
        };
      },
      { FROM, TO, ts },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Pre-fix: no row is created and the bucket delta is 0.
    expect(result.bucketDeltaUsd).toBeCloseTo(7, 2);
    expect(result.rowFound).toBe(true);
    expect(result.rowProfitUsd).toBeCloseTo(7, 2);
    expect(result.refundBlocked).toBe(true);
  });
});
