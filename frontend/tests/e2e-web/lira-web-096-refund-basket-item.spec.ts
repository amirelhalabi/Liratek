/**
 * lira-web-096 — LIRA-381: "Refund item" on ANY member of a checked-out
 * session basket, driven on the real web Transactions page
 * (specs/381-refund-any-basket-item, SC-002: stories 1 and 2).
 *
 * The owner's basket: a $20 service, a 300,000 LBP loto ticket and a
 * 500,000 LBP loto prize, paid in cash — the customer gives $20 and gets
 * 200,000 LBP (the prize netted against the ticket).
 *   Story 1 — "Refund item" on the ticket: the window offers 300,000 LBP
 *     back; confirmed, the General LBP drawer moves by −300,000 (delta) and
 *     the ticket is marked refunded.
 *   Story 2 — "Refund item" on the prize: the window opens in the
 *     "Customer pays back" direction with 500,000 LBP; confirmed as cash,
 *     General LBP moves by +500,000 and the prize is voided.
 * Also saves the What's new screenshot of the window in the "Customer pays
 * back" direction (rule 30), 1400×900.
 *
 * Rows are found by identity — this run's own ticket number on the summary,
 * the amount in the row — never by position (rule 15); drawers are asserted
 * as deltas.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  drawers,
  expectMoved,
  lastTxnId,
  openShopDay,
  postJson,
  txnsSince,
  waitPost,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/refund-basket-item.png",
);
const RATE = 89_500;

test("LIRA-381 refund a loto ticket, then the loto prize, out of a checked-out basket", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const day = await openShopDay(browser);
  const { page } = day;
  const ticketNo = `T381-${day.stamp}`;
  const customer = `Basket 381 ${day.stamp}`;

  // ── The basket, checked out over REST (setup; the refund is the UI) ────
  const before = await lastTxnId(day);
  const started = await postJson<{ success: boolean; sessionId: number }>(
    day,
    "/api/sessions/start",
    { customer_name: customer },
  );
  expect(started.success, JSON.stringify(started)).toBeTruthy();
  const sessionId = started.sessionId;
  const checkout = await postJson<{ success: boolean; error?: string }>(
    day,
    "/api/sessions/checkout",
    {
      sessionId,
      exchangeRate: RATE,
      userId: 1,
      cartItems: [
        {
          id: "svc",
          module: "custom_service",
          label: `Screen glass ${ticketNo}`,
          amount: 20,
          currency: "USD",
          ipcChannel: "custom-services:add",
          formData: {
            description: `Screen glass ${ticketNo}`,
            cost_usd: 5,
            price_usd: 20,
            cost_lbp: 0,
            price_lbp: 0,
          },
        },
        {
          id: "ticket",
          module: "loto_ticket",
          label: "Loto ticket",
          amount: 300_000,
          currency: "LBP",
          ipcChannel: "loto:sell",
          formData: {
            ticket_number: ticketNo,
            sale_amount: 300_000,
            commission_rate: 0.05,
            currency: "LBP",
          },
        },
        {
          id: "prize",
          module: "loto_prize",
          label: "Loto prize",
          amount: -500_000,
          currency: "LBP",
          ipcChannel: "loto:cash-prize:create",
          formData: { ticket_number: ticketNo, prize_amount: 500_000 },
        },
      ],
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20, direction: "IN" },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 200_000,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
    },
  );
  expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();

  const members = (await txnsSince(day, before)).filter(
    (t) => (t as { session_id?: number | null }).session_id === sessionId,
  );
  const ticket = members.find((t) => t.type === "LOTO");
  const prize = members.find((t) => t.type === "LOTO_CASH_PRIZE");
  expect(ticket, JSON.stringify(members)).toBeTruthy();
  expect(prize, JSON.stringify(members)).toBeTruthy();

  // ── The Transactions page, narrowed to this run's ticket number ────────
  await page.goto("/#/audit");
  const box = page.getByPlaceholder(/Search summary, client, user/);
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(ticketNo);
  await box.press("Enter");
  const table = page.getByTestId("data-table");
  const rowWith = (amount: RegExp) =>
    table
      .locator("tbody tr", { hasText: amount })
      .filter({ has: page.getByRole("button", { name: "Refund item" }) })
      .first();
  const modal = page.getByTestId("counterparty-settle-modal");

  // ── Story 1: the ticket — 300,000 LBP back to the customer ─────────────
  const d0 = await drawers(day);
  await rowWith(/300,000/)
    .getByRole("button", { name: "Refund item" })
    .click();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await expect(modal.getByText("Refund — Choose Return Method")).toBeVisible();
  await expect(modal.getByTestId("refund-return-summary")).toContainText(
    "300,000 LBP",
  );
  const ticketRes = waitPost(page, "/items/refund");
  await page.getByRole("button", { name: "Confirm Refund" }).click();
  const ticketDone = await ticketRes;
  expect(ticketDone.body.success, JSON.stringify(ticketDone.body)).toBeTruthy();
  expect(ticketDone.request.transactionId).toBe(ticket!.id);
  expect(ticketDone.body.direction).toBe("to_customer");
  await expect(modal).toBeHidden({ timeout: 15_000 });
  const d1 = await drawers(day);
  expectMoved(d1, d0, "General", "LBP", -300_000);
  expectMoved(d1, d0, "General", "USD", 0);

  // ── Story 2: the prize — the customer pays 500,000 LBP back ────────────
  await rowWith(/500,000/)
    .getByRole("button", { name: "Refund item" })
    .click();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await expect(modal.getByText("Refund — Customer pays back")).toBeVisible();
  await expect(modal.getByTestId("refund-return-summary")).toContainText(
    "Customer pays: 500,000 LBP via Cash",
  );

  // What's new screenshot (rule 30): the real window, landscape.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(modal.getByText("Refund — Customer pays back")).toBeVisible();
  await page.screenshot({ path: SCREENSHOT });

  const prizeRes = waitPost(page, "/items/refund");
  await page.getByRole("button", { name: "Confirm Refund" }).click();
  const prizeDone = await prizeRes;
  expect(prizeDone.body.success, JSON.stringify(prizeDone.body)).toBeTruthy();
  expect(prizeDone.request.transactionId).toBe(prize!.id);
  expect(prizeDone.body.direction).toBe("from_customer");
  await expect(modal).toBeHidden({ timeout: 15_000 });
  const d2 = await drawers(day);
  expectMoved(d2, d1, "General", "LBP", 500_000);

  // Both REFUND rows sit in the session, pointing at their member.
  const refunds = (await txnsSince(day, before)).filter(
    (t) => t.type === "REFUND",
  );
  const refundOf = (memberId: number) =>
    refunds.find((r) => r.meta.memberTransactionId === memberId);
  expect(refundOf(ticket!.id)?.meta.refundDirection).toBe("to_customer");
  expect(refundOf(prize!.id)?.meta.refundDirection).toBe("from_customer");

  await day.context.close();
});
