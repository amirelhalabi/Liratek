/**
 * LIRA-105 — T2: editing the exchange rate in the Process Repayment modal
 * must NOT re-derive a native-LBP debt's prefill.
 *
 * Owner repro (2026-07-12): a 600,000 LBP debt opened the repayment modal at
 * rate 89,000; editing the rate to 90,000 changed the prefilled payment to
 * 606,742 LBP — the modal collapsed the per-currency position into ONE USD
 * scalar (dueUsd + dueLbp/rate) and MultiPaymentInput re-derived the LBP
 * figure from it at the edited rate (600000/89000 × 90000). Cashiers trusting
 * the prefill over-collected the difference.
 *
 * Fix under guard (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md, MCP-3): the
 * Debts modal feeds MultiPaymentInput per-currency `totals`, and the
 * component's engine only converts at a currency boundary — an LBP debt paid
 * in LBP never touches the rate. Rule 17: reverting the modal to the scalar
 * `totalAmount` wiring makes the rate-invariance assertion below fail with
 * exactly "606,742". Rule 15: identity matching + drawer/debt DELTAS only.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

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
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

let dialogs: string[] = [];

async function generalBalances(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const b = await w.api.dashboard.getDrawerBalances();
    return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
  });
}

async function debtorTotals(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.debt.getDebtors();
    const row = rows.find((r) => (r.full_name ?? r.client_name) === n);
    return row
      ? { usd: row.total_debt_usd, lbp: row.total_debt_lbp }
      : { usd: 0, lbp: 0 };
  }, name);
}

test.describe("LIRA-105 — repayment prefill is rate-invariant for native-LBP debt", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test("editing the modal rate keeps a 600,000 LBP debt at 600,000 and books it exactly", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L105 RateInv ${ts}`;
    const DEBT_LBP = 600_000;

    // Seed an LBP-ONLY debt via the manual account-entry path (direction
    // "debt": shop hands the client cash → they owe LBP natively; no USD
    // bucket exists, so any USD-scalar round-trip is fully visible).
    const seeded = await appPage.evaluate(
      async ({ name, debtLbp }) => {
        const w = window as unknown as Api;
        const created = await w.api.clients.create({
          full_name: name,
          phone_number: `71${String(Date.now()).slice(-6)}`,
          whatsapp_opt_in: 0,
        });
        if (!created.success || !created.id) {
          return { ok: false, error: created.error ?? "client create failed" };
        }
        const entry = await w.api.debt.addAccountEntry({
          direction: "debt",
          clientId: created.id,
          amountUSD: 0,
          amountLBP: debtLbp,
          note: "L105 LBP debt seed",
        });
        return { ok: entry.success === true, error: entry.error ?? null };
      },
      { name: CLIENT, debtLbp: DEBT_LBP },
    );
    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);
    const debtBefore = await debtorTotals(appPage, CLIENT);
    expect(debtBefore.lbp).toBeCloseTo(DEBT_LBP, 0);
    expect(Math.abs(debtBefore.usd)).toBeLessThan(0.01);

    // Snapshot AFTER the seed (the debt entry itself pays the drawer OUT).
    const before = await generalBalances(appPage);

    // Open the repayment modal from the Debts page UI.
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

    // Native prefill: one LBP line carrying the full native amount.
    const amount = appPage.locator('[data-testid^="payment-amount-"]').first();
    await expect(amount).toHaveValue("600,000");

    // THE GUARD — edit the rate 89,000 → 90,000. The debt is LBP paid in LBP:
    // no currency boundary is crossed, so the prefill must not move. Pre-fix
    // this re-derived through the USD scalar and showed exactly "606,742".
    await appPage.getByTestId("payment-exchange-rate").fill("90000");
    await expect(amount).toHaveValue("600,000");

    // And back — still anchored to the native amount.
    await appPage.getByTestId("payment-exchange-rate").fill("89000");
    await expect(amount).toHaveValue("600,000");

    // Book it. The repayment must clear exactly the native LBP debt.
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

    // Money: exactly 600,000 LBP into General, not a lira more; USD untouched.
    const after = await generalBalances(appPage);
    expect(after.lbp - before.lbp).toBeCloseTo(DEBT_LBP, 0);
    expect(after.usd - before.usd).toBeCloseTo(0, 2);

    // Debt: fully settled per currency.
    const remaining = await debtorTotals(appPage, CLIENT);
    expect(Math.abs(remaining.lbp)).toBeLessThan(1);
    expect(Math.abs(remaining.usd)).toBeLessThan(0.01);
  });
});
