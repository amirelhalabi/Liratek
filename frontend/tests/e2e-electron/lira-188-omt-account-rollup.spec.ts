/**
 * E2E: LIRA-188 — OMT account rollup on the Suppliers page
 * (docs/plans/ongoing_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D6, §5, §9.3).
 *
 * OMT is ONE open-credit account (plan §1 D1). The OMT counter, the OMT App
 * wallet, and iPick credit all draw on it, but ledger rows NEVER move —
 * each child keeps its own `supplier_ledger` rows, its own drawer; the
 * account is a READ-TIME rollup via the new `suppliers.account_supplier_id`
 * self-FK (LIRA-187). This spec proves that rollup end-to-end through the
 * real Suppliers page:
 *
 *   - OMT renders as a single account CARD (not three separate top-level
 *     tiles) whose headline balance equals the sum of its sub-rows.
 *   - OMT App and iPick disappear from the top-level Companies list (they
 *     now render only inside the account card's sub-rows) while Katsh
 *     (D7 — stays standalone, no account) is unaffected.
 *   - A fresh OMT SEND and a fresh iPick supplier-credit top-up each move
 *     the account headline AND their own sub-row by exactly their own
 *     contribution — proving the rollup is a live sum, not a cached or
 *     parent-only figure (plan §4's worked example: allocated rows, never
 *     a single row on the parent).
 *   - The merged ledger carries a Type column identifying which member
 *     each row actually belongs to, and the type filter narrows to one
 *     member (D6).
 *
 * Rule 15 discipline: every money assertion is a DELTA snapshotted
 * immediately before the action and matched by IDENTITY (a unique fee/
 * amount marker), never an absolute total or row position — this suite
 * shares one accumulating DB across specs. The one exception, by
 * construction rather than by relaxation: comparing the UI-rendered
 * headline against the SAME-moment IPC-computed rollup is an internal
 * consistency check on a single live snapshot, not an absolute-total
 * assertion about the DB's history.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// Distinctive, non-round figures so identity matching by (source_name,
// amount) inside the merged ledger cannot collide with any other spec.
const SEND_AMOUNT_USD = 481;
const SEND_FEE_USD = 23;
const IPICK_TOPUP_USD = 296;

const LEDGER_SEND_AMOUNT_USD = 553;
const LEDGER_SEND_FEE_USD = 17;
const LEDGER_IPICK_TOPUP_USD = 314;

type AccountChildBalance = {
  supplier_id: number;
  name: string;
  provider: string | null;
  drawer_name: string | null;
  total_usd: number;
  total_lbp: number;
  is_parent: boolean;
};
type AccountBalance = {
  account_supplier_id: number;
  account_name: string;
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
};
type AccountLedgerEntry = {
  id: number;
  supplier_id: number;
  source_provider: string | null;
  source_name: string;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  is_refunded: number;
  settlement_id: number | null;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getAccountBalances: () => Promise<AccountBalance[]>;
      getAccountLedger: (
        accountSupplierId: number,
        limit?: number,
      ) => Promise<AccountLedgerEntry[]>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        omtServiceType?: string;
        omtFee?: number;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; error?: string }>;
    };
    recharge: {
      topUpFromSupplier: (data: {
        provider: "iPick" | "Katsh" | "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function omtAccount(page: Page): Promise<AccountBalance | undefined> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    return (await w.api.suppliers.getAccountBalances()).find(
      (a) => a.account_name === "OMT",
    );
  });
}

function childOf(
  account: AccountBalance | undefined,
  provider: string,
): AccountChildBalance | undefined {
  return account?.children.find((c) => c.provider === provider);
}

async function omtSupplierId(page: Page): Promise<number> {
  const id = await page.evaluate(async () => {
    const w = window as unknown as Api;
    const omt = (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "OMT",
    );
    return omt?.id ?? null;
  });
  if (id === null) throw new Error("OMT supplier not found");
  return id;
}

async function seedOmtSend(page: Page, amount: number, fee: number) {
  const res = await page.evaluate(
    async ({ amount, fee }) => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: fee,
        payments: [{ method: "CASH", currencyCode: "USD", amount: amount + fee }],
      });
    },
    { amount, fee },
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
}

async function seedIpickTopup(page: Page, amount: number) {
  const res = await page.evaluate(
    async ({ amount }) => {
      const w = window as unknown as Api;
      return w.api.recharge.topUpFromSupplier({
        provider: "iPick",
        amount,
        currency: "USD",
      });
    },
    { amount },
  );
  expect(res.success).toBe(true);
}

/** Parse a formatted money string ("$150.00", "1,234,000 LBP", "-$5.00")
 *  back to a number, tolerant of whichever display format the page uses. */
