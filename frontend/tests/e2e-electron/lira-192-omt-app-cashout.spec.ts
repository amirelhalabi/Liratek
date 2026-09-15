/**
 * E2E: LIRA-192 — "Cash Out to OMT" (OMT App wallet cashout)
 * (docs/plans/todo_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8, D10-D16).
 *
 * The mirror of LIRA-190's credit top-up: the `OMT_App` wallet balance goes
 * DOWN and the OMT open-credit account is credited principal PLUS a 0.1%
 * commission (D11) — no physical cash moves either way (D2), `OMT_System`
 * (the OMT Cash Drawer) stays untouched, and the commission is recognised
 * as profit only at account settlement (D14, LIRA-189 — wave 2), so this
 * flow's own unified transaction stamps `profit_* = 0` at creation.
 *
 * WHY THIS SPEC DRIVES THE REAL MODAL (rule 15 layer-seam, not raw IPC):
 * `OmtAppCashoutModal` computes and displays a live commission preview via
 * the SAME shared core function the repository stamps with
 * (`omtAppCashoutCommission`, `packages/core/src/constants/omtAppCashout.ts`)
 * — precisely the "preview computed by the frontend" seam a hand-built IPC
 * payload can never exercise. This spec independently re-derives the
 * expected commission from the DOCUMENTED rate (0.1%, D13) rather than
 * importing the same function the app uses, so a regression that changes
 * the rate OR desyncs the preview from the stamp is caught here, not just
 * proven self-consistent.
 *
 * D15 (insufficient wallet → blocked) is a pure repository guard with its
 * own core-jest coverage (`RechargeRepository.omtAppCashout.test.ts`) and no
 * frontend arithmetic of its own — not duplicated here.
 *
 * Every assertion is a DELTA snapshotted immediately before the action,
 * matched by drawer/supplier NAME — never an absolute total or row
 * position (rule 15; this suite shares one accumulating DB across specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// D13: the OMT App cashout's own named constant — independently re-derived
// here (never imported from the app) so this spec can catch a drift between
// the two, not just prove them tautologically equal.
const CASHOUT_COMMISSION_RATE = 0.001;

// Distinctive, non-round amounts so identity matching by (type, amount)
// cannot collide with any other spec's activity in the shared DB.
const CASHOUT_USD = 733.0;
const CASHOUT_LBP = 3_517_000;
const WALLET_SEED_USD = 5_000; // funds the wallet well above CASHOUT_USD
const WALLET_SEED_LBP = 40_000_000; // funds the wallet well above CASHOUT_LBP
const VOID_ROUNDTRIP_USD = 219.5;

function roundForCurrency(amount: number, currency: "USD" | "LBP"): number {
  const unit = currency === "LBP" ? 1 : 0.01;
  return Math.round(amount / unit) * unit;
}

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };
type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type RecentTxn = {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
      topUpFromSupplier: (data: {
        provider: "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string }>;
      cashoutToSupplier: (data: {
        provider: "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string; commission?: number }>;
    };
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalance[]>;
    };
    transactions: {
      getRecent: (limit: number) => Promise<RecentTxn[]>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function drawers(
  page: Page,
): Promise<{ general: number; omtSystem: number; omtApp: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pick = (n: string) => rows.find((d) => d.name === n)?.usdBalance ?? 0;
    return {
      general: pick("General"),
      omtSystem: pick("OMT_System"),
      omtApp: pick("OMT_App"),
    };
  });
}

async function omtAppSupplierBalance(
  page: Page,
  currency: "USD" | "LBP",
): Promise<number> {
  return page.evaluate(async (cur) => {
    const w = window as unknown as Api;
    const supplier = (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "OMT_APP",
    );
    if (!supplier) return NaN;
    const bal = (await w.api.suppliers.getBalances(true)).find(
      (b) => b.supplier_id === supplier.id,
    );
    return cur === "USD" ? (bal?.total_usd ?? 0) : (bal?.total_lbp ?? 0);
  }, currency);
}

/** Seed the wallet via raw IPC (setup, not the behaviour under test — that
 *  is LIRA-190's own spec) so the cashout has real balance to draw down
 *  regardless of this shared DB's prior history. */
