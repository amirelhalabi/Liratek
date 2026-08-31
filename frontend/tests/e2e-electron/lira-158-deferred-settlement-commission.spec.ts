/**
 * E2E: LIRA-158 follow-up — owner decision D17 (2026-08-31), "deferred
 * settlement commission on a cashless settlement."
 *
 * BACKGROUND. LIRA-158 (commit `8c453764`) moved supplier-commission
 * recognition from transaction time to SETTLEMENT time: the operator enters
 * the real commission when settling a batch, and that figure — not the
 * auto-calculated estimate stamped on the financial_services row at
 * creation — is what Profits/Closing report, dated to the settlement day.
 *
 * D17 refines WHEN that settlement-day recognition actually fires. The
 * owner routinely settles OMT/WHISH batches out of his OWN drawer BEFORE the
 * clients who owe him for those specific transfers have repaid — he is
 * fronting the money. A settlement is CASHLESS when no money actually
 * arrives at settlement (OMT/WHISH, and a mixed bills+OMT batch); a
 * bills-only Katsh/iPick settlement is the opposite (Katsh's commission
 * literally funds a real drawer top-up, so it keeps recognising
 * immediately — LIRA-137, unaffected by this ticket). So: commission on a
 * CASHLESS settlement now DEFERS until the underlying client's debt is
 * covered, landing in the same "stranded behind an uncovered client debt"
 * bucket `getDeferredProfit` already tracks for ordinary account-charged
 * transactions, instead of recognising on the settlement day.
 *
 * This spec is the ticket's own worked example, driven end-to-end through
 * the REAL UI at every money-moving step (never a hand-built IPC payload
 * where the UI itself would otherwise do the arithmetic):
 *
 *   1. Record a real OMT (system) SEND through the Services form, charged
 *      ENTIRELY to a brand-new client's account (CUSTOMER_ACCOUNT) — so the
 *      client owes the shop for the transfer, unpaid at settlement time.
 *   2. Settle it through the REAL Suppliers "Commission Settlement" tab,
 *      entering a commission DELIBERATELY DIFFERENT from the auto-calculated
 *      estimate still sitting on the financial_services row (LIRA-158 §1.1:
 *      OMT's `commission` column holds that estimate, untouched by the
 *      settlement-recognition cutover — D6/D3 in the parent plan).
 *   3. Assert the Supplier Commission figure does NOT move (the settlement
 *      is cashless and the client hasn't repaid — D17 defers it) while the
 *      Deferred Profit figure moves by EXACTLY the entered commission (not
 *      the estimate, and not the auto-calc-estimate-based figure either).
 *   4. Repay the client's whole debt through the real Debts page.
 *   5. Assert the deferred amount moves INTO the recognised Supplier
 *      Commission figure (and its settlement count) by the same amount, and
 *      the deferred figure gives it back up.
 *
 * Every assertion is a DELTA around its own action (CLAUDE.md rule 15): the
 * suite shares ONE accumulating SQLite DB across every spec, alphabetically,
 * and by the time this file runs the all-time Profits window already
 * contains OTHER suppliers' settled commission (Katsh/iPick bills from
 * lira-056/089/137/141 etc., which recognise immediately and are NOT
 * cashless) — so an absolute "$0.00" or "count === 0" assertion on the
 * all-time totals would be flatly wrong from the first row this file reads,
 * and a `getRecent()[0]`-style "newest row" check would be wrong too (one
 * settlement here writes both a `SUPPLIER_SETTLEMENT` transaction and,
 * later, the debt repayment's own ledger rows). The OMT SEND's own dollar
 * amount is a `Date.now()`-derived, effectively-unique two-decimal figure
 * used only to FIND this run's own unsettled row — never to assert
 * position.
 *
 * Both the raw `profits:summary` IPC figures (exact, unrounded) AND the REAL
 * rendered Profits page (via the `supplier-commission-usd` /
 * `deferred-client-debt-usd` test-ids this same ticket added to
 * `Profits.tsx`) are read, both as deltas — proving the fix at the
 * repository/service layer AND at the actual frontend rendering layer the
 * operator looks at, not just one or the other (the "layer-seam testing"
 * lesson: driving only IPC never catches a frontend-side wiring mistake).
 *
 * WHAT THIS SPEC DOES NOT PROVE (said plainly, not papered over): the
 * "fully deferred" pointer card (`supplier-commission-fully-deferred`,
 * shown when a window's recognised commission is 0/0) cannot be observed
 * live against this shared, accumulating all-time window — other specs
 * earlier in the same run already settled bills-only Katsh/iPick batches
 * that DO recognise immediately, so the all-time aggregate's `count` is
 * never 0 by the time this file runs, even though THIS scenario's own
 * contribution to it is provably 0 (that is exactly what the delta
 * assertions below establish). That branch is deterministic-data territory
 * — it is covered instead by
 * `frontend/src/features/profits/pages/__tests__/Profits.deferredSettlementCommission.test.tsx`,
 * which mocks the summary response directly.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";
import { settleModalRoot, beforeContentBlock } from "./helpers/katshSettlement";

test.describe.configure({ retries: 0 });

// This spec asserts on the repayment toast — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing (mirrors
// lira-148-omt-system-account-settlement-routing.spec.ts, which reads the
// same "Repayment processed" toast).
test.use({ notificationDurationMs: null });

const ts = Date.now();
// A run-unique USD amount (2 decimals) so this SEND's own unsettled row can
// be found by IDENTITY on the Suppliers Settle tab, which also lists every
// other spec's stale unsettled OMT rows (rule 15) — never by position.
const AMOUNT = 500 + (ts % 400) + 0.41;
const FEE = 6;

type SupplierRow = { id: number; provider: string | null };
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  commission: number;
};
type DebtorRow = {
  client_id: number;
  full_name?: string;
  client_name?: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};
type ProfitSummaryShape = {
  supplier_commission?: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  deferred?: {
    partner_profit_usd: number;
    partner_profit_lbp: number;
    client_debt_profit_usd: number;
    client_debt_profit_lbp: number;
  };
};
type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getUnsettledTransactions: (provider: string) => Promise<SupplierTxnRow[]>;
    };
    debt: { getDebtors: () => Promise<DebtorRow[]> };
    profits: {
      summary: (from: string, to: string) => Promise<ProfitSummaryShape>;
    };
  };
};

// A wide, fixed all-time window — the point of every assertion below is the
// DELTA between two reads of it, never an absolute value (rule 15).
const WIDE_FROM = "2000-01-01";
const WIDE_TO = "2100-01-01";

async function getProfitFigures(
  page: Page,
): Promise<{
  commissionUsd: number;
  commissionCount: number;
  deferredClientDebtUsd: number;
}> {
  return page.evaluate(
    async (args: { from: string; to: string }) => {
      const w = window as unknown as Api;
      const summary = await w.api.profits.summary(args.from, args.to);
      return {
        commissionUsd: summary.supplier_commission?.profit_usd ?? 0,
        commissionCount: summary.supplier_commission?.count ?? 0,
        deferredClientDebtUsd: summary.deferred?.client_debt_profit_usd ?? 0,
      };
    },
    { from: WIDE_FROM, to: WIDE_TO },
  );
}

/** Reads the SAME two figures off the REAL Profits page (Overview tab,
 *  default) via the test-ids this ticket added to Profits.tsx, so the
 *  frontend rendering layer is proven too, not just the IPC/service layer.
 *  Returns 0 when a card isn't rendered at all (e.g. a genuinely-zero
 *  figure never mounts its row) — a real value only ever needs comparing as
 *  a DELTA against another call to this same helper. */
