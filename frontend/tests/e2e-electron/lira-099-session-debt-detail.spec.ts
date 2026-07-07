/**
 * E2E: Session Debt entries show their itemized basket contents.
 *
 * A session basket charged (wholly or partly) to CUSTOMER_ACCOUNT creates ONE
 * debt_ledger row for the whole on-account portion (transaction_id is NULL —
 * it isn't any single item; lira-session-basket-debt). Without a link back to
 * the basket, the Debts page could only show a free-text note, never what was
 * actually purchased.
 *
 * debt_ledger.session_id (added alongside this spec) lets the "Session Debt"
 * row join back to the basket. This spec drives the real app end-to-end:
 * starts a session, adds two distinct cart items via the real session:cart:add
 * IPC (mirroring how the SessionFloatingWindow UI builds a basket), checks out
 * the whole basket via CUSTOMER_ACCOUNT, then uses the real Debts page UI to
 * open SessionDebtDetailModal and confirms it shows both items.
 *
 * Caught a real bug pre-merge: DebtRepository.getColumns() is a separate
 * explicit column list (not SELECT *) that silently dropped session_id from
 * every read even though the write path stored it — see
 * DebtRepository.session_id.test.ts for the unit-level guard.
 */

import { test, expect } from "./fixtures";
import { navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const PHONE = "03777888";
const CLIENT_NAME = "E2E SessionDetail Customer";
const ITEM_A_LABEL = "E2E Widget Repair";
const ITEM_B_LABEL = "E2E Phone Case";

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number }>;
      getActive: () => Promise<{ success: boolean; session?: { id: number } }>;
      cartAdd: (
        sessionId: number,
        item: {
          item_id: string;
          module: string;
          label: string;
          amount: number;
          currency: string;
          form_data: string;
          ipc_channel: string;
        },
      ) => Promise<{ success: boolean; error?: string }>;
      checkout: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  };
};

test.describe("Session Debt — itemized basket detail on the Debts page", () => {
  test("basket with 2 items charged to CUSTOMER_ACCOUNT shows both items in the modal", async ({
    appPage,
  }) => {
    const setup = await appPage.evaluate(
      async ({ phone, name, itemALabel, itemBLabel }) => {
        const w = window as unknown as Api;

        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        let sessionId = started.sessionId;
        if (!sessionId)
          sessionId = (await w.api.session.getActive()).session?.id;
        if (!sessionId)
          return { ok: false, error: "no session", sessionId: null };

        const addA = await w.api.session.cartAdd(sessionId, {
          item_id: "e2e-verify-item-a",
          module: "custom_service",
          label: itemALabel,
          amount: 20,
          currency: "USD",
          form_data: JSON.stringify({
            description: itemALabel,
            cost_usd: 5,
            cost_lbp: 0,
            price_usd: 20,
            price_lbp: 0,
            paid_by: "CUSTOMER_ACCOUNT",
          }),
          ipc_channel: "custom-services:add",
        });

        const addB = await w.api.session.cartAdd(sessionId, {
          item_id: "e2e-verify-item-b",
          module: "custom_service",
          label: itemBLabel,
          amount: 15,
          currency: "USD",
          form_data: JSON.stringify({
            description: itemBLabel,
            cost_usd: 3,
            cost_lbp: 0,
            price_usd: 15,
            price_lbp: 0,
            paid_by: "CUSTOMER_ACCOUNT",
          }),
          ipc_channel: "custom-services:add",
        });

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [
            {
              id: "e2e-verify-item-a",
              module: "custom_service",
              label: itemALabel,
              amount: 20,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: itemALabel,
                cost_usd: 5,
                cost_lbp: 0,
                price_usd: 20,
                price_lbp: 0,
                paid_by: "CUSTOMER_ACCOUNT",
              },
            },
            {
              id: "e2e-verify-item-b",
              module: "custom_service",
              label: itemBLabel,
              amount: 15,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: itemBLabel,
                cost_usd: 3,
                cost_lbp: 0,
                price_usd: 15,
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
              amount: 35,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });

        return {
          ok: checkout.success,
          error: checkout.error ?? null,
          addAOk: addA.success,
          addBOk: addB.success,
          sessionId,
        };
      },
      {
        phone: PHONE,
        name: CLIENT_NAME,
        itemALabel: ITEM_A_LABEL,
        itemBLabel: ITEM_B_LABEL,
      },
    );

    expect(setup.addAOk).toBe(true);
    expect(setup.addBOk).toBe(true);
    expect(setup.error).toBeNull();
    expect(setup.ok).toBe(true);

    // ── Drive the real Debts page UI ──────────────────────────────────────
    await navigateTo(appPage, "/debts");

    const search = appPage.getByPlaceholder("Search client...");
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(CLIENT_NAME);

    const card = appPage
      .locator("button")
      .filter({ hasText: CLIENT_NAME })
      .first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // The "Session Debt" badge should render on the basket's debt row.
    const sessionBadge = appPage.getByText("Session Debt", { exact: true });
    await expect(sessionBadge).toBeVisible({ timeout: 10_000 });

    const eyeButton = appPage.getByTitle("View Basket Items");
    await expect(eyeButton).toBeVisible({ timeout: 10_000 });
    await eyeButton.click();

    // Modal should show BOTH item labels — not just the aggregate debt amount.
    await expect(appPage.getByText(ITEM_A_LABEL)).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText(ITEM_B_LABEL)).toBeVisible({
      timeout: 5_000,
    });
  });
});

export type _SessionDebtDetailSpecPage = Page;
