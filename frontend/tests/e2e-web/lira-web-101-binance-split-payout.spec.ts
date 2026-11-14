/**
 * lira-web-101 — LIRA-391 (FR-6): a Binance cash-out paid out in two ways
 * through the REAL payout sheet, over the web transport (rule 19).
 *
 * 533.06 USDT, $5 fee deducted → payout $528.06, paid as
 * $200 to the customer's account + $328.06 Whish Wallet, the account line
 * entered FIRST (picking a client seeds it — the order that left the page's
 * remembered method at CUSTOMER_ACCOUNT).
 *
 * Asserted from what was BOOKED, never the snapshot:
 *   - `GET /api/services/transactions/:id/payments`: a WHISH row of −328.06
 *     USD out of Whish_App;
 *   - `GET /api/debts/clients/:id/history`: this transaction's rows credit
 *     the client exactly −200 USD.
 *
 * Rule 15: a fresh client per run, the transaction found by identity (the
 * response's own id), money checked as this transaction's own rows.
 *
 * Rule 17 — run on 2026-11-14 against the unfixed page + core (fresh web DB):
 * FAILED at the Whish-row check — the booked payments were only
 * BINANCE +533.06 USDT and COMMISSION 0, no WHISH row at all
 * ("Expected length: 1, Received length: 0"). Green after the fix.
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

const USDT = 533.06;
const FEE = 5;
const ON_ACCOUNT = 200;
const VIA_WHISH = 328.06;

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

test.describe("lira-web-101 Binance cash-out — split payout books each part", () => {
  test("Account $200 + Whish $328.06 → account credited 200, Whish_App −328.06", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const name = `L101 Split ${stamp}`;
    const client = await (
      await page.request.post(`${BACKEND_URL}/api/clients`, {
        headers: auth,
        data: { full_name: name, phone_number: `71${stamp}` },
      })
    ).json();
    const clientId = (client.data?.id ?? client.id) as number;
    expect(clientId, JSON.stringify(client)).toBeTruthy();

    await gotoAndSettle(page, "/#/recharge");
    await expect(async () => {
      await page
        .getByRole("button", { name: "Binance", exact: true })
        .first()
        .click({ force: true });
      await expect(page.locator("#crypto-amount")).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
    await page.locator("button").filter({ hasText: /^Cash Out$/ }).first().click();

    await page.locator("#crypto-amount").fill(String(USDT));
    await page.locator("#crypto-fee").fill(String(FEE));
    await page.getByTestId("crypto-fee-mode-deducted").check();

    await page.locator("#crypto-client").fill(name);
    await page.getByTestId(`client-option-${clientId}`).click();

    await page
      .getByRole("button", { name: "Confirm Cash Out", exact: true })
      .click();
    const sheet = page.getByTestId("multi-payment-input");
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Account line FIRST (one line: the page remembers its method), then
    // split and add the Whish Wallet line.
    await payMethod(sheet, 0).selectOption("CUSTOMER_ACCOUNT");
    await payAmount(sheet, 0).fill(String(ON_ACCOUNT));
    await splitOn(sheet);
    if ((await sheet.locator('[data-testid^="payment-method-"]').count()) < 2) {
      await addLine(sheet);
    }
    await payMethod(sheet, 1).selectOption("WHISH");
    await payAmount(sheet, 1).fill(String(VIA_WHISH));
    await payAmount(sheet, 0).fill(String(ON_ACCOUNT));

    const posted = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: /Confirm Cash Out \$/ }).click();
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
    const whish = payments.filter(
      (p) => p.method === "WHISH" && p.currency_code === "USD",
    );
    expect(whish, JSON.stringify(payments)).toHaveLength(1);
    expect(whish[0]!.drawer_name).toBe("Whish_App");
    expect(whish[0]!.amount).toBeCloseTo(-VIA_WHISH, 2);

    const { history } = await getJson<{
      history: Array<{ transaction_id: number | null; amount_usd: number }>;
    }>(page, auth, `/api/debts/clients/${clientId}/history`);
    const credited = history
      .filter((h) => h.transaction_id === txn.id)
      .reduce((s, h) => s + h.amount_usd, 0);
    expect(credited).toBeCloseTo(-ON_ACCOUNT, 2);
  });
});