function parseMoneyText(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, "");
  return parseFloat(cleaned);
}

async function openCompaniesTab(page: Page) {
  await navigateTo(page, "/suppliers");
  const tab = page.getByRole("button", { name: "Companies" });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  }
  await expect(page.getByTestId("supplier-account-card-OMT")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Selects the OMT account (revealing the detail panel's Refresh button,
 * which only renders once a supplier is selected — `Suppliers/index.tsx`'s
 * `{!selectedSupplier ? ... : ...}` gate) and clicks it.
 *
 * This spec seeds through raw IPC (`omt.addTransaction` /
 * `recharge.topUpFromSupplier`), which bypasses the mutation hooks
 * (`useAddLedgerEntryMutation` etc.) that normally call
 * `invalidateAccountQueries` on success — and the app-wide QueryClient
 * default `staleTime` is 30s (`App.tsx`), so simply re-opening the
 * Companies tab re-renders `accountBalancesQuery`/`accountLedgerQuery` from
 * cache rather than refetching. The Refresh button is wired to
 * `useRefreshSupplierAccountQueries` (`useSuppliers.ts`) for exactly this
 * case, so clicking it — rather than reloading the page — both fixes the
 * flake AND exercises that real wiring end to end.
 */
async function refreshAccountData(page: Page) {
  const card = page.getByTestId("supplier-account-card-OMT");
  await card.getByTestId("supplier-tile-OMT").click();
  const refreshBtn = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refreshBtn).toBeVisible({ timeout: 10_000 });
  await refreshBtn.click();
}

