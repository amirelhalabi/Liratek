/**
 * lira-web-074 — LIRA-334 payout round-up over REST (owner decision
 * 2026-10-18).
 *
 * The cashier pays out a little MORE than owed because the drawer has no
 * coins: an OMT system RECEIVE of $87.87 paid out as $88.00 cash with
 * `rounding_given_usd: 0.13`. Proves on the web transport (the same core
 * path as desktop IPC):
 *   (a) the payout is accepted, the drawer moves by the FULL $88.00, and one
 *       "Change rounding" expense of $0.13 is booked for it;
 *   (b) voiding the payout nets the drawer back to 0 and voids the expense;
 *   (c) an overpay with no claim is still refused, and a claim over the
 *       $5 cap is refused — no drawer movement either way.
 *
 * Rule 15: rows are matched by identity (the financial-services id the POST
 * returns, the unique $0.13 amount), and every money check is a delta.
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
      e.category === "Change rounding" &&
      Math.abs(e.amount_usd - 0.13) < 0.001,
  );
}

const live = (rows: ExpenseRow[]) =>
  rows.filter((e) => !e.is_refunded && (e.status ?? "active") === "active");

const receive = (extra: Record<string, unknown>) => ({
  provider: "OMT",
  serviceType: "RECEIVE",
  amount: 87.87,
  currency: "USD",
  omtServiceType: "INTRA",
  cashoutMethod: "CASH",
  ...extra,
});

test.describe("LIRA-334 payout round-up over REST", () => {
  test("(a)+(b) $88.00 paid on $87.87 books a $0.13 Change rounding expense; void nets to 0", async ({
    page,
  }) => {
    const headers = await auth(page);
    const drawerBefore = await totalUsd(page, headers);
    const expBefore = live(await roundingExpenses(page, headers)).length;

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: receive({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 88 }],
          rounding_given_usd: 0.13,
        }),
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    expect((await totalUsd(page, headers)) - drawerBefore).toBeCloseTo(-88, 2);
    expect(live(await roundingExpenses(page, headers)).length - expBefore).toBe(
      1,
    );

    // Find the payout's own unified row by identity, then void it.
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
    expect(live(await roundingExpenses(page, headers)).length).toBe(expBefore);
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
          payments: [{ method: "CASH", currencyCode: "USD", amount: 88 }],
        }),
      })
    ).json();
    expect(noClaim.success).toBe(false);
    expect(noClaim.error as string).toContain("more than the total");

    const overCap = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: receive({
          amount: 81.87,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 88 }],
          rounding_given_usd: 6.13,
        }),
      })
    ).json();
    expect(overCap.success).toBe(false);
    expect(overCap.error as string).toContain("round a payout up by");

    expect((await totalUsd(page, headers)) - drawerBefore).toBeCloseTo(0, 2);
  });
});
