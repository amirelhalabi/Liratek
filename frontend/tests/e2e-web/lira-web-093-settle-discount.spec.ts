/**
 * lira-web-093 — one Discount line on every settle screen (LIRA-372,
 * specs/372-settle-discount-line). Real browser screens + REST.
 *
 * 1. OMT Settle Account (we owe OMT, SMS mode): type Discount 2.50 → the
 *    pay line drops to SMS − 2.50 by itself; confirm. The OMT drawer pays
 *    SMS − 2.50, the row closes, the settlement's profit is the commission
 *    (unchanged) and a $2.50 discount row exists. Saves the What's new
 *    screenshot. Then void it → drawer back.
 * 2. Partner by amount, the partner owes $500: Discount 5 → the pay line
 *    reads 495 by itself → Confirm; balance 0, General +495.
 * 3. Debts, the client owes $100: Discount 5 → the pay line drops to 95;
 *    typing 6 shows the cap; confirm; debt 0.
 * 4. No Waive button on any of these screens.
 * 5. SC-004 on the web transport: a hand-built repayment with a $6
 *    discount is refused, HTTP 200 envelope.
 *
 * Rule 15: identity + deltas only. Web e2e only (no Electron on this Mac).
 */
import { mkdirSync } from "node:fs";
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
  source_table?: string;
  source_id?: number;
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

