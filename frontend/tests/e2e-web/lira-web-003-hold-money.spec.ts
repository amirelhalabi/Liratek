/**
 * lira-web-003 — hold-money over REST.
 *
 * Guards the hold-money web-parity work: create → active → collect all run
 * through the REST transport into the same core HoldMoneyService. Holding
 * credits the General drawer, collecting debits it (net zero); both journal a
 * transaction row with zero profit (FEATURE_GUIDE §10). Drawer deltas are
 * proven at the DB level by the impl's curl check; this spec guards the REST
 * round-trip + hold lifecycle so a regression surfaces in the web suite.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("hold-money create → active → collect over REST", async ({ page }) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/hold-money`, {
      headers: auth,
      data: {
        client_name: "HM Web Spec",
        phone_number: "03111000",
        usd_amount: 15,
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  expect(created.id).toBeTruthy();

  const active = await (
    await page.request.get(`${BACKEND_URL}/api/hold-money/active`, {
      headers: auth,
    })
  ).json();
  expect(active.success).toBeTruthy();
  expect(active.data.some((h: { id: number }) => h.id === created.id)).toBe(
    true,
  );

  const collected = await (
    await page.request.post(
      `${BACKEND_URL}/api/hold-money/${created.id}/collect`,
      { headers: auth },
    )
  ).json();
  expect(collected.success, JSON.stringify(collected)).toBeTruthy();

  // No longer active after collection.
  const after = await (
    await page.request.get(`${BACKEND_URL}/api/hold-money/active`, {
      headers: auth,
    })
  ).json();
  expect(after.data.some((h: { id: number }) => h.id === created.id)).toBe(
    false,
  );
});