test.describe("LIRA-188 — OMT account rollup on the Suppliers page", () => {
  test("OMT App and iPick no longer render as standalone top-level tiles; Katsh (D7, no account) is unaffected", async ({
    appPage,
  }) => {
    await openCompaniesTab(appPage);

    await expect(appPage.getByTestId("supplier-tile-OMT_APP")).toHaveCount(0);
    await expect(appPage.getByTestId("supplier-tile-iPick")).toHaveCount(0);
    // OMT no longer renders as a STANDALONE bare tile — but
    // `SupplierAccountCard` (Suppliers/index.tsx, ~:366-370) deliberately
    // keeps the `supplier-tile-OMT` testid, nested on the account card's own
    // header button, so pre-existing specs (lira-158/lira-159) that select
    // OMT via `supplier-tile-${provider}` keep working unchanged. So the
    // testid still resolves to exactly one element — the assertion that
    // actually distinguishes "old bare tile" from "the account card" is that
    // it is a DESCENDANT of `supplier-account-card-OMT`, not a sibling tile
    // sitting outside it.
    const omtCard = appPage.getByTestId("supplier-account-card-OMT");
    await expect(appPage.getByTestId("supplier-tile-OMT")).toHaveCount(1);
    await expect(omtCard.getByTestId("supplier-tile-OMT")).toHaveCount(1);

    // Katsh has no account_supplier_id (D7) — untouched, still top-level.
    await expect(appPage.getByTestId("supplier-tile-Katsh")).toBeVisible();
  });

  test("The account card's headline balance equals the sum of its own sub-rows, and matches the backend rollup exactly", async ({
    appPage,
  }) => {
    await openCompaniesTab(appPage);
    const card = appPage.getByTestId("supplier-account-card-OMT");

    const omtSub = card.getByTestId("supplier-account-subrow-balance-OMT");
    const appSub = card.getByTestId("supplier-account-subrow-balance-OMT_APP");
    const ipickSub = card.getByTestId("supplier-account-subrow-balance-iPick");
    await expect(omtSub).toBeVisible();
    await expect(appSub).toBeVisible();
    await expect(ipickSub).toBeVisible();

    const headlineUsdText = await card
      .getByTestId("supplier-account-balance-usd")
      .innerText();
    const headlineLbpText = await card
      .getByTestId("supplier-account-balance-lbp")
      .innerText();

    // Same-moment oracle: the backend's own rollup for this exact read.
    const account = await omtAccount(appPage);
    expect(account).toBeDefined();
    if (!account) return;

    expect(parseMoneyText(headlineUsdText)).toBeCloseTo(account.total_usd, 2);
    expect(parseMoneyText(headlineLbpText)).toBeCloseTo(account.total_lbp, 0);

    // Sum-of-parts-equals-whole is an internal identity, safe at any point
    // in the shared DB's history (never assumed to be any particular
    // absolute figure).
    const sumUsd = account.children.reduce((s, c) => s + c.total_usd, 0);
    const sumLbp = account.children.reduce((s, c) => s + c.total_lbp, 0);
    expect(sumUsd).toBeCloseTo(account.total_usd, 2);
    expect(sumLbp).toBeCloseTo(account.total_lbp, 0);
  });

  test("A fresh OMT SEND and a fresh iPick credit top-up each move the account headline and only their own sub-row, by exactly their own contribution", async ({
    appPage,
  }) => {
    const beforeAccount = await omtAccount(appPage);
    expect(beforeAccount).toBeDefined();
    if (!beforeAccount) return;
    const beforeOmt = childOf(beforeAccount, "OMT")?.total_usd ?? 0;
    const beforeApp = childOf(beforeAccount, "OMT_APP")?.total_usd ?? 0;
    const beforeIpick = childOf(beforeAccount, "iPick")?.total_usd ?? 0;

    await seedOmtSend(appPage, SEND_AMOUNT_USD, SEND_FEE_USD);
    await seedIpickTopup(appPage, IPICK_TOPUP_USD);

    const afterAccount = await omtAccount(appPage);
    expect(afterAccount).toBeDefined();
    if (!afterAccount) return;
    const afterOmt = childOf(afterAccount, "OMT")?.total_usd ?? 0;
    const afterApp = childOf(afterAccount, "OMT_APP")?.total_usd ?? 0;
    const afterIpick = childOf(afterAccount, "iPick")?.total_usd ?? 0;

    // grossOwedDelta(SEND) = x + f (Phase 2, D1 — the whole fee is owed,
    // never netted against commission here).
    expect(afterOmt - beforeOmt).toBeCloseTo(SEND_AMOUNT_USD + SEND_FEE_USD, 2);
    expect(afterIpick - beforeIpick).toBeCloseTo(IPICK_TOPUP_USD, 2);
    // The OMT App child is untouched by either action.
    expect(afterApp - beforeApp).toBeCloseTo(0, 2);
    // The account headline moved by exactly the sum of its children's
    // deltas — never a single row parked on the parent (plan §4).
    expect(afterAccount.total_usd - beforeAccount.total_usd).toBeCloseTo(
      SEND_AMOUNT_USD + SEND_FEE_USD + IPICK_TOPUP_USD,
      2,
    );

    // Re-render the real page and confirm the SAME totals reach the DOM —
    // this is the seam a backend-only rollup test can never cover. Click
    // the real Refresh button first (see `refreshAccountData`'s doc
    // comment) — the seeds above went through raw IPC, which never
    // invalidates the account queries a mutation would, and the app-wide
    // 30s staleTime means the cache is still holding the pre-seed reading.
    await openCompaniesTab(appPage);
    const card = appPage.getByTestId("supplier-account-card-OMT");
    await refreshAccountData(appPage);

    await expect
      .poll(
        async () =>
          parseMoneyText(
            await card
              .getByTestId("supplier-account-subrow-balance-OMT")
              .innerText(),
          ),
        { timeout: 10_000 },
      )
      .toBeCloseTo(afterOmt, 2);
    await expect
      .poll(
        async () =>
          parseMoneyText(
            await card
              .getByTestId("supplier-account-subrow-balance-iPick")
              .innerText(),
          ),
        { timeout: 10_000 },
      )
      .toBeCloseTo(afterIpick, 2);
  });

  test("Ledger Type column identifies each member, and the type filter narrows to one member", async ({
    appPage,
  }) => {
    await seedOmtSend(appPage, LEDGER_SEND_AMOUNT_USD, LEDGER_SEND_FEE_USD);
    await seedIpickTopup(appPage, LEDGER_IPICK_TOPUP_USD);

    // Cross-check via the account ledger IPC (identity, not position) that
    // both rows landed with the right source_name before touching the UI.
    const omtId = await omtSupplierId(appPage);
    const ledger = await appPage.evaluate(
      async (id) => (window as unknown as Api).api.suppliers.getAccountLedger(id, 200),
      omtId,
    );
    const omtRow = ledger.find(
      (r) =>
        r.source_name === "OMT" &&
        Math.abs(r.amount_usd - (LEDGER_SEND_AMOUNT_USD + LEDGER_SEND_FEE_USD)) <
          0.01,
    );
    const ipickRow = ledger.find(
      (r) =>
        r.source_name === "iPick" &&
        Math.abs(r.amount_usd - LEDGER_IPICK_TOPUP_USD) < 0.01,
    );
    expect(omtRow).toBeDefined();
    expect(ipickRow).toBeDefined();

    await openCompaniesTab(appPage);
    await refreshAccountData(appPage);

    // `AccountLedgerTable` (Suppliers/index.tsx ~:535-645) renders each row
    // as a `<div class="grid grid-cols-12 ... border-t ...">`, never a real
    // `<table>`/`<tr>` — matching on `"tr"` can never find anything here (it
    // silently matches zero elements). Anchor on the row's OWN
    // `supplier-ledger-type-cell` testid (unique to this table) and walk up
    // to its row wrapper, then narrow by the row's own formatted USD amount
    // text (e.g. "570.00") — precise identity matching per rule 15.
    const findRowByAmount = (amount: number): Locator =>
      appPage
        .locator('[data-testid="supplier-ledger-type-cell"]')
        .locator("xpath=ancestor::div[contains(@class,'border-t')][1]")
        .filter({ hasText: amount.toFixed(2) })
        .first();

    const omtRowEl = findRowByAmount(
      LEDGER_SEND_AMOUNT_USD + LEDGER_SEND_FEE_USD,
    );
    const ipickRowEl = findRowByAmount(LEDGER_IPICK_TOPUP_USD);
    await expect(omtRowEl).toBeVisible({ timeout: 10_000 });
    await expect(ipickRowEl).toBeVisible({ timeout: 10_000 });

    await expect(
      omtRowEl.getByTestId("supplier-ledger-type-cell"),
    ).toHaveText(/OMT$/);
    await expect(
      ipickRowEl.getByTestId("supplier-ledger-type-cell"),
    ).toHaveText(/iPick/);

    // Filter down to iPick only — the OMT row must disappear, the iPick row
    // must stay. Handles either a native <select> or a chip/segment group.
    const filter = appPage.getByTestId("supplier-ledger-type-filter");
    await expect(filter).toBeVisible({ timeout: 10_000 });
    const tag = await filter.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "select") {
      await filter.selectOption({ label: "iPick" });
    } else {
      await filter.getByText(/^iPick$/).click();
    }

    await expect(ipickRowEl).toBeVisible({ timeout: 10_000 });
    await expect(omtRowEl).toHaveCount(0);
  });
});
