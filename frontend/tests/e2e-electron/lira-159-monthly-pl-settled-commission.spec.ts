/**
 * E2E: LIRA-159 — `FinancialRepository.getMonthlyPL`'s commission arms
 * (`serviceCommissionsUSD`/`serviceCommissionsLBP`, the Dashboard "Monthly
 * Net Profit" tile) now compose `ProfitRepository.getRealizedCommissionTotals`
 * (LEGACY, `commission_model = 0`) + `getSupplierCommissionTotals`
 * (AT_SETTLEMENT, `commission_model = 1`) instead of a raw
 * `SUM(financial_services.commission)`. For a model-1 row (every OMT/WHISH
 * SEND/RECEIVE, `FinancialServiceRepository.ts` ~:1496 `isOmtWhishTransfer`)
 * the row's own `commission` column is a creation-time ESTIMATE settlement
 * never writes back (owner decision D6) — the REAL commission is whatever
 * the operator types into the Suppliers "Commission Settlement" modal, and it
 * is recognised in the SETTLEMENT month, never the transaction's own month
 * (owner decisions D7/D10, cash basis; see `FinancialRepository.ts`'s own
 * doc comment on `getMonthlyPL`).
 *
 * Every pre-existing fixture in this suite settles at (or near) its own
 * auto-calculated estimate, which is exactly why this class of bug was
 * invisible before LIRA-159: summing the raw `commission` column silently
 * "worked" as long as nobody typed a genuinely different number. So every
 * test below deliberately enters a commission that does NOT match the row's
 * own creation-time estimate.
 *
 * Layer coverage / UI-vs-IPC choices (stated plainly, so a reviewer can see
 * the reasoning rather than guess at it):
 *   - CREATION always goes through raw IPC (`w.api.omt.addTransaction`),
 *     mirroring lira-102-business-day-monthly's own precedent for this exact
 *     "does creation alone move the P&L tile" question. The row's own
 *     creation-time `commission` is passed EXPLICITLY (rather than derived
 *     from the real Services form's `OMT_COMMISSION_RATES` lookup) so the
 *     "entered != estimate" premise is deterministic and does not depend on
 *     a rate table this file has no reason to duplicate — the repository
 *     logic under test does not care whether the estimate came from the
 *     real form's arithmetic or a hand-supplied number, only that it is
 *     IGNORED at settlement-recognition time, which is the actual thing
 *     being proven.
 *   - SETTLEMENT (test 2, USD) drives the REAL Suppliers "Commission
 *     Settlement" modal end-to-end (LUMP entry, the real "Commission (USD)"
 *     input, the real MultiPaymentInput CASH auto-fill, the real "Confirm
 *     Settlement" click) — this is the one place the frontend does real
 *     arithmetic before sending (net-pay = owed − commission; see the
 *     "layer-seam testing" lesson: 42/84 desktop specs hand-build IPC
 *     payloads and never touch the UI, so they can't catch a
 *     frontend↔repository mismatch). The helpers below are duplicated from
 *     `lira-158-deferred-settlement-commission.spec.ts`'s own
 *     `selectSupplierTile`/`omtRowLabel`/`settleOmtRow` (Playwright rejects
 *     a spec importing another spec file, so duplication — not a shared
 *     import — is this suite's own established convention for exactly this
 *     situation; see that file's own comment on `pickOmt`), with ONE
 *     deliberate divergence in `settleOmtRow`: a "Refresh" click before
 *     looking for the row. Root-caused via the trace (`toBeVisible` on
 *     `omtRowLabel` timing out, element genuinely never in the DOM) plus
 *     reproduction: this file's test 2 passes in 1.6s run alone, but
 *     reproducibly fails with the exact same error when run immediately
 *     after lira-158 (`npx playwright test lira-158-... lira-159-...`).
 *     Cause: this test's row is minted via raw IPC (`w.api.omt.addTransaction`),
 *     which — unlike every mutation in `useSuppliers.ts` — invalidates no
 *     React Query cache. `useUnsettledTransactionsQuery` inherits the
 *     app-wide 30s `staleTime` (`App.tsx:66`) and this suite runs the WHOLE
 *     desktop run in ONE persistent Electron window per worker (no reload
 *     between spec files — `fixtures.ts`'s own "Single Electron instance per
 *     worker" design), so the query-cache entry for `["supplier-unsettled",
 *     "OMT"]` survives across files. lira-158 (which sorts immediately
 *     before this file and also drives the OMT Settle tab, via
 *     `useSettleTransactionsMutation`'s own `onSuccess` invalidation of that
 *     same key) leaves that cache freshly populated moments before this
 *     file starts — well inside the 30s window — so re-selecting the OMT
 *     tile here silently reuses a list that predates this test's own row,
 *     with no refetch ever triggered. The app already ships the fix for an
 *     operator hitting exactly this: the Settle tab's own "Refresh" button
 *     (`Suppliers/index.tsx` ~:1343, wired to `unsettledQuery.refetch()`
 *     since the LIRA-141 follow-up) — `settleOmtRow` now clicks it before
 *     searching for the row, same as a real operator would.
 *   - SETTLEMENT (test 3, LBP) and the void/refund cycle (test 4) go through
 *     raw IPC `w.api.suppliers.settleTransactions` / `w.api.transactions.void`
 *     instead of the real Settle-tab UI. This is NOT a shortcut of
 *     convenience — it is the only way to exercise these paths at all today.
 *     `Suppliers/index.tsx`'s own `selectableUnsettled` (~:1000-1005) filters
 *     `t.currency !== "LBP" || t.service_type === "BILL"`, so an
 *     LBP-denominated OMT SEND is structurally NOT SELECTABLE in the real
 *     Settle-tab checklist. This is a DELIBERATE, DOCUMENTED constraint, not
 *     a gap this file is flagging: `Suppliers/index.tsx`'s own comment on
 *     `settleTotalOwedLbp` (~:840-848, LIRA-119) states outright "TODAY: the
 *     only LBP-denominated rows `selectableUnsettled` lets into this batch
 *     are BILLs" and explains the LBP net-owed math is computed
 *     symmetrically with the USD side anyway, specifically so a future
 *     LBP-eligible non-BILL type (an LBP OMT/WHISH row, exactly this test's
 *     shape) nets correctly for free once `selectableUnsettled` is widened.
 *     Raw IPC is simply the only route available against TODAY's UI for
 *     this shape. Voiding a settlement (test 4) has no committed real-UI
 *     precedent anywhere in this suite either (every void-a-settlement spec
 *     — lira-089/lira-137 — voids via raw `w.api.transactions.void`,
 *     matching lira-056/059's own settle-coverage convention), so raw IPC is
 *     this suite's established, lower-risk choice for that step too.
 *
 * `_bookCommissionAtSettlement` (SupplierRepository.ts ~:1874-1899) splits an
 * entered `commission_lbp` ONLY across rows whose OWN `currency` is `'LBP'`
 * (`allocateProportional`'s `rows.length === 0` returns `[]` for an
 * all-foreign-currency batch) — so test 3 below settles a row that is ITSELF
 * LBP-denominated at creation. Entering an LBP commission against a
 * USD-denominated batch would silently allocate NOTHING to any row's
 * `settlement_commission_allocations` entry, which is a real, separately
 * worth-flagging trap this file does not need to also exercise here.
 *
 * `amount_usd`/`amount_lbp` in every raw `settleTransactions` call below are
 * 0 — deliberately. Those two fields are the settlement's own net-pay
 * bookkeeping figure (`SupplierRepository.ts` ~:1287-1288: `netUsd =
 * -Math.abs(data.amount_usd)`), taken verbatim from the caller with no
 * server-side cross-check against the row's real gross-owed, and are
 * ORTHOGONAL to `commission_usd`/`commission_lbp` (the money-bearing figures
 * this file actually tests — see `_bookCommissionAtSettlement`'s own INSERT).
 * Passing 0/0 also keeps `owesCash` false, so no `payments[]` leg is
 * required (`SupplierRepository.ts` ~:1198-1204) — correctly scoping these
 * IPC-driven tests to the ONE axis they exist to prove (commission
 * recognition), not the separately-guarded net-pay/drawer money movement
 * (lira-076, lira-131).
 *
 * Rule 15 (shared accumulating DB): every test is fully self-contained (its
 * own freshly created row, never reused across tests) and every assertion is
 * a DELTA snapshotted immediately before/after its own action — never an
 * absolute `getMonthlyPL` total (other specs' commission activity is already
 * baked into whatever this file finds "before"). Rows are matched by
 * IDENTITY: a `Date.now()`-derived amount unique to this run, or (for the
 * raw-IPC tests) the `id` `addTransaction`/`settleTransactions` hands back
 * directly — never `getRecent()[0]` or list position.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";
import { settleModalRoot, beforeContentBlock } from "./helpers/katshSettlement";

test.describe.configure({ retries: 0 });

// This spec asserts on toast/UI settle state — opt out of the harness's 2ms
// notification-duration override (mirrors lira-089/lira-158's own opt-out).
test.use({ notificationDurationMs: null });

const ts = Date.now();

type SupplierRow = { id: number; provider: string | null };
type MonthlyPL = {
  serviceCommissionsUSD: number;
  serviceCommissionsLBP: number;
};
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
};
type AddTransactionResult = {
  success?: boolean;
  id?: number;
  error?: string;
};
type SettleResult = { success?: boolean; id?: number; error?: string };

type Api = {
  api: {
    omt: {
      addTransaction: (d: Record<string, unknown>) => Promise<AddTransactionResult>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        note?: string;
      }) => Promise<SettleResult>;
    };
    financial: { getMonthlyPL: (month: string) => Promise<MonthlyPL> };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxnRow[] | { transactions?: RecentTxnRow[] }>;
      void: (
        id: number,
      ) => Promise<{ success?: boolean; error?: string }>;
    };
  };
};

/** `getMonthlyPL` buckets by the LOCAL business month (LIRA-102) — computed
 *  ONCE and reused for both the before/after snapshot in each test so a
 *  midnight rollover mid-test can never split one test's own pair across two
 *  different month buckets. */
function localMonthNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function commissionSnapshot(
  page: Page,
  month: string,
): Promise<MonthlyPL> {
  return page.evaluate(async (m) => {
    const w = window as unknown as Api;
    const pl = await w.api.financial.getMonthlyPL(m);
    return {
      serviceCommissionsUSD: pl.serviceCommissionsUSD,
      serviceCommissionsLBP: pl.serviceCommissionsLBP,
    };
  }, month);
}

/** OMT supplier id — looked up fresh each time (never assumed left over from
 *  a previous test), matching lira-089/lira-158's own `.find(provider ===)`
 *  identity lookup. */
async function omtSupplierId(page: Page): Promise<number> {
  const supplier = await page.evaluate(async () => {
    const w = window as unknown as Api;
    return (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "OMT",
    );
  });
  expect(supplier, "OMT supplier not found").toBeTruthy();
  return supplier!.id;
}

async function createOmtSend(
  page: Page,
  args: { amount: number; currency: "USD" | "LBP"; commission: number },
): Promise<number> {
  const res = await page.evaluate(async (a) => {
    const w = window as unknown as Api;
    return w.api.omt.addTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: a.amount,
      currency: a.currency,
      commission: a.commission,
      omtServiceType: "INTRA",
      paidByMethod: "CASH",
    });
  }, args);
  expect(res.error ?? null).toBeNull();
  expect(res.success).not.toBe(false);
  expect(res.id, "addTransaction did not return an id").toBeTruthy();
  return res.id!;
}

