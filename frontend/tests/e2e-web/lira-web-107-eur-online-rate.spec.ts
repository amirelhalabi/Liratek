/**
 * lira-web-107 — LIRA-404: the euro takes its rate from the online feed, not
 * Settings (specs/404-eur-online-rate), over the WEB transport.
 *
 * The feed (open.er-api.com) is mocked with fixed numbers so the run never
 * depends on the network: 1 USD = 0.8 EUR → 1.25 USD per euro.
 *
 *   1. No EUR rate row in Settings (v235 removed it; an earlier spec on the
 *      shared DB may have re-added one, so it is deleted first over REST).
 *   2. On the real Exchange screen: 100 EUR → USD at the feed rate, no
 *      spread — the request carries leg1Rate 1.25 and amountOut 125; General
 *      EUR +100, USD −125 (rule 15 deltas).
 *   3. Earlier runs' EUR position is written off first and 200 € at $1.10
 *      added (admin adjustment), so the panel reads 300 € at an average of
 *      $1.15 and +$30.00 unrealized.
 *   4. The Open Positions panel shows the EUR Market (USD) $1.2500 from the
 *      feed (the server sends null) — the What's new screenshot is taken
 *      here (rule 30).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_URL, test, expect } from "./fixtures";
import {
  drawers,
  expectMoved,
  getJson,
  openShopDay,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/eur-positions-market.png",
);

const FEED = {
  result: "success",
  base_code: "USD",
  time_last_update_utc: "Tue, 25 Nov 2026 00:02:31 +0000",
  time_next_update_unix: Math.floor(Date.now() / 1000) + 24 * 3600,
  rates: {
    USD: 1,
    LBP: 89_500,
    EUR: 0.8,
    GBP: 0.75,
    CAD: 1.4,
    AUD: 1.5,
    TRY: 40,
  },
};

test("LIRA-404 EUR exchanged at the online rate with no Settings row; Open Positions shows the feed market", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const day = await openShopDay(browser);
  const { page } = day;

  try {
    await day.context.route("https://open.er-api.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FEED),
      }),
    );

    // ── 1. No EUR row in Settings ────────────────────────────────────────
    type RatesRes = { success: boolean; rates: Array<{ to_code: string }> };
    let rates = await getJson<RatesRes>(day, "/api/rates");
    if (rates.rates.some((r) => r.to_code === "EUR")) {
      const del = await page.request.delete(
        `${BACKEND_URL}/api/rates/USD/EUR`,
        {
          headers: day.auth,
        },
      );
      expect(del.ok(), await del.text()).toBeTruthy();
      rates = await getJson<RatesRes>(day, "/api/rates");
    }
    expect(rates.success, JSON.stringify(rates)).toBeTruthy();
    expect(rates.rates.map((r) => r.to_code)).not.toContain("EUR");
    expect(rates.rates.map((r) => r.to_code)).toContain("LBP");

    // A known EUR position for the panel (and the picture): write off what
    // earlier runs left on the shared DB, then 200 € held at $1.10 each.
    type Position = {
      currency_code: string;
      open_qty: number;
      current_market_unit_usd: number | null;
    };
    const positionsOf = async () =>
      (
        await getJson<{ success: boolean; data: Position[] }>(
          day,
          "/api/exchange-lots/positions",
        )
      ).data;
    const adjust = async (qty: number, unitCostUsd?: number) => {
      const r = await page.request.post(
        `${BACKEND_URL}/api/exchange-lots/adjust`,
        {
          headers: { ...day.auth, "Idempotency-Key": randomUUID() },
          data: {
            currencyCode: "EUR",
            qty,
            ...(unitCostUsd ? { unitCostUsd } : {}),
            note: "lira-web-107 e2e: known EUR position",
          },
        },
      );
      const j = (await r.json()) as { success: boolean };
      expect(j.success, JSON.stringify(j)).toBeTruthy();
    };
    const held = (await positionsOf()).find((p) => p.currency_code === "EUR");
    if (held && held.open_qty > 0.005) await adjust(-held.open_qty);
    await adjust(200, 1.1);

    // ── 2. 100 EUR → USD on the real screen ──────────────────────────────
    const d0 = await drawers(day);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/#/exchange");
    await expect(page.getByTestId("exchange-swap-button")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByPlaceholder("Search currency...").fill("EUR");
    // The dropdown option ("EUR €") — not the Positions panel's "View EUR
    // history" button, which also matches /EUR/.
    await page.getByRole("button", { name: "EUR €", exact: true }).click();
    await page.getByRole("button", { name: "USD", exact: true }).nth(1).click();
    await page.getByPlaceholder("0.00").first().fill("100");
    await page.getByRole("button", { name: /Proceed to Payout/ }).click();
    const res = waitPost(page, "/api/exchange/transactions");
    await page.getByRole("button", { name: /^Pay/ }).last().click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(request).toMatchObject({ fromCurrency: "EUR", toCurrency: "USD" });
    expect(Number(request.leg1Rate)).toBeCloseTo(1.25, 6);
    expect(Number(request.leg1MarketRate)).toBeCloseTo(1.25, 6);
    expect(Number(request.amountIn)).toBeCloseTo(100, 6);
    expect(Number(request.amountOut)).toBeCloseTo(125, 2);
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "EUR", 100);
    expectMoved(d1, d0, "General", "USD", -125);

    // ── 3. Open Positions: Market from the feed ──────────────────────────
    const eurServer = (await positionsOf()).find(
      (p) => p.currency_code === "EUR",
    );
    expect(eurServer?.open_qty).toBeCloseTo(300, 6);
    expect(eurServer!.current_market_unit_usd).toBeNull(); // no Settings row

    // The shared e2e DB carries positions other specs opened (e.g. a random
    // test currency code). Keep only EUR in the panel for the What's new
    // picture — the EUR row itself is the real server response.
    await page.route("**/api/exchange-lots/positions**", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        data?: Array<{ currency_code: string }>;
      } & Record<string, unknown>;
      const data = Array.isArray(body.data)
        ? body.data.filter((p) => p.currency_code === "EUR")
        : body.data;
      await route.fulfill({ response, json: { ...body, data } });
    });

    // A fresh load (toast gone, form cleared); the feed is still mocked.
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.reload();
    const panel = page
      .getByRole("heading", { name: "Open Positions" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    const eurRow = panel.locator("tr", { hasText: "EUR" });
    await expect(eurRow).toBeVisible({ timeout: 20_000 });
    await expect(eurRow).toContainText("$1.2500"); // market from the feed
    await expect(eurRow).toContainText("$1.1500"); // avg of 200 @ 1.10 + 100 @ 1.25
    await expect(eurRow).toContainText("+$30.00"); // 300 × (1.25 − 1.15)
    await expect(eurRow.getByText("—")).toHaveCount(0);
    await expect(panel).toContainText("Indicative — market feed may be stale");

    await panel.scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5); // no hover highlight in the picture
    await page.screenshot({ path: SCREENSHOT, animations: "disabled" });
  } finally {
    await day.context.close();
  }
});
