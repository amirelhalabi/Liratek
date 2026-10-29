/**
 * lira-web-083 — a partner settle box paid in the other currency (LIRA-359,
 * specs/359-settle-one-payment-box). Rayan's case on Cornertech, 2026-10-29:
 * the shop owed RAWAD HMAIDI $8 + 700,000 LBP and paid everything in LBP.
 *
 *  1. Over REST: a fresh partner (unique name, rule 15 identity) the shop
 *     owes $8 and 700,000 LBP (paper entries, no cash).
 *  2. Partners → the partner → Settle: today is picked. The $ box is paid
 *     in LBP: 712,000 at 89,000. The LBP box keeps its 700,000.
 *  3. The Total line reads 1,412,000 LBP (no dollars). Saves the What's new
 *     screenshot (rule 30).
 *  4. Confirm. The partner is at $0 / 0 LBP and the General drawer moved by
 *     exactly −1,412,000 LBP and $0 (deltas, rule 15).
 */
import { mkdirSync } from "node:fs";
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
  "../../public/whats-new/1.35.0/partner-settle-other-currency.png",
);

type Auth = { Authorization: string };

async function generalDrawer(
  page: Page,
  auth: Auth,
): Promise<{ usd: number; lbp: number }> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/system-expected-balances-dynamic`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const g = (r.balances as Record<string, Record<string, number>>).General;
  return { usd: g?.USD ?? 0, lbp: g?.LBP ?? 0 };
}

test("lira-web-083 partner settle: the $ box paid in LBP", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const post = async (p: string, data: unknown) => {
    const body = await (
      await page.request.post(`${BACKEND_URL}${p}`, { headers: auth, data })
    ).json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    return body;
  };

  // ── 1. The shop owes the partner $8 + 700,000 LBP ───────────────────────
  const name = `RAWAD ${String(Date.now()).slice(-6)}`;
  const partnerId = (await post("/api/partners", { name })).data.id as number;
  for (const [amount, currency] of [
    [8, "USD"],
    [700_000, "LBP"],
  ] as const) {
    await post("/api/partners/transactions", {
      partnerId,
      transactionType: "ADJUSTMENT",
      amount,
      currency,
      direction: "CREDIT",
      notes: "Sejel Adli",
    });
  }

  // ── 2. Settle: the $ box paid in LBP ────────────────────────────────────
  await gotoAndSettle(page, "/#/partners");
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole("button", { name: "Settle", exact: true }).first().click();
  const sheet = page.getByTestId("partner-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  const usdBox = sheet.getByTestId("partner-settle-section-usd");
  const lbpBox = sheet.getByTestId("partner-settle-section-lbp");
  if (!(await usdBox.count())) {
    await sheet.getByText("TODAY").click();
  }
  await expect(usdBox).toBeVisible({ timeout: 15_000 });
  await expect(lbpBox).toBeVisible();

  for (const box of [usdBox, lbpBox]) {
    const rate = box.getByTestId("payment-exchange-rate");
    await rate.fill("89000");
    await rate.blur();
  }
  await usdBox.locator('select[data-testid^="payment-currency-"]').first().selectOption("LBP");
  const usdAmount = usdBox.locator('[data-testid^="payment-amount-"]').first();
  await usdAmount.fill("712000");
  await usdAmount.blur();
  await expect(
    lbpBox.locator('[data-testid^="payment-amount-"]').first(),
  ).toHaveValue(/700,?000/);

  // ── 3. The Total line, and the What's new screenshot ────────────────────
  const total = sheet.getByTestId("partner-settle-paid-total");
  await expect(total).toContainText("1,412,000 LBP");
  await expect(total).not.toContainText("$");
  await total.scrollIntoViewIfNeeded();
  mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT });

  // ── 4. Confirm; by identity and deltas ──────────────────────────────────
  const drawerBefore = await generalDrawer(page, auth);
  await sheet.getByTestId("partner-settle-submit").click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const balance = await (
    await page.request.get(`${BACKEND_URL}/api/partners/${partnerId}/balance`, {
      headers: auth,
    })
  ).json();
  expect(balance.balance.usd).toBeCloseTo(0, 2);
  expect(balance.balance.lbp).toBeCloseTo(0, 0);
  const drawerAfter = await generalDrawer(page, auth);
  expect(drawerAfter.lbp - drawerBefore.lbp).toBeCloseTo(-1_412_000, 0);
  expect(drawerAfter.usd - drawerBefore.usd).toBeCloseTo(0, 2);
});
