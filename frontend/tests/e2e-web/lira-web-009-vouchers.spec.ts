/**
 * lira-web-009 — voucher (gift-card) config CRUD over REST.
 *
 * Guards the voucher-codes module over the REST transport into the same core
 * VoucherService: create a gift card for a client, find it in the list by its
 * generated code (identity, not "newest row" — rule 15), validate it by code,
 * then cancel it (admin-only). Then a PAGE-LEVEL round-trip: navigate to
 * /vouchers and assert the created code renders — driving getAll THROUGH the
 * useApi() adapter (the REST-direct asserts never exercise the adapter).
 * Tenant-scoped via authenticateJWT.
 *
 * The voucher MONEY path (redemption → customer-account credit) is internal to
 * parent sale/session transactions and is intentionally NOT in this surface.
 *
 * Pre-feature: every /api/vouchers endpoint 404s (no route existed), so create
 * fails — this spec cannot pass without the new REST surface.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("voucher create → list → validate → cancel → page render over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: "Voucher Web Spec", phone_number: "03666999" },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/vouchers`, {
      headers: auth,
      data: { clientId, amount: 25, currency: "USD", note: "web spec" },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const code = created.voucher.code as string;
  const voucherId = created.voucher.id as number;
  expect(code).toBeTruthy();
  expect(created.voucher.status).toBe("pending");

  // Identity match: find OUR voucher by code in the client-scoped list.
  const list = await (
    await page.request.get(`${BACKEND_URL}/api/vouchers?clientId=${clientId}`, {
      headers: auth,
    })
  ).json();
  expect(list.success).toBeTruthy();
  expect(list.vouchers.some((v: { code: string }) => v.code === code)).toBe(
    true,
  );

  const validated = await (
    await page.request.post(`${BACKEND_URL}/api/vouchers/validate`, {
      headers: auth,
      data: { code },
    })
  ).json();
  expect(validated.success, JSON.stringify(validated)).toBeTruthy();
  expect(validated.voucher.code).toBe(code);

  const cancelled = await (
    await page.request.post(`${BACKEND_URL}/api/vouchers/${voucherId}/cancel`, {
      headers: auth,
    })
  ).json();
  expect(cancelled.success, JSON.stringify(cancelled)).toBeTruthy();
  expect(cancelled.voucher.status).toBe("cancelled");

  // Page-level adapter round-trip: the vouchers list must render our code,
  // proving getAll unwraps correctly through useApi() in the browser.
  await page.goto("/#/vouchers");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 15_000 });
});
