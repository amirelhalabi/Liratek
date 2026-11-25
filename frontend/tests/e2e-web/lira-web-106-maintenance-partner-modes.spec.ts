/**
 * lira-web-106 — LIRA-403: the partner switch on repair jobs, over the WEB
 * transport (specs/403-maintenance-partner-modes).
 *
 * On the real Maintenance screen:
 *   1. a new job, "For Partner", the partner picked — the What's new
 *      screenshot is taken here (rule 30);
 *   2. "Deliver to partner": no payment window; the partner owes $100
 *      (FOR_MAINTENANCE DEBIT), no drawer moves (rule 15 deltas);
 * Over REST (same core schema as desktop):
 *   3. a Via-Partner job paid $100 cash: General +$100, the shop owes the
 *      partner the $40 labour cost (THROUGH_MAINTENANCE CREDIT);
 *   4. refund both: partner balance and General back where they started.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  drawers,
  expectMoved,
  getJson,
  openShopDay,
  partnerBalance,
  postJson,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/maintenance-partner-switch.png",
);

async function txnOf(
  day: Awaited<ReturnType<typeof openShopDay>>,
  jobId: number,
): Promise<{
  id: number;
  amount_usd: number;
  profit_usd: number;
  client_name: string | null;
}> {
  const r = await getJson<{
    success: boolean;
    transaction: {
      id: number;
      amount_usd: number;
      profit_usd: number;
      client_name: string | null;
    } | null;
  }>(day, `/api/transactions/by-source/maintenance/${jobId}`);
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  expect(r.transaction, `MAINTENANCE txn for job ${jobId}`).toBeTruthy();
  return r.transaction!;
}

test("LIRA-403 repair for a partner and via a partner: partner owed, drawers right, refunds net 0", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const day = await openShopDay(browser);
  const { page } = day;

  try {
    const partnerName = `Tech Partner ${day.stamp}`;
    const created = await postJson<{ success: boolean; data: { id: number } }>(
      day,
      "/api/partners",
      { name: partnerName, phone: `0370${day.stamp}`.slice(0, 15) },
    );
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const partnerId = created.data.id;

    const bal0 = await partnerBalance(day, partnerId);
    const d0 = await drawers(day);

    // ── 1. For Partner on the real screen ────────────────────────────────
    await page.setViewportSize({ width: 1600, height: 1250 });
    await page.goto("/#/maintenance");
    await expect(page.locator("#maintenance-device-name")).toBeVisible({
      timeout: 20_000,
    });
    await page.fill("#maintenance-device-name", `iPhone 12 ${day.stamp}`);
    await page.fill("#maintenance-issue", "Screen — done for a partner");
    await page.fill("#maintenance-cost", "40");
    await page.fill("#maintenance-price", "100");
    await page.getByTestId("maintenance-for-partner-toggle").click();
    // One active partner is auto-picked (PartnerSelector shows its name);
    // with several, the picker opens.
    const selectPartner = page.getByRole("button", { name: /Select partner/ });
    if ((await selectPartner.count()) > 0) {
      await selectPartner.first().click();
      await page.getByRole("option", { name: partnerName }).click();
    } else {
      await expect(page.getByText(`Partner: ${partnerName}`)).toBeVisible();
    }
    await expect(
      page.getByTestId("maintenance-for-partner-notice"),
    ).toContainText("$100.00");
    await expect(page.getByText("Proceed to Checkout")).toHaveCount(0);
    await expect(
      page.getByTestId("maintenance-for-partner-toggle"),
    ).toHaveAttribute("aria-checked", "true");
    await page.mouse.move(1500, 1200); // no hover highlight in the picture
    await page.screenshot({ path: SCREENSHOT, animations: "disabled" });

    // ── 2. Deliver to partner ────────────────────────────────────────────
    const saved = waitPost(page, "/api/maintenance/jobs");
    await page.getByTestId("maintenance-deliver-to-partner").click();
    const forSave = await saved;
    expect(forSave.body.success, JSON.stringify(forSave.body)).toBeTruthy();
    expect(forSave.request).toMatchObject({
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    expect(forSave.request).not.toHaveProperty("payments");
    const forJobId = forSave.body.id as number;

    const bal1 = await partnerBalance(day, partnerId);
    expect(bal1.usd - bal0.usd, "partner owes the full price").toBeCloseTo(
      100,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", 0);
    const forTxn = await txnOf(day, forJobId);
    expect(forTxn.amount_usd).toBeCloseTo(100, 2);
    expect(forTxn.client_name).toBe(`${partnerName} [partner]`);

    // ── 3. Via Partner over REST ─────────────────────────────────────────
    const via = await postJson<{
      success: boolean;
      id: number;
      error?: string;
    }>(day, "/api/maintenance/jobs", {
      device_name: `Galaxy ${day.stamp}`,
      issue_description: "Board repair — outside technician",
      client_name: "Walk-in",
      client_phone: "",
      currency: "USD",
      cost_usd: 40,
      price_usd: 100,
      final_amount_usd: 100,
      exchange_rate: 89500,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      paid_by: "CASH",
      partner_mode: "VIA",
      partner_id: partnerId,
    });
    expect(via.success, JSON.stringify(via)).toBeTruthy();
    const bal2 = await partnerBalance(day, partnerId);
    expect(bal2.usd - bal1.usd, "shop owes the labour cost").toBeCloseTo(
      -40,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", 100);
    const viaTxn = await txnOf(day, via.id);
    expect(viaTxn.profit_usd).toBeCloseTo(60, 2);

    // Rule 23 parity: a For job with a payment leg is refused on REST too.
    const refused = await postJson<{ success: boolean }>(
      day,
      "/api/maintenance/jobs",
      {
        device_name: "Refused",
        currency: "USD",
        price_usd: 10,
        final_amount_usd: 10,
        status: "Delivered_Paid",
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        partner_mode: "FOR",
        partner_id: partnerId,
      },
    );
    expect(refused.success).toBe(false);

    // ── 4. Refund both: everything back (rule 20) ────────────────────────
    for (const txnId of [forTxn.id, viaTxn.id]) {
      const r = await postJson<{ success: boolean }>(
        day,
        `/api/transactions/${txnId}/refund`,
      );
      expect(r.success, JSON.stringify(r)).toBeTruthy();
    }
    const bal3 = await partnerBalance(day, partnerId);
    expect(bal3.usd - bal0.usd).toBeCloseTo(0, 2);
    expect(bal3.lbp - bal0.lbp).toBeCloseTo(0, 0);
    expectMoved(await drawers(day), d0, "General", "USD", 0);
  } finally {
    await day.context.close();
  }
});
