/**
 * lira-web-069 — LIRA-327: bills ride the Mobile Recharge basket, and For
 * Partner is basket-wide, over the web transport (rule 19).
 *
 *   (a) A Katsh bill is staged on the Katsh tab, a Whish App card is picked
 *       on the Whish App tab, and the basket is paid ONCE from the Whish App
 *       tab: the bill is booked under Katsh (its cost leaves the Katsh
 *       drawer, never Whish App's), General gets the full price once, and
 *       voiding the basket nets every drawer to 0 (rule 20).
 *   (b) For Partner is turned on in the Whish App tab with items on two
 *       providers (a confirm is accepted), it is still on in the Katsh tab,
 *       and ONE Submit to Partner books both: the partner owes the total,
 *       each provider drawer pays its own cost, General never moves.
 *
 * Rule 15: the web DB accumulates — items and the partner are created fresh
 * with unique labels, and every money check is a DELTA around its action.
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

const KATSH = { provider: "Katsh", cost: 90_000, sell: 100_000 } as const;
const WHISH = { provider: "WHISH_APP", cost: 45_000, sell: 50_000 } as const;
const BILL_LBP = 300_000;

const DRAWERS = ["Katsh", "Whish_App", "General"] as const;
type Drawer = (typeof DRAWERS)[number];
type Snapshot = Record<Drawer, { usd: number; lbp: number }>;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function postJson(page: Page, auth: Auth, path: string, data?: unknown) {
  return (
    await page.request.post(`${BACKEND_URL}${path}`, { headers: auth, data })
  ).json();
}

async function snapshot(page: Page, auth: Auth): Promise<Snapshot> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/recharge/drawer-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const rows = r.balances as Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
  }>;
  const out = {} as Snapshot;
  for (const name of DRAWERS) {
    const row = rows.find((d) => d.name === name);
    out[name] = { usd: row?.usdBalance ?? 0, lbp: row?.lbpBalance ?? 0 };
  }
  return out;
}

function delta(after: Snapshot, before: Snapshot): Snapshot {
  const out = {} as Snapshot;
  for (const name of DRAWERS) {
    out[name] = {
      usd: after[name].usd - before[name].usd,
      lbp: after[name].lbp - before[name].lbp,
    };
  }
  return out;
}

async function partnerBalance(
  page: Page,
  auth: Auth,
  partnerId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/partners/${partnerId}/balance`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return { usd: r.balance.usd, lbp: r.balance.lbp };
}

/** Provider tabs show only a logo when unselected; the name is the aria-label. */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("button", { name, exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
}

/** Whish App → its Bills grid, priced in LBP. */
async function openWhishBills(page: Page): Promise<void> {
  await openTab(page, "Whish App");
  const billsTab = page
    .locator("button")
    .filter({ hasText: /^Bills$/ })
    .first();
  await expect(billsTab).toBeVisible({ timeout: 10_000 });
  await billsTab.click();
  const lbpSwitch = page.getByRole("radio", { name: "LBP" });
  if (
    (await lbpSwitch.count()) > 0 &&
    (await lbpSwitch.getAttribute("aria-checked")) !== "true"
  ) {
    await lbpSwitch.click();
  }
}

async function pick(page: Page, providerName: string, label: string) {
  const search = page.getByPlaceholder(
    new RegExp(`Search ${providerName} items`, "i"),
  );
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill(label);
  const card = page.getByText(label, { exact: true }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
  // Clear the search so the Bill card (hidden while searching) shows again.
  await search.fill("");
}

async function createItem(
  page: Page,
  auth: Auth,
  it: { provider: string; cost: number; sell: number },
  label: string,
) {
  const created = await postJson(page, auth, "/api/mobile-service-items", {
    provider: it.provider,
    category: "Gaming",
    subcategory: "L069",
    label,
    cost_lbp: it.cost,
    sell_lbp: it.sell,
  });
  expect(created.success, JSON.stringify(created)).toBeTruthy();
}

test.describe("lira-web-069 Mobile Recharge basket: bills and For Partner", () => {
  test("(a) a Katsh bill + a Whish App card paid once from the Whish App tab: the bill is booked under Katsh; basket void nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const whishLabel = `L069a Whish ${stamp}`;
    await createItem(page, auth, WHISH, whishLabel);

    await gotoAndSettle(page, "/#/recharge");

    // A hash-only goto keeps the catalog loaded at login; reload so the items

    // created above are in it.

    await page.reload();

    // Stage a Katsh bill on the Katsh tab.
    // The Bill card defaults to LBP.
    await openTab(page, "Katsh");
    await expect(page.getByRole("button", { name: /^Add Bill$/ })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByPlaceholder("0", { exact: true }).first().fill("300000");
    await page.getByRole("button", { name: /^Add Bill$/ }).click();
    await expect(page.getByText(/Pending: 300,000 LBP/)).toBeVisible();

    // Pick a Whish App card and pay from the Whish App tab.
    await openWhishBills(page);
    await pick(page, "Whish App", whishLabel);
    await page.getByRole("button", { name: /Proceed to Pay/i }).click();
    const list = page.getByTestId("payment-sheet-items");
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(list.getByText(whishLabel, { exact: true })).toBeVisible();
    await expect(list.getByText("Bill", { exact: true })).toBeVisible();
    // Grouped under their providers: Katsh (the bill) and Whish App.
    await expect(page.getByTestId("payment-sheet-item-group")).toHaveCount(2);

    const before = await snapshot(page, auth);
    const checkout = page.waitForResponse(
      (r) =>
        r.url().includes("/api/recharge-basket/checkout") &&
        r.request().method() === "POST",
    );
    const pay = page.getByRole("button", { name: /^Pay / });
    await expect(pay).toBeEnabled({ timeout: 10_000 });
    await pay.click();
    const result = await (await checkout).json();
    expect(result.success, JSON.stringify(result)).toBeTruthy();
    const sessionId = result.sessionId as number;
    expect(sessionId).toBeGreaterThan(0);
    // The bill is booked under Katsh (its own cart entry).
    const modules = (result.results as Array<{ module: string }>).map(
      (r) => r.module,
    );
    expect(modules.sort()).toEqual(["katsh", "whish_app"]);

    await expect
      .poll(async () => delta(await snapshot(page, auth), before).General.lbp, {
        timeout: 10_000,
      })
      .toBeCloseTo(BILL_LBP + WHISH.sell, 0);
    const sold = delta(await snapshot(page, auth), before);
    expect(sold.Katsh.lbp, "Katsh pays the bill").toBeCloseTo(-BILL_LBP, 0);
    expect(sold.Whish_App.lbp, "Whish App pays its card only").toBeCloseTo(
      -WHISH.cost,
      0,
    );
    for (const name of DRAWERS) expect(sold[name].usd).toBeCloseTo(0, 2);

    // Paid: the bill is gone from the Katsh tab too.
    await openTab(page, "Katsh");
    await expect(page.getByText(/Pending: 300,000 LBP/)).toHaveCount(0);

    // Rule 20: voiding the whole basket nets every drawer to 0.
    const voided = await postJson(
      page,
      auth,
      `/api/transactions/session-basket/${sessionId}/void`,
    );
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
    const net = delta(await snapshot(page, auth), before);
    for (const name of DRAWERS) {
      expect(net[name].lbp, `${name} LBP`).toBeCloseTo(0, 0);
      expect(net[name].usd, `${name} USD`).toBeCloseTo(0, 2);
    }
  });

  test("(b) For Partner on, items on Katsh and Whish App, one submit: the partner owes the total, each drawer pays its own cost", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const labels = {
      Katsh: `L069b Katsh ${stamp}`,
      Whish: `L069b Whish ${stamp}`,
    };
    await createItem(page, auth, KATSH, labels.Katsh);
    await createItem(page, auth, WHISH, labels.Whish);
    const partnerName = `L-web-069 Partner ${stamp}`;
    const partner = await postJson(page, auth, "/api/partners", {
      name: partnerName,
      phone: `03${stamp}`,
    });
    expect(partner.success, JSON.stringify(partner)).toBeTruthy();
    const partnerId = partner.data.id as number;

    await gotoAndSettle(page, "/#/recharge");

    // A hash-only goto keeps the catalog loaded at login; reload so the items

    // created above are in it.

    await page.reload();
    await openTab(page, "Katsh");
    await pick(page, "Katsh", labels.Katsh);
    await openWhishBills(page);
    await pick(page, "Whish App", labels.Whish);

    // Turn For Partner on in the Whish App tab: the basket already holds 2
    // items, so it asks first.
    let question = "";
    page.once("dialog", async (d) => {
      question = d.message();
      await d.accept();
    });
    await page.getByTestId("financial-for-partner-toggle").check();
    expect(question).toMatch(/Make all 2 items/);
    const selectPartner = page.getByRole("button", { name: /Select partner/ });
    if ((await selectPartner.count()) > 0) {
      await selectPartner.first().click();
      await page.getByRole("option", { name: partnerName }).click();
    }

    // Still on in the Katsh tab, same partner.
    await openTab(page, "Katsh");
    await expect(page.getByTestId("katsh-for-partner-toggle")).toBeChecked();

    const before = await snapshot(page, auth);
    const balanceBefore = await partnerBalance(page, auth, partnerId);
    const order = page.waitForResponse(
      (r) =>
        r.url().includes("/api/recharge-basket/partner-order") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Submit to Partner/i }).click();
    const result = await (await order).json();
    expect(result.success, JSON.stringify(result)).toBeTruthy();
    expect(result.ids).toHaveLength(2);

    // The partner owes the full selling price of both providers' items.
    await expect
      .poll(
        async () =>
          (await partnerBalance(page, auth, partnerId)).lbp - balanceBefore.lbp,
        { timeout: 10_000 },
      )
      .toBeCloseTo(KATSH.sell + WHISH.sell, 0);

    // Each provider drawer pays its own cost; no counter payment.
    const d = delta(await snapshot(page, auth), before);
    expect(d.Katsh.lbp).toBeCloseTo(-KATSH.cost, 0);
    expect(d.Whish_App.lbp).toBeCloseTo(-WHISH.cost, 0);
    expect(d.General.lbp).toBeCloseTo(0, 0);
    for (const name of DRAWERS) expect(d[name].usd).toBeCloseTo(0, 2);

    // Submitted: For Partner is off again and the basket is empty.
    await expect(
      page.getByTestId("katsh-for-partner-toggle"),
    ).not.toBeChecked();
  });
});
