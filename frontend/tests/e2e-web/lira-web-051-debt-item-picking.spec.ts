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
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("basket on account → tick the OMT send → $50 lands in the OMT cash drawer", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const name = `L051 Picker ${Date.now()}`;
  const phone = `0377${Date.now().toString().slice(-6)}`;

  const drawers = async (): Promise<{ general: number; pcd: number }> => {
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
  };

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
            id: "l051-omt",
            module: "omt_system",
            label: "L051 OMT SEND",
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
            id: "l051-cs",
            module: "custom_services",
            label: "L051 Service",
            amount: 9,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: {
              description: "L051 Service",
              price_usd: 9,
              cost_usd: 7,
              status: "completed",
            },
          },
        ],
        payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 110 }],
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
    : (Object.values(clients.data ?? {}).find((v) => Array.isArray(v)) as
        | Array<{ id: number; full_name: string }>
        | undefined) ?? [];
  const client = list.find((c: { full_name: string }) => c.full_name === name);
  expect(client, "basket client not found").toBeTruthy();

  const open = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${client.id}/open-items`,
      { headers: auth },
    )
  ).json();
  expect(open.success, JSON.stringify(open)).toBeTruthy();
  const omtItem = open.items.find(
    (i: { kind: string; isPrimary: boolean }) => i.kind === "member" && i.isPrimary,
  );
  expect(omtItem, JSON.stringify(open.items)).toBeTruthy();
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
  await expect(page.locator('[data-testid^="payment-legs-detail-"]').first()).toContainText(
    "{$50 OMT Cash Drawer}",
  );
});
