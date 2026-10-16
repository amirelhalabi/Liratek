/**
 * lira-web-068 — LIRA-326: one Mobile Recharge basket across providers, over
 * the web transport (rule 19).
 *
 * Three fresh LBP items (Katsh, iPick, Whish App) are created through the API,
 * so the test does not depend on the starting catalog. Then, in the real page:
 *
 *   - one item is picked on each of the Katsh, iPick and Whish App tabs —
 *     switching tabs keeps the earlier picks;
 *   - Proceed to Pay on the Whish App tab opens ONE payment window listing all
 *     three items, grouped by provider;
 *   - paying it in full cash takes each item's cost from its OWN provider
 *     drawer (never the tab the payment was started from), and General gets
 *     the full price once;
 *   - voiding the basket as a whole brings every drawer back (rule 20).
 *
 * Rule 15: the web DB accumulates — items are matched by their own fresh
 * labels, the basket by the session id the checkout returns, and every money
 * check is a DELTA taken around its action.
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

const ITEMS = {
  Katsh: { provider: "Katsh", cost: 90_000, sell: 100_000 },
  iPick: { provider: "iPick", cost: 180_000, sell: 200_000 },
  Whish: { provider: "WHISH_APP", cost: 45_000, sell: 50_000 },
} as const;
const TOTAL_SELL = ITEMS.Katsh.sell + ITEMS.iPick.sell + ITEMS.Whish.sell; // 350,000

const DRAWERS = ["Katsh", "iPick", "Whish_App", "General"] as const;
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

/** Provider tabs show only a logo when unselected; the name is the aria-label. */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("button", { name, exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
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
}

test.describe("lira-web-068 Mobile Recharge basket across providers", () => {
  test("Katsh + iPick + Whish App picked on three tabs, paid once: each drawer pays its own cost; basket void nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    const stamp = Date.now().toString().slice(-6);
    const labels = {
      Katsh: `L068 Katsh ${stamp}`,
      iPick: `L068 iPick ${stamp}`,
      Whish: `L068 Whish ${stamp}`,
    };

    for (const key of ["Katsh", "iPick", "Whish"] as const) {
      const it = ITEMS[key];
      const created = await postJson(page, auth, "/api/mobile-service-items", {
        provider: it.provider,
        category: "Gaming",
        subcategory: "L068",
        label: labels[key],
        cost_lbp: it.cost,
        sell_lbp: it.sell,
      });
      expect(created.success, JSON.stringify(created)).toBeTruthy();
    }

    await gotoAndSettle(page, "/#/recharge");

    // A hash-only goto keeps the catalog loaded at login; reload so the items

    // created above are in it.

    await page.reload();

    // Pick one item on each provider tab.
    await openTab(page, "Katsh");
    await pick(page, "Katsh", labels.Katsh);
    await openTab(page, "iPick");
    await pick(page, "iPick", labels.iPick);

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
    await page.getByPlaceholder(/Search Whish App items/i).fill(labels.Whish);
    const whishCard = page.getByText(labels.Whish, { exact: true }).first();
    await expect(whishCard).toBeVisible({ timeout: 10_000 });
    await whishCard.click();

    // Switching away and back keeps the Katsh pick (FR-001).
    await openTab(page, "Katsh");
    await page.getByPlaceholder(/Search Katsh items/i).fill(labels.Katsh);
    await openTab(page, "Whish App");
    await billsTab.click();
    await expect(page.getByPlaceholder(/Search Whish App items/i)).toBeVisible({
      timeout: 10_000,
    });

    // ONE payment window lists all three, grouped by provider (FR-003).
    await page.getByRole("button", { name: /Proceed to Pay/i }).click();
    const list = page.getByTestId("payment-sheet-items");
    await expect(list).toBeVisible({ timeout: 10_000 });
    for (const label of Object.values(labels)) {
      await expect(list.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("payment-sheet-item-group")).toHaveCount(3);

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

    // FR-004: every cost leaves its own provider; General gets the price once.
    await expect
      .poll(async () => delta(await snapshot(page, auth), before).General.lbp, {
        timeout: 10_000,
      })
      .toBeCloseTo(TOTAL_SELL, 0);
    const sold = delta(await snapshot(page, auth), before);
    expect(sold.Katsh.lbp).toBeCloseTo(-ITEMS.Katsh.cost, 0);
    expect(sold.iPick.lbp).toBeCloseTo(-ITEMS.iPick.cost, 0);
    expect(sold.Whish_App.lbp).toBeCloseTo(-ITEMS.Whish.cost, 0);
    for (const name of DRAWERS) expect(sold[name].usd).toBeCloseTo(0, 2);

    // The basket is emptied after payment.
    await expect(list).toHaveCount(0);

    // FR-009: voiding the basket as a whole nets every drawer to 0.
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
});
