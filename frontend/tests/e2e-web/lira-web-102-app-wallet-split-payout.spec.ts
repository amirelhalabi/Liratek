/**
 * lira-web-102 — LIRA-391 (FR-6): an OMT App cash-out (RECEIVE) paid out in
 * two ways through the REAL payout sheet, over the web transport (rule 19).
 *
 * $300 received into OMT App (no fee on OMT App RECEIVE), paid out as $100 to
 * the customer's account + $200 Cash, the account line entered FIRST — the
 * order that left the form's `cashoutMethod` at CUSTOMER_ACCOUNT.
 *
 * Asserted from what was BOOKED, never the snapshot:
 *   - `GET /api/services/transactions/:id/payments`: a CASH row of −200 USD;
 *   - `GET /api/debts/clients/:id/history`: this transaction's rows credit
 *     the client exactly −100 USD.
 *
 * Rule 15: a fresh client per run, the transaction found by identity (the
 * response's own id), money checked as this transaction's own rows.
 *
 * Rule 17 — run on 2026-11-14 against the unfixed page + core (fresh web DB):
 * FAILED at the cash-row check — the only booked payment was OMT_APP +300
 * USD, no cash payout row ("Expected length: 1, Received length: 0").
 * Green after the fix.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";
import { payAmount, payMethod, addLine, splitOn, waitPost } from "./shopDayHelpers";

type Auth = { Authorization: string };

const AMOUNT = 300;
const ON_ACCOUNT = 100;
const IN_CASH = 200;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function getJson<T>(page: Page, auth: Auth, path: string): Promise<T> {
  const r = await (
    await page.request.get(`${BACKEND_URL}${path}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

test.describe("lira-web-102 OMT App cash-out — split payout books each part", () => {
  test("Account $100 + Cash $200 → account credited 100, cash −200", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const name = `L102 Split ${stamp}`;
    const client = await (
      await page.request.post(`${BACKEND_URL}/api/clients`, {
        headers: auth,
        data: { full_name: name, phone_number: `76${stamp}` },
      })
    ).json();
    const clientId = (client.data?.id ?? client.id) as number;
    expect(clientId, JSON.stringify(client)).toBeTruthy();

    await gotoAndSettle(page, "/#/recharge");
    const tab = page.getByRole("button", { name: "OMT App", exact: true }).first();
    await expect(tab).toBeVisible({ timeout: 8_000 });
    await tab.click();
    await page.locator("button").filter({ hasText: /^Receive$/ }).first().click();
    await expect(page.locator("#receiver-name")).toBeVisible({ timeout: 5_000 });

    await page.locator("#transfer-amount").fill(String(AMOUNT));
    await page.locator("#receiver-name").fill(name);
    await page.getByTestId(`client-option-${clientId}`).click();

    await page.getByRole("button", { name: /Proceed to Pay/i }).click();
    const sheet = page.getByTestId("multi-payment-input");
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Account line FIRST (one line: the form remembers its method), then
    // split and add the Cash line.
    await payMethod(sheet, 0).selectOption("CUSTOMER_ACCOUNT");
    await payAmount(sheet, 0).fill(String(ON_ACCOUNT));
    await splitOn(sheet);
    if ((await sheet.locator('[data-testid^="payment-method-"]').count()) < 2) {
      await addLine(sheet);
    }
    await payMethod(sheet, 1).selectOption("CASH");
    await payAmount(sheet, 1).fill(String(IN_CASH));
    await payAmount(sheet, 0).fill(String(ON_ACCOUNT));

    const posted = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: /^Pay \$/ }).click();
    const { body } = await posted;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const fsId = body.id as number;

    const txn = (
      await getJson<{ transaction: { id: number } }>(
        page,
        auth,
        `/api/transactions/by-source/financial_services/${fsId}`,
      )
    ).transaction;

    const { payments } = await getJson<{
      payments: Array<{
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
      }>;
    }>(page, auth, `/api/services/transactions/${txn.id}/payments`);
    const cash = payments.filter(
      (p) => p.method === "CASH" && p.currency_code === "USD" && p.amount < 0,
    );
    expect(cash, JSON.stringify(payments)).toHaveLength(1);
    expect(cash[0]!.amount).toBeCloseTo(-IN_CASH, 2);

    const { history } = await getJson<{
      history: Array<{ transaction_id: number | null; amount_usd: number }>;
    }>(page, auth, `/api/debts/clients/${clientId}/history`);
    const credited = history
      .filter((h) => h.transaction_id === txn.id)
      .reduce((s, h) => s + h.amount_usd, 0);
    expect(credited).toBeCloseTo(-ON_ACCOUNT, 2);
  });
});
