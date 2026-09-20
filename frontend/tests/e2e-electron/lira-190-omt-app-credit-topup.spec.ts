/**
 * E2E: LIRA-190 — OMT App wallet loads on OMT credit by default
 * (docs/plans/ongoing_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D2/D4, §5).
 *
 * Before this ticket, `topUpApp` was the ONLY way to fund the OMT App
 * wallet, and its default source drawer was `OMT_System` — every wallet
 * load silently drained the physical OMT Cash Drawer (§3 of the plan). D2
 * says loading the wallet on the OMT open-credit account should move NO
 * physical cash: the wallet drawer goes up and the shop's OMT account debt
 * goes up by the same amount, with `OMT_System` and `General` untouched.
 *
 * `RechargeRepository.topUpFromSupplier` already did the right thing for
 * iPick/Katsh; LIRA-190 widens it to `OMT_APP` and makes it the DEFAULT in
 * the real Top-Up modal (`packages/ui/src/components/ui/TopUpModal.tsx`),
 * behind a "Funding Source" choice — `topup-funding-credit` ("On OMT
 * credit", default) vs `topup-funding-transfer` ("Transfer from drawer",
 * the pre-existing `topUpApp` path, now defaulting its source to `General`
 * instead of `OMT_System` per the same ticket).
 *
 * This spec drives the REAL modal (layer-seam rule, CLAUDE.md rule 15/
 * README "Assertion discipline") rather than calling
 * `recharge.topUpFromSupplier` over raw IPC, specifically to prove the
 * funding-choice UI actually defaults to credit and actually wires through
 * to the credit path — a hand-built IPC payload cannot catch a regression
 * where the UI's default silently flips back to `transfer` while the IPC
 * contract stays correct in isolation.
 *
 * Every assertion is a DELTA snapshotted immediately before the action,
 * matched by drawer/supplier NAME — never an absolute total or row
 * position (rule 15; this suite shares one accumulating DB across specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// Distinctive, non-round amounts so a getRecent() match by (type, amount) is
// safe against coincidental collision with any other spec's activity.
const CREDIT_TOPUP_USD = 342.17;
const CREDIT_TOPUP_LBP = 2_734_000;
const TRANSFER_TOPUP_USD = 19.43;
const VOID_ROUNDTRIP_USD = 271.09;

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
  summary: string | null;
};

// OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5 (LIRA-188): 'OMT App' is now an
// OMT-account CHILD (`account_supplier_id` -> OMT), so `getBalances`
// deliberately excludes it from its top-level list (it surfaces only in the
// account rollup's `children[]`). Its real balance is only reachable via
// `getAccountBalances()`.
type AccountChildBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type AccountBalance = {
  account_supplier_id: number;
  account_name: string;
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
      topUpFromSupplier: (data: {
        provider: "iPick" | "Katsh" | "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string }>;
    };
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalance[]>;
      // RAW array — the OMT open-credit account rollup (LIRA-188). The only
      // method that exposes an account CHILD's (iPick/OMT App) own balance.
      getAccountBalances: () => Promise<AccountBalance[]>;
    };
    transactions: {
      getRecent: (limit: number) => Promise<RecentTxn[]>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

/** Named drawer balances (USD) — matched by name, never position. */
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

/** The 'OMT App' supplier's ledger balance for one currency (D2's proof that
 *  the credit path books the OMT account, not just the wallet drawer).
 *  'OMT App' is an OMT-account CHILD (LIRA-188) — `getBalances` no longer
 *  lists it at all (by design), so its real balance is only reachable via
 *  the account rollup's `children[]`. */
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
    const bal = (await w.api.suppliers.getAccountBalances())
      .flatMap((a) => a.children)
      .find((c) => c.supplier_id === supplier.id);
    return cur === "USD" ? (bal?.total_usd ?? 0) : (bal?.total_lbp ?? 0);
  }, currency);
}

/** Click the OMT App provider tab and confirm its Top-Up button rendered. */
async function selectOmtAppTab(page: Page) {
  const tab = page
    .locator("button")
    .filter({ hasText: /^OMT App$/ })
    .first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await expect(
    page.getByRole("button", { name: "Top-Up" }),
  ).toBeVisible({ timeout: 10_000 });
}

/** Open the real Top-Up modal and return a locator scoped to its panel (not
 *  the page behind it — the OMT/Whish transfer form rendered underneath also
 *  has its own decimal amount input, so every field lookup below must stay
 *  scoped to this panel). */
async function openTopUpModal(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Top-Up" }).click();
  const heading = page.getByRole("heading", {
    name: /Top Up OMT App Drawer/i,
  });
  await expect(heading).toBeVisible({ timeout: 10_000 });
  return heading.locator("xpath=ancestor::div[contains(@class,'rounded-2xl')]");
}

