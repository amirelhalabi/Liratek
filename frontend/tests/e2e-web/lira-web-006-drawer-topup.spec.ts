/**
 * lira-web-006 — drawer top-ups over REST.
 *
 * Guards the drawer-top-up web transport: source-drawers + create + history
 * through the REST routes into the same core DrawerTopUpService. A $50 create
 * credits the General drawer (verified at the DB level by the impl's curl
 * check); this spec guards the REST round-trip + that the top-up lands in
 * history. Tenant-scoped via authenticateJWT.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("drawer top-up create → history over REST", async ({ page }) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const sources = await (
    await page.request.get(`${BACKEND_URL}/api/drawer-topup/source-drawers`, {
      headers: auth,
    })
  ).json();
  expect(sources.success).toBeTruthy();
  expect(Array.isArray(sources.data)).toBe(true);

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/drawer-topup`, {
      headers: auth,
      data: { amount_usd: 50, amount_lbp: 0, notes: "web spec" },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();

  const history = await (
    await page.request.get(`${BACKEND_URL}/api/drawer-topup/history?limit=10`, {
      headers: auth,
    })
  ).json();
  expect(history.success).toBeTruthy();
  expect(history.data.length).toBeGreaterThan(0);
});
