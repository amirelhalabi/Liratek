/**
 * lira-web-091 — settle the OMT account from the amount on OMT's SMS
 * (LIRA-370, specs/370-omt-sms-amount-settle). Real browser sheet + REST.
 *
 * 1. We owe OMT: one past day with an Intra send. The sheet opens with no
 *    commission type ticked (LIRA-378: the SMS box at the gross owed, the
 *    expected commission "stays owed"); ticking All types brings the box to
 *    owed − expected commission; the cashier types $10 less (OMT gave $10
 *    more commission). One settlement closes the day: the OMT drawer pays
 *    exactly the SMS figure and the settlement's profit is expected + $10.
 *    Saves the What's new screenshot.
 * 2. OMT owes us, the SMS includes only Western Union shares: a Western
 *    Union receive and an Intra send on another past day. Both transfers
 *    close, the drawer receives the SMS figure, profit = the WU share only,
 *    and the Intra share stays owed by OMT (account-owed-shares read).
 *
 * Rule 15: the account carries other specs' backlog, so each settlement is
 * scoped to this spec's own day, rows are matched by kind + id, and every
 * money check is a delta.
 */
import type { Locator, Page } from "@playwright/test";
import { tickAllSmsTypes } from "./helpers/omtSmsSettle";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

interface QueueRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  remaining_usd: number;
  shop_day: string;
  expected_commission_usd?: number;
}
interface RecentTxn {
  id: number;
  type: string;
  profit_usd: number;
  metadata_json: string | null;
}

async function getJson<T>(page: Page, auth: Auth, url: string): Promise<T> {
  const r = await (await page.request.get(`${BACKEND_URL}${url}`, { headers: auth })).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

async function omtId(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{ balances: Array<{ account_supplier_id: number; account_name: string }> }>(
    page,
    auth,
    "/api/suppliers/account-balances",
  );
  const a = r.balances.find((b) => b.account_name === "OMT");
  expect(a).toBeTruthy();
  return a!.account_supplier_id;
}

const queue = async (page: Page, auth: Auth, id: number) =>
  (await getJson<{ transactions: QueueRow[] }>(page, auth, `/api/suppliers/${id}/account-unsettled`))
    .transactions;

async function omtDrawerUsd(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{ balances: Array<{ name: string; usdBalance: number }> }>(
    page,
    auth,
    "/api/recharge/drawer-balances",
  );
  return r.balances.find((b) => b.name === "OMT_System")!.usdBalance;
}

/** The settlement that closed `rowId` (identity, never "the newest"). */
async function settlementFor(page: Page, auth: Auth, rowId: number): Promise<RecentTxn> {
  const r = await getJson<{ transactions: RecentTxn[] }>(
    page,
    auth,
    "/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=300",
  );
  const t = r.transactions.find((x) => {
    const sel = (JSON.parse(x.metadata_json ?? "{}").selections ?? []) as Array<{ kind: string; id: number }>;
    return sel.some((s) => s.kind === "FINANCIAL_SERVICE" && s.id === rowId);
  });
  expect(t, `no settlement selected FINANCIAL_SERVICE:${rowId}`).toBeTruthy();
  return t!;
}

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
}
const shiftDay = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const noonUtc = (day: string) => `${day}T12:00:00.000Z`;
const monthNumber = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));

async function freePastDay(page: Page, auth: Auth, id: number, today: string, skip: string[] = []) {
  const open = new Set((await queue(page, auth, id)).map((r) => r.shop_day));
  for (let k = 1; k <= 180; k++) {
    const day = shiftDay(today, -k);
    if (!open.has(day) && !skip.includes(day)) return day;
  }
  throw new Error("no free past day");
}

async function transfer(
  page: Page,
  auth: Auth,
  data: { serviceType: "SEND" | "RECEIVE"; amount: number; fee: number; type: string; day: string },
): Promise<number> {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: data.serviceType,
        amount: data.amount,
        currency: "USD",
        omtServiceType: data.type,
        omtFee: data.fee,
        ...(data.serviceType === "RECEIVE"
          ? { cashoutMethod: "CASH", payments: [{ method: "CASH", currencyCode: "USD", amount: data.amount }] }
          : { payments: [{ method: "CASH", currencyCode: "USD", amount: data.amount + data.fee }] }),
        transaction_time: noonUtc(data.day),
      },
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.id as number;
}

async function openSheetOnDay(page: Page, today: string, day: string): Promise<Locator> {
  await gotoAndSettle(page, "/#/suppliers");
  const card = page.getByTestId("supplier-account-card-OMT");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("supplier-account-settle-button").click();
  const sheet = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  const bar = sheet.getByTestId("settle-selection-bar");
  await expect(bar).toBeVisible({ timeout: 15_000 });
  const clear = bar.getByRole("button", { name: "Clear", exact: true });
  if (await clear.count()) await clear.click();
  for (let i = monthNumber(today) - monthNumber(day); i > 0; i--) {
    await sheet.getByRole("button", { name: "Previous month", exact: true }).click();
  }
  const button = sheet.locator(`[data-day="${day}"] button`);
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(bar).toContainText("1 day picked");
  return sheet;
}

const money = (v: number) => Math.round(v * 100) / 100;

