/**
 * lira-web-007 — debts account-entry + cash-out over REST.
 *
 * Guards the debt money-writes over the REST transport into the same core
 * DebtService: a CREDIT account entry ($30) records a client credit
 * (balance_usd −30 = shop owes customer, FEATURE_GUIDE §5); cash-out returns
 * it (balance → 0). General-drawer deltas are proven at the DB level by the
 * impl's curl check; this spec guards the REST round-trip + balance signs.
 * Tenant-scoped via authenticateJWT.
 *
 * Second test (bug 10, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §2): the FIRST
 * test above never exercises the Debts PAGE at all (pure `page.request`
 * calls) — it cannot catch a UI-level transport gate. Bug 10 was exactly
 * that: `Debts/index.tsx`'s cash-out branch hard-blocked with
 * `if (!window.api) { alert("Cash out is only available in the desktop
 * app."); return; }` even though the actual booking call three lines below
 * (`api.cashOut(...)`) already goes through the dual-mode adapter
 * (`ipcOrHttp` in `backendApi.ts`) — the gate was dead weight that only hurt
 * the browser, where `window.api` is genuinely undefined (no Electron
 * preload, no shim in this suite — unlike the `web-shared` project's
 * desktop-spec reuse, which polyfills `window.api` and would never have
 * observed this bug). Proven failing-first: this exact test, run against
 * the pre-fix source, hits the alert dialog and the "Confirm Payment" click
 * never reaches `api.cashOut` — the balance/drawer assertions below fail on
 * the untouched credit.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("debt account-entry credit → balance → cash-out over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: "Debt Web Spec", phone_number: "03444777" },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  const credit = await (
    await page.request.post(`${BACKEND_URL}/api/debts/account-entry`, {
      headers: auth,
      data: {
        direction: "credit",
        clientId,
        amountUSD: 30,
        amountLBP: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      },
    })
  ).json();
  expect(credit.success, JSON.stringify(credit)).toBeTruthy();

  const bal = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
      { headers: auth },
    )
  ).json();
  expect(bal.success).toBeTruthy();
  expect(bal.data.balance_usd).toBe(-30); // credit: shop owes customer

  const cashout = await (
    await page.request.post(`${BACKEND_URL}/api/debts/cash-out`, {
      headers: auth,
      data: {
        clientId,
        amountUSD: 30,
        amountLBP: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      },
    })
  ).json();
  expect(cashout.success, JSON.stringify(cashout)).toBeTruthy();

  const balAfter = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
      { headers: auth },
    )
  ).json();
  expect(balAfter.data.balance_usd).toBe(0);
});

test("bug 10: cash-out through the Debts page UI works in the browser (no window.api gate)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const CLIENT = `L007 UI CashOut ${Date.now()}`;
  const PHONE = `0347${Date.now().toString().slice(-6)}`;
  const CREDIT = 22;

  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: CLIENT, phone_number: PHONE },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  const credited = await (
    await page.request.post(`${BACKEND_URL}/api/debts/account-entry`, {
      headers: auth,
      data: {
        direction: "credit",
        clientId,
        amountUSD: CREDIT,
        amountLBP: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: CREDIT }],
      },
    })
  ).json();
  expect(credited.success, JSON.stringify(credited)).toBeTruthy();

  const generalUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };
  const before = await generalUsd();

  // Catch the pre-fix dialog ("Cash out is only available in the desktop
  // app.") — if the gate were still present, Confirm Payment would never
  // reach `api.cashOut` and this array would carry the block message.
  const dialogs: string[] = [];
  page.on("dialog", (d) => dialogs.push(d.message()));

  await page.goto("/#/debts");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder(/Search client/i).fill(CLIENT);
  await page.locator("button").filter({ hasText: CLIENT }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Cash Out/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible();

  // The payout amount auto-prefills with the credit (abs value); fill it
  // explicitly to be robust to formatting.
  await page
    .locator('[data-testid^="payment-amount-"]')
    .first()
    .fill(String(CREDIT));
  await page.getByRole("button", { name: /^Confirm Payment$/ }).click();

  await expect(
    page.locator('[role="alert"]', { hasText: /Cash out processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  expect(
    dialogs.filter((d) => /desktop app/i.test(d)),
    "the desktop-only gate alert fired — bug 10 regressed",
  ).toEqual([]);

  const balAfter = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
      { headers: auth },
    )
  ).json();
  expect(balAfter.data.balance_usd).toBeCloseTo(0, 2);

  const after = await generalUsd();
  expect(after - before).toBeCloseTo(-CREDIT, 2);
});