// ── Suppliers Settle-tab UI helpers (test 2 only) ───────────────────────────
// Verbatim of lira-158-deferred-settlement-commission.spec.ts's own
// selectSupplierTile/omtRowLabel/settleOmtRow — see that file's comments for
// the retry/escalation rationale. Duplicated, not imported (Playwright
// rejects spec-to-spec imports).

async function selectSupplierTile(page: Page, provider: string) {
  const tile = page.getByTestId(`supplier-tile-${provider}`);
  const settleHeader = page.getByText("Commission Settlement");
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(tile).toBeVisible({ timeout: 15_000 });
    if (attempt === 0) {
      await tile.click();
    } else {
      await page.mouse.move(5, 400);
      await tile.evaluate((el) => (el as HTMLButtonElement).click());
    }
    const waitMs = [8_000, 12_000, 12_000][attempt] ?? 12_000;
    const ok = await settleHeader
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error(
    `"${provider}" supplier tile selected but "Commission Settlement" heading never appeared.`,
  );
}

function omtRowLabel(page: Page, amountUsd: number) {
  const amountText = `$${amountUsd.toFixed(2)}`;
  return page.locator("label").filter({ hasText: amountText });
}

async function settleOmtRow(
  page: Page,
  amountUsd: number,
  enteredCommissionUsd: number,
) {
  // LIRA-159 (see this file's own top-of-file comment for the full
  // derivation): the row was minted via raw IPC, which invalidates no React
  // Query cache, and `unsettledQuery` inherits the app-wide 30s staleTime —
  // across this suite's single persistent Electron window, an earlier spec
  // selecting the OMT tile within the last 30s (e.g. lira-158, which sorts
  // immediately before this file and also drives this exact tab) leaves a
  // still-"fresh" cached list that predates this test's own row. Click the
  // real "Refresh" button (Suppliers/index.tsx, wired to
  // `unsettledQuery.refetch()`) to force it, exactly as an operator would.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();

  const row = omtRowLabel(page, amountUsd);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('input[type="checkbox"]').check();

  const settleBtn = page.getByRole("button", { name: /^Settle \(1\)$/ });
  await expect(settleBtn).toBeVisible();
  await expect(settleBtn).toBeEnabled();
  await settleBtn.click();
  await expect(settleModalRoot(page)).toBeVisible({ timeout: 10_000 });

  const body = beforeContentBlock(page);
  await body.getByRole("button", { name: "Lump sum", exact: true }).click();

  const commissionUsdInput = body
    .locator('label:text-is("Commission (USD)")')
    .locator("xpath=following-sibling::input[1]");
  await commissionUsdInput.fill(enteredCommissionUsd.toFixed(2));

  const methodSelect = page.locator('[data-testid^="payment-method-"]').first();
  await expect(methodSelect).toBeVisible({ timeout: 10_000 });
  await methodSelect.selectOption("CASH");

  const confirmBtn = settleModalRoot(page).getByRole("button", {
    name: "Confirm Settlement",
  });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();
  await expect(settleModalRoot(page)).toBeHidden({ timeout: 15_000 });
}

