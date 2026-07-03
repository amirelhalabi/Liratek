/**
 * E2E: LIRA-082 (B7) — loto rows show their in/out in the transactions table
 *
 * LOTO ticket sales (and LOTO_CASH_PRIZE payouts) had no case in the badge's
 * direction mapping, so the transactions table rendered a blank In/Out cell
 * for every loto row. A cash ticket sale must read as cash IN (green ↓ badge
 * + an "in:" payment leg); the payment legs come from the real payments rows.
 *
 * Row located by IDENTITY (unique ticket number in the summary), never by
 * position (shared accumulating DB).
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    loto: {
      sell: (data: {
        ticket_number?: string;
        sale_amount: number;
        payment_method?: string;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
        }>;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
    transactions: {
      getRecent: (limit: number) => Promise<
        Array<{
          id: number;
          type: string;
          summary: string | null;
          payments: Array<{
            direction: "in" | "out";
            amount: number;
            currency_code: string;
          }>;
        }>
      >;
    };
  };
};

test.describe("LIRA-082 (B7) — loto in/out", () => {
  test("cash loto sale: row has an 'in' payment leg and a cash-in badge", async ({
    appPage,
  }) => {
    const ticket = `B7-${Date.now()}`;

    // 1. Sell a loto ticket for 75,000 LBP cash via IPC.
    const result = await appPage.evaluate(async (ticket) => {
      const w = window as unknown as Api;
      const res = await w.api.loto.sell({
        ticket_number: ticket,
        sale_amount: 75_000,
        payment_method: "CASH",
      });
      const row =
        (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "LOTO" && t.summary?.includes(ticket),
        ) ?? null;
      return { ok: res.success === true, error: res.error ?? null, row };
    }, ticket);

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.row).not.toBeNull();

    // The structured legs carry the customer's cash IN (75,000 LBP).
    const inLegs = result.row!.payments.filter((p) => p.direction === "in");
    expect(inLegs.length).toBeGreaterThan(0);
    expect(inLegs[0].amount).toBeCloseTo(75_000, 2);
    expect(inLegs[0].currency_code).toBe("LBP");

    // 2. The transactions table renders the badge + legs (pre-B7: blank cell).
    // Bounce through another route to force a fresh mount/fetch of /audit.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const row = appPage.locator("tr", { hasText: ticket }).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "in",
    );
    await expect(row.getByTestId("payment-legs")).toContainText("in:");
  });

  test("LBP ticket paid in USD books the PAID currency (owner-reported bug)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const general = async () => {
        const g = (await w.api.recharge.getDrawerBalances()).find(
          (d) => d.name === "General",
        );
        return { usd: g?.usdBalance ?? 0, lbp: g?.lbpBalance ?? 0 };
      };

      const before = await general();
      // 500,000 LBP ticket, customer hands over $5.
      const res = await w.api.loto.sell({
        ticket_number: `B-USD-${Date.now()}`,
        sale_amount: 500_000,
        payment_method: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      });
      const after = await general();

      return {
        ok: res.success === true,
        error: res.error ?? null,
        usdDelta: after.usd - before.usd,
        lbpDelta: after.lbp - before.lbp,
      };
    });

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // The $5 the customer handed over — NOT a phantom +500,000 LBP.
    expect(result.usdDelta).toBeCloseTo(5, 2);
    expect(result.lbpDelta).toBeCloseTo(0, 2);
  });
});
