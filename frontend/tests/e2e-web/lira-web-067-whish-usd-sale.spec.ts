/**
 * lira-web-067 — LIRA-324: Recharge → Whish App → Bills sold in USD, over the
 * web transport (rule 19).
 *
 * A fresh USD-only Whish App item (no LBP price, cost $3.00, sell $3.50) is
 * created through the API, so the test does not depend on migration v218 or
 * the starting catalog. Then, in the real form:
 *
 *   - the item is hidden in LBP mode and shows in USD mode, priced in $;
 *   - selling it, paid $3.50 cash, moves Whish_App USD by −3.00 and General
 *     USD by +3.50, and nothing in LBP;
 *   - voiding the sale brings both drawers back (per currency, rule 20).
 *
 * Rule 15: the web DB accumulates — the item is matched by its own fresh
 * label, the transaction by type + that label, and every money check is a
 * DELTA taken around its action.
 *
 * Written before it was run; the owner is asked before e2e runs.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

const COST_USD = 3;
const SELL_USD = 3.5;

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

type Snapshot = {
  whishUsd: number;
  whishLbp: number;
  generalUsd: number;
  generalLbp: number;
};

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
    whishUsd: row("Whish_App")?.usdBalance ?? 0,
    whishLbp: row("Whish_App")?.lbpBalance ?? 0,
    generalUsd: row("General")?.usdBalance ?? 0,
    generalLbp: row("General")?.lbpBalance ?? 0,
  };
}

function delta(after: Snapshot, before: Snapshot): Snapshot {
  return {
    whishUsd: after.whishUsd - before.whishUsd,
    whishLbp: after.whishLbp - before.whishLbp,
    generalUsd: after.generalUsd - before.generalUsd,
    generalLbp: after.generalLbp - before.generalLbp,
  };
}

async function openWhishBills(page: Page): Promise<void> {
  await gotoAndSettle(page, "/#/recharge");
  // A hash-only goto keeps the catalog loaded at login; reload so the item
  // created by the test is in it.
  await page.reload();
  // Provider tabs show only a logo when unselected; the name is the
  // button's accessible name.
  const tab = page
    .getByRole("button", { name: "Whish App", exact: true })
    .first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
  // Whish App keeps its inner Transfer/Bills mode — force Bills.
  const billsTab = page
    .locator("button")
    .filter({ hasText: /^Bills$/ })
    .first();
  await expect(billsTab).toBeVisible({ timeout: 10_000 });
  await billsTab.click();
}

test.describe("lira-web-067 Whish App Bills in USD", () => {
  test("a USD-only item shows only in USD; sold for $3.50 cash: Whish −3, General +3.50; void nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const label = `L067 USD Card ${stamp}`;

    const item = await postJson(page, auth, "/api/mobile-service-items", {
      provider: "WHISH_APP",
      category: "Gaming",
      subcategory: "L067 USD",
      label,
      cost_lbp: 0,
      sell_lbp: 0,
      cost_usd: COST_USD,
      sell_usd: SELL_USD,
    });
    expect(item.success, JSON.stringify(item)).toBeTruthy();

    await openWhishBills(page);
    const search = page.getByPlaceholder(/Search Whish App items/i);
    const usdSwitch = page.getByRole("radio", { name: "USD" });
    const lbpSwitch = page.getByRole("radio", { name: "LBP" });
    await expect(usdSwitch).toBeVisible({ timeout: 10_000 });

    // LBP mode: the USD-only item is hidden.
    if ((await lbpSwitch.getAttribute("aria-checked")) !== "true") {
      await lbpSwitch.click();
    }
    await search.fill(label);
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);

    // USD mode: it shows, priced in dollars.
    await usdSwitch.click();
    await expect(usdSwitch).toHaveAttribute("aria-checked", "true");
    await search.fill(label);
    const card = page.getByText(label, { exact: true }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("$3.50").first()).toBeVisible();

    const before = await snapshot(page, auth);
    await card.click();
    await page.getByRole("button", { name: /Proceed to Pay/i }).click();
    const pay = page.getByRole("button", { name: /^Pay \$3\.50/ });
    await expect(pay).toBeEnabled({ timeout: 10_000 });
    await pay.click();

    await expect
      .poll(async () => delta(await snapshot(page, auth), before).whishUsd, {
        timeout: 10_000,
      })
      .toBeCloseTo(-COST_USD, 2);
    const sold = delta(await snapshot(page, auth), before);
    expect(sold.generalUsd).toBeCloseTo(SELL_USD, 2);
    expect(sold.whishLbp).toBeCloseTo(0, 2);
    expect(sold.generalLbp).toBeCloseTo(0, 2);

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
        amount_usd: number;
      }>
    ).find(
      (t) =>
        t.type === "FINANCIAL_SERVICE" && (t.summary ?? "").includes(label),
    );
    expect(row, "Whish App USD sale not found").toBeTruthy();
    expect(row!.amount_usd).toBeCloseTo(SELL_USD, 2);

    const voided = await postJson(
      page,
      auth,
      `/api/transactions/${row!.id}/void`,
    );
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();

    const net = delta(await snapshot(page, auth), before);
    expect(net.whishUsd).toBeCloseTo(0, 2);
    expect(net.generalUsd).toBeCloseTo(0, 2);
    expect(net.whishLbp).toBeCloseTo(0, 2);
    expect(net.generalLbp).toBeCloseTo(0, 2);

    // Leave the device on LBP (the default) for later specs.
    await lbpSwitch.click();
  });
});
