/**
 * lira-web-109 — LIRA-406: Mobile Recharge → Whish App → Bills sells an Alfa
 * card "Only Days", over the web transport (rule 19).
 *
 * A fresh Whish App Alfa card is created through the API with its Only Days
 * catalog data (face credit $7.58, days cost and days price), so the test
 * does not depend on the starting catalog. Then, in the real form:
 *
 *   - the card offers "Only Days"; ticking it sets the price to the days
 *     price (250,000 LBP) and the returned credit to $7;
 *   - selling it, paid in cash, moves Whish_App LBP by −765,007 (the full card
 *     cost), General LBP by +250,000 and the Alfa USD drawer by +$7;
 *   - voiding the sale brings every drawer back (per currency, rule 20).
 *
 * The What's new screenshot of the Only Days panel is taken here (rule 30).
 *
 * Rule 15: the web DB accumulates — the item is matched by its own fresh
 * label, the transaction by type + that label, and every money check is a
 * DELTA taken around its action.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/whish-only-days.png",
);

type Auth = { Authorization: string };

const COST_LBP = 765_007;
const DAYS_PRICE_LBP = 250_000;
const RETURNED_USD = 7;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function getJson(page: Page, auth: Auth, path: string) {
  const r = await (
    await page.request.get(`${BACKEND_URL}${path}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r;
}

async function postJson(page: Page, auth: Auth, path: string, data?: unknown) {
  return (
    await page.request.post(`${BACKEND_URL}${path}`, { headers: auth, data })
  ).json();
}

type Snapshot = { whishLbp: number; generalLbp: number; alfaUsd: number };

async function snapshot(page: Page, auth: Auth): Promise<Snapshot> {
  const r = await getJson(page, auth, "/api/recharge/drawer-balances");
  const row = (name: string) =>
    (
      r.balances as Array<{
        name: string;
        usdBalance: number;
        lbpBalance: number;
      }>
    ).find((d) => d.name === name);
  return {
    whishLbp: row("Whish_App")?.lbpBalance ?? 0,
    generalLbp: row("General")?.lbpBalance ?? 0,
    alfaUsd: row("Alfa")?.usdBalance ?? 0,
  };
}

function delta(after: Snapshot, before: Snapshot): Snapshot {
  return {
    whishLbp: after.whishLbp - before.whishLbp,
    generalLbp: after.generalLbp - before.generalLbp,
    alfaUsd: after.alfaUsd - before.alfaUsd,
  };
}

async function openWhishBills(page: Page): Promise<void> {
  await gotoAndSettle(page, "/#/recharge");
  // Reload so the item created by the test is in the catalog.
  await page.reload();
  const tab = page
    .getByRole("button", { name: "Whish App", exact: true })
    .first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
  const billsTab = page
    .locator("button")
    .filter({ hasText: /^Bills$/ })
    .first();
  await expect(billsTab).toBeVisible({ timeout: 10_000 });
  await billsTab.click();
  const lbpSwitch = page.getByRole("radio", { name: "LBP" });
  await expect(lbpSwitch).toBeVisible({ timeout: 10_000 });
  if ((await lbpSwitch.getAttribute("aria-checked")) !== "true") {
    await lbpSwitch.click();
  }
}

test.describe("lira-web-109 Whish App Only Days", () => {
  test("an Alfa card sold Only Days: Whish −card cost, General +days price, Alfa +$7; void nets to 0", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const label = `L109 ${stamp}`;

    const item = await postJson(page, auth, "/api/mobile-service-items", {
      provider: "WHISH_APP",
      category: "alfa",
      subcategory: "Prepaid",
      label,
      cost_lbp: COST_LBP,
      sell_lbp: 800_000,
      credits: 7.58,
      validity_days: 30,
      days_cost_lbp: 120_707,
      sell_days_lbp: DAYS_PRICE_LBP,
    });
    expect(item.success, JSON.stringify(item)).toBeTruthy();

    await openWhishBills(page);
    await page.getByPlaceholder(/Search Whish App items/i).fill(label);
    const card = page.getByText(label, { exact: true }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const onlyDays = page.getByRole("checkbox", { name: /Only Days/i });
    await expect(onlyDays).toBeVisible({ timeout: 10_000 });
    await onlyDays.check();
    await expect(page.getByTestId("katsh-onlydays-credits")).toHaveValue("7");
    await expect(page.getByText("250,000 LBP").first()).toBeVisible();

    await page.screenshot({ path: SCREENSHOT, animations: "disabled" });

    const before = await snapshot(page, auth);
    await page.getByRole("button", { name: /Proceed to Pay/i }).click();
    const pay = page.getByRole("button", { name: /^Pay 250,000/ });
    await expect(pay).toBeEnabled({ timeout: 10_000 });
    await pay.click();

    await expect
      .poll(async () => delta(await snapshot(page, auth), before).alfaUsd, {
        timeout: 10_000,
      })
      .toBeCloseTo(RETURNED_USD, 2);
    const sold = delta(await snapshot(page, auth), before);
    expect(sold.whishLbp).toBeCloseTo(-COST_LBP, 0);
    expect(sold.generalLbp).toBeCloseTo(DAYS_PRICE_LBP, 0);

    // Identity: the Whish App sale row carrying this item's own label.
    const recent = await getJson(
      page,
      auth,
      "/api/transactions/recent?limit=100",
    );
    const row = (
      recent.transactions as Array<{
        id: number;
        type: string;
        summary: string | null;
      }>
    ).find(
      (t) =>
        t.type === "FINANCIAL_SERVICE" && (t.summary ?? "").includes(label),
    );
    expect(row, "Whish App Only Days sale not found").toBeTruthy();

    const voided = await postJson(
      page,
      auth,
      `/api/transactions/${row!.id}/void`,
    );
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();

    const net = delta(await snapshot(page, auth), before);
    expect(net.whishLbp).toBeCloseTo(0, 0);
    expect(net.generalLbp).toBeCloseTo(0, 0);
    expect(net.alfaUsd).toBeCloseTo(0, 2);
  });
});
