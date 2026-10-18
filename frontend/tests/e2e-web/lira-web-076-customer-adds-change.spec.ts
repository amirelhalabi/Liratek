/**
 * lira-web-076 — LIRA-336 customer adds change on a payout, over REST
 * (owner decision 2026-10-18).
 *
 * An OMT system RECEIVE of $196.87: the customer hands $3.13 so the cashier
 * can pay out a round $200.00 — `customerPayments` Cash USD 3.13 IN,
 * `payments` Cash USD 200 OUT, `added_change_usd: 3.13`. Proves on the web
 * transport (same core path as desktop IPC):
 *   (a) accepted; the drawers move by −$196.87 net; NO "Change rounding"
 *       expense (the customer's money is not a round-up);
 *   (b) void nets the drawers back to 0;
 *   (c) the same lines with no claim are refused, and a claim over the
 *       $5 cap is refused — no drawer movement.
 * Rule 15: identity by the returned financial-services id and the unique
 * 3.13 amount; deltas only.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

async function auth(page: Page) {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

/** Every drawer's USD balance summed — the payout's drawer (the primary
 *  cash drawer for a primary-system RECEIVE, else General) is inside it. */
async function totalUsd(page: Page, headers: Record<string, string>) {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const b = r.balances as Record<string, { usd?: number } | undefined>;
  return Object.values(b).reduce((s, d) => s + (d?.usd ?? 0), 0);
}

type ExpenseRow = {
  id: number;
  category: string;
  amount_usd: number;
  is_refunded?: number;
  status?: string;
};

async function roundingExpenses(page: Page, headers: Record<string, string>) {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/expenses/today`, { headers })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return ((r.expenses ?? []) as ExpenseRow[]).filter(
    (e) =>
      e.category === "Change rounding" && Math.abs(e.amount_usd - 3.13) < 0.001,
  );
}

const live = (rows: ExpenseRow[]) =>
  rows.filter((e) => !e.is_refunded && (e.status ?? "active") === "active");

const receive = (extra: Record<string, unknown>) => ({
  provider: "OMT",
  serviceType: "RECEIVE",
  amount: 196.87,
  currency: "USD",
  omtServiceType: "INTRA",
  cashoutMethod: "CASH",
  ...extra,
});

test.describe("LIRA-336 customer adds change over REST", () => {
  test("(a)+(b) $3.13 in + $200 out on $196.87 owed: net −196.87, no rounding expense; void nets to 0", async ({
    page,
  }) => {
    const headers = await auth(page);
    const drawerBefore = await totalUsd(page, headers);
    const expBefore = live(await roundingExpenses(page, headers)).length;

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: receive({
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 3.13 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
          added_change_usd: 3.13,
        }),
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    expect((await totalUsd(page, headers)) - drawerBefore).toBeCloseTo(
      -196.87,
      2,
    );
    expect(live(await roundingExpenses(page, headers)).length).toBe(expBefore);

    const recent = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?limit=100`,
        { headers },
      )
    ).json();
    const row = (
      recent.transactions as Array<{
        id: number;
        type: string;
        source_table: string | null;
        source_id: number | null;
      }>
    ).find(
      (t) =>
        t.type === "FINANCIAL_SERVICE" &&
        t.source_table === "financial_services" &&
        t.source_id === res.id,
    );
    expect(row, `payout txn for fs #${res.id} not found`).toBeTruthy();

    const voided = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${row!.id}/void`,
        { headers },
      )
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
    expect((await totalUsd(page, headers)) - drawerBefore).toBeCloseTo(0, 2);
  });

  test("(c) no claim, or a claim over the cap, is refused with no drawer movement", async ({
    page,
  }) => {
    const headers = await auth(page);
    const drawerBefore = await totalUsd(page, headers);

    const noClaim = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: receive({
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 3.13 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
        }),
      })
    ).json();
    expect(noClaim.success).toBe(false);

    const overCap = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: receive({
          amount: 190,
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 10 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
          added_change_usd: 10,
        }),
      })
    ).json();
    expect(overCap.success).toBe(false);

    expect((await totalUsd(page, headers)) - drawerBefore).toBeCloseTo(0, 2);
  });
});
