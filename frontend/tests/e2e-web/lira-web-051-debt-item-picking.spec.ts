/**
 * lira-web-051 — LIRA-304 over the web transport (rule 19): a customer
 * session basket checked out on Customer Account (OMT send $100 + $1 fee,
 * a $9 custom service), then a repayment of $50 cash with the basket's OMT
 * send TICKED. Proves, through the real REST routes and the real page:
 *
 *  - GET /api/debts/clients/:id/open-items lists the basket items, the OMT
 *    send flagged as a primary-system transfer;
 *  - POST /api/debts/repayments with `targets` routes the $50 into the OMT
 *    cash drawer (OMT_System +$50, General unchanged) — matched by drawer
 *    DELTAS, never absolute balances (rule 15);
 *  - the Transactions page shows that repayment's payment detail as
 *    "In — Cash: $50 {$50 OMT Cash Drawer}" (row matched by its own client
 *    name, never by position).
 *
 * LIRA-308 (owner decisions 2026-10-11) — the second test drives the real
 * Process Repayment modal: a tick change resets the amount, and an amount
 * above the ticked sum ticks the OMT send by itself (cash drawer first) —
 * which then lands in the OMT cash drawer.
 *
 * LIRA-383 (owner 2026-11-11, reverses LIRA-308 decisions 1 and 3) — the
 * modal opens with NOTHING ticked and the whole due filled in; nothing
 * ticked is a valid payment (oldest first), so Confirm stays enabled; a
 * typed amount after ticking is kept (less = partial on the ticked item).
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };

/** A customer-session basket checked out on Customer Account: OMT send
 *  $100 + $1 fee and a $9 custom service. Returns the client and its open
 *  items (the OMT send flagged as a primary-system transfer). */
