/**
 * E2E: LIRA-107 (T3, KC-2) — "Keep change" on a debt repayment.
 *
 * The debts flow is the special case (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md):
 * an unreturned overpayment normally becomes EXTRA debt reduction / client
 * credit. With keep-change active the kept extra must instead:
 *   - NOT reduce the debt (600,000 LBP debt paid 700,000 → debt exactly 0,
 *     not a 100,000 credit),
 *   - stay in the drawer (General LBP +700,000 — the full tender),
 *   - book as profit on the DEBT_REPAYMENT transaction, aggregated by the
 *     new "Other / kept change" profits bucket (owner decision 2026-07-13).
 *
 * UI-driven through the Process Repayment modal so the whole chain is under
 * guard: keep-change button (repay mode only) → reduction excludes kept →
 * keptChangeUSD/LBP through the shared schema → repo profit stamp → profits
 * summary bucket. Rule 17: with the pre-KC-2 core dist the schema strips the
 * kept fields and the reduction math over-reduces — the debt and profit
 * assertions fail. Rule 15: identity + deltas only.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// This spec asserts on toast visibility — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Api = {
  api: {
    clients: {
      create: (c: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: number;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    debt: {
      addAccountEntry: (d: {
        direction: "credit" | "debt";
        clientId: number;
        amountUSD: number;
        amountLBP: number;
        note?: string;
      }) => Promise<{ success?: boolean; error?: string }>;
      getDebtors: () => Promise<
        Array<{
          client_id: number;
          full_name?: string;
          client_name?: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
      getClientBalance: (clientId: number) => Promise<{
        success?: boolean;
        data?: { balance_usd: number; balance_lbp: number };
      }>;
    };
    profits: {
      summary: (
        from: string,
        to: string,
      ) => Promise<{
        debt_repayments?: { profit_usd: number; profit_lbp: number };
      }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; lbpBalance: number }>
      >;
    };
  };
};

let dialogs: string[] = [];

async function generalLbp(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.lbpBalance ?? 0;
  });
}

async function keptChangeLbpProfit(page: Page): Promise<number> {
  return page.evaluate(
    async ({ FROM, TO }) => {
      const w = window as unknown as Api;
      const s = await w.api.profits.summary(FROM, TO);
      return s.debt_repayments?.profit_lbp ?? 0;
    },
    { FROM, TO },
  );
}

test.describe("LIRA-107 — keep change on a debt repayment", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test("kept extra does not reduce the debt, stays in the drawer, and books as kept-change profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L107 Keep ${ts}`;
    const DEBT_LBP = 600_000;
    const PAID_LBP = 700_000;
    const KEPT_LBP = PAID_LBP - DEBT_LBP; // 100,000

    // Seed an LBP-only debt (same path as lira-105).
    const seeded = await appPage.evaluate(
      async ({ name, debtLbp }) => {
        const w = window as unknown as Api;
        const created = await w.api.clients.create({
          full_name: name,
          phone_number: `71${String(Date.now()).slice(-6)}`,
          whatsapp_opt_in: 0,
        });
        if (!created.success || !created.id) {
          return { ok: false, id: 0, error: created.error ?? "create failed" };
        }
        const entry = await w.api.debt.addAccountEntry({
          direction: "debt",
          clientId: created.id,
          amountUSD: 0,
          amountLBP: debtLbp,
          note: "L107 seed",
        });
        return {
          ok: entry.success === true,
          id: created.id,
          error: entry.error ?? null,
        };
      },
      { name: CLIENT, debtLbp: DEBT_LBP },
    );
    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);

    const drawerBefore = await generalLbp(appPage);
    const profitBefore = await keptChangeLbpProfit(appPage);

    // Open the repayment modal, overpay, keep the change.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    await appPage.getByPlaceholder(/Search client/i).fill(CLIENT);
    await appPage.locator("button").filter({ hasText: CLIENT }).first().click();
    await appPage
      .locator("button")
      .filter({ hasText: /Settle Debt/i })
      .first()
      .click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();

    // Prefill is the native 600,000; overpay to 700,000.
    const amount = appPage.locator('[data-testid^="payment-amount-"]').first();
    await expect(amount).toHaveValue("600,000");
    await amount.fill("700000");

    // The overpay surfaces Return/Change with the keep-change button (repay
    // mode wires onKeptChange — opt-in).
    await appPage.getByTestId("keep-change").click();
    await expect(appPage.getByText("Change kept (profit)")).toBeVisible();

    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Repayment processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "repayment raised an error dialog",
    ).toEqual([]);

    // Debt: exactly settled — the kept 100,000 did NOT become client credit.
    const balance = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      const res = await w.api.debt.getClientBalance(id);
      return res.data ?? { balance_usd: NaN, balance_lbp: NaN };
    }, seeded.id);
    expect(Math.abs(balance.balance_lbp)).toBeLessThan(1);
    expect(Math.abs(balance.balance_usd)).toBeLessThan(0.01);

    // Drawer: the FULL tender stays (kept change included).
    const drawerAfter = await generalLbp(appPage);
    expect(drawerAfter - drawerBefore).toBeCloseTo(PAID_LBP, 0);

    // Profits: the kept extra shows in the "Other / kept change" bucket.
    const profitAfter = await keptChangeLbpProfit(appPage);
    expect(profitAfter - profitBefore).toBeCloseTo(KEPT_LBP, 0);
  });
});
