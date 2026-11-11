/**
 * lira-web-098 — LIRA-385: expenses per module on Profits › By Module, web.
 *
 * Seeds over REST (the real routes):
 *   - an MTC credit transfer paid in cash, which books its SMS fee as an
 *     expense linked to the recharge → the "MTC Recharges" row's Expenses;
 *   - a manual "Shop supply" expense with a unique amount → the
 *     "Other expenses (not linked to a module)" row.
 * Then proves:
 *   1. REST: Σ every By Module row's expenses (Other included) equals the
 *      Overview's expenses for the same range, per currency (the invariant
 *      that keeps the new column and the net row in agreement);
 *   2. UI: the columns, the Other row, and a click on an expense figure
 *      opening that row's expense list (MTC: the SMS fee; Other: our expense).
 * Saves the What's new screenshot (rule 30), landscape 1400×900.
 *
 * Rule 15: the DB accumulates — rows are matched by identity (module key,
 * our unique description/amount), never position or absolute totals.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  BACKEND_URL,
  loginAsAdmin,
  staffHeaders,
  unlockProfitsOverRest,
  PROFITS_PASSWORDS,
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/profits-module-expenses.png",
);

interface ModuleRow {
  module: string;
  expenses_usd: number;
  expenses_lbp: number;
}

/** Local `YYYY-MM-DD`, the same day the browser's Profits page uses. */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("By Module shows expenses per module + Other, and opens their lists (LIRA-385)", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const auth = await staffHeaders(page, "admin", "admin123");
  await unlockProfitsOverRest(page, auth);

  const today = localIso(new Date());
  const from = localIso(new Date(Date.now() - 30 * 86_400_000));
  // A unique amount so our manual expense is found by identity (rule 15).
  const otherAmount = Number((1 + (Date.now() % 900) / 100).toFixed(2));
  const otherDescription = `LIRA-385 paper rolls ${Date.now()}`;

  // ── Seed ────────────────────────────────────────────────────────────────
  const recharge = await (
    await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers: auth,
      data: {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.5,
        currency: "USD",
        phoneNumber: "03385385",
        paid_by_method: "CASH",
        client_day: today,
      },
    })
  ).json();
  expect(recharge.success, JSON.stringify(recharge)).toBeTruthy();

  const expense = await (
    await page.request.post(`${BACKEND_URL}/api/expenses`, {
      headers: auth,
      data: {
        category: "Shop_Supply",
        amount_usd: otherAmount,
        amount_lbp: 0,
        paid_by_method: "CASH",
        description: otherDescription,
        expense_date: today,
      },
    })
  ).json();
  expect(expense.success, JSON.stringify(expense)).toBeTruthy();

  // ── 1. REST invariant: Σ module expenses + Other = summary.expenses ─────
  const qs = `from=${from}&to=${today}`;
  const byModule = await (
    await page.request.get(`${BACKEND_URL}/api/profits/by-module?${qs}`, {
      headers: auth,
    })
  ).json();
  expect(byModule.success, JSON.stringify(byModule)).toBeTruthy();
  const rows = byModule.data as ModuleRow[];
  const summary = await (
    await page.request.get(`${BACKEND_URL}/api/profits/summary?${qs}`, {
      headers: auth,
    })
  ).json();
  expect(summary.success, JSON.stringify(summary)).toBeTruthy();
  const sumUsd = rows.reduce((s, r) => s + r.expenses_usd, 0);
  const sumLbp = rows.reduce((s, r) => s + r.expenses_lbp, 0);
  expect(sumUsd).toBeCloseTo(summary.data.expenses.total_usd, 2);
  expect(sumLbp).toBeCloseTo(summary.data.expenses.total_lbp, 0);

  const mtc = rows.find((r) => r.module === "RECHARGE_MTC");
  expect(mtc, "RECHARGE_MTC row").toBeTruthy();
  expect(mtc!.expenses_usd).toBeGreaterThan(0);
  const other = rows.find((r) => r.module === "OTHER_EXPENSES");
  expect(other, "Other expenses row").toBeTruthy();
  expect(other!.expenses_usd).toBeGreaterThanOrEqual(otherAmount - 0.001);
  expect(rows[rows.length - 1].module).toBe("OTHER_EXPENSES");

  // ── 2. UI ───────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#/profits");
  await expect(page.getByTestId("profits-lock-screen")).toBeVisible({
    timeout: 15_000,
  });
  for (const password of PROFITS_PASSWORDS) {
    await page.getByTestId("profits-password-input").fill(password);
    await page.getByTestId("profits-unlock-submit").click();
    const unlocked = await page
      .getByTestId("profits-lock-screen")
      .waitFor({ state: "detached", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (unlocked) break;
  }
  await expect(page.getByTestId("profits-lock-screen")).toHaveCount(0);

  await page.getByRole("button", { name: "By Module", exact: true }).click();
  const mtcExpense = page.getByTestId("by-module-expenses-usd-RECHARGE_MTC");
  await expect(mtcExpense).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("by-module-row-OTHER_EXPENSES")).toContainText(
    "Other expenses (not linked to a module)",
  );
  await expect(page.getByTestId("by-module-total-expenses-usd")).toBeVisible();

  // Other row → our manual expense is in its list.
  await page.getByTestId("by-module-expenses-usd-OTHER_EXPENSES").click();
  await expect(
    page.getByTestId("by-module-expenses-list-OTHER_EXPENSES"),
  ).toContainText(otherDescription, { timeout: 15_000 });
  await page.getByTestId("by-module-expand-OTHER_EXPENSES").click();

  // MTC row → its SMS fee, with the recharge it was paid for.
  await mtcExpense.click();
  const mtcList = page.getByTestId("by-module-expenses-list-RECHARGE_MTC");
  await expect(mtcList).toContainText("SMS Transfer Fee", { timeout: 15_000 });
  await expect(page.locator("#root")).not.toContainText("Something went wrong");

  // What's new screenshot (rule 30): columns + the MTC row's expense list.
  await page.getByTestId("by-module-row-RECHARGE_MTC").scrollIntoViewIfNeeded();
  await page.screenshot({ path: SCREENSHOT });
});
