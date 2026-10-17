/**
 * lira-web-066 — Transactions Type filter also shows rows paid through the
 * chosen wallet (LIRA-323), over REST and in the web UI.
 *
 * A Custom Service paid $10 cash + $30 OMT Wallet is not an "OMT App Send"
 * row, but its payment moved money through the OMT_App drawer, so ticking
 * "OMT App Send" must list it; ticking "MTC" must not. A session basket paid
 * by OMT Wallet (pooled leg, no own leg on the member) must show too.
 *
 * Proves the web transport end to end: the adapter JSON-encodes
 * `paid_via_drawer` on the tuple, the route validates it with the shared
 * core schema (which strips unknown keys — rule 23), the repository matches
 * it, and the page's client twin keeps the row.
 *
 * Rule 15: rows matched by IDENTITY (source_table + source_id / a unique
 * description), never by position; a fresh tag per run.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  closeAutoCheckpoint,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };
type TxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
};

const OMT_APP_SEND = {
  type: "FINANCIAL_SERVICE",
  provider: "OMT_APP",
  service_type: "SEND",
  paid_via_drawer: "OMT_App",
};
const MTC = { type: "RECHARGE", provider: "MTC" };

async function recentIds(
  page: Page,
  auth: Auth,
  typeFilters: Array<Record<string, unknown>>,
): Promise<number[]> {
  const params = new URLSearchParams({
    limit: "500",
    typeFilters: JSON.stringify(typeFilters),
  });
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/recent?${params}`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.transactions as TxnRow[]).map((t) => t.id);
}

async function txnBySource(
  page: Page,
  auth: Auth,
  sourceId: number,
): Promise<TxnRow> {
  const t = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/by-source/custom_services/${sourceId}`,
      { headers: auth },
    )
  ).json();
  expect(t.success, JSON.stringify(t)).toBeTruthy();
  const row = t.transaction as TxnRow;
  expect(row.type).toBe("CUSTOM_SERVICE");
  return row;
}

test.describe("lira-web-066 — filter by wallet shows rows paid through it", () => {
  test("a custom service paid partly by OMT Wallet shows under OMT App Send, not under MTC", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    const tag = `L066 ${Date.now()}`;

    // 1. Own legs: $10 cash + $30 OMT Wallet.
    const created = await (
      await page.request.post(`${BACKEND_URL}/api/custom-services`, {
        headers: auth,
        data: {
          description: `${tag} own`,
          price_usd: 40,
          cost_usd: 1,
          paid_by: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 10 },
            { method: "OMT", currency_code: "USD", amount: 30 },
          ],
        },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const ownRow = await txnBySource(page, auth, created.id as number);

    // 2. Pooled leg: a session basket paid entirely by OMT Wallet.
    const started = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
        headers: auth,
        data: { customer_name: `${tag} session` },
      })
    ).json();
    expect(started.success, JSON.stringify(started)).toBeTruthy();
    const checkout = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
        headers: auth,
        data: {
          sessionId: started.sessionId as number,
          cartItems: [
            {
              id: "l066-a",
              module: "custom_services",
              label: `${tag} basket`,
              amount: 15,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: `${tag} basket`,
                price_usd: 15,
                cost_usd: 1,
                status: "completed",
              },
            },
          ],
          payments: [{ method: "OMT", currency_code: "USD", amount: 15 }],
          exchangeRate: 89500,
          userId: 1,
        },
      })
    ).json();
    expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
    const basketSourceId = (
      checkout.results as Array<{ transactionId: number }>
    )[0].transactionId;
    const basketRow = await txnBySource(page, auth, basketSourceId);

    // REST: OMT App Send lists both; MTC lists neither; without the drawer
    // key the tuple is the plain type filter again.
    const omtIds = await recentIds(page, auth, [OMT_APP_SEND]);
    expect(omtIds).toContain(ownRow.id);
    expect(omtIds).toContain(basketRow.id);
    const mtcIds = await recentIds(page, auth, [MTC]);
    expect(mtcIds).not.toContain(ownRow.id);
    expect(mtcIds).not.toContain(basketRow.id);
    const { paid_via_drawer: _drop, ...plainSend } = OMT_APP_SEND;
    expect(await recentIds(page, auth, [plainSend])).not.toContain(ownRow.id);

    // UI: the Transactions page's own filter shows the row by its description.
    await gotoAndSettle(page, "/#/audit");
    await closeAutoCheckpoint(page);
    // Scoped to the Type filter's own testids (a page-wide getByText("MTC")
    // could also hit a table cell on the shared DB).
    const option = (label: string) =>
      page.getByTestId(`transactions-type-filter-option-${label}`);
    // Groups start collapsed (grouped type filter): open each one first.
    const openGroup = (label: string) =>
      page
        .getByTestId(`transactions-type-filter-group-toggle-${label}`)
        .click();
    await page.getByTestId("transactions-type-filter").click();
    await openGroup("OMT App");
    await openGroup("Recharge");
    await option("OMT App Send").click();
    await expect(
      page.locator("tr", { hasText: `${tag} own` }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Swap to MTC only: the row is gone.
    await option("OMT App Send").click();
    await option("MTC").click();
    await expect(page.locator("tr", { hasText: `${tag} own` })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
