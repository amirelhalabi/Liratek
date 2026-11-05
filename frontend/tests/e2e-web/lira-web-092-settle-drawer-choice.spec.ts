/**
 * lira-web-092 — "OMT Cash Drawer | General" (LIRA-371,
 * specs/371-settle-drawer-choice). Real browser screens + REST.
 *
 * 1. Debts: a client owes $200 for one OMT send (basket on Customer
 *    Account). Repay $200 cash with General picked → General +$200,
 *    OMT_System ±0. The payment detail on the Transactions page shows the
 *    cash with no OMT drawer split (FR-010). Void → both drawers back.
 *    Saves the What's new screenshot of the Repay modal with the choice.
 * 2. OMT Settle Account on this spec's own past day, cash, General →
 *    General −paid, OMT_System ±0.
 *
 * Rule 15: identity + deltas only (rows matched by client / row id, money
 * checked as before/after deltas, never absolute balances or row position).
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

async function authOf(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function drawers(page: Page, auth: Auth): Promise<{ general: number; omt: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return {
    general: r.balances.generalDrawer.usd as number,
    omt: r.balances.omtDrawer.usd as number,
  };
}

const money = (v: number) => Math.round(v * 100) / 100;

/** A customer basket on Customer Account holding one OMT send ($199 + $1). */
async function seedOmtDebt(page: Page, auth: Auth, name: string, phone: string) {
  const started = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
      headers: auth,
      data: { customer_name: name, customer_phone: phone },
    })
  ).json();
  expect(started.success, JSON.stringify(started)).toBeTruthy();
  const checkout = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
      headers: auth,
      data: {
        sessionId: started.sessionId,
        cartItems: [
          {
            id: "l092-omt",
            module: "omt_system",
            label: "l092 OMT SEND",
            amount: 200,
            currency: "USD",
            ipcChannel: "financial:create",
            formData: {
              provider: "OMT",
              serviceType: "SEND",
              amount: 199,
              currency: "USD",
              omtServiceType: "INTRA",
              omtFee: 1,
            },
          },
        ],
        payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 200 }],
        exchangeRate: 89000,
        userId: 1,
      },
    })
  ).json();
  expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
  const clients = await (
    await page.request.get(`${BACKEND_URL}/api/clients?search=${encodeURIComponent(name)}`, {
      headers: auth,
    })
  ).json();
  const list = Array.isArray(clients.data)
    ? clients.data
    : ((Object.values(clients.data ?? {}).find((v) => Array.isArray(v)) as
        | Array<{ id: number; full_name: string }>
        | undefined) ?? []);
  const client = list.find((c: { full_name: string }) => c.full_name === name);
  expect(client, "client not found").toBeTruthy();
  return client as { id: number; full_name: string };
}

// ── Settle Account helpers (as lira-web-091) ─────────────────────────────
interface QueueRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  remaining_usd: number;
  shop_day: string;
}

async function getJson<T>(page: Page, auth: Auth, url: string): Promise<T> {
  const r = await (await page.request.get(`${BACKEND_URL}${url}`, { headers: auth })).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

async function omtAccountId(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{ balances: Array<{ account_supplier_id: number; account_name: string }> }>(
    page,
    auth,
    "/api/suppliers/account-balances",
  );
  return r.balances.find((b) => b.account_name === "OMT")!.account_supplier_id;
}

const queue = async (page: Page, auth: Auth, id: number) =>
  (await getJson<{ transactions: QueueRow[] }>(page, auth, `/api/suppliers/${id}/account-unsettled`))
    .transactions;

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
const monthNumber = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));

