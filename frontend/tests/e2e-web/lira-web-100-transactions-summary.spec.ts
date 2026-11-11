/**
 * lira-web-100 — LIRA-389: the Summary view of Audit & Transactions on the
 * real web page (specs/389-transactions-summary, SC-003, SC-004).
 *
 *   1. Seeds through REST: three products of this run (a laptop, a cable, a
 *      mouse — names carry the run's stamp), three POS sales (laptop ×2 +
 *      cable; laptop + mouse; cable ×3) and refunds the third whole.
 *   2. Summary by Product (search = the stamp, today): laptop Count 2 / Units
 *      3, mouse 1 / 1, the refunded cable sale left out (cable 1 / 1); the
 *      TOTAL equals the list's row count minus the refund row and the
 *      refunded sale (research.md R3). Ticking "Include refunded" adds it
 *      back, netted to 0 units.
 *   3. Clicking the laptop row opens the List filtered to its 2 sales.
 *   4. The Excel export, with Summary shown, has a "Summary by Product"
 *      sheet with the same rows and TOTAL.
 *   5. Service type: an OMT send and an OMT receive move "OMT System Send" /
 *      "OMT System Recv" by exactly +1 each (deltas, rule 15), the same
 *      delta the list shows for the "OMT System" filter.
 *   6. SC-004: one 12-month summary is timed (reported, budget 3 s).
 *
 * Also saves the What's new screenshot of Summary by Product (rule 30).
 * Rows are found by identity (this run's stamp), counts as deltas (rule 15).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSXns from "xlsx";
import { test, expect } from "./fixtures";
import { getJson, openShopDay, postJson, type ShopDay } from "./shopDayHelpers";

const XLSX =
  (XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/transactions-summary.png",
);

interface SummaryRow {
  key: string;
  label: string;
  count: number;
  units: number | null;
  volume_usd: number;
  volume_lbp: number;
}
interface Summary {
  rows: SummaryRow[];
  total: { count: number; units: number | null; volume_usd: number };
  truncated: boolean;
}

/** The operator's own day, as the page sends it (rule 27). */
function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function summary(
  day: ShopDay,
  payload: Record<string, unknown>,
): Promise<Summary> {
  const res = await getJson<{
    success: boolean;
    data?: Summary;
    error?: string;
  }>(
    day,
    `/api/transactions/summary?${new URLSearchParams({
      payload: JSON.stringify(payload),
    })}`,
  );
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return res.data!;
}

/** The list's own rows over REST (what the page reads, all pages). */
async function listRows(
  day: ShopDay,
  filters: Record<string, string>,
): Promise<Array<{ id: number; type: string; reverses_id: number | null }>> {
  const res = await getJson<{
    success: boolean;
    transactions: Array<{
      id: number;
      type: string;
      reverses_id: number | null;
    }>;
  }>(
    day,
    `/api/transactions/recent?${new URLSearchParams({ limit: "5000", ...filters })}`,
  );
  expect(res.success).toBeTruthy();
  return res.transactions;
}

const rowOf = (s: Summary, label: string) =>
  s.rows.find((r) => r.label === label);

