/**
 * lira-web-110 — owner 2026-11-28: the Expenses History window filters by
 * date (From / To), so every row shows its Date. Over the web transport.
 *
 * An expense is booked through the API with a fresh description (rule 15:
 * matched by identity, not by row position). The History window shows a Date
 * column; the row's date is its business day, the same day the From / To
 * filter files it under, and filtering on that day keeps the row.
 *
 * Also takes the What's new screenshot (rule 30).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "../../public/whats-new/1.35.0/history-date-column.png",
);

function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.describe("lira-web-110 History windows show the date", () => {
  test("Expenses History has a Date column matching the date filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    const today = localDay();
    const description = `L110 rent ${Date.now().toString().slice(-6)}`;

    const added = await (
      await page.request.post(`${BACKEND_URL}/api/expenses`, {
        headers: auth,
        data: {
          category: "Rent",
          amount_usd: 12,
          amount_lbp: 0,
          paid_by_method: "CASH",
          description,
          expense_date: today,
        },
      })
    ).json();
    expect(added.success, JSON.stringify(added)).toBeTruthy();

    await gotoAndSettle(page, "/#/expenses");
    await page.getByRole("button", { name: /^History$/ }).first().click();
    await expect(page.getByText("Expense History")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("columnheader", { name: /^Date$/ }),
    ).toBeVisible();

    const row = page.locator("tr", { hasText: description }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId("expense-history-date")).toHaveAttribute(
      "datetime",
      today,
    );

    await page.screenshot({ path: SCREENSHOT, animations: "disabled" });
  });
});
