/**
 * lira-web-004 — service presets over REST.
 *
 * Config CRUD (no money) for custom-service preset templates. Guards the full
 * create → list → update → delete round-trip through the REST transport into
 * the same core ServicePresetService. Tenant-scoped via authenticateJWT.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("service presets create → list → update → delete over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/service-presets`, {
      headers: auth,
      data: {
        name: "Web Spec Preset",
        category: "digital_account",
        price_usd: 5,
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const id = created.data.id as number;
  expect(id).toBeTruthy();

  const listed = await (
    await page.request.get(`${BACKEND_URL}/api/service-presets`, {
      headers: auth,
    })
  ).json();
  expect(listed.success).toBeTruthy();
  expect(listed.data.some((p: { id: number }) => p.id === id)).toBe(true);

  const updated = await (
    await page.request.put(`${BACKEND_URL}/api/service-presets/${id}`, {
      headers: auth,
      data: { price_usd: 9 },
    })
  ).json();
  expect(updated.success).toBeTruthy();
  expect(updated.data.price_usd).toBe(9);

  const deleted = await (
    await page.request.delete(`${BACKEND_URL}/api/service-presets/${id}`, {
      headers: auth,
    })
  ).json();
  expect(deleted.success).toBeTruthy();

  // Gone from the default (active) list.
  const after = await (
    await page.request.get(`${BACKEND_URL}/api/service-presets`, {
      headers: auth,
    })
  ).json();
  expect(after.data.some((p: { id: number }) => p.id === id)).toBe(false);
});
