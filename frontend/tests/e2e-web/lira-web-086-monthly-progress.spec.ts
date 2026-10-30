/**
 * LIRA-364 — the Monthly progress page over REST (web app).
 *
 * Snapshots are only ever taken by the month-end sweep, so this spec seeds
 * two saved months straight into the shared web test DB, switches the
 * feature on for the e2e tenant, and checks the sidebar item and the page:
 * months as columns (newest first) and the change from the month before.
 * Also saves the What's new screenshot (rule 30).
 *
 * The switch and the seeded months are put back as they were afterwards, so
 * later specs never see a "Monthly progress" menu item they did not ask for.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test, expect, loginAsAdmin, gotoAndSettle } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/monthly-progress.png",
);

const TENANT_ID = 1;
const MONTHS: Array<{
  month: string;
  values: Record<string, [number, number]>;
}> = [
  {
    month: "2026-08",
    values: {
      customers_owe_shop: [1240, 3_150_000],
      suppliers_owe_shop: [0, 0],
      partners_owe_shop: [85, 0],
      shop_owes_customers: [60, 450_000],
      shop_owes_suppliers: [2310, 18_400_000],
      shop_owes_partners: [400, 0],
      stock_value: [8020, 0],
      carrier_credits: [35, 0],
    },
  },
  {
    month: "2026-09",
    values: {
      customers_owe_shop: [1065, 3_600_000],
      suppliers_owe_shop: [0, 0],
      partners_owe_shop: [120, 0],
      shop_owes_customers: [45, 300_000],
      shop_owes_suppliers: [1890, 15_200_000],
      shop_owes_partners: [400, 0],
      stock_value: [9540, 0],
      carrier_credits: [20, 0],
    },
  },
];

function deleteSeeded(db: Database.Database): void {
  for (const { month } of MONTHS) {
    db.prepare(
      `DELETE FROM kpi_snapshots WHERE tenant_id = ? AND month = ?`,
    ).run(TENANT_ID, month);
  }
}

test("monthly progress: sidebar item and months side by side", async ({
  page,
}) => {
  const db = new Database(DB_PATH);
  const before = db
    .prepare(
      `SELECT enabled_features FROM tenant_subscriptions WHERE tenant_id = ?`,
    )
    .get(TENANT_ID) as { enabled_features: string | null } | undefined;
  expect(before, "e2e tenant has a subscription row").toBeTruthy();

  try {
    db.pragma("foreign_keys = ON");
    deleteSeeded(db);
    db.prepare(
      `UPDATE tenant_subscriptions SET enabled_features = ? WHERE tenant_id = ?`,
    ).run(JSON.stringify(["kpi_snapshots"]), TENANT_ID);
    for (const { month, values } of MONTHS) {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO kpi_snapshots
             (tenant_id, month, taken_at, is_late, usd_lbp_buy_rate, usd_lbp_sell_rate)
           VALUES (?, ?, ?, 0, 89000, 89500)`,
        )
        .run(TENANT_ID, month, `${month}-28 21:00:00`);
      for (const [key, [usd, lbp]] of Object.entries(values)) {
        db.prepare(
          `INSERT INTO kpi_snapshot_values
             (tenant_id, snapshot_id, kpi_key, amount_usd, amount_lbp)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(TENANT_ID, lastInsertRowid, key, usd, lbp);
      }
    }

    await loginAsAdmin(page);
    await gotoAndSettle(page, "/#/dashboard");
    const nav = page.getByTestId("nav-monthly-progress");
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await expect(nav).toHaveAttribute("href", "#/monthly-progress");
    // Opened by address, not by clicking: a click leaves a stuck hover
    // highlight on the sidebar item under the pointer in the screenshot.
    await gotoAndSettle(page, "/#/monthly-progress");

    const headers = page.getByTestId(/^kpi-month-/);
    await expect(headers.first()).toBeVisible({ timeout: 15_000 });
    // Newest first; earlier runs' months (if any) never sit between ours.
    const ids = await headers.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid")),
    );
    expect(ids.indexOf("kpi-month-2026-09")).toBeLessThan(
      ids.indexOf("kpi-month-2026-08"),
    );

    const stock = page
      .getByTestId("kpi-row-stock_value")
      .getByTestId("kpi-cell-2026-09");
    await expect(stock).toContainText("$9,540.00");
    await expect(stock).toContainText("+$1,520.00");

    mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
    await page.screenshot({ path: SCREENSHOT });
  } finally {
    deleteSeeded(db);
    db.prepare(
      `UPDATE tenant_subscriptions SET enabled_features = ? WHERE tenant_id = ?`,
    ).run(before?.enabled_features ?? null, TENANT_ID);
    db.close();
  }
});
