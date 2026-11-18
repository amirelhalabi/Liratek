/**
 * lira-web-104 — LIRA-401: a repayment is booked once, however many times it
 * is sent (web app).
 *
 * Production (Corner Tech, 2026-11-18): the same $350 repayment landed twice
 * in the same second — two taps on Confirm, two POSTs, no Idempotency-Key.
 *
 * Three guards over the REAL wire (REST + the Debts page), each on its own
 * client so the counts are never shared (rule 15):
 *   1. two POSTs with the SAME `idempotency-key` → ONE Repayment row, and the
 *      second reply equals the first;
 *   2. two POSTs with DIFFERENT keys → TWO rows (a new key is a new payment);
 *   3. the Debts page: Confirm clicked twice in a burst (dispatched, so the
 *      disabled state cannot swallow the second click) → ONE Repayment row.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };

async function newClientWithDebt(
  page: import("@playwright/test").Page,
  auth: Auth,
  name: string,
  debtUsd: number,
): Promise<number> {
  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: {
        full_name: name,
        phone_number: `0381${Date.now().toString().slice(-6)}`,
      },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId, JSON.stringify(client)).toBeTruthy();
  const debt = await (
    await page.request.post(`${BACKEND_URL}/api/debts/account-entry`, {
      headers: auth,
      data: {
        direction: "debt",
        clientId,
        amountUSD: debtUsd,
        amountLBP: 0,
        moveCash: false,
      },
    })
  ).json();
  expect(debt.success, JSON.stringify(debt)).toBeTruthy();
  return clientId;
}

async function repaymentRows(
  page: import("@playwright/test").Page,
  auth: Auth,
  clientId: number,
): Promise<number> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/history`,
      { headers: auth },
    )
  ).json();
  const rows = res.history as Array<{ transaction_type: string }>;
  return rows.filter((r) => r.transaction_type === "Repayment").length;
}

function repaymentBody(clientId: number, usd: number) {
  return {
    clientId,
    amountUSD: usd,
    amountLBP: 0,
    payments: [{ method: "CASH", currencyCode: "USD", amount: usd }],
  };
}

test("LIRA-401: same key twice books one repayment; a new key books another; a double-click on the Debts page books one", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const tail = Date.now().toString(36);

  // ── 1. Same key, sent twice ─────────────────────────────────────────────
  const a = await newClientWithDebt(page, auth, `L400 same key ${tail}`, 40);
  const key = `web-e2e-${tail}-same`;
  const send = () =>
    page.request
      .post(`${BACKEND_URL}/api/debts/repayments`, {
        headers: { ...auth, "idempotency-key": key },
        data: repaymentBody(a, 40),
      })
      .then((r) => r.json());
  const first = await send();
  expect(first.success, JSON.stringify(first)).toBeTruthy();
  const second = await send();
  expect(second).toEqual(first);
  expect(await repaymentRows(page, auth, a)).toBe(1);

  // ── 2. Two different keys ───────────────────────────────────────────────
  const b = await newClientWithDebt(page, auth, `L400 two keys ${tail}`, 40);
  for (const k of ["k1", "k2"]) {
    const r = await (
      await page.request.post(`${BACKEND_URL}/api/debts/repayments`, {
        headers: { ...auth, "idempotency-key": `web-e2e-${tail}-${k}` },
        data: repaymentBody(b, 20),
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
  }
  expect(await repaymentRows(page, auth, b)).toBe(2);

  // ── 3. Debts page: Confirm clicked twice in a burst ─────────────────────
  const NAME = `L400 double tap ${tail}`;
  const c = await newClientWithDebt(page, auth, NAME, 40);

  await page.goto("/#/debts");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder(/Search client/i).fill(NAME);
  await page.locator("button").filter({ hasText: NAME }).first().click();
  await page.getByTestId("debts-settle-open").click();
  await expect(page.getByText("Process Repayment")).toBeVisible();
  await page.locator('[data-testid^="payment-amount-"]').first().fill("40");

  const confirm = page.getByRole("button", { name: /^Confirm Payment$/ });
  await expect(confirm).toBeEnabled();
  // Two clicks in ONE browser task, before React re-renders the disabled
  // button — the production double tap. (Two awaited dispatches would let
  // the first request finish and close the modal between them.)
  await confirm.evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });

  await expect(
    page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
  // Let any second request (the bug) land before counting.
  await page.waitForTimeout(1500);
  expect(await repaymentRows(page, auth, c)).toBe(1);

  const bal = await (
    await page.request.get(`${BACKEND_URL}/api/debts/clients/${c}/balance`, {
      headers: auth,
    })
  ).json();
  expect(bal.data.balance_usd).toBeCloseTo(0, 2);
});
