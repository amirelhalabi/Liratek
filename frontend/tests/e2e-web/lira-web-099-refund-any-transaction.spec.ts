/**
 * lira-web-099 — LIRA-388: one "Refund" on (almost) every Transactions row,
 * driven on the real web Transactions page
 * (specs/388-refund-any-transaction, SC-004).
 *
 *   1. A loto cash prize paid OUTSIDE a session (the Corner Tech report):
 *      the row used to say "Can't refund here"; now "Refund" opens the
 *      window as "Customer pays back" with the prize preselected. Confirmed
 *      untouched, every drawer nets 0 against before the prize, the
 *      unreimbursed-prizes total is back where it was, and a REFUND row
 *      links to the prize.
 *   2. An Alfa manual top-up: credits added by hand to an Alfa line (today
 *      the only "manual top-up" for MTC/Alfa — the drawer top-up refuses
 *      them: "Alfa credits are added on the phone line itself"), a
 *      CARRIER_LINE_ADJUSTMENT that now records the credits before/after.
 *      Refunded with ONE confirm naming the opposite entry: the line and the
 *      Alfa drawer go back.
 *   3. A sale refunded through the single Refund button, same method (the
 *      old "Void"): no Void button on the row, the drawer moves back exactly
 *      as the void did (the sale's own legs mirrored), a REFUND row links.
 *
 * Also saves the What's new screenshot of the refund window on the loto
 * prize row (rule 30), 1400×900.
 *
 * Rows are found by identity (this run's own ticket number / product name /
 * amount), never by position; drawers are asserted as deltas (rule 15).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, BACKEND_URL } from "./fixtures";
import {
  drawers,
  expectMoved,
  getJson,
  lastTxnId,
  openShopDay,
  postJson,
  txnsSince,
  waitPost,
  type Drawers,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/refund-any-row.png",
);

/** Every drawer × currency moved by exactly 0 between two snapshots. */
function expectNoNetMove(after: Drawers, before: Drawers): void {
  for (const drawer of new Set([
    ...Object.keys(after),
    ...Object.keys(before),
  ])) {
    for (const cur of new Set([
      ...Object.keys(after[drawer] ?? {}),
      ...Object.keys(before[drawer] ?? {}),
    ])) {
      expectMoved(after, before, drawer, cur, 0);
    }
  }
}