async function seedBasketOnAccount(
  page: Page,
  auth: Auth,
  name: string,
  phone: string,
  tag: string,
): Promise<{
  client: { id: number; full_name: string };
  items: Array<{
    kind: string;
    id: number;
    isPrimary: boolean;
    openUsd: number;
  }>;
}> {
  const started = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
      headers: auth,
      data: { customer_name: name, customer_phone: phone },
    })
  ).json();
  expect(started.success, JSON.stringify(started)).toBeTruthy();

  const checkout = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
      headers: auth,
      data: {
        sessionId: started.sessionId,
        cartItems: [
          {
            id: `${tag}-omt`,
            module: "omt_system",
            label: `${tag} OMT SEND`,
            amount: 101,
            currency: "USD",
            ipcChannel: "financial:create",
            formData: {
              provider: "OMT",
              serviceType: "SEND",
              amount: 100,
              currency: "USD",
              omtServiceType: "INTRA",
              omtFee: 1,
            },
          },
          {
            id: `${tag}-cs`,
            module: "custom_services",
            label: `${tag} Service`,
            amount: 9,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: {
              description: `${tag} Service`,
              price_usd: 9,
              cost_usd: 7,
              status: "completed",
            },
          },
        ],
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 110 },
        ],
        exchangeRate: 89000,
        userId: 1,
      },
    })
  ).json();
  expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();

  const clients = await (
    await page.request.get(
      `${BACKEND_URL}/api/clients?search=${encodeURIComponent(name)}`,
      { headers: auth },
    )
  ).json();
  const list = Array.isArray(clients.data)
    ? clients.data
    : ((Object.values(clients.data ?? {}).find((v) => Array.isArray(v)) as
        | Array<{ id: number; full_name: string }>
        | undefined) ?? []);
  const client = list.find((c: { full_name: string }) => c.full_name === name);
  expect(client, "basket client not found").toBeTruthy();

  const open = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${client.id}/open-items`,
      { headers: auth },
    )
  ).json();
  expect(open.success, JSON.stringify(open)).toBeTruthy();
  return { client, items: open.items };
}

async function drawerBalances(
  page: Page,
  auth: Auth,
): Promise<{ general: number; pcd: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return {
    general: r.balances.generalDrawer.usd as number,
    pcd: r.balances.omtDrawer.usd as number,
  };
}

test("basket on account → tick the OMT send → $50 lands in the OMT cash drawer", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const name = `L051 Picker ${Date.now()}`;
  const phone = `0377${Date.now().toString().slice(-6)}`;

  const drawers = () => drawerBalances(page, auth);
  const { client, items } = await seedBasketOnAccount(
    page,
    auth,
    name,
    phone,
    "l051",
  );
  const open = { items };
  const omtItem = open.items.find(
    (i: { kind: string; isPrimary: boolean }) =>
      i.kind === "member" && i.isPrimary,
  );
  expect(omtItem, JSON.stringify(open.items)).toBeTruthy();
  if (!omtItem) return;
  expect(omtItem.openUsd).toBeCloseTo(101, 2);

  const before = await drawers();
  const repaid = await (
    await page.request.post(`${BACKEND_URL}/api/debts/repayments`, {
      headers: auth,
      data: {
        clientId: client.id,
        amountUSD: 50,
        amountLBP: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
        tender_exchange_rate: 89000,
        targets: [{ kind: "member", id: omtItem.id }],
      },
    })
  ).json();
  expect(repaid.success, JSON.stringify(repaid)).toBeTruthy();
  const after = await drawers();
  expect(after.pcd - before.pcd).toBeCloseTo(50, 2);
  expect(after.general - before.general).toBeCloseTo(0, 2);

  // The page shows where the money went.
  await page.goto("/#/audit");
  const row = page
    .locator("tr", { hasText: `Debt Repayment: $50` })
    .filter({ hasText: name })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByText("payment detail").click();
  await expect(
    page.locator('[data-testid^="payment-legs-detail-"]').first(),
  ).toContainText("{$50 OMT Cash Drawer}");
});

test("LIRA-308 + LIRA-383: opens unticked; ticks fill the amount, a typed amount stays", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const name = `L051b Ticks ${Date.now()}`;
  const phone = `0378${Date.now().toString().slice(-6)}`;
  const { client, items } = await seedBasketOnAccount(
    page,
    auth,
    name,
    phone,
    "l051b",
  );
  const omt = items.find((i) => i.kind === "member" && i.isPrimary)!;
  const svc = items.find((i) => i.kind === "member" && !i.isPrimary)!;
  expect(omt && svc, JSON.stringify(items)).toBeTruthy();

  await page.goto("/#/debts");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder(/Search client/i).fill(name);
  await page.locator("button").filter({ hasText: name }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Settle Debt/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible();

  const omtBox = page
    .getByTestId(`debt-item-member-${omt.id}`)
    .locator("input");
  const svcBox = page
    .getByTestId(`debt-item-member-${svc.id}`)
    .locator("input");
  const amount = page.locator('[data-testid^="payment-amount-"]').first();
  const confirm = page.getByRole("button", { name: /^Confirm Payment$/ });

  // LIRA-383: nothing ticked on open, the whole due ($110) filled in,
  // Confirm enabled (oldest first), the hint says so.
  await expect(omtBox).not.toBeChecked();
  await expect(svcBox).not.toBeChecked();
  await expect(amount).toHaveValue("110");
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId("debt-item-picker-hint")).toContainText(
    "the oldest items are paid first",
  );

  // What's new (rule 30): the real modal with one item ticked and a
  // smaller amount typed — "pays $40 · leaves $61" on the ticked send.
  await omtBox.check();
  await expect(amount).toHaveValue("101");
  await amount.fill("40");
  await expect(omtBox).toBeChecked(); // typing never unticks
  await expect(svcBox).not.toBeChecked();
  await expect(page.getByTestId(`debt-item-member-${omt.id}`)).toContainText(
    "pays $40 · leaves $61",
  );
  await expect(amount).toHaveValue("40"); // the typed amount is kept
  await page.mouse.move(1, 1);
  const modal = page
    .locator('[role="dialog"]')
    .filter({ hasText: "Process Repayment" })
    .first();
  await ((await modal.count()) ? modal : page).screenshot({
    path: "public/whats-new/1.35.0/repay-pick-items.png",
  });

  // LIRA-308 decision 2: a tick change re-fills the amount, even a typed one.
  await svcBox.check();
  await expect(amount).toHaveValue("110");
  await omtBox.uncheck();
  await expect(amount).toHaveValue("9");

  // Decision 5: only the $9 service ticked, pay $60 → the OMT send ticks
  // itself.
  await expect(svcBox).toBeChecked();
  await expect(omtBox).not.toBeChecked();
  await amount.fill("60");
  await expect(omtBox).toBeChecked();
  await expect(page.getByTestId(`debt-item-member-${omt.id}`)).toContainText(
    "pays $51 · leaves $50",
  );
  await expect(page.getByTestId("repay-goes-to")).toContainText("$51");

  const before = await drawerBalances(page, auth);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
  const after = await drawerBalances(page, auth);
  expect(after.pcd - before.pcd).toBeCloseTo(51, 2);
  expect(after.general - before.general).toBeCloseTo(9, 2);

  const left = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${client.id}/open-items`,
      { headers: auth },
    )
  ).json();
  const omtLeft = left.items.find(
    (i: { id: number; kind: string }) => i.kind === "member" && i.id === omt.id,
  );
  expect(omtLeft.openUsd).toBeCloseTo(50, 2);
  expect(
    left.items.some(
      (i: { id: number; kind: string }) =>
        i.kind === "member" && i.id === svc.id,
    ),
  ).toBe(false);
});