async function freePastDay(page: Page, auth: Auth, id: number, today: string) {
  const open = new Set((await queue(page, auth, id)).map((r) => r.shop_day));
  for (let k = 1; k <= 180; k++) {
    const day = shiftDay(today, -k);
    if (!open.has(day)) return day;
  }
  throw new Error("no free past day");
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

test.describe.serial("lira-web-092 cash drawer choice", () => {
  test("Debts: $200 OMT send repaid in cash with General → General +200, OMT 0; void puts it back", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const auth = await authOf(page);
    // Landscape from the start (the What's new screenshot below).
    await page.setViewportSize({ width: 1400, height: 900 });
    const name = `L092 Drawer ${Date.now()}`;
    const phone = `0371${Date.now().toString().slice(-6)}`;
    const client = await seedOmtDebt(page, auth, name, phone);

    await page.goto("/#/debts");
    await expect(page.locator("#root")).not.toContainText("Something went wrong");
    await page.getByPlaceholder(/Search client/i).fill(name);
    await page.locator("button").filter({ hasText: name }).first().click();
    await page.locator("button").filter({ hasText: /Settle Debt/i }).first().click();
    await expect(page.getByText("Process Repayment")).toBeVisible();
    await expect(page.locator('[data-testid^="payment-amount-"]').first()).toHaveValue("200");

    const goes = page.getByTestId("repay-goes-to");
    await expect(goes.getByTestId("cash-drawer-choice-system")).toHaveAttribute("aria-pressed", "true");
    await goes.getByTestId("cash-drawer-choice-general").click();
    await expect(goes.getByTestId("cash-drawer-choice-general")).toHaveAttribute("aria-pressed", "true");
    await expect(goes.getByTestId("cash-drawer-choice-system")).toHaveAttribute("aria-pressed", "false");
    await expect(goes.getByTestId("repay-goes-to-general")).toContainText("$200");
    await expect(goes.getByTestId("repay-goes-to-system")).toHaveCount(0);

    // What's new (rule 30): the real Repay modal with the choice open
    // (viewport set landscape before any click, so no stale hover state).
    // Park the mouse so no pill shows its hover state in the screenshot.
    await page.mouse.move(1, 1);
    const modal = page.locator('[role="dialog"]').filter({ hasText: "Process Repayment" }).first();
    await (await modal.count() ? modal : page).screenshot({
      path: "public/whats-new/1.35.0/settle-drawer-choice.png",
    });

    const before = await drawers(page, auth);
    await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    const after = await drawers(page, auth);
    expect(money(after.general - before.general)).toBe(200);
    expect(money(after.omt - before.omt)).toBe(0);

    // FR-010 — the payment detail shows the cash with no OMT drawer split.
    await page.goto("/#/audit");
    const row = page
      .locator("tr", { hasText: "Debt Repayment: $200" })
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByText("payment detail").click();
    const detail = page.locator('[data-testid^="payment-legs-detail-"]').first();
    await expect(detail).toContainText("Cash: $200");
    await expect(detail).not.toContainText("OMT Cash Drawer");

    // Void → both drawers back where they were.
    const recent = await getJson<{ transactions: Array<{ id: number; type: string; client_id: number | null }> }>(
      page,
      auth,
      `/api/transactions/recent?type=DEBT_REPAYMENT&client_id=${client.id}&limit=20`,
    );
    const txn = recent.transactions.find((t) => t.type === "DEBT_REPAYMENT" && t.client_id === client.id);
    expect(txn, JSON.stringify(recent.transactions)).toBeTruthy();
    const voided = await (
      await page.request.post(`${BACKEND_URL}/api/transactions/${txn!.id}/void`, { headers: auth })
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
    const back = await drawers(page, auth);
    expect(money(back.general - before.general)).toBe(0);
    expect(money(back.omt - before.omt)).toBe(0);
  });

  test("OMT Settle Account in cash with General → General pays, OMT_System ±0", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const auth = await authOf(page);
    const id = await omtAccountId(page, auth);
    const today = await browserToday(page);
    const DAY = await freePastDay(page, auth, id, today);

    const sent = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers: auth,
        data: {
          provider: "OMT",
          serviceType: "SEND",
          amount: 765,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 7.3,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 772.3 }],
          transaction_time: `${DAY}T12:00:00.000Z`,
        },
      })
    ).json();
    expect(sent.success, JSON.stringify(sent)).toBeTruthy();
    const rowId = sent.id as number;
    expect((await queue(page, auth, id)).some((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)).toBe(true);

    const sheet = await openSheetOnDay(page, today, DAY);
    const choice = sheet.getByTestId("cash-drawer-choice");
    await expect(choice).toContainText("Comes from");
    await choice.getByTestId("cash-drawer-choice-general").click();
    const paid = Number(
      (await sheet.locator('[data-testid^="payment-amount-"]').first().inputValue()).replace(/,/g, ""),
    );
    expect(paid).toBeGreaterThan(0);

    const before = await drawers(page, auth);
    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });
    const after = await drawers(page, auth);
    expect(money(after.general - before.general)).toBe(money(-paid));
    expect(money(after.omt - before.omt)).toBe(0);
    expect((await queue(page, auth, id)).some((r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId)).toBe(false);
  });
});
