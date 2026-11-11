/**
 * lira-web-095 — LIRA-382: the "− Less | + Extra" line on a payout, typed on
 * the real web screen (specs/382-payout-extra-less, SC-002).
 *
 * An OMT system RECEIVE of $102.90 paid out in cash. The cashier types 0.10
 * in "+ Extra": the payment line becomes $103.00 and the receive is saved.
 *   1. the request carries `rounding_given_usd: 0.1` and a $103.00 cash leg;
 *   2. the cash leg's drawer moved by −$103.00 (delta, rule 15);
 *   3. one new "Change rounding" expense of $0.10 exists, and the Expenses
 *      page shows it.
 * Also saves the What's new screenshot of the line on the receive sheet
 * (rule 30), 1400×900.
 *
 * Rows are found by identity (the receive's reference, the expense id that
 * did not exist before), never by position (rule 15).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  drawers,
  expectLegMovedDrawer,
  expectMoved,
  findTxn,
  getJson,
  lastTxnId,
  openShopDay,
  payAmount,
  payMethod,
  phoneOf,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/payout-extra-less.png",
);

interface ExpenseRow {
  id: number;
  category: string;
  amount_usd: number;
  is_refunded?: number;
  status?: string;
}

async function roundingExpenses(
  day: Awaited<ReturnType<typeof openShopDay>>,
): Promise<ExpenseRow[]> {
  const r = await getJson<{ success: boolean; expenses?: ExpenseRow[] }>(
    day,
    "/api/expenses/today",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.expenses ?? []).filter(
    (e) =>
      e.category === "Change rounding" &&
      Math.abs(e.amount_usd - 0.1) < 0.001 &&
      !e.is_refunded &&
      (e.status ?? "active") === "active",
  );
}

test("LIRA-382 payout '+ Extra' 0.10 on an OMT receive of $102.90: pays $103.00, books Change rounding 0.10", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const ref = `PXL-${day.stamp}`;

  await page.goto("/#/omt-whish");
  const omtReceive = page.getByRole("button", { name: /OMT\s*↓/ });
  await expect(omtReceive).toBeVisible({ timeout: 20_000 });
  await omtReceive.click();

  await page.getByPlaceholder("0.00").nth(0).fill("102.90");
  await page.locator("#service-receiver-name").fill(`Extra Spec ${day.stamp}`);
  await page.getByPlaceholder("Receiver phone").fill(phoneOf(day, 9));
  await page.getByPlaceholder("Optional").first().fill(ref);
  await payMethod(page, 0).selectOption("CASH");

  // The line sits under the total, empty by default.
  const line = page.getByTestId("payout-extra-less");
  await expect(line).toBeVisible();
  const field = line.getByTestId("payout-extra-less-input");
  await expect(field).toHaveValue("");

  const before = await lastTxnId(day);
  const d0 = await drawers(day);
  const expBefore = new Set((await roundingExpenses(day)).map((e) => e.id));

  const extra = line.getByTestId("discount-mode-extra");
  if ((await extra.getAttribute("aria-pressed")) !== "true") {
    await extra.click();
  }
  await field.fill("0.10");
  await field.blur();
  await expect(payAmount(page, 0)).toHaveValue(/^103(\.00?)?$/);
  await expect(page.getByTestId("payout-you-pay")).toContainText("103.00");
  await expect(page.getByTestId("payout-roundup-summary")).toBeVisible();

  // What's new screenshot (rule 30): the real receive screen, landscape.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(field).toHaveValue("0.10");
  await page
    .getByTestId("multi-payment-input")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: SCREENSHOT });

  const res = waitPost(page, "/api/services/transactions");
  await page.getByRole("button", { name: "Record Receive" }).click();
  const { body, request } = await res;
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  expect(request.rounding_given_usd, JSON.stringify(request)).toBe(0.1);
  expect(request.payments, JSON.stringify(request)).toEqual([
    expect.objectContaining({
      method: "CASH",
      currencyCode: "USD",
      amount: 103,
    }),
  ]);

  await findTxn(
    day,
    before,
    "omt_whish_transfer",
    (t) => t.details?.reference === ref,
  );
  // The $103.00 left its drawer — by exactly the legs (delta, rule 15).
  const drawer = await expectLegMovedDrawer(
    day,
    before,
    d0,
    "CASH",
    "USD",
    103,
    -1,
  );
  // Exactly −103.00 — the rounding expense is not a second drawer move.
  expectMoved(await drawers(day), d0, drawer, "USD", -103);

  // One new $0.10 "Change rounding" expense, by identity.
  const added = (await roundingExpenses(day)).filter(
    (e) => !expBefore.has(e.id),
  );
  expect(added, JSON.stringify(added)).toHaveLength(1);

  // …and the Expenses page shows it (its History window lists the rows).
  await page.goto("/#/expenses");
  await page.getByRole("button", { name: "History" }).click();
  await expect(
    page
      .locator("tr", { hasText: "Change rounding" })
      .filter({ hasText: "0.10" })
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  await day.context.close();
});
