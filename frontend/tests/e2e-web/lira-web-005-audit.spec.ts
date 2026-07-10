/**
 * lira-web-005 — audit log (read-only) over REST.
 *
 * Guards the audit-viewer web transport: search + recent read through the REST
 * routes into the same core AuditService. Asserts well-formed results (rows
 * array + numeric total) rather than seeded data — REST action routes do not
 * yet write audit entries (audit WRITING over REST is a separate, documented
 * gap; this covers the viewer READ path only).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("audit search + recent respond over REST", async ({ page }) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const search = await (
    await page.request.post(`${BACKEND_URL}/api/audit/search`, {
      headers: auth,
      data: { limit: 25, offset: 0 },
    })
  ).json();
  expect(search.success, JSON.stringify(search)).toBeTruthy();
  expect(Array.isArray(search.rows)).toBe(true);
  expect(typeof search.total).toBe("number");

  const recent = await (
    await page.request.get(`${BACKEND_URL}/api/audit/recent?limit=10`, {
      headers: auth,
    })
  ).json();
  expect(recent.success).toBeTruthy();
  expect(Array.isArray(recent.rows)).toBe(true);
});