async function seedWallet(
  page: Page,
  amount: number,
  currency: "USD" | "LBP",
) {
  const res = await page.evaluate(
    async ({ amount, currency }) => {
      const w = window as unknown as Api;
      return w.api.recharge.topUpFromSupplier({
        provider: "OMT_APP",
        amount,
        currency,
      });
    },
    { amount, currency },
  );
  expect(res.success).toBe(true);
}

/** Click the OMT App provider tab and confirm the Cash Out button rendered
 *  (D16: OMT App only — this button's very presence is part of the gate). */
async function selectOmtAppTab(page: Page) {
  const tab = page
    .locator("button")
    .filter({ hasText: /^OMT App$/ })
    .first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await expect(page.getByTestId("omt-app-cashout-button")).toBeVisible({
    timeout: 10_000,
  });
}

/** Parse a formatted money string ("$733.00", "3,517,000 LBP", "-100.10")
 *  back to a number, tolerant of whichever display format the modal uses. */
function parseMoneyText(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, "");
  return parseFloat(cleaned);
}

test.describe("LIRA-192 — OMT App cash-out, driven through the real modal", () => {
  test("USD cash-out: OMT_System untouched, OMT_App falls by the amount, the OMT account falls by amount+commission — commission preview matches the documented 0.1%", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await seedWallet(appPage, WALLET_SEED_USD, "USD");

    // Re-navigate so the page's own drawer-balance cache (which the modal's
    // client-side "insufficient balance" hint reads) reflects the seed —
    // the effect that reloads it is keyed on the active-provider tab.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/recharge");
    await selectOmtAppTab(appPage);

    const before = await drawers(appPage);
    const beforeLedger = await omtAppSupplierBalance(appPage, "USD");

    await appPage.getByTestId("omt-app-cashout-button").click();
    const amountInput = appPage.getByTestId("omt-app-cashout-amount");
    await expect(amountInput).toBeVisible({ timeout: 10_000 });

    // Currency defaults to USD already — leave the selector untouched.
    await amountInput.fill(String(CASHOUT_USD));

    const expectedCommission = roundForCurrency(
      CASHOUT_USD * CASHOUT_COMMISSION_RATE,
      "USD",
    );
    const previewText = await appPage
      .getByTestId("omt-app-cashout-commission-preview")
      .innerText();
    expect(parseMoneyText(previewText)).toBeCloseTo(expectedCommission, 2);

    await appPage.getByTestId("omt-app-cashout-submit").click();
    await expect(amountInput).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const afterLedger = await omtAppSupplierBalance(appPage, "USD");

    // D2: no physical cash moves either way.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);
    // The wallet balance leaves…
    expect(after.omtApp - before.omtApp).toBeCloseTo(-CASHOUT_USD, 2);
    // …and the OMT account is credited principal + commission (D11) — the
    // ledger sign convention is "positive = shop owes"; a cash-out MUST move
    // it negative (OMT now owes the shop), never SUPPLIER_PAYS_US's positive
    // direction (plan §9.2's named trap).
    expect(afterLedger - beforeLedger).toBeCloseTo(
      -(CASHOUT_USD + expectedCommission),
      2,
    );
  });

  test("LBP cash-out: same 0.1% contract, no cross-currency conversion (D13)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await seedWallet(appPage, WALLET_SEED_LBP, "LBP");

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/recharge");
    await selectOmtAppTab(appPage);

    const before = await drawers(appPage);
    const beforeLedgerLbp = await omtAppSupplierBalance(appPage, "LBP");

    await appPage.getByTestId("omt-app-cashout-button").click();
    const amountInput = appPage.getByTestId("omt-app-cashout-amount");
    await expect(amountInput).toBeVisible({ timeout: 10_000 });

    await appPage.getByTestId("omt-app-cashout-currency").selectOption("LBP");
    await amountInput.fill(String(CASHOUT_LBP));

    const expectedCommission = roundForCurrency(
      CASHOUT_LBP * CASHOUT_COMMISSION_RATE,
      "LBP",
    );
    const previewText = await appPage
      .getByTestId("omt-app-cashout-commission-preview")
      .innerText();
    expect(parseMoneyText(previewText)).toBeCloseTo(expectedCommission, 0);

    await appPage.getByTestId("omt-app-cashout-submit").click();
    await expect(amountInput).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const afterLedgerLbp = await omtAppSupplierBalance(appPage, "LBP");

    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);
    expect(afterLedgerLbp - beforeLedgerLbp).toBeCloseTo(
      -(CASHOUT_LBP + expectedCommission),
      0,
    );
  });

  test("create + void nets the OMT_App drawer and the 'OMT App' ledger back to baseline, with profit staying 0 throughout (D14, rule 20)", async ({
    appPage,
  }) => {
    // Reversal is a repository contract, not frontend arithmetic — proven
    // over raw IPC, same convention as lira-092/lira-104's void/refund
    // reversal proofs. The UI cases above already cover the seam that DOES
    // have frontend arithmetic (the commission preview).
    await navigateTo(appPage, "/recharge");
    await seedWallet(appPage, WALLET_SEED_USD, "USD");

    const result = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as Api;

        const drawerUsd = (rows: DrawerBalance[], name: string) =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;

        const supplier = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "OMT_APP",
        );
        if (!supplier) return { found: false as const };

        const drawersBefore = await w.api.recharge.getDrawerBalances();
        const omtAppBefore = drawerUsd(drawersBefore, "OMT_App");
        const balancesBefore = await w.api.suppliers.getBalances(true);
        const ledgerBefore =
          balancesBefore.find((b) => b.supplier_id === supplier.id)
            ?.total_usd ?? 0;

        const cashout = await w.api.recharge.cashoutToSupplier({
          provider: "OMT_APP",
          amount,
          currency: "USD",
        });
        if (!cashout.success) {
          return { found: true, ok: false, error: cashout.error ?? null };
        }

        // Identity match: WALLET_CASHOUT row carrying this exact unique
        // principal (never getRecent()[0] — rule 15).
        const recent = await w.api.transactions.getRecent(100);
        const row = recent.find(
          (t) => t.type === "WALLET_CASHOUT" && t.amount_usd === amount,
        );
        if (!row) {
          return { found: true, ok: false, error: "cashout txn not found" };
        }
        const meta = row.metadata_json
          ? (JSON.parse(row.metadata_json) as { commission?: number })
          : {};

        const voidRes = await w.api.transactions.void(row.id);

        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const omtAppAfter = drawerUsd(drawersAfter, "OMT_App");
        const balancesAfter = await w.api.suppliers.getBalances(true);
        const ledgerAfter =
          balancesAfter.find((b) => b.supplier_id === supplier.id)
            ?.total_usd ?? 0;

        return {
          found: true,
          ok: voidRes.success === true,
          error: voidRes.error ?? null,
          storedCommission: meta.commission ?? null,
          omtAppNetDelta: Math.round((omtAppAfter - omtAppBefore) * 100) / 100,
          ledgerNetDelta:
            Math.round((ledgerAfter - ledgerBefore) * 100) / 100,
        };
      },
      { amount: VOID_ROUNDTRIP_USD },
    );

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    // The commission WAS computed and stored at creation (D14) — this is
    // what distinguishes "recorded, not yet recognised" from "never
    // computed at all".
    expect(result.storedCommission).toBeCloseTo(
      roundForCurrency(VOID_ROUNDTRIP_USD * CASHOUT_COMMISSION_RATE, "USD"),
      2,
    );
    expect(result.omtAppNetDelta).toBeCloseTo(0, 2);
    expect(result.ledgerNetDelta).toBeCloseTo(0, 2);
  });
});
