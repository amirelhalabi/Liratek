/**
 * E2E: LIRA-086 (B5) — profits cover maintenance and recharge teshriji
 *
 * Maintenance profit was ALWAYS zero in every profits view: the queries
 * filtered on a fictional 'completed' status that the maintenance workflow
 * (Received / In_Progress / Ready / Delivered / Delivered_Paid) never
 * produces. Recharge teshriji (CREDIT_TRANSFER) coverage is verified too.
 *
 * IPC-driven; shared accumulating DB → snapshot profits.summary before each
 * action and assert the tab's profit delta (guards currency mixing and
 * double counting per the LEFT_TO_DO plan).
 */

import { test, expect, ensureProfitsUnlocked } from "./fixtures";

test.describe.configure({ retries: 0 });

type Summary = {
  maintenance: { profit_usd: number };
  recharges: { profit_usd: number; profit_lbp: number };
};

type Api = {
  api: {
    profits: {
      // Returns the ProfitSummary object directly (no success envelope).
      summary: (from: string, to: string) => Promise<Summary>;
    };
    maintenance: {
      save: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    recharge: {
      process: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    expenses: {
      getToday: () => Promise<Array<{ category: string; amount_usd: number }>>;
    };
  };
};

const FROM = "2000-01-01";
const TO = "2099-12-31";

test.describe("LIRA-086 (B5) — profits coverage", () => {
  // profits:* IPC is password-gated since the profits-gate change; unlock
  // before reading profit numbers as an oracle.
  test.beforeEach(async ({ appPage }) => {
    await ensureProfitsUnlocked(appPage);
  });

  test("a Delivered_Paid maintenance job increases maintenance profit by price − cost", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const summaryOf = async () => w.api.profits.summary(FROM, TO);

        const before = await summaryOf();

        // cost $25, price $60 → profit $35
        const res = await w.api.maintenance.save({
          device_name: "B5 profit phone",
          issue_description: "screen replacement",
          client_name: `B5 MAINT ${Date.now()}`,
          client_phone: "70999888",
          cost_usd: 25,
          price_usd: 60,
          final_amount_usd: 60,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        });

        const after = await summaryOf();
        return {
          ok: res.success === true,
          error: res.error ?? null,
          delta: after.maintenance.profit_usd - before.maintenance.profit_usd,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Pre-B5 this delta was 0 — maintenance never reached the profits page.
    expect(result.delta).toBeCloseTo(35, 2);
  });

  test("a recharge teshriji (CREDIT_TRANSFER) increases recharge profit by its gross commission and books the SMS cost as its own expense", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const summaryOf = async () => w.api.profits.summary(FROM, TO);
        const smsExpenseTotal = async () =>
          (await w.api.expenses.getToday())
            .filter((e) => e.category === "SMS_Transfer_Fee")
            .reduce((sum, e) => sum + e.amount_usd, 0);

        const before = await summaryOf();
        const smsBefore = await smsExpenseTotal();

        // $3 MTC transfer sold at $3.50: gross margin = 3.50 − 3.00 = $0.50.
        // Since commit cff444ea (2026-09-07) the SMS cost is no longer netted
        // out of recharge profit — it books as its own SMS_Transfer_Fee
        // expense (1 SMS × $0.16, ceil(3/3) = 1), asserted separately below.
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 3,
          cost: 3,
          price: 3.5,
          currency: "USD",
          phoneNumber: "70123456",
          paid_by_method: "CASH",
        });

        const after = await summaryOf();
        const smsAfter = await smsExpenseTotal();
        return {
          ok: res.success === true,
          error: res.error ?? null,
          delta: after.recharges.profit_usd - before.recharges.profit_usd,
          smsExpenseDelta: smsAfter - smsBefore,
        };
      },
      { FROM, TO },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // Gross commission — teshriji profit reaches the recharge tab undeducted.
    expect(result.delta).toBeCloseTo(0.5, 2);
    // The SMS cost went to its own expense row, not a profit deduction.
    expect(result.smsExpenseDelta).toBeCloseTo(0.16, 2);
  });
});