async function authOf(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function generalDrawer(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{ balances: Record<string, Record<string, number>> }>(
    page,
    auth,
    "/api/closing/system-expected-balances-dynamic",
  );
  return r.balances.General?.USD ?? 0;
}

async function post<T = { success: boolean }>(
  page: Page,
  auth: Auth,
  url: string,
  data: unknown,
): Promise<T> {
  const r = await (
    await page.request.post(`${BACKEND_URL}${url}`, { headers: auth, data })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

const payAmount = (scope: Locator) =>
  scope.locator('input[data-testid^="payment-amount-"]').first();
const amountOf = async (scope: Locator) =>
  Number((await payAmount(scope).inputValue()).replace(/,/g, ""));

test.describe.serial("lira-web-093 settle Discount line", () => {
  test("OMT Settle Account: Discount 2.50 lowers the payment; drawer = SMS − 2.50; commission unchanged; void restores", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const auth = await authOf(page);
    const id = await omtId(page, auth);
    const today = await browserToday(page);
    const DAY = await freePastDay(page, auth, id, today);

    const rowId = await transfer(page, auth, { serviceType: "SEND", amount: 300, fee: 8, type: "INTRA", day: DAY });
    const row = (await queue(page, auth, id)).find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)!;
    const OWED = money(row.remaining_usd);
    const OWN_COMMISSION = money(row.expected_commission_usd ?? 0);
    // LIRA-378 — ticking All types also collects the commission OMT still
    // owes from earlier specs' settlements (rule 15: shared DB; 091 leaves
    // an Intra share on purpose), and that counts as this settlement's
    // profit too. Read it, never assume 0.
    const shares = (
      await getJson<{ shares: Array<{ currency: string; amount: number }> }>(
        page,
        auth,
        `/api/suppliers/${id}/account-owed-shares`,
      )
    ).shares;
    const OWED_SHARES = money(
      shares.filter((sh) => sh.currency === "USD").reduce((t, sh) => t + sh.amount, 0),
    );
    const COMMISSION = money(OWN_COMMISSION + OWED_SHARES);
    const SMS = money(OWED - COMMISSION);
    const DISCOUNT = 2.5;
    const PAID = money(SMS - DISCOUNT);
    const drawerBefore = await omtDrawerUsd(page, auth);

    const sheet = await openSheetOnDay(page, today, DAY);
    await tickAllSmsTypes(sheet); // LIRA-378: the SMS here includes the commission
    const usd = sheet.getByTestId("supplier-account-settle-section-usd");
    await expect.poll(() => amountOf(usd)).toBeCloseTo(SMS, 2);
    await expect(sheet.getByTestId("waive-remaining")).toHaveCount(0);
    await usd.getByTestId("settle-discount-usd").fill(String(DISCOUNT));
    await usd.getByTestId("settle-discount-reason").fill("Rounded with OMT");
    await expect.poll(() => amountOf(usd)).toBeCloseTo(PAID, 2);
    await expect(sheet.getByTestId("supplier-account-settle-sms-commission-usd")).toContainText(
      `$${COMMISSION.toFixed(2)}`,
    );
    await expect(sheet.getByTestId("supplier-account-settle-sms-discount-usd")).toContainText("$2.50");

    // What's new (rule 30): the real sheet, landscape.
    await page.setViewportSize({ width: 1400, height: 900 });
    mkdirSync("public/whats-new/1.35.0", { recursive: true });
    await sheet.screenshot({ path: "public/whats-new/1.35.0/settle-discount.png" });

    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    expect((await queue(page, auth, id)).some((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)).toBe(false);
    expect(money((await omtDrawerUsd(page, auth)) - drawerBefore)).toBe(-PAID);
    const txn = await settlementFor(page, auth, rowId);
    expect(money(txn.profit_usd)).toBe(COMMISSION);
    const discounts = await getJson<{ transactions: RecentTxn[] }>(
      page,
      auth,
      "/api/transactions/recent?type=COUNTERPARTY_DISCOUNT&limit=300",
    );
    const mine = discounts.transactions.find(
      (t) => JSON.parse(t.metadata_json ?? "{}").settlement_transaction_id === txn.id,
    );
    expect(mine, "no discount row for this settlement").toBeTruthy();
    expect(money(mine!.profit_usd)).toBe(DISCOUNT);

    await post(page, auth, `/api/transactions/${txn.id}/void`, {});
    expect(money((await omtDrawerUsd(page, auth)) - drawerBefore)).toBe(0);
  });

  test("Partner by amount: the partner owes $500, Discount 5 → pay line 495 → balance 0, General +495", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const auth = await authOf(page);
    const name = `DISC372 ${String(Date.now()).slice(-6)}`;
    const partnerId = (await post<{ success: boolean; data: { id: number } }>(page, auth, "/api/partners", { name })).data.id;
    await post(page, auth, "/api/partners/transactions", {
      partnerId,
      transactionType: "ADJUSTMENT",
      amount: 500,
      currency: "USD",
      direction: "DEBIT",
    });
    const drawerBefore = await generalDrawer(page, auth);

    await gotoAndSettle(page, "/#/partners");
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole("button", { name: "Settle", exact: true }).first().click();
    await page.getByTestId("partner-settle-by-amount").click();
    const box = page.getByTestId("multi-payment-input");
    await expect(box).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => amountOf(box)).toBe(500);
    await box.getByTestId("settle-discount-usd").fill("5");
    await expect.poll(() => amountOf(box)).toBe(495);
    await expect(page.getByTestId("waive-remaining")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm Settlement" }).click();
    await expect(box).toHaveCount(0, { timeout: 10_000 });

    const bal = await getJson<{ balance: { usd: number } }>(page, auth, `/api/partners/${partnerId}/balance`);
    expect(money(bal.balance.usd)).toBe(0);
    expect(money((await generalDrawer(page, auth)) - drawerBefore)).toBe(495);
  });

  test("Debts: the client owes $100, Discount 5 → pay line 95; typing 6 shows the cap; debt closes", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const auth = await authOf(page);
    const name = `Disc Client ${String(Date.now()).slice(-6)}`;
    const client = await post<{ success: boolean; data?: { id: number }; id?: number }>(page, auth, "/api/clients", {
      full_name: name,
      phone_number: `0371${Date.now().toString().slice(-6)}`,
    });
    const clientId = (client.data?.id ?? client.id) as number;
    await post(page, auth, "/api/debts/account-entry", {
      direction: "debt",
      clientId,
      amountUSD: 100,
      amountLBP: 0,
      moveCash: false,
    });

    await gotoAndSettle(page, "/#/debts");
    await page.getByPlaceholder(/Search client/i).fill(name);
    await page.locator("button").filter({ hasText: name }).first().click();
    await page.locator("button").filter({ hasText: /Settle Debt/i }).first().click();
    const box = page.getByTestId("multi-payment-input");
    await expect(box).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => amountOf(box)).toBe(100);
    await box.getByTestId("settle-discount-usd").fill("5");
    await expect.poll(() => amountOf(box)).toBe(95);
    await box.getByTestId("settle-discount-usd").fill("6");
    await expect(box.getByTestId("discount-cap-note")).toContainText("$5.00");
    await expect(page.getByTestId("waive-remaining")).toHaveCount(0);
    await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(box).toHaveCount(0, { timeout: 10_000 });

    const bal = await getJson<{ data: { balance_usd: number } }>(page, auth, `/api/debts/clients/${clientId}/balance`);
    expect(money(bal.data.balance_usd)).toBe(0);
  });

  test("SC-004: a hand-built repayment with a $6 discount is refused on the web transport", async ({ page }) => {
    await loginAsAdmin(page);
    const auth = await authOf(page);
    const client = await post<{ success: boolean; data?: { id: number }; id?: number }>(page, auth, "/api/clients", {
      full_name: `Disc Cap ${String(Date.now()).slice(-6)}`,
      phone_number: `0372${Date.now().toString().slice(-6)}`,
    });
    const clientId = (client.data?.id ?? client.id) as number;
    const res = await page.request.post(`${BACKEND_URL}/api/debts/repayments`, {
      headers: auth,
      data: {
        clientId,
        amountUSD: 10,
        amountLBP: 0,
        discount: { amount_usd: 6, amount_lbp: 0 },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toContain("The discount is more than $5.");
  });
});
