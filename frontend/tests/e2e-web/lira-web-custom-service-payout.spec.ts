/**
 * NOT RUN — the owner runs the e2e suite later (fix-round I4).
 *
 * lira-web — OWNER_NOTES_REMAINING_BUILD.md #16 Custom Services "Pay out"
 * (Route A, the Syria transfer OUT, migration v185, fix-round I4), driven
 * over REST — the web-transport twin of
 * frontend/tests/e2e-electron/lira-custom-service-payout.spec.ts.
 *
 * "Pay out" is `partner_mode: 'VIA'` with `direction: 'OUT'` instead of the
 * default 'IN' — not a third partner mode. Owner's own worked example: $100
 * arrives via the partner, the recipient gets $97 cash, $3 is profit
 * (commission), same day.
 *   - price_usd = what the PARTNER now owes the shop (THROUGH_CUSTOM_SERVICE
 *     partner_ledger DEBIT).
 *   - cost_usd  = what physically leaves the General drawer to the
 *     recipient, CASH only.
 *   - profit_usd stays price − cost.
 *
 * `POST /api/custom-services` validates against the SAME core
 * `createCustomServiceSchema` (with its two payout refines) the desktop IPC
 * handler's local schema now mirrors (fix-round I2) — proving REST accepts
 * exactly what desktop accepts is therefore a parity check on the SCHEMA,
 * not just on this one route.
 *
 * Rule 15: a fresh partner per run (identity by returned id), deltas only.
 * Whish_System is not asserted here — `GET /api/dashboard/drawer-balances`
 * exposes only `generalDrawer`/`omtDrawer` (the PRIMARY cash drawer, whichever
 * of OMT_System/Whish_System `shop_base_system` names) /`appWalletDrawer`,
 * no direct non-primary-system field; the desktop spec (full named-drawer
 * IPC surface) is the one that proves Whish_System specifically stays at 0.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("Pay out over REST: $100 arrives, $97 leaves General, $3 profit — badge OUT, void nets to 0", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();

  const partner = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: { name: `L-web Syria Corridor ${ts}`, phone: `Lweb${ts}`.slice(0, 15) },
    })
  ).json();
  expect(partner.success, JSON.stringify(partner)).toBeTruthy();
  const partnerId = partner.data.id as number;
  expect(partnerId).toBeTruthy();

  const balOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balance.usd as number;
  };
  const ledgerOf = async (): Promise<
    Array<{
      transaction_type: string | null;
      direction: "DEBIT" | "CREDIT";
      amount: number;
      currency: string;
      reference_table: string | null;
      reference_id: number | null;
    }>
  > => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/partners/${partnerId}/ledger`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.statement.entries;
  };
  const generalDrawerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };

  const generalBefore = await generalDrawerUsd();

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/custom-services`, {
      headers: auth,
      data: {
        description: `L-web Syria transfer payout ${ts}`,
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const serviceId = created.id as number;
  expect(serviceId).toBeTruthy();

  // Drawer: exactly the $97 payout left General.
  expect(await generalDrawerUsd()).toBeCloseTo(generalBefore - 97, 2);

  // Partner ledger: ONE THROUGH_CUSTOM_SERVICE DEBIT for the full $100 that
  // "arrived" via the partner — never the $97 payout figure.
  const ledgerAfterCreate = await ledgerOf();
  const debitRow = ledgerAfterCreate.find(
    (e) =>
      e.transaction_type === "THROUGH_CUSTOM_SERVICE" &&
      e.reference_table === "custom_services" &&
      e.reference_id === serviceId,
  );
  expect(debitRow, JSON.stringify(ledgerAfterCreate)).toBeTruthy();
  expect(debitRow!.direction).toBe("DEBIT");
  expect(debitRow!.amount).toBeCloseTo(100, 2);
  expect(await balOf()).toBeCloseTo(100, 2);

  // Identity-matched unified row: face amount is the payout (cost), profit
  // is the commission, badge (metadata_json.direction) is OUT.
  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?limit=50&source_table=custom_services`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const rows: Array<{
    id: number;
    source_id: number;
    amount_usd: number;
    profit_usd: number;
    metadata_json: string | null;
  }> = recent.transactions ?? [];
  const row = rows.find((r) => r.source_id === serviceId);
  expect(row, JSON.stringify(rows.slice(0, 5))).toBeTruthy();
  expect(row!.amount_usd).toBeCloseTo(97, 2);
  expect(row!.profit_usd).toBeCloseTo(3, 2);
  const meta = row!.metadata_json ? JSON.parse(row!.metadata_json) : {};
  expect(meta.direction).toBe("OUT");

  // Void: create + void nets every ledger touched to 0 (rule 20).
  const voidResult = await (
    await page.request.delete(`${BACKEND_URL}/api/custom-services/${serviceId}`, {
      headers: auth,
    })
  ).json();
  expect(voidResult.success, JSON.stringify(voidResult)).toBeTruthy();

  expect(await generalDrawerUsd()).toBeCloseTo(generalBefore, 2);
  expect(await balOf()).toBeCloseTo(0, 2);

  const ledgerAfterVoid = await ledgerOf();
  const reversalRow = ledgerAfterVoid.find(
    (e) =>
      e.transaction_type === "THROUGH_CUSTOM_SERVICE" &&
      e.reference_table === "custom_services" &&
      e.reference_id === serviceId &&
      e.direction === "CREDIT",
  );
  expect(reversalRow, JSON.stringify(ledgerAfterVoid)).toBeTruthy();
});

test("Pay out is rejected without a Via-Partner mode over REST (schema parity, I2)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const result = await (
    await page.request.post(`${BACKEND_URL}/api/custom-services`, {
      headers: auth,
      data: {
        description: "L-web bare payout, no partner mode",
        price_usd: 50,
        cost_usd: 48,
        direction: "OUT",
      },
    })
  ).json();

  expect(result.success).toBe(false);
});
