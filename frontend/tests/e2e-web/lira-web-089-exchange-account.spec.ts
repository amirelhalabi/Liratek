/**
 * lira-web-089 — LIRA-369 over the web transport (rule 19): the customer's
 * account on both sides of an exchange, in EUR.
 *
 *  (a) REST, payout to the account: $110 → 100 EUR, 60 EUR cash + 40 EUR to
 *      the client's account at 1.10 → the client gets a $44 credit, General
 *      USD +110. Refund → every delta back to 0.
 *  (b) REST, customer pays from the account: 100 EUR → $105, all 100 EUR on
 *      the client's account at 1.05 → the client owes $105, General USD −105.
 *      Refund → back to 0.
 *  (c) REST, refused: an EUR account payout without the typed rate.
 *
 * Rule 15: the web DB accumulates — each check is a DELTA around its own
 * action on a fresh client. Payloads follow `exchangeSubmitSchema` (one
 * schema for IPC and REST).
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function seedClient(page: Page, auth: Auth, tag: string): Promise<number> {
  const stamp = Date.now().toString();
  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: `L089${tag} ${stamp}`, phone_number: `0389${stamp.slice(-6)}` },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId, JSON.stringify(client)).toBeTruthy();
  return clientId;
}

async function generalUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances.generalDrawer.usd as number;
}

async function balanceUsd(page: Page, auth: Auth, clientId: number): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/debts/clients/${clientId}/balance`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return ((r.data ?? r).balance_usd as number) ?? 0;
}

async function submit(page: Page, auth: Auth, data: Record<string, unknown>) {
  return (
    await page.request.post(`${BACKEND_URL}/api/exchange/transactions`, {
      headers: auth,
      data,
    })
  ).json();
}

async function exchangeTxnId(
  page: Page,
  auth: Auth,
  clientId: number,
): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/client/${clientId}?limit=50`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const txn = (
    r.transactions as Array<{ id: number; source_table: string; reverses_id?: number | null }>
  ).find((t) => t.source_table === "exchange_transactions" && !t.reverses_id);
  expect(txn, `exchange transaction for client #${clientId} not found`).toBeTruthy();
  return txn!.id;
}

async function refund(page: Page, auth: Auth, txnId: number) {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/transactions/${txnId}/refund`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
}

const r2 = (n: number) => Math.round(n * 100) / 100;

test.describe("Exchange — customer account both ways in EUR (LIRA-369)", () => {
  test("(a) payout: 60 EUR cash + 40 EUR to the account at 1.10 → credit $44; refund → 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const clientId = await seedClient(page, auth, "a");
    const usd0 = await generalUsd(page, auth);
    const bal0 = await balanceUsd(page, auth, clientId);

    const res = await submit(page, auth, {
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 110,
      amountOut: 100,
      leg1Rate: 1.1,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
      clientId,
      customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
      payments: [
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ],
      payout_account_usd_rate: 1.1,
    });
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    expect(r2((await generalUsd(page, auth)) - usd0)).toBe(110);
    expect(r2((await balanceUsd(page, auth, clientId)) - bal0)).toBe(-44);

    await refund(page, auth, await exchangeTxnId(page, auth, clientId));
    expect(r2((await generalUsd(page, auth)) - usd0)).toBe(0);
    expect(r2((await balanceUsd(page, auth, clientId)) - bal0)).toBe(0);
  });

  test("(b) customer side: 100 EUR on the account at 1.05 → owes $105; refund → 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const clientId = await seedClient(page, auth, "b");
    const usd0 = await generalUsd(page, auth);
    const bal0 = await balanceUsd(page, auth, clientId);

    const res = await submit(page, auth, {
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 105,
      leg1Rate: 1.05,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      clientId,
      customerPayments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 }],
      customer_account_usd_rate: 1.05,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
    });
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    expect(r2((await generalUsd(page, auth)) - usd0)).toBe(-105);
    expect(r2((await balanceUsd(page, auth, clientId)) - bal0)).toBe(105);

    await refund(page, auth, await exchangeTxnId(page, auth, clientId));
    expect(r2((await generalUsd(page, auth)) - usd0)).toBe(0);
    expect(r2((await balanceUsd(page, auth, clientId)) - bal0)).toBe(0);
  });

  test("(c) an EUR account payout without the typed rate is refused", async ({ page }) => {
    const auth = await authOf(page);
    const clientId = await seedClient(page, auth, "c");
    const res = await submit(page, auth, {
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 110,
      amountOut: 100,
      leg1Rate: 1.1,
      leg1MarketRate: 1.18,
      leg1ProfitUsd: 5,
      totalProfitUsd: 5,
      clientId,
      customerPayments: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 }],
    });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/EUR → USD rate/);
  });
});
