/**
 * lira-web-007 — debts account-entry + cash-out over REST.
 *
 * Guards the debt money-writes over the REST transport into the same core
 * DebtService: a CREDIT account entry ($30) records a client credit
 * (balance_usd −30 = shop owes customer, FEATURE_GUIDE §5); cash-out returns
 * it (balance → 0). General-drawer deltas are proven at the DB level by the
 * impl's curl check; this spec guards the REST round-trip + balance signs.
 * Tenant-scoped via authenticateJWT.
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
