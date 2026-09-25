/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183)
 * extends this file with partial-pickup + void coverage over REST; the new
 * assertions fail against pre-fix code by construction (no
 * hold_money_pickups table, no void route) — rule 17.
 *
 * lira-web-003 — hold-money over REST.
 *
 * Guards the hold-money web-parity work: create → active → collect all run
 * through the REST transport into the same core HoldMoneyService. Holding
 * posts its payment legs, collecting posts a payout (net zero across a full
 * pickup); both journal a transaction row with zero profit (FEATURE_GUIDE
 * §10). A collect call with no body still works (every field is optional —
 * the pre-existing backward-compat fallback). Drawer deltas are proven at
 * the DB level by the impl's curl check; this spec guards the REST
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

test("LIRA-214: partial pickup over REST leaves the hold active, and voiding a pickup reopens it", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/hold-money`, {
      headers: auth,
      data: { client_name: "HM Web Partial", usd_amount: 50 },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();

  // Partial pickup: $20 of the $50 held.
  const partial = await (
    await page.request.post(
      `${BACKEND_URL}/api/hold-money/${created.id}/collect`,
      { headers: auth, data: { usd_amount: 20 } },
    )
  ).json();
  expect(partial.success, JSON.stringify(partial)).toBeTruthy();

  const activeAfterPartial = await (
    await page.request.get(`${BACKEND_URL}/api/hold-money/active`, {
      headers: auth,
    })
  ).json();
  const row = activeAfterPartial.data.find(
    (h: { id: number }) => h.id === created.id,
  );
  expect(row).toBeTruthy();
  expect(row.status).toBe("held");
  expect(row.remaining_usd).toBeCloseTo(30, 2);

  // Over-collecting the $30 remainder as $50 is rejected.
  const overCollect = await (
    await page.request.post(
      `${BACKEND_URL}/api/hold-money/${created.id}/collect`,
      { headers: auth, data: { usd_amount: 50 } },
    )
  ).json();
  expect(overCollect.success).toBe(false);

  // Void the partial pickup — re-credits it and the hold stays/returns to
  // its full remaining balance.
  const pickups = await (
    await page.request.get(
      `${BACKEND_URL}/api/hold-money/${created.id}/pickups`,
      { headers: auth },
    )
  ).json();
  expect(pickups.success, JSON.stringify(pickups)).toBeTruthy();
  const pickupId = pickups.data[0]?.id;
  expect(pickupId).toBeTruthy();

  const voided = await (
    await page.request.post(
      `${BACKEND_URL}/api/hold-money/pickups/${pickupId}/void`,
      { headers: auth },
    )
  ).json();
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();

  const activeAfterVoid = await (
    await page.request.get(`${BACKEND_URL}/api/hold-money/active`, {
      headers: auth,
    })
  ).json();
  const rowAfterVoid = activeAfterVoid.data.find(
    (h: { id: number }) => h.id === created.id,
  );
  expect(rowAfterVoid.remaining_usd).toBeCloseTo(50, 2);
});
