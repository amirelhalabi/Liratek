/**
 * E2E: LIRA-104 — refunding an account-charged transaction reverses the debt
 * (owner-reported 2026-07-12).
 *
 * The exact reported flow: an MTC recharge charged to a customer account
 * (600,000 LBP), refunded from the Transactions table — and the client's
 * debt ledger DID NOT move: the 'Recharge Debt' row survived the refund.
 * Pre-fix, TransactionRepository._cancelDebt ran only for sales, matched
 * only 'Sale Debt', and negated only amount_usd; the module-debt reversal
 * fix runs it unconditionally over MODULE_DEBT_TRANSACTION_TYPES in BOTH
 * currencies.
 *
 * This is also the first spec to drive the Transactions-table REFUND button
 * (lira-092 covers Void). Assertions follow rule 15: the row is located by
 * IDENTITY (label + unique amount) and the debt is asserted as a DELTA on
 * this spec's own client — never absolute totals or row position.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

const CLIENT_NAME = "L104 Refund Client";
// Unique amount so the /audit row is identity-matchable in the shared DB.
const PRICE_LBP = 654_000;

type DebtorRow = {
  id: number;
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};

type Api = {
  api: {
    clients: {
      create: (c: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: 0 | 1;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    debt: {
      getDebtors: () => Promise<DebtorRow[]>;
    };
    recharge: {
      process: (data: {
        provider: "MTC" | "Alfa";
        type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
        amount: number;
        cost: number;
        price: number;
        paid_by_method?: string;
        phoneNumber?: string;
        clientId?: number;
        currency?: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
  };
};

/** Snapshot this spec's client balance (0/0 when no ledger rows yet). */
async function balance(page: Page): Promise<{ usd: number; lbp: number }> {
  return page.evaluate(async (name) => {
    const w = window as unknown as Api;
    const row = (await w.api.debt.getDebtors()).find(
      (d) => d.full_name === name,
    );
    return { usd: row?.total_debt_usd ?? 0, lbp: row?.total_debt_lbp ?? 0 };
  }, CLIENT_NAME);
}

test("refund from the Transactions table cancels an account-charged recharge debt (LBP)", async ({
  appPage,
}) => {
  // Seed: client with name + phone (the account gate needs both), then the
  // reported transaction — MTC credits charged to the account, priced in LBP.
  const seeded = await appPage.evaluate(
    async (args: { name: string; price: number }) => {
      const w = window as unknown as Api;
      const client = await w.api.clients.create({
        full_name: args.name,
        phone_number: `71${String(Date.now()).slice(-6)}`,
        whatsapp_opt_in: 0,
      });
      if (!client.success || !client.id) {
        return { ok: false, error: client.error ?? "client create failed" };
      }
      const recharge = await w.api.recharge.process({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 530_000,
        price: args.price,
        currency: "LBP",
        phoneNumber: "03123456",
        paid_by_method: "CUSTOMER_ACCOUNT",
        clientId: client.id,
      });
      return {
        ok: recharge.success === true,
        error: recharge.error ?? null,
      };
    },
    { name: CLIENT_NAME, price: PRICE_LBP },
  );
  expect(seeded.error).toBeNull();
  expect(seeded.ok).toBe(true);

  // On-account charge booked: the client owes exactly the price, in LBP.
  await expect
    .poll(async () => (await balance(appPage)).lbp, { timeout: 10_000 })
    .toBeCloseTo(PRICE_LBP, 2);
  const charged = await balance(appPage);

  // Bounce through "/" first (README "Assertion discipline" / LIRA-111) —
  // a viewer already parked on /audit from an earlier spec does not
  // remount on a same-route hash nav, so the table can show a stale list.
  await navigateTo(appPage, "/");
  await navigateTo(appPage, "/audit");

  // Identity match (rule 15): the MTC recharge row with this spec's unique
  // amount. It must offer a Refund button.
  const row = appPage
    .locator("tbody tr")
    .filter({ hasText: /Recharge/i })
    .filter({ hasText: "654,000" })
    .first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const refundBtn = row.getByRole("button", { name: /^Refund$/ });
  await expect(refundBtn).toBeVisible();

  // Answer the confirm explicitly with OK (same pattern as lira-092's Void).
  const confirmSeen = new Promise<string>((resolve) => {
    appPage.once("dialog", (d) => {
      d.accept().catch(() => {});
      resolve(d.message());
    });
  });
  await refundBtn.click();
  expect(await confirmSeen).toMatch(/Refund this transaction/i);

  // THE fix: the debt is cancelled — the client's balance returns to its
  // pre-recharge level in BOTH currencies (pre-fix: LBP stayed +654,000).
  await expect
    .poll(
      async () => (await balance(appPage)).lbp - (charged.lbp - PRICE_LBP),
      {
        timeout: 10_000,
      },
    )
    .toBeCloseTo(0, 2);
  const after = await balance(appPage);
  expect(after.usd).toBeCloseTo(charged.usd, 2);
});