test("LIRA-389 Summary by Product and by Service type match the list, drill down and export", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const today = localDay();
  const stamp = `S389x${day.stamp}`;
  const LAPTOP = `Laptop ${stamp}`;
  const CABLE = `Cable ${stamp}`;
  const MOUSE = `Mouse ${stamp}`;

  // ── 1. Seed ────────────────────────────────────────────────────────────
  const product = async (name: string, price: number) => {
    const r = await postJson<{ success: boolean; data: { id: number } }>(
      day,
      "/api/inventory/products",
      {
        name,
        category: `Cat ${stamp}`,
        cost_price_usd: price / 2,
        retail_price_usd: price,
        stock: 20,
        min_stock_threshold: 0,
      },
    );
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.data.id;
  };
  const laptop = await product(LAPTOP, 450);
  const cable = await product(CABLE, 5);
  const mouse = await product(MOUSE, 12);

  const sell = async (items: Array<[number, number, number]>) => {
    const total = items.reduce((s, [, q, p]) => s + q * p, 0);
    const r = await postJson<{
      success: boolean;
      saleId?: number;
      error?: string;
    }>(day, "/api/sales/process", {
      client_id: null,
      items: items.map(([product_id, quantity, price]) => ({
        product_id,
        quantity,
        price,
      })),
      total_amount: total,
      discount: 0,
      final_amount: total,
      payment_usd: total,
      payment_lbp: 0,
      payments: [
        {
          method: "CASH",
          currency_code: "USD",
          amount: total,
          direction: "IN",
        },
      ],
      change_given_usd: 0,
      change_given_lbp: 0,
      exchange_rate: 90000,
    });
    expect(r.success, JSON.stringify(r)).toBeTruthy();
  };
  await sell([
    [laptop, 2, 450],
    [cable, 1, 5],
  ]);
  await sell([
    [laptop, 1, 450],
    [mouse, 1, 12],
  ]);
  await sell([[cable, 3, 5]]);

  // Refund the cable-only sale whole (found by identity: this run's stamp,
  // the $15 SALE).
  const mine = await listRows(day, {
    search: stamp,
    day_from: today,
    day_to: today,
  });
  const cableSale = (
    await getJson<{
      success: boolean;
      transactions: Array<{ id: number; type: string; amount_usd: number }>;
    }>(
      day,
      `/api/transactions/recent?${new URLSearchParams({ limit: "50", search: CABLE, day_from: today, day_to: today })}`,
    )
  ).transactions.find((t) => t.type === "SALE" && t.amount_usd === 15);
  expect(cableSale, JSON.stringify(mine)).toBeTruthy();
  const refunded = await postJson<{ success: boolean; error?: string }>(
    day,
    `/api/transactions/${cableSale!.id}/refund`,
    {},
  );
  expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

  // ── 2. Summary by Product (REST) vs the list ───────────────────────────
  const base = { search: stamp, day_from: today, day_to: today };
  const byProduct = await summary(day, { group_by: "product", ...base });
  expect(rowOf(byProduct, LAPTOP)).toMatchObject({
    count: 2,
    units: 3,
    volume_usd: 1350,
  });
  expect(rowOf(byProduct, MOUSE)).toMatchObject({
    count: 1,
    units: 1,
    volume_usd: 12,
  });
  expect(rowOf(byProduct, CABLE)).toMatchObject({
    count: 1,
    units: 1,
    volume_usd: 5,
  });
  // distinct sales 1 and 2 (the refunded sale 3 is out)
  expect(byProduct.total).toMatchObject({
    count: 2,
    units: 5,
    volume_usd: 1367,
  });

  const list = await listRows(day, base);
  const reversals = list.filter(
    (r) => r.reverses_id != null || r.type === "REFUND",
  );
  // 3 sales + 1 refund row; TOTAL = list − reversal rows − refunded sale
  expect(list).toHaveLength(4);
  expect(byProduct.total.count).toBe(list.length - reversals.length - 1);

  const withRefunded = await summary(day, {
    group_by: "product",
    include_refunded: true,
    ...base,
  });
  expect(rowOf(withRefunded, CABLE)).toMatchObject({
    count: 2,
    units: 1,
    volume_usd: 5,
  });
  expect(withRefunded.total.count).toBe(list.length - reversals.length);

  // ── 2b. The same on the screen ─────────────────────────────────────────
  await page.goto("/#/audit");
  const box = page.getByPlaceholder(/Search summary, client, user/);
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(stamp);
  await box.press("Enter");
  await expect(page.getByTestId("data-table")).toContainText(stamp, {
    timeout: 15_000,
  });
  await page.getByTestId("transactions-view-summary").click();
  await page.getByTestId("summary-group-product").click();
  const summaryTable = page.getByTestId("transactions-summary-table");
  await expect(summaryTable).toContainText(LAPTOP, { timeout: 15_000 });
  const laptopRow = summaryTable
    .getByTestId("transactions-summary-row")
    .filter({ hasText: LAPTOP });
  await expect(laptopRow).toContainText("$1,350.00");
  await expect(page.getByTestId("transactions-summary-total")).toContainText(
    "$1,367.00",
  );
  await expect(page.getByTestId("summary-group-product")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("summary-group-type")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const headers = await summaryTable.locator("th").allTextContents();
  expect(headers.join("|")).not.toMatch(/profit|cost|margin|commission/i);

  // What's new screenshot (rule 30): the real Summary by Product, landscape.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(laptopRow).toBeVisible();
  // The segmented buttons fade their background (transition-colors): wait
  // until "Type" has fully let go of the active look before capturing.
  const bgOf = (id: string) =>
    page.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect
    .poll(
      async () =>
        (await bgOf("summary-group-type")) ===
        (await bgOf("summary-group-service")),
    )
    .toBe(true);
  await page.screenshot({ path: SCREENSHOT });

  // ── 4. Excel export with Summary shown ─────────────────────────────────
  const dl = page.waitForEvent("download");
  await page.getByTestId("export-excel-btn").click();
  const download = await dl;
  const file = test.info().outputPath("summary-export.xlsx");
  await download.saveAs(file);
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  expect(wb.SheetNames).toEqual([
    "Summary",
    "Summary by Product",
    "Transactions",
    "Payments",
    "Details",
  ]);
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(
    wb.Sheets["Summary by Product"]!,
    { header: 1, defval: null, raw: true },
  );
  expect(sheet).toContainEqual([LAPTOP, 2, 3, 1350, null]);
  expect(sheet).toContainEqual(["TOTAL", 2, 5, 1367, null]);

  // ── 3. Row click → the List, filtered to the laptop's sales ────────────
  await laptopRow.click();
  await expect(page.getByTestId("transactions-drill-chip")).toContainText(
    LAPTOP,
  );
  const table = page.getByTestId("data-table");
  await expect(table.locator("tbody tr", { hasText: stamp })).toHaveCount(2, {
    timeout: 15_000,
  });
  expect(
    (await listRows(day, { ...base, sale_product_id: String(laptop) })).length,
  ).toBe(2);

  // ── 5. Service type: OMT send + receive, as deltas ─────────────────────
  const omtOption = [{ type: "FINANCIAL_SERVICE", provider: "OMT" }];
  const omtSummary = () =>
    summary(day, {
      group_by: "service",
      options: omtOption,
      day_from: today,
      day_to: today,
    });
  const omtList = async () =>
    (
      await listRows(day, {
        typeFilters: JSON.stringify(omtOption),
        day_from: today,
        day_to: today,
      })
    ).filter((r) => r.reverses_id == null && r.type !== "REFUND").length;
  const count = (s: Summary, label: string) => rowOf(s, label)?.count ?? 0;
  const s0 = await omtSummary();
  const l0 = await omtList();
  const send = await postJson<{ success: boolean }>(
    day,
    "/api/services/transactions",
    {
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      omtServiceType: "INTRA",
      omtFee: 4,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 54 }],
    },
  );
  expect(send.success, JSON.stringify(send)).toBeTruthy();
  const receive = await postJson<{ success: boolean }>(
    day,
    "/api/services/transactions",
    {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      omtServiceType: "INTRA",
      omtFee: 3,
    },
  );
  expect(receive.success, JSON.stringify(receive)).toBeTruthy();
  const s1 = await omtSummary();
  expect(count(s1, "OMT System Send") - count(s0, "OMT System Send")).toBe(1);
  expect(count(s1, "OMT System Recv") - count(s0, "OMT System Recv")).toBe(1);
  expect(s1.total.count - s0.total.count).toBe((await omtList()) - l0);

  await page.getByTestId("transactions-view-summary").click();
  await page.getByTestId("summary-group-service").click();
  await box.fill("");
  await box.press("Enter");
  await expect(page.getByTestId("transactions-summary-table")).toContainText(
    "OMT System Send",
    { timeout: 15_000 },
  );

  // ── 6. SC-004: a 12-month summary, timed once ──────────────────────────
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const t0 = Date.now();
  const year = await summary(day, {
    group_by: "type",
    day_from: localDay(yearAgo),
    day_to: today,
  });
  const ms = Date.now() - t0;
  test.info().annotations.push({
    type: "SC-004",
    description: `12-month summary: ${ms} ms, ${year.total.count} transactions, truncated=${year.truncated}`,
  });
  process.stdout.write(
    `[SC-004] 12-month summary: ${ms} ms over ${year.total.count} counted transactions\n`,
  );
  expect(ms).toBeLessThan(3000);
});