test("LIRA-308 owner answers: earlier balance as its own ticked line; unreturned change is account credit", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const name = `L051c Earlier ${Date.now()}`;
  const phone = `0379${Date.now().toString().slice(-6)}`;
  const { client } = await seedBasketOnAccount(
    page,
    auth,
    name,
    phone,
    "l051c",
  );

  // Answer 2: an opening balance with no item behind it (a paper entry —
  // no cash moves) — $20 on top of the $110 basket.
  const entry = await (
    await page.request.post(`${BACKEND_URL}/api/debts/account-entry`, {
      headers: auth,
      data: {
        direction: "debt",
        clientId: client.id,
        amountUSD: 20,
        amountLBP: 0,
        note: "L051c opening balance",
        moveCash: false,
      },
    })
  ).json();
  expect(entry.success, JSON.stringify(entry)).toBeTruthy();
  const open = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${client.id}/open-items`,
      { headers: auth },
    )
  ).json();
  const earlier = open.items.find(
    (i: { kind: string }) => i.kind === "balance",
  );
  expect(earlier, JSON.stringify(open.items)).toBeTruthy();
  expect(earlier.openUsd).toBeCloseTo(20, 2);

  await page.goto("/#/debts");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder(/Search client/i).fill(name);
  await page.locator("button").filter({ hasText: name }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Settle Debt/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible();

  const earlierRow = page.getByTestId(`debt-item-balance-${earlier.id}`);
  const amount = page.locator('[data-testid^="payment-amount-"]').first();
  await expect(earlierRow).toContainText("Earlier balance (no items)");
  // LIRA-383: nothing ticked on open; the amount is the whole balance.
  await expect(earlierRow.locator("input")).not.toBeChecked();
  await expect(amount).toHaveValue("130");
  await earlierRow.locator("input").check();
  await expect(amount).toHaveValue("20");
  await earlierRow.locator("input").uncheck();
  await expect(amount).toHaveValue("130");

  // Answer 1: $131 paid, nothing returned → $1 account credit. LIRA-313
  // (owner decision 2026-10-12): the change now starts as "Return change"
  // ($1 in the field); the "Account" button empties it (owner 2026-10-13:
  // the toggle became one button and the field stays on screen, empty).
  await amount.fill("131");
  await expect(page.getByTestId("return-usd")).toHaveValue("1.00");
  await page.getByTestId("change-destination-account").click();
  await expect(page.getByTestId("return-usd")).toHaveValue("");
  await expect(page.getByTestId("repay-goes-to")).toContainText(
    "Account credit$1",
  );

  const before = await drawerBalances(page, auth);
  await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
  await expect(
    page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
  const after = await drawerBalances(page, auth);
  // All $131 stays in the shop: $101 to the OMT cash drawer, $30 in General.
  expect(after.pcd - before.pcd).toBeCloseTo(101, 2);
  expect(after.general - before.general).toBeCloseTo(30, 2);

  const bal = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${client.id}/balance`,
      { headers: auth },
    )
  ).json();
  const data = bal.data ?? bal;
  expect(data.balance_usd).toBeCloseTo(-1, 2);
});