async function readProfitsPageFigures(
  page: Page,
): Promise<{ commissionUsd: number; deferredClientDebtUsd: number }> {
  await navigateTo(page, "/");
  await navigateTo(page, "/profits");
  await expect(page.getByText("Net Profit (USD)")).toBeVisible({
    timeout: 15_000,
  });

  const parse = async (locator: Locator): Promise<number> => {
    if ((await locator.count()) === 0) return 0;
    const text = await locator.first().innerText();
    const n = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  return {
    commissionUsd: await parse(page.getByTestId("supplier-commission-usd")),
    deferredClientDebtUsd: await parse(
      page.getByTestId("deferred-client-debt-usd"),
    ),
  };
}

/** Select the OMT system tile for a direction: ↑ = SEND, ↓ = RECEIVE.
 *  Verbatim of lira-148-omt-system-account-settlement-routing.spec.ts's own
 *  helper (spec files can't import each other — Playwright rejects it — so
 *  this small, stable locator is duplicated rather than factored out). */
async function pickOmt(page: Page, direction: "SEND" | "RECEIVE") {
  const arrow = direction === "SEND" ? /↑/ : /↓/;
  const tile = page
    .locator("button")
    .filter({ hasText: /OMT/ })
    .filter({ hasText: arrow })
    .first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.click();
}

/** Drive the REAL OMT/Whish form: a fee-on-top system SEND charged entirely
 *  to the customer's account. Returns the total the customer now owes
 *  (x + f). Verbatim of lira-148's own helper. */
async function recordOmtSystemSendOnAccount(
  page: Page,
  opts: { client: string; phone: string; amount: number; fee: number },
): Promise<number> {
  await navigateTo(page, "/services");
  await pickOmt(page, "SEND");

  const amountInput = page.locator("#service-amount");
  await expect(amountInput).toBeVisible({ timeout: 15_000 });
  await amountInput.fill(String(opts.amount));

  const feeInput = page.getByTestId("service-omt-fee-input");
  await expect(feeInput).toBeVisible({ timeout: 10_000 });
  await feeInput.fill(String(opts.fee));

  await page.locator("#service-sender-name").fill(opts.client);
  await page.keyboard.press("Escape");
  await page.locator("#service-sender-phone").fill(opts.phone);
  await page.keyboard.press("Escape");

  await page
    .locator('[data-testid^="payment-method-"]')
    .first()
    .selectOption("CUSTOMER_ACCOUNT");

  await page.getByRole("button", { name: /Record Send/i }).click();
  await expect(amountInput).toHaveValue("", { timeout: 15_000 });

  return opts.amount + opts.fee;
}

/** Drive the REAL Debts page: settle this client's whole debt in cash.
 *  Verbatim of lira-148's own helper. */
async function settleFullDebtInCash(page: Page, clientName: string) {
  await navigateTo(page, "/debts");
  await page.getByPlaceholder(/Search client/i).fill(clientName);
  await page.locator("button").filter({ hasText: clientName }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Settle Debt|Cash Out/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
  await expect(
    page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/** Select a supplier tile on the Suppliers page and wait for its
 *  "Commission Settlement" header — provider-generic version of
 *  `selectKatshSupplierTile` (helpers/katshSettlement.ts), which is named
 *  and scoped for Katsh specifically. The underlying mechanism (tile click,
 *  escalating retry, same heading) is identical for every supplier. */
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

/** The unsettled-queue row for THIS run's own SEND, matched by its unique
 *  USD amount text — never by position (rule 15: the tab also lists every
 *  other spec's own stale unsettled OMT rows). */
function omtRowLabel(page: Page, amountUsd: number): Locator {
  const amountText = `$${amountUsd.toFixed(2)}`;
  return page.locator("label").filter({ hasText: amountText });
}

/** Select this run's OMT row, open the Commission Settlement modal, force
 *  LUMP entry mode, enter a commission through the REAL "Commission (USD)"
 *  input (never a hand-built IPC payload), pick CASH for the net payment,
 *  and confirm. */
async function settleOmtRow(
  page: Page,
  amountUsd: number,
  enteredCommissionUsd: number,
) {
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

  // The net payment to OMT (owed − entered commission) needs an active
  // payment leg — MultiPaymentInput auto-fills the single CASH line to that
  // total once a method is picked (same convention as every other
  // settlement spec's payCashWithClient/methodSelect usage).
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

test.describe("LIRA-158 D17 — deferred settlement commission (cashless OMT settlement)", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("commission on an account-charged OMT settlement defers until the client repays, then recognises", async ({
    appPage,
  }) => {
    const CLIENT = `L158D17 ${ts}`;
    const PHONE = `79${String(ts).slice(-6)}`;

    await closeAllActiveSessions(appPage);

    // ── 1. Record the OMT SEND, charged ENTIRELY to the client's account ──
    const owed = await recordOmtSystemSendOnAccount(appPage, {
      client: CLIENT,
      phone: PHONE,
      amount: AMOUNT,
      fee: FEE,
    });
    expect(owed).toBeCloseTo(AMOUNT + FEE, 2);

    const debtBeforeRepay = await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      const rows = await w.api.debt.getDebtors();
      const row = rows.find(
        (d) => (d.full_name ?? d.client_name ?? "").trim() === name,
      );
      return row?.total_debt_usd ?? 0;
    }, CLIENT);
    expect(debtBeforeRepay).toBeCloseTo(owed, 2);

    // ── 2. Find this run's OWN unsettled row and read its auto-calc
    // estimate — LIRA-158 §1.1: an OMT row's `commission` column holds the
    // estimate untouched (D6/D3), which is the whole premise of "enter a
    // commission deliberately different from it" below. ──────────────────
    const unsettledRow = await appPage.evaluate(
      async (amount: number) => {
        const w = window as unknown as Api;
        const rows = await w.api.suppliers.getUnsettledTransactions("OMT");
        return (
          rows.find(
            (r) =>
              r.service_type === "SEND" &&
              r.currency !== "LBP" &&
              Math.abs(r.amount - amount) < 0.005,
          ) ?? null
        );
      },
      AMOUNT,
    );
    expect(unsettledRow, "unsettled OMT SEND row not found").toBeTruthy();
    const estimate = unsettledRow!.commission;
    expect(estimate).toBeGreaterThan(0);
    // Clearly different from the estimate in every case, never a
    // coincidental match regardless of the exact auto-calc formula/rate.
    const ENTERED_COMMISSION = Math.round((estimate + 3.75) * 100) / 100;
    expect(ENTERED_COMMISSION).not.toBeCloseTo(estimate, 2);

    // ── 3. Snapshot Profits (IPC + real page) immediately before settling
    // (rule 15). ─────────────────────────────────────────────────────────
    const ipcBeforeSettle = await getProfitFigures(appPage);
    const pageBeforeSettle = await readProfitsPageFigures(appPage);

    // ── 4. Settle via the REAL Suppliers "Commission Settlement" tab,
    // entering ENTERED_COMMISSION — never a hand-built IPC payload. ──────
    await navigateTo(appPage, "/suppliers");
    await selectSupplierTile(appPage, "OMT");
    await settleOmtRow(appPage, AMOUNT, ENTERED_COMMISSION);

    // ── 5. D17: the client hasn't repaid yet, so this cashless settlement's
    // commission must NOT be recognised — it must show up as deferred
    // instead, by exactly the entered figure (not the estimate). ─────────
    const ipcAfterSettle = await getProfitFigures(appPage);
    const pageAfterSettle = await readProfitsPageFigures(appPage);

    expect(
      ipcAfterSettle.commissionUsd - ipcBeforeSettle.commissionUsd,
      "recognised supplier commission must not move before the client repays",
    ).toBeCloseTo(0, 2);
    expect(
      ipcAfterSettle.commissionCount - ipcBeforeSettle.commissionCount,
      "a fully-deferred settlement must not increment the recognised count",
    ).toBe(0);
    expect(
      ipcAfterSettle.deferredClientDebtUsd - ipcBeforeSettle.deferredClientDebtUsd,
      "the ENTERED commission (not the estimate) must appear as deferred",
    ).toBeCloseTo(ENTERED_COMMISSION, 2);

    // Same deltas, read off the REAL rendered Profits page.
    expect(
      pageAfterSettle.commissionUsd - pageBeforeSettle.commissionUsd,
    ).toBeCloseTo(0, 1);
    expect(
      pageAfterSettle.deferredClientDebtUsd - pageBeforeSettle.deferredClientDebtUsd,
    ).toBeCloseTo(ENTERED_COMMISSION, 1);

    // ── 6. Repay the client's WHOLE debt through the real Debts page ─────
    await settleFullDebtInCash(appPage, CLIENT);

    const debtAfterRepay = await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      const rows = await w.api.debt.getDebtors();
      const row = rows.find(
        (d) => (d.full_name ?? d.client_name ?? "").trim() === name,
      );
      return row?.total_debt_usd ?? 0;
    }, CLIENT);
    expect(Math.abs(debtAfterRepay)).toBeLessThan(0.05);

    // ── 7. The deferred commission moves INTO recognised. ────────────────
    const ipcAfterRepay = await getProfitFigures(appPage);
    const pageAfterRepay = await readProfitsPageFigures(appPage);

    expect(
      ipcAfterRepay.commissionUsd - ipcAfterSettle.commissionUsd,
      "the deferred commission must recognise once the client's debt is covered",
    ).toBeCloseTo(ENTERED_COMMISSION, 2);
    expect(
      ipcAfterRepay.commissionCount - ipcAfterSettle.commissionCount,
      "this settlement now contributes recognised commission — count +1",
    ).toBe(1);
    expect(
      ipcAfterRepay.deferredClientDebtUsd - ipcAfterSettle.deferredClientDebtUsd,
      "the deferred bucket gives back exactly what it just recognised",
    ).toBeCloseTo(-ENTERED_COMMISSION, 2);

    expect(
      pageAfterRepay.commissionUsd - pageAfterSettle.commissionUsd,
    ).toBeCloseTo(ENTERED_COMMISSION, 1);
    expect(
      pageAfterRepay.deferredClientDebtUsd - pageAfterSettle.deferredClientDebtUsd,
    ).toBeCloseTo(-ENTERED_COMMISSION, 1);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _Lira158D17SpecPage = Page;