test.describe("LIRA-159 — Monthly P&L tracks the SETTLED commission, not the creation-time estimate", () => {
  test("creation alone (an unsettled AT_SETTLEMENT row) does not move the tile", async ({
    appPage,
  }) => {
    const AMOUNT = 500 + (ts % 300) + 0.11;
    const CREATION_ESTIMATE = 0.5;
    const MONTH = localMonthNow();

    const before = await commissionSnapshot(appPage, MONTH);
    await createOmtSend(appPage, {
      amount: AMOUNT,
      currency: "USD",
      commission: CREATION_ESTIMATE,
    });
    const after = await commissionSnapshot(appPage, MONTH);

    expect(
      after.serviceCommissionsUSD - before.serviceCommissionsUSD,
      "an unsettled model-1 row's creation-time estimate must not reach the tile",
    ).toBeCloseTo(0, 2);
  });

  test("settling recognises the ENTERED commission (USD), not the auto-calculated estimate, in the settlement month", async ({
    appPage,
  }) => {
    const AMOUNT = 500 + (ts % 300) + 0.27;
    const CREATION_ESTIMATE = 0.5;
    const ENTERED_COMMISSION = 2.0; // deliberately != CREATION_ESTIMATE
    expect(ENTERED_COMMISSION).not.toBeCloseTo(CREATION_ESTIMATE, 2);
    const MONTH = localMonthNow();

    await createOmtSend(appPage, {
      amount: AMOUNT,
      currency: "USD",
      commission: CREATION_ESTIMATE,
    });

    const before = await commissionSnapshot(appPage, MONTH);

    await closeAllActiveSessions(appPage).catch(() => {});
    await navigateTo(appPage, "/suppliers");
    await selectSupplierTile(appPage, "OMT");
    await settleOmtRow(appPage, AMOUNT, ENTERED_COMMISSION);

    const after = await commissionSnapshot(appPage, MONTH);

    expect(
      after.serviceCommissionsUSD - before.serviceCommissionsUSD,
      "the tile must move by the operator's ENTERED figure",
    ).toBeCloseTo(ENTERED_COMMISSION, 2);
  });

  test("an LBP-entered settlement commission moves serviceCommissionsLBP by the exact entered figure", async ({
    appPage,
  }) => {
    const AMOUNT_LBP = 300_000 + (ts % 9000) * 10 + 7;
    const CREATION_ESTIMATE_LBP = 15_000;
    const ENTERED_COMMISSION_LBP = 63_000; // deliberately != CREATION_ESTIMATE_LBP
    const MONTH = localMonthNow();

    const rowId = await createOmtSend(appPage, {
      amount: AMOUNT_LBP,
      currency: "LBP",
      commission: CREATION_ESTIMATE_LBP,
    });
    const supplierId = await omtSupplierId(appPage);

    const before = await commissionSnapshot(appPage, MONTH);

    const settleRes = await appPage.evaluate(
      async (args: {
        supplierId: number;
        rowId: number;
        commissionLbp: number;
      }) => {
        const w = window as unknown as Api;
        return w.api.suppliers.settleTransactions({
          supplier_id: args.supplierId,
          financial_service_ids: [args.rowId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: args.commissionLbp,
          entry_mode: "LUMP",
          note: "LIRA-159 e2e LBP commission settlement",
        });
      },
      { supplierId, rowId, commissionLbp: ENTERED_COMMISSION_LBP },
    );
    expect(settleRes.error ?? null).toBeNull();
    expect(settleRes.success).toBe(true);

    const after = await commissionSnapshot(appPage, MONTH);

    expect(
      after.serviceCommissionsLBP - before.serviceCommissionsLBP,
      "the LBP tile must move by the operator's ENTERED LBP figure",
    ).toBeCloseTo(ENTERED_COMMISSION_LBP, 2);
    // The USD side of the SAME settlement must stay untouched — proves the
    // two currencies are genuinely independent, not one leaking into the
    // other via a shared/undifferentiated commission field.
    expect(
      after.serviceCommissionsUSD - before.serviceCommissionsUSD,
    ).toBeCloseTo(0, 2);
  });

  test("voiding a settlement removes its commission from the tile — nets back to the pre-settle figure", async ({
    appPage,
  }) => {
    const AMOUNT = 500 + (ts % 300) + 0.43;
    const CREATION_ESTIMATE = 0.6;
    const ENTERED_COMMISSION = 3.25;
    const MONTH = localMonthNow();

    const rowId = await createOmtSend(appPage, {
      amount: AMOUNT,
      currency: "USD",
      commission: CREATION_ESTIMATE,
    });
    const supplierId = await omtSupplierId(appPage);

    const baseline = await commissionSnapshot(appPage, MONTH);

    const settleRes = await appPage.evaluate(
      async (args: {
        supplierId: number;
        rowId: number;
        commissionUsd: number;
      }) => {
        const w = window as unknown as Api;
        return w.api.suppliers.settleTransactions({
          supplier_id: args.supplierId,
          financial_service_ids: [args.rowId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: args.commissionUsd,
          commission_lbp: 0,
          entry_mode: "LUMP",
          note: "LIRA-159 e2e void-cycle settlement",
        });
      },
      { supplierId, rowId, commissionUsd: ENTERED_COMMISSION },
    );
    expect(settleRes.error ?? null).toBeNull();
    expect(settleRes.success).toBe(true);
    const settlementLedgerId = settleRes.id!;
    expect(settlementLedgerId).toBeTruthy();

    const afterSettle = await commissionSnapshot(appPage, MONTH);
    expect(
      afterSettle.serviceCommissionsUSD - baseline.serviceCommissionsUSD,
    ).toBeCloseTo(ENTERED_COMMISSION, 2);

    // Identity, not position (rule 15): the SUPPLIER_SETTLEMENT transaction
    // this exact settlement wrote, matched by its own source_id — same
    // pattern lira-089 uses for its own void step.
    const settlementTxn = await appPage.evaluate(
      async (ledgerId: number) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(50, {
          source_table: "supplier_ledger",
        });
        const list = Array.isArray(recent)
          ? recent
          : (recent.transactions ?? []);
        return (
          list.find(
            (t) => t.type === "SUPPLIER_SETTLEMENT" && t.source_id === ledgerId,
          ) ?? null
        );
      },
      settlementLedgerId,
    );
    expect(
      settlementTxn,
      "SUPPLIER_SETTLEMENT transaction not found",
    ).toBeTruthy();

    const voidRes = await appPage.evaluate(async (id: number) => {
      const w = window as unknown as Api;
      return w.api.transactions.void(id);
    }, settlementTxn!.id);
    expect(voidRes.error ?? null).toBeNull();
    expect(voidRes.success).toBe(true);

    const afterVoid = await commissionSnapshot(appPage, MONTH);
    expect(
      afterVoid.serviceCommissionsUSD - afterSettle.serviceCommissionsUSD,
      "voiding the settlement must reverse exactly the entered commission",
    ).toBeCloseTo(-ENTERED_COMMISSION, 2);
    expect(
      afterVoid.serviceCommissionsUSD - baseline.serviceCommissionsUSD,
      "the tile must net back to its pre-settle baseline",
    ).toBeCloseTo(0, 2);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _Lira159MonthlyPlSpecPage = Page;
