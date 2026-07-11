/**
 * lira-web-008 — partners config + partner_ledger over REST.
 *
 * Guards the partners module over the REST transport into the same core
 * PartnerService:
 *  - create a partner (config record)
 *  - record a DEBIT $50 ledger entry → balance usd = +50 (partner owes us,
 *    FEATURE_GUIDE §7 partner-ledger sign; balance = DEBIT − CREDIT)
 *  - settle $50 → server computes CREDIT (positive balance) → balance = 0
 * Then a PAGE-LEVEL round-trip: navigate to /partners and assert the created
 * partner renders — this drives getAllBalances THROUGH the useApi() adapter
 * (unwrap key `res.balances`), which the REST-direct asserts above never
 * exercise. All routes are tenant-scoped via authenticateJWT.
 *
 * Pre-feature: every /api/partners endpoint 404s (no route existed), so the
 * create step fails — this spec cannot pass without the new REST surface.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("partner create → DEBIT ledger → settle → page render over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // Unique name — partners.name is UNIQUE and the e2e DB accumulates across
  // runs, so a fixed name would collide on the second run (rule 15 identity).
  const name = `Partner Web ${Date.now()}`;

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: { name, phone: "03555888" },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const partnerId = created.data.id as number;
  expect(partnerId).toBeTruthy();

  // Record a manual DEBIT of $50 (partner owes us).
  const recorded = await (
    await page.request.post(`${BACKEND_URL}/api/partners/transactions`, {
      headers: auth,
      data: {
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 50,
        currency: "USD",
        direction: "DEBIT",
      },
    })
  ).json();
  expect(recorded.success, JSON.stringify(recorded)).toBeTruthy();

  const bal = await (
    await page.request.get(`${BACKEND_URL}/api/partners/${partnerId}/balance`, {
      headers: auth,
    })
  ).json();
  expect(bal.success).toBeTruthy();
  expect(bal.balance.usd).toBe(50); // DEBIT − CREDIT

  // Settle $50 — server computes direction (positive balance → CREDIT).
  const settled = await (
    await page.request.post(`${BACKEND_URL}/api/partners/settle`, {
      headers: auth,
      data: {
        partnerId,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
      },
    })
  ).json();
  expect(settled.success, JSON.stringify(settled)).toBeTruthy();

  const balAfter = await (
    await page.request.get(`${BACKEND_URL}/api/partners/${partnerId}/balance`, {
      headers: auth,
    })
  ).json();
  expect(balAfter.balance.usd).toBe(0);

  // Page-level adapter round-trip: the partners list must render our partner,
  // proving getAllBalances unwraps correctly through useApi() in the browser.
  await page.goto("/#/partners");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
});
