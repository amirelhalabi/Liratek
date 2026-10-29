/**
 * lira-web-082 — Loto on Settle Account (LIRA-351,
 * specs/351-loto-settle-calendar, T025). Real browser sheet + REST.
 *
 * Owner decisions 2026-10-29: Loto settles only on the day calendar; prizes
 * net within their day; the old Pay / Receive tab and the Loto page's settle
 * dialog are gone.
 *
 *  1. Seeds 3 Loto tickets of 120,000 LBP on a past day that has no Loto row
 *     yet (backdated with `transaction_time`, noon UTC). (Prizes netting
 *     within their day is proven in core — a cash prize cannot be backdated
 *     over REST, so it would land on today.)
 *  2. Suppliers → Loto: a Settle Account button, no Pay / Receive tab.
 *  3. The sheet: clears the default pick, picks only that day, sets the Loto
 *     credit to 0 (other specs may leave credit). The LBP box is pre-filled
 *     with the day's net: 3 × (sale − commission). Saves the What's
 *     new screenshot.
 *  4. Confirm. By identity: that day's ticket rows are closed; the
 *     General drawer moved by exactly −net in LBP.
 *
 * Rule 15: the DB accumulates across runs and specs — rows are matched by
 * kind + id and money is checked as deltas. Rule 30: saves
 * `frontend/public/whats-new/1.35.0/loto-settle-calendar.png` (landscape).
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
  "../../public/whats-new/1.35.0/loto-settle-calendar.png",
);

type Auth = { Authorization: string };

interface Row {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  entry_type: string | null;
  remaining_lbp: number;
  shop_day: string;
  row_scope: "DAY" | "ACCOUNT";
  transaction_id: number | null;
}

async function getJson<T>(page: Page, auth: Auth, url: string): Promise<T> {
  const r = await (
    await page.request.get(`${BACKEND_URL}${url}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

async function lotoSupplierId(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
  ).json();
  const list = (r.suppliers ?? r.data ?? r) as Array<{
    id: number;
    provider: string | null;
  }>;
  const loto = list.find((s) => s.provider === "LOTO");
  expect(loto, JSON.stringify(list)).toBeTruthy();
  return loto!.id;
}

async function queue(page: Page, auth: Auth, id: number): Promise<Row[]> {
  return (
    await getJson<{ transactions: Row[] }>(
      page,
      auth,
      `/api/suppliers/${id}/account-unsettled`,
    )
  ).transactions;
}

async function generalLbp(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{
    balances: Record<string, Record<string, number>>;
  }>(page, auth, "/api/closing/system-expected-balances-dynamic");
  return r.balances.General?.LBP ?? 0;
}

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

const noonUtc = (day: string) => `${day}T12:00:00.000Z`;

/** The most recent past day in this month with no Loto row at all (open or
 *  settled), so the day's colour comes from this spec's rows only. Kept in
 *  the current month so the sheet opens on it. */
async function freePastDay(
  page: Page,
  auth: Auth,
  id: number,
  today: string,
): Promise<string> {
  const open = new Set((await queue(page, auth, id)).map((r) => r.shop_day));
  const month = today.slice(0, 7);
  const busy = new Set(
    (
      await getJson<{ rows: Row[] }>(
        page,
        auth,
        `/api/suppliers/${id}/account-month-rows?month=${month}`,
      )
    ).rows.map((r) => r.shop_day),
  );
  for (let k = 1; k <= 27; k++) {
    const day = shiftDay(today, -k);
    if (day.slice(0, 7) !== month) break;
    if (!open.has(day) && !busy.has(day)) return day;
  }
  test.skip(true, "no free past day left in this month for Loto");
  return "";
}

test("lira-web-082 Loto settles by day: a day's tickets settled from Settle Account", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };

  const lotoId = await lotoSupplierId(page, auth);
  const today = await browserToday(page);
  const DAY = await freePastDay(page, auth, lotoId, today);

  // ── 1. Seed 3 tickets on DAY ────────────────────────────────────────────
  const SALE = 120_000;
  const RATE = 0.0445;
  const OWED = SALE - SALE * RATE; // 114,660
  for (let i = 0; i < 3; i++) {
    const r = await (
      await page.request.post(`${BACKEND_URL}/api/loto/sell`, {
        headers: auth,
        data: {
          ticket_number: `L082-${Date.now()}-${i}`,
          sale_amount: SALE,
          commission_rate: RATE,
          currency: "LBP",
          payment_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
          sale_date: DAY,
          transaction_time: noonUtc(DAY),
        },
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
  }

  const dayRows = (await queue(page, auth, lotoId)).filter(
    (r) => r.shop_day === DAY && r.row_scope === "DAY",
  );
  // The 3 tickets, all this spec's (the day was free).
  expect(dayRows).toHaveLength(3);
  const NET = dayRows.reduce((s, r) => s + r.remaining_lbp, 0);
  expect(NET).toBeCloseTo(3 * OWED, 0);

  // ── 2. Suppliers → Loto: Settle Account, no Pay / Receive ───────────────
  await gotoAndSettle(page, "/#/suppliers");
  await page.getByTestId("supplier-tile-LOTO").click();
  await expect(page.getByText("Pay / Receive")).toHaveCount(0);
  await page.getByTestId("supplier-settle-by-day-button").click();
  const sheet = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  // ── 3. Pick only DAY; no credit ─────────────────────────────────────────
  const bar = sheet.getByTestId("settle-selection-bar");
  const clear = bar.getByRole("button", { name: "Clear", exact: true });
  if (await clear.count()) await clear.click();
  const dayButton = sheet.locator(`[data-day="${DAY}"] button`);
  await expect(dayButton).toBeVisible({ timeout: 15_000 });
  await dayButton.click();
  await expect(dayButton).toHaveAttribute("aria-pressed", "true");
  for (const c of ["usd", "lbp"]) {
    const input = sheet.getByTestId(`supplier-account-settle-credit-${c}`);
    if (await input.count()) {
      await input.fill("0");
      await expect(input).toHaveValue("0");
    }
  }
  const lbp = sheet.getByTestId("supplier-account-settle-section-lbp");
  const amount = lbp.locator('[data-testid^="payment-amount-"]');
  await expect(amount).toHaveCount(1);
  expect(
    Number((await amount.first().inputValue()).replace(/,/g, "")),
  ).toBeCloseTo(NET, 0);

  await sheet
    .getByTestId("supplier-account-settle-calendar")
    .scrollIntoViewIfNeeded();
  mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT });

  // ── 4. Confirm; by identity and deltas ──────────────────────────────────
  const drawerBefore = await generalLbp(page, auth);
  const submit = sheet.getByTestId("supplier-account-settle-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const after = await queue(page, auth, lotoId);
  for (const r of dayRows) {
    expect(
      after.find((x) => x.kind === r.kind && x.id === r.id),
      `row ${r.id} should be closed`,
    ).toBeUndefined();
  }
  expect((await generalLbp(page, auth)) - drawerBefore).toBeCloseTo(-NET, 0);
});