test.describe("LIRA-190 — OMT App wallet credit top-up, driven through the real modal", () => {
  test("Top-Up defaults to 'On OMT credit': OMT Cash Drawer and General untouched, OMT_App and the OMT account both rise", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await selectOmtAppTab(appPage);

    const before = await drawers(appPage);
    const beforeLedger = await omtAppSupplierBalance(appPage, "USD");

    const modal = await openTopUpModal(appPage);

    // D4: "On OMT credit" is the DEFAULT — proved via the segmented button's
    // own active styling, never by clicking it ourselves first. If a future
    // change flips the default to "transfer", this assertion fails before
    // the money assertions below even run.
    await expect(modal.getByTestId("topup-funding-credit")).toHaveClass(
      /bg-violet-600/,
    );
    await expect(modal.getByTestId("topup-funding-transfer")).not.toHaveClass(
      /bg-violet-600/,
    );

    await modal
      .locator('input[inputmode="decimal"]')
      .fill(String(CREDIT_TOPUP_USD));
    await modal.getByRole("button", { name: "Confirm Supplier Credit" }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const afterLedger = await omtAppSupplierBalance(appPage, "USD");

    // D2's core invariant: no physical cash moves either drawer.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);
    // The wallet balance itself rises by the full amount…
    expect(after.omtApp - before.omtApp).toBeCloseTo(CREDIT_TOPUP_USD, 2);
    // …and the shop now owes the OMT account exactly that much more.
    expect(afterLedger - beforeLedger).toBeCloseTo(CREDIT_TOPUP_USD, 2);
  });

  test("Top-Up on OMT credit works in LBP too, at the same no-conversion contract", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await selectOmtAppTab(appPage);

    const before = await drawers(appPage);
    const beforeLedgerLbp = await omtAppSupplierBalance(appPage, "LBP");

    const modal = await openTopUpModal(appPage);
    await modal.getByRole("button", { name: "LBP" }).click();
    await modal
      .locator('input[inputmode="decimal"]')
      .fill(String(CREDIT_TOPUP_LBP));
    await modal.getByRole("button", { name: "Confirm Supplier Credit" }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const afterLedgerLbp = await omtAppSupplierBalance(appPage, "LBP");

    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);
    expect(after.omtApp - before.omtApp).toBeCloseTo(0, 2); // USD leg untouched
    expect(afterLedgerLbp - beforeLedgerLbp).toBeCloseTo(CREDIT_TOPUP_LBP, 2);
  });

  test("'Transfer from drawer' stays available as the explicit alternative, and now defaults its source to General — never OMT_System", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await selectOmtAppTab(appPage);

    const before = await drawers(appPage);
    const beforeLedger = await omtAppSupplierBalance(appPage, "USD");

    const modal = await openTopUpModal(appPage);
    await modal.getByTestId("topup-funding-transfer").click();
    await expect(modal.getByTestId("topup-funding-transfer")).toHaveClass(
      /bg-violet-600/,
    );

    await modal
      .locator('input[inputmode="decimal"]')
      .fill(String(TRANSFER_TOPUP_USD));
    await modal.getByRole("button", { name: "Confirm Top-Up" }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const afterLedger = await omtAppSupplierBalance(appPage, "USD");

    expect(after.omtApp - before.omtApp).toBeCloseTo(TRANSFER_TOPUP_USD, 2);
    // The regression this whole ticket exists to prevent: pre-LIRA-190 the
    // default source for this exact path was OMT_System, so this same
    // submit used to drain the OMT Cash Drawer by TRANSFER_TOPUP_USD.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    expect(after.general - before.general).toBeCloseTo(-TRANSFER_TOPUP_USD, 2);
    // A drawer-to-drawer transfer books no OMT-account debt at all.
    expect(afterLedger - beforeLedger).toBeCloseTo(0, 2);
  });

  test("void of an OMT App credit top-up is refused, and the drawer/ledger are therefore unchanged (rule 20)", async ({
    appPage,
  }) => {
    // Verified by reading, not assumed: `TRANSACTION_TYPES.RECHARGE_TOPUP` —
    // the type every topUpFromSupplier call produces, OMT_APP included — is
    // a member of `NON_REVERSIBLE_TRANSACTION_TYPES`
    // (packages/core/src/constants/transactionTypes.ts), with the documented
    // rationale "the provider-drawer credit has no payments row either".
    // `TransactionRepository._assertReversible` refuses ANY void of that
    // type before any write, for iPick and Katsh exactly as much as for OMT
    // App — this batch (LIRA-187/188/190/192) deliberately did NOT change
    // that; making it reversible would be a cross-cutting rewrite of every
    // top-up flow, not an OMT-App-only fix (see
    // RechargeRepository.omtAppCredit.test.ts's own regression guard for the
    // same finding at the repository layer).
    //
    // This is rule 20 option (b) — gated non-reversible with a documented
    // correction path — not an oversight: the correction path an operator
    // must use instead is an OPPOSITE MANUAL ENTRY on the Suppliers page
    // (a manual debit against the OMT App supplier ledger plus the matching
    // manual drawer adjustment), mirroring how CREDIT_CASH_IN/DEBT_CASH_OUT
    // document their own correction path in the same constant's doc comment.
    //
    // Reversal proof deliberately IPC-driven (rule 20 is a repository
    // contract, not frontend arithmetic — the UI cases above already prove
    // the seam that DOES have frontend arithmetic: the funding-mode default).
    const result = await appPage.evaluate(
      async ({ amount }) => {
        const w = window as unknown as Api;

        const drawerUsd = (rows: DrawerBalance[], name: string) =>
          rows.find((d) => d.name === name)?.usdBalance ?? 0;

        const childBalUsd = (accounts: AccountBalance[], supplierId: number) =>
          accounts
            .flatMap((a) => a.children)
            .find((c) => c.supplier_id === supplierId)?.total_usd ?? 0;

        const supplier = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "OMT_APP",
        );
        if (!supplier) return { found: false as const };

        // Shape shared by every "found: true" branch below, so the caller
        // can narrow on `found` alone without a second union split.
        const topUpFailed = (error: string | null) => ({
          found: true as const,
          topUpOk: false,
          voidSucceeded: false,
          voidError: null as string | null,
          error,
          omtAppNetDelta: NaN,
          ledgerNetDelta: NaN,
        });

        const topUp = await w.api.recharge.topUpFromSupplier({
          provider: "OMT_APP",
          amount,
          currency: "USD",
        });
        if (!topUp.success) {
          return topUpFailed(topUp.error ?? null);
        }

        // Identity match: RECHARGE_TOPUP row carrying this exact unique
        // amount (never getRecent()[0] — rule 15).
        const recent = await w.api.transactions.getRecent(100);
        const row = recent.find(
          (t) => t.type === "RECHARGE_TOPUP" && t.amount_usd === amount,
        );
        if (!row) {
          return topUpFailed("topup txn not found");
        }

        // Snapshot the baseline IMMEDIATELY BEFORE the void attempt (NOT
        // before the top-up) — this test proves the REFUSED VOID moves
        // nothing further, not that the whole round trip nets to zero. The
        // top-up's own +amount rise is already proved by the "defaults to
        // credit" test above; measuring from before the top-up would fold
        // that legitimate, expected movement into "net delta" and wrongly
        // expect it to cancel out against a void that never runs.
        const drawersBefore = await w.api.recharge.getDrawerBalances();
        const omtAppBefore = drawerUsd(drawersBefore, "OMT_App");
        const accountsBefore = await w.api.suppliers.getAccountBalances();
        const ledgerBefore = childBalUsd(accountsBefore, supplier.id);

        // The void attempt itself — expected to be REFUSED, not to succeed.
        const voidRes = await w.api.transactions.void(row.id);

        const drawersAfter = await w.api.recharge.getDrawerBalances();
        const omtAppAfter = drawerUsd(drawersAfter, "OMT_App");
        const accountsAfter = await w.api.suppliers.getAccountBalances();
        const ledgerAfter = childBalUsd(accountsAfter, supplier.id);

        return {
          found: true as const,
          topUpOk: true,
          voidSucceeded: voidRes.success === true,
          voidError: voidRes.error ?? null,
          error: null as string | null,
          // Deltas measured across the void ATTEMPT ONLY (baseline snapshotted
          // right before `void()`, after the top-up already landed) — since
          // the attempt is refused before any write, both must be unchanged
          // across that narrower window. The top-up's own full-amount rise is
          // proved by the "defaults to credit" test above; this test only
          // proves the refused void moves nothing further on top of it.
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
    expect(result.topUpOk).toBe(true);
    // The void is REFUSED by `_assertReversible` (RECHARGE_TOPUP is a member
    // of NON_REVERSIBLE_TRANSACTION_TYPES) — this is the actual, deliberate
    // behaviour this test exists to pin, not a bug.
    expect(result.voidSucceeded).toBe(false);
    expect(result.voidError).not.toBeNull();
    // Nothing moved: the refused void attempt is a no-op on both the drawer
    // and the OMT account ledger — it did not create a fresh imbalance on
    // top of the original top-up.
    expect(result.omtAppNetDelta).toBeCloseTo(0, 2);
    expect(result.ledgerNetDelta).toBeCloseTo(0, 2);
  });
});