test.describe.serial("lira-web-091 OMT settle from the SMS amount", () => {
  test("we owe OMT: SMS $10 under the expected figure closes the day; drawer = SMS, profit = expected + $10", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
    const auth: Auth = { Authorization: `Bearer ${token}` };
    const id = await omtId(page, auth);
    const today = await browserToday(page);
    const DAY = await freePastDay(page, auth, id, today);

    const rowId = await transfer(page, auth, { serviceType: "SEND", amount: 300, fee: 8, type: "INTRA", day: DAY });
    const row = (await queue(page, auth, id)).find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)!;
    expect(row.shop_day).toBe(DAY);
    const OWED = money(row.remaining_usd);
    const EXPECTED_COMMISSION = money(row.expected_commission_usd ?? 0);
    const EXPECTED = money(OWED - EXPECTED_COMMISSION);
    const SMS = money(EXPECTED - 10);
    const drawerBefore = await omtDrawerUsd(page, auth);

    const sheet = await openSheetOnDay(page, today, DAY);
    const sms = sheet.getByTestId("supplier-account-settle-sms-usd");
    // LIRA-378 — opens with nothing ticked: no commission, the box at the
    // gross owed, the expected commission "stays owed". What's new
    // screenshot of that default (rule 30), landscape.
    await expect(sms).toHaveValue(OWED.toFixed(2));
    await expect(sheet.getByTestId("supplier-account-settle-covered")).toContainText("No commission");
    await expect(sheet.getByTestId("supplier-account-settle-sms-includes-none")).toBeVisible();
    await expect(sheet.getByTestId("supplier-account-settle-sms-stays-owed-usd")).toContainText(
      `$${EXPECTED_COMMISSION.toFixed(2)}`,
    );
    await page.setViewportSize({ width: 1400, height: 900 });
    await sheet.screenshot({ path: "public/whats-new/1.35.0/omt-sms-no-commission.png" });
    // Ticking All types brings the expected figure back.
    await tickAllSmsTypes(sheet);
    await expect(sms).toHaveValue(EXPECTED.toFixed(2));
    await sms.fill(SMS.toFixed(2));
    const line = sheet.getByTestId("supplier-account-settle-sms-commission-usd");
    await expect(line).toContainText(`$${money(EXPECTED_COMMISSION + 10).toFixed(2)}`);
    await expect(line).toContainText("$10.00");
    const usd = sheet.getByTestId("supplier-account-settle-section-usd");
    await expect
      .poll(async () => Number((await usd.locator('[data-testid^="payment-amount-"]').first().inputValue()).replace(/,/g, "")))
      .toBeCloseTo(SMS, 2);
    await expect(
      usd.locator(`[data-testid="supplier-account-settle-preview-row"][data-kind="FINANCIAL_SERVICE"][data-row-id="${rowId}"]`),
    ).toHaveAttribute("data-status", "closes");

    // What's new (rule 30): the real sheet, landscape.
    await page.setViewportSize({ width: 1400, height: 900 });
    await sheet.screenshot({ path: "public/whats-new/1.35.0/omt-sms-settle.png" });

    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    expect((await queue(page, auth, id)).some((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)).toBe(false);
    expect(money((await omtDrawerUsd(page, auth)) - drawerBefore)).toBe(-SMS);
    const txn = await settlementFor(page, auth, rowId);
    expect(money(txn.profit_usd)).toBe(money(EXPECTED_COMMISSION + 10));
  });

  test("OMT owes us, SMS includes Western Union shares only: both close, profit = WU share, the Intra share stays owed", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
    const auth: Auth = { Authorization: `Bearer ${token}` };
    const id = await omtId(page, auth);
    const today = await browserToday(page);
    const DAY = await freePastDay(page, auth, id, today);

    const wuId = await transfer(page, auth, { serviceType: "RECEIVE", amount: 500, fee: 10, type: "WESTERN_UNION", day: DAY });
    const intraId = await transfer(page, auth, { serviceType: "SEND", amount: 100, fee: 1, type: "INTRA", day: DAY });
    const rows = await queue(page, auth, id);
    const wu = rows.find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === wuId)!;
    const intra = rows.find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === intraId)!;
    const OWED = money(wu.remaining_usd + intra.remaining_usd); // negative: OMT owes us
    expect(OWED).toBeLessThan(0);
    const WU_SHARE = money(wu.expected_commission_usd ?? 0);
    const INTRA_SHARE = money(intra.expected_commission_usd ?? 0);
    const SMS = money(OWED - WU_SHARE); // what OMT's "WU shares" SMS says
    const drawerBefore = await omtDrawerUsd(page, auth);

    const sheet = await openSheetOnDay(page, today, DAY);
    await sheet.getByTestId("supplier-account-settle-covered").click();
    await page.getByTestId("supplier-account-settle-covered-option-WESTERN_UNION").click();
    await page.keyboard.press("Escape");
    await expect(sheet.getByTestId("supplier-account-settle-sms-includes")).toContainText("Western Union");
    const sms = sheet.getByTestId("supplier-account-settle-sms-usd");
    await expect(sms).toHaveValue(SMS.toFixed(2));
    if (INTRA_SHARE > 0) {
      await expect(sheet.getByTestId("supplier-account-settle-sms-stays-owed-usd")).toContainText(
        `$${INTRA_SHARE.toFixed(2)}`,
      );
    }
    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    const after = await queue(page, auth, id);
    expect(after.some((r) => r.kind === "FINANCIAL_SERVICE" && (r.id === wuId || r.id === intraId))).toBe(false);
    expect(money((await omtDrawerUsd(page, auth)) - drawerBefore)).toBe(money(-SMS));
    const txn = await settlementFor(page, auth, wuId);
    expect(money(txn.profit_usd)).toBe(WU_SHARE);
    const shares = (
      await getJson<{ shares: Array<{ financial_service_id: number; amount: number; omt_service_type: string }> }>(
        page,
        auth,
        `/api/suppliers/${id}/account-owed-shares`,
      )
    ).shares;
    const mine = shares.filter((s) => s.financial_service_id === intraId);
    expect(mine.map((s) => [s.omt_service_type, money(s.amount)])).toEqual(
      INTRA_SHARE > 0 ? [["INTRA", INTRA_SHARE]] : [],
    );
  });
});
