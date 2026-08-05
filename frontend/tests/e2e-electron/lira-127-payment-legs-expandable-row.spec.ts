/**
 * E2E: LIRA-067 — Transaction Payment Detail: Expandable Row
 *
 * Owner report (2026-07-28): a split payment (e.g. cash + Whish App, same
 * currency) doesn't show how much went to each method — the compact Summary
 * cell's "in: $50" merges same-currency legs together by design
 * (formatPaymentLegs, cashFlow.ts), so the customer-facing detail is lost.
 *
 * This proves the NEW expandable row (TransactionsViewer.tsx): clicking the
 * "▸ payment detail" toggle on a row with structured legs reveals each leg
 * on its own line (method + direction + amount, own currency preserved),
 * and clicking again collapses it. Reuses the LIRA-064 structured `payments`
 * field already on the row — no new backend wiring.
 *
 * Row identity (CLAUDE.md rule 15): the session carries a unique
 * Date.now()-seeded customer_name marker, located via the /audit search box
 * — never row position. The transaction id (fetched via IPC right after
 * checkout) is used to target the exact toggle/detail elements by their
 * `data-testid`, which are keyed by row id.
 *
 * Failing-first procedure (rule 17, for the verifier): this spec cannot pass
 * without TransactionsViewer.tsx's `expandedLegRows`/`buildLegDetailTr`
 * addition — stash that file back to its pre-LIRA-067 state and re-run; the
 * toggle button locator never becomes visible (times out), so this test
 * fails. Restore the fix and confirm it passes again.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number }>;
      getActive: () => Promise<{ success: boolean; session?: { id: number } }>;
      checkout: (data: {
        sessionId: number;
        cartItems: Array<{
          id: string;
          module: string;
          label: string;
          amount: number;
          currency: string;
          formData: Record<string, unknown>;
          ipcChannel: string;
        }>;
        paidByMethod?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
        exchangeRate?: number;
        userId: number;
      }) => Promise<{ success: boolean; itemCount?: number; error?: string }>;
      close: (
        sessionId: number,
        closedBy: string,
      ) => Promise<{ success: boolean }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: unknown,
      ) => Promise<Array<{ id: number; session_id: number | null }>>;
    };
  };
};

test.describe("LIRA-067 — payment-leg detail expandable row", () => {
  test("split payment (cash + Whish App, same currency) shows both legs separately when expanded, collapses back", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const marker = `LIRA067 SPLIT ${ts}`;

    const setup = await appPage.evaluate(async (customerName) => {
      const w = window as unknown as Api;

      const started = await w.api.session.start({
        customer_name: customerName,
        started_by: "e2e",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      // The session's own customer_name does NOT propagate onto a
      // custom_service basket item's client_name (that only happens for
      // flows explicitly wired per CLAUDE.md rule 11) — the description
      // DOES land in the transaction's `summary`, which the /audit search
      // also matches (TransactionRepository: summary LIKE / client_name LIKE
      // / username LIKE), so the marker travels through the description.
      const item = {
        id: "e2e-067-split",
        module: "custom_service",
        label: customerName,
        amount: 50,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: customerName,
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 50,
          price_lbp: 0,
          paid_by: "CASH",
        },
      };

      const checkout = await w.api.session.checkout({
        sessionId: sessionId as number,
        cartItems: [item],
        paidByMethod: "CASH",
        // Same-currency split across two DISTINCT methods — the exact
        // scenario the compact Summary line merges into one "in: $50".
        payments: [
          { method: "CASH", currency_code: "USD", amount: 30, direction: "IN" },
          {
            method: "WHISH",
            currency_code: "USD",
            amount: 20,
            direction: "IN",
          },
        ],
        exchangeRate: 90_000,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const row = recent.find((t) => t.session_id === sessionId);

      // Never leave a session open for later specs (README hazard).
      await w.api.session.close(sessionId as number, "e2e");

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        txnId: row?.id ?? null,
      };
    }, marker);

    expect(setup.checkoutError).toBeNull();
    expect(setup.checkoutOk).toBe(true);
    expect(setup.txnId).not.toBeNull();
    const txnId = setup.txnId as number;

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const searchInput = appPage.getByPlaceholder(
      /Search summary, client, user/i,
    );
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
    await searchInput.fill(marker);
    await searchInput.press("Enter");

    const row = appPage.locator("tr", { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Compact Summary line still shows the merged total (unchanged behavior —
    // formatPaymentLegs intentionally sums same-currency legs for the
    // one-line preview).
    await expect(row.locator('[data-testid="payment-legs"]')).toContainText(
      "in: $50",
    );

    // Detail row starts collapsed — not in the DOM at all.
    const detailRow = appPage.locator(
      `[data-testid="payment-legs-detail-${txnId}"]`,
    );
    await expect(detailRow).toHaveCount(0);

    // Expand — both legs appear on their own line, own method + amount.
    const toggle = row.locator(`[data-testid="toggle-legs-${txnId}"]`);
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await toggle.click();

    await expect(detailRow).toBeVisible({ timeout: 5_000 });
    await expect(detailRow).toContainText("Cash: $30");
    await expect(detailRow).toContainText("Whish Wallet: $20");

    // Collapse — the detail row leaves the DOM again.
    await toggle.click();
    await expect(detailRow).toHaveCount(0);
  });
});
