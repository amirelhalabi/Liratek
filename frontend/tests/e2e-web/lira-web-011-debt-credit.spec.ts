/**
 * lira-web-011 — debt addCredit over REST (the phase-3 built route).
 *
 * Guards POST /api/debts/credit (built in 0cf0254) into the same core
 * DebtService.addCredit the Electron IPC path uses. A credit is the shop OWING
 * the customer (prepaid credit), so it drives the per-currency balance NEGATIVE
 * (FEATURE_GUIDE §5). Asserted as a DELTA on the client's own balance (rule 15),
 * and the client surfaces in the debtors list carrying that credit.
 * userId is injected from the JWT; tenant-scoped via authenticateJWT.
 *
 * This is the dedicated REST proof; lira-097 exercises the same route over the
 * web-shim through the Debts-page UI.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("addCredit records a prepaid credit (negative balance) over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: "Credit Web Spec", phone_number: "03888111" },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  const balOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success).toBeTruthy();
    return r.data.balance_usd as number;
  };

  const before = await balOf();

  const credited = await (
    await page.request.post(`${BACKEND_URL}/api/debts/credit`, {
      headers: auth,
      data: { clientId, amountUsd: 30, amountLbp: 0 },
    })
  ).json();
  expect(credited.success, JSON.stringify(credited)).toBeTruthy();

  // Credit = shop owes customer → balance moves DOWN by the credited amount.
  const after = await balOf();
  expect(after - before).toBeCloseTo(-30, 2);

  // The client surfaces in the debtors list carrying the credit (negative USD).
  const debtors = await (
    await page.request.get(`${BACKEND_URL}/api/debts/debtors`, {
      headers: auth,
    })
  ).json();
  const mine = (debtors.debtors ?? []).find(
    (d: { id: number }) => d.id === clientId,
  );
  expect(mine, "credited client missing from debtors").toBeTruthy();
  expect(mine.total_debt_usd).toBeCloseTo(-30, 2);
});