test("LIRA-388 refund a standalone loto prize, an Alfa top-up and a sale from their rows", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const ticketNo = `T388-${day.stamp}`;
  const modal = page.getByTestId("counterparty-settle-modal");
  const table = page.getByTestId("data-table");
  const search = async (text: string) => {
    await page.goto("/#/audit");
    const box = page.getByPlaceholder(/Search summary, client, user/);
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.fill(text);
    await box.press("Enter");
  };

  // ── 1. Standalone loto prize ───────────────────────────────────────────
  const prizesTotal = async () =>
    (
      await getJson<{ success: boolean; total: number }>(
        day,
        "/api/loto/cash-prizes/total-unreimbursed",
      )
    ).total;
  const total0 = await prizesTotal();
  const d0 = await drawers(day);
  const before = await lastTxnId(day);
  const paid = await postJson<{ success: boolean; error?: string }>(
    day,
    "/api/loto/cash-prizes",
    { ticket_number: ticketNo, prize_amount: 500_000 },
  );
  expect(paid.success, JSON.stringify(paid)).toBeTruthy();
  const prize = (await txnsSince(day, before)).find(
    (t) => t.type === "LOTO_CASH_PRIZE",
  );
  expect(prize).toBeTruthy();
  expect(await prizesTotal()).toBeCloseTo(total0 + 500_000, 0);

  await search(ticketNo);
  const prizeRow = table
    .locator("tbody tr", { hasText: /500,000/ })
    .filter({ has: page.getByTestId("row-refund") })
    .first();
  await expect(prizeRow).toBeVisible({ timeout: 15_000 });
  await expect(prizeRow.getByText("Can't refund here")).toHaveCount(0);
  await expect(
    prizeRow.getByRole("button", { name: "Void", exact: true }),
  ).toHaveCount(0);
  await prizeRow.getByTestId("row-refund").click();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await expect(modal.getByText("Refund — Customer pays back")).toBeVisible();
  await expect(modal.getByTestId("refund-return-summary")).toContainText(
    "500,000 LBP",
  );

  // What's new screenshot (rule 30): the real window, landscape.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(modal.getByText("Refund — Customer pays back")).toBeVisible();
  await page.screenshot({ path: SCREENSHOT });

  const prizeRes = waitPost(page, `/api/transactions/${prize!.id}/refund`);
  await page.getByRole("button", { name: "Confirm Refund" }).click();
  const prizeDone = await prizeRes;
  expect(prizeDone.body.success, JSON.stringify(prizeDone.body)).toBeTruthy();
  // Untouched window → no override: the exact mirror of the prize's leg.
  expect(prizeDone.request.refundLegs ?? undefined).toBeUndefined();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  expectNoNetMove(await drawers(day), d0);
  expect(await prizesTotal()).toBeCloseTo(total0, 0);
  const prizeRefund = (await txnsSince(day, before)).find(
    (t) => t.type === "REFUND" && t.reverses_id === prize!.id,
  );
  expect(prizeRefund, "REFUND row linked to the prize").toBeTruthy();

  // ── 2. Alfa manual top-up: credits added to a line by hand ────────────
  const line = await postJson<{
    success: boolean;
    data?: { id: number };
    error?: string;
  }>(day, "/api/carrier-lines", {
    carrier: "alfa",
    phone_number: `03${day.stamp}`,
    credits: 10,
  });
  expect(line.success, JSON.stringify(line)).toBeTruthy();
  const lineId = line.data!.id;
  const d1 = await drawers(day);
  const before2 = await lastTxnId(day);
  const edit = await (
    await page.request.put(
      `${BACKEND_URL}/api/carrier-lines/${lineId}/balance`,
      {
        headers: day.auth,
        data: { credits: 510 },
      },
    )
  ).json();
  expect(edit.success, JSON.stringify(edit)).toBeTruthy();
  const adj = (await txnsSince(day, before2)).find(
    (t) => t.type === "CARRIER_LINE_ADJUSTMENT",
  );
  expect(adj, "the line edit's row").toBeTruthy();
  expect(adj!.meta).toMatchObject({ credits_before: 10, credits_after: 510 });
  expectMoved(await drawers(day), d1, "Alfa", "USD", 500);

  await search(`03${day.stamp}`);
  const adjRow = table
    .locator("tbody tr", { hasText: /Line adjustment/ })
    .filter({ has: page.getByTestId("row-refund") })
    .first();
  await expect(adjRow).toBeVisible({ timeout: 15_000 });
  const dialogsBefore = day.dialogs.length;
  const adjRes = waitPost(page, `/api/transactions/${adj!.id}/refund`);
  await adjRow.getByTestId("row-refund").click();
  const adjDone = await adjRes;
  expect(adjDone.body.success, JSON.stringify(adjDone.body)).toBeTruthy();
  // ONE confirm, naming the opposite entry (no payment window).
  const asked = day.dialogs.slice(dialogsBefore);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/Write the opposite entry: −\$500/);
  await expect(modal).toBeHidden();
  expectNoNetMove(await drawers(day), d1);
  const lines = await getJson<{
    success: boolean;
    data: Array<{ id: number; credits: number }>;
  }>(day, "/api/carrier-lines/active");
  expect(lines.data.find((l) => l.id === lineId)?.credits).toBe(10);

  // ── 3. A sale, same method (what Void did) ─────────────────────────────
  const name = `L-web-099 Cable ${day.stamp}`;
  const product = await postJson<{ success: boolean; data: { id: number } }>(
    day,
    "/api/inventory/products",
    {
      name,
      category: "General",
      cost_price_usd: 4,
      retail_price_usd: 12,
      stock: 3,
      min_stock_threshold: 0,
    },
  );
  expect(product.success, JSON.stringify(product)).toBeTruthy();
  const d2 = await drawers(day);
  const before3 = await lastTxnId(day);
  const sale = await postJson<{
    success: boolean;
    id?: number;
    error?: string;
  }>(day, "/api/sales/process", {
    client_id: null,
    items: [{ product_id: product.data.id, quantity: 1, price: 12 }],
    total_amount: 12,
    discount: 0,
    final_amount: 12,
    payment_usd: 12,
    payment_lbp: 0,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 12, direction: "IN" },
    ],
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate: 89_500,
  });
  expect(sale.success, JSON.stringify(sale)).toBeTruthy();
  const saleTxn = (await txnsSince(day, before3)).find(
    (t) => t.type === "SALE",
  );
  expect(saleTxn).toBeTruthy();
  expectMoved(await drawers(day), d2, "General", "USD", 12);

  await search(name);
  const saleRow = table
    .locator("tbody tr", { hasText: /Sale #\d+/ })
    .filter({ has: page.getByTestId("row-refund") })
    .first();
  await expect(saleRow).toBeVisible({ timeout: 15_000 });
  // One action: Refund. No Void on the row.
  await expect(
    saleRow.getByRole("button", { name: "Void", exact: true }),
  ).toHaveCount(0);
  const saleRes = waitPost(page, `/api/transactions/${saleTxn!.id}/refund`);
  await saleRow.getByTestId("row-refund").click();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Confirm Refund" }).click();
  const saleDone = await saleRes;
  expect(saleDone.body.success, JSON.stringify(saleDone.body)).toBeTruthy();
  expect(saleDone.request.refundLegs ?? undefined).toBeUndefined();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  // Same money as the old Void: the $12 cash leg mirrored, nothing else.
  expectNoNetMove(await drawers(day), d2);
  const saleRefund = (await txnsSince(day, before3)).find(
    (t) => t.type === "REFUND" && t.reverses_id === saleTxn!.id,
  );
  expect(saleRefund, "REFUND row linked to the sale").toBeTruthy();
  expect(saleRefund!.amount_usd).toBeCloseTo(-12, 2);

  await day.context.close();
});
