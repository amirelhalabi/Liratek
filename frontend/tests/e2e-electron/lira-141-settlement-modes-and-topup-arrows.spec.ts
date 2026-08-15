/**
 * E2E: LIRA-141 -- verifies two owner checkpoints by driving the REAL app and
 * printing what the UI actually renders, so the orchestrator can report
 * observed values back to the owner instead of asking them to click through
 * it manually.
 *
 * ── Checkpoint 1 (shipped `4424a70`) ────────────────────────────────────────
 * The Commission Settlement modal's Top-up | Other payment toggle, for a
 * Katsh bills-only batch:
 *   - Top-up (default): the commission credits the Katsh provider drawer
 *     directly. No supplier debt. Nothing leaves the till. NO
 *     MultiPaymentInput renders (nothing for the operator to type).
 *   - Other payment: MultiPaymentInput renders, autofilled with the entered
 *     commission. The money arrives via a real payment leg into whichever
 *     drawer the chosen method maps to (CASH -> General, since Katsh is
 *     never the shop's primary system) -- the Katsh drawer does NOT move.
 * Both modes are driven on their OWN Katsh bill (unique amounts, matched by
 * identity per rule 15 -- never "select all", never row position), with
 * drawer/ledger deltas snapshotted immediately around ONLY the Confirm
 * click, then the resulting SUPPLIER_SETTLEMENT transaction is read back
 * (metadata + real payment legs) and its /audit row is inspected for the
 * rendered Amount cell, cash-flow badge, and summary text.
 *
 * ── Checkpoint 2 (shipped `7b07672`) ─────────────────────────────────────
 * `getCashFlowDirection`'s RECHARGE_TOPUP/DRAWER_TOPUP cases now follow what
 * actually moved instead of a fixed per-type default:
 *   - topUpFromSupplier (debt-funded, zero legs)         -> "in"   (owner's
 *     own reported bug: Katsh top-up rendered a red "out" arrow)
 *   - topUpFromClient with cashPaid > 0 (cash really leaves General)
 *                                                          -> "both"
 *   - topUpApp (a real source drawer debited into a cash-equivalent dest)
 *                                                          -> "both"
 *   - DRAWER_TOPUP "External (Cash In)"                   -> "in"
 *   - DRAWER_TOPUP "From Drawer" (a cash-equivalent PCD debited)
 *                                                          -> "both"
 * All FIVE are driven through the real UI below (Recharge page's TopUpModal
 * for the first three, the Dashboard's DrawerTopUpModal for the last two).
 * `topUpFromPartner` is deliberately NOT covered here -- the commit left it
 * unchanged ("in", already correct before and after), so there is nothing
 * new for this spec to prove about it.
 *
 * Rule 15 (shared accumulating DB): every fixture uses a run-unique,
 * `Date.now()`-derived amount/marker (never a fixed literal another spec
 * could also produce), every row is matched by that identity -- never
 * `getRecent()[0]` / `tbody tr.first()` -- and every money assertion is a
 * DELTA snapshotted immediately before/after the action under test, never an
 * absolute balance.
 *
 * The KatchForm/Suppliers-settle-modal helpers are imported from
 * `helpers/katshSettlement.ts` (originally defined inline in
 * lira-137-katsh-bill-settlement-commission-topup.spec.ts, unchanged
 * otherwise) instead of being re-derived here. Playwright rejects a spec
 * file importing another spec file outright, so both specs pull these from
 * the shared non-spec helper module instead.
 *
 * ── Fix-round 2 notes (first real run found three things) ──────────────────
 *
 * 1. Checkpoint 1's SECOND settlement (Other-payment) could not find its
 *    bill row on the Suppliers page (`billRowLabel` timed out). Diagnosis:
 *    the earlier version of this test created+settled one bill, THEN
 *    created the second bill, THEN navigated back to /suppliers -- but
 *    `useUnsettledTransactionsQuery`'s cache (TanStack Query, global
 *    `staleTime: 30_000` set in `frontend/src/app/App.tsx`) is only
 *    invalidated by `useSettleTransactionsMutation`'s own `onSuccess`
 *    (`frontend/src/features/suppliers/hooks/useSuppliers.ts`) -- creating a
 *    bill on the Recharge page has no idea that query key exists and never
 *    invalidates it. Returning to /suppliers well within 30s of the FIRST
 *    settlement's invalidate-triggered refetch serves that now-stale-in-
 *    reality-but-not-yet-expired cached list, which correctly reflects "bill
 *    A settled" but was fetched BEFORE bill B existed, so it's missing.
 *    Fixed by creating BOTH bills upfront (mirrors lira-137's own precedent)
 *    so the ONE initial fetch already contains both, before either
 *    settlement runs -- no code timing hack, just not re-triggering the
 *    trap. Also added an IPC existence check for both bills immediately
 *    after creation, per the coordinator's ask, to isolate "was it created"
 *    from "does the UI show it" for any future regression here.
 *    This is a real, reproducible staleness gap (see the task report for the
 *    precise mechanism), but it is NOT "the settle list doesn't refresh
 *    after a settlement" -- it refreshes correctly for ITS OWN mutation.
 *    It's a narrower gap: a write on a DIFFERENT page never invalidates this
 *    query, so a quick return within the 30s window can show a stale list.
 *
 * 2. Checkpoint 2's `fillPlainAmount` hit a strict-mode violation --
 *    `getByRole('button', {name:'LBP', exact:true})` resolved to 2 elements.
 *    TopUpModal is an absolutely-positioned overlay; the KatchForm/
 *    OmtWhishAppTransferForm page underneath stays mounted (just visually
 *    covered) and has ITS OWN currency-style buttons, so a page-wide
 *    `getByRole` locator hits both. Fixed by scoping every TopUpModal/
 *    DrawerTopUpModal interaction to the modal's own overlay root
 *    (`div.fixed.inset-0` filtered by its unique heading text -- neither
 *    modal component has a `data-testid`) instead of the whole page.
 *
 * 3. `metadata.counterparty.method` reads `"CASH"` on the TOP_UP-mode
 *    settlement even though no cash moved and `payments` is empty --
 *    reported separately (task report), NOT fixed here: it's a core
 *    write-path change (`SupplierRepository.ts`) the orchestrator owns,
 *    since the owner's own stated requirement ("either method picked,
 *    should appear in the payment detail") is at stake. This spec captures
 *    (logs) `.method` for BOTH modes without asserting a specific value on
 *    the TOP_UP side, so it neither hides nor bakes in the wrong value.
 *
 * UNEXECUTED: better-sqlite3 is on the Electron ABI in this environment;
 * running any jest suite or e2e here would flip it. This spec is typechecked
 * against tsconfig.playwright.json and carefully re-read, but has not been
 * run. The orchestrator runs it via `node scripts/run-e2e.mjs electron`.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";
import {
  providerTabKatsh,
  billCard,
  addBill,
  payCashWithClient,
  selectKatshSupplierTile,
  billRowLabel,
  settleModalRoot,
  beforeContentBlock,
  captureModalState,
} from "./helpers/katshSettlement";

test.describe.configure({ retries: 0 });

const ts = Date.now();

// Disjoint from every other Katsh-bill spec's own fixed offsets (see
// lira-137's own header comment for the roster: 50k/130k.../611k/922k etc.)
// -- these bases (641k/758k for bills, 861k/947k for the settlement RATE
// input) sit in gaps none of those specs use, plus a `ts`-derived jitter, so
// even a same-second re-run of two specs during a migration window can't
// collide on the exact LBP figure this spec matches rows by.
const BILL_TOPUP_LBP = 641_000 + (ts % 500);
const BILL_OTHER_LBP = 758_000 + (ts % 500);
const RATE_TOPUP_LBP = 861_000 + (ts % 700) + 1;
const RATE_OTHER_LBP = 947_000 + (ts % 700) + 3;

// ── Shared types (mirrors lira-137's own Api surface, plus the fields this
// spec additionally reads: transaction summary/payments for the audit-trail
// capture, and getUnsettledTransactions for the IPC pre-flight check). ─────
type SupplierRow = { id: number; provider: string | null };
type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
};
type DrawerRow = { name: string; usdBalance: number; lbpBalance: number };
type PaymentLegRow = {
  direction: "in" | "out";
  amount: number;
  currency_code: string;
  method: string;
};
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string | null;
  amount_usd: number;
  amount_lbp: number;
  summary: string | null;
  metadata_json: string | null;
  payments?: PaymentLegRow[];
};
type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getUnsettledTransactions: (provider: string) => Promise<SupplierTxnRow[]>;
    };
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxnRow[] | { transactions?: RecentTxnRow[] }>;
    };
  };
};

async function getDrawers(
  page: Page,
): Promise<Record<string, { usd: number; lbp: number }>> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const out: Record<string, { usd: number; lbp: number }> = {};
    for (const r of rows) out[r.name] = { usd: r.usdBalance, lbp: r.lbpBalance };
    return out;
  });
}

async function fetchRecentByType(
  page: Page,
  type: string,
): Promise<RecentTxnRow[]> {
  return page.evaluate(async (t) => {
    const w = window as unknown as Api;
    const recent = await w.api.transactions.getRecent(150, { type: t });
    return Array.isArray(recent) ? recent : (recent.transactions ?? []);
  }, type);
}

// ── Generic provider-tab selector (mirrors lira-137's own providerTabKatsh
// escalation pattern -- force-click, then a mouse-move + evaluated click on
// retry, since a lingering notification toast from the PREVIOUS case's
// top-up can sit over the tab row and swallow a plain click). ─────────────
async function providerTab(page: Page, label: string, marker: Locator) {
  const pattern = new RegExp(
    `^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    await page
      .locator('[role="alert"]')
      .first()
      .waitFor({ state: "hidden", timeout: 6_000 })
      .catch(() => {});
    const tab = page.locator("button").filter({ hasText: pattern }).first();
    if (attempt === 0) {
      await tab.click({ force: true });
    } else {
      await page.mouse.move(5, 400);
      await tab.evaluate((el) => (el as HTMLButtonElement).click());
    }
    const waitMs = [2_500, 5_000, 10_000, 10_000][attempt] ?? 10_000;
    const ok = await marker
      .first()
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error(`"${label}" provider tab did not activate`);
}

// ── TopUpModal helpers (packages/ui/src/components/ui/TopUpModal.tsx --
// no data-testid on the component, so every locator below is scoped to the
// modal's OWN overlay root instead of the whole page: TopUpModal renders
// absolutely-positioned ON TOP OF the still-mounted KatchForm/
// OmtWhishAppTransferForm page, which has its own currency-style buttons
// ("LBP"/"USD"/"Send" etc.) -- a page-wide `getByRole` locator hits both and
// throws a strict-mode violation (fix-round 2 finding #2 above). ──────────
async function openTopUpModal(
  page: Page,
  providerLabel: string,
): Promise<Locator> {
  const btn = page.getByRole("button", { name: "Top-Up", exact: true });
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: `Top Up ${providerLabel} Drawer` });
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

async function expectModalClosed(modal: Locator) {
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

/** Fills the plain (non-Whish) Currency + Amount block -- used by both the
 *  Katsh/iPick supplier-credit layout and the generic from-drawer layout
 *  (both share this same block; only the Source Drawer selector differs).
 *  `modal` MUST be scoped to the TopUpModal root -- see the file header
 *  note on why a page-wide locator here is wrong. */
async function fillPlainAmount(
  modal: Locator,
  amount: number,
  currency: "USD" | "LBP",
) {
  await modal.getByRole("button", { name: currency, exact: true }).click();
  const input = modal
    .locator('label:text-is("Amount")')
    .locator("xpath=following-sibling::div[1]//input");
  await input.fill(String(amount));
}

/** Whish App "From Client" sub-mode: switches into it, picks the currency
 *  (which also clears the amount -- must run BEFORE filling it), then fills
 *  the "Credits Received from Client" field. Same modal-scoping requirement
 *  as `fillPlainAmount`. */
async function fillWhishClientAmount(
  modal: Locator,
  amount: number,
  currency: "USD" | "LBP",
) {
  await modal.getByRole("button", { name: "From Client", exact: true }).click();
  await modal.getByRole("button", { name: currency, exact: true }).click();
  const input = modal
    .locator('label:text-is("Credits Received from Client")')
    .locator("xpath=following-sibling::div[1]//input");
  await input.fill(String(amount));
}

// ── DrawerTopUpModal helpers (Dashboard "Top Up" button --
// frontend/src/features/dashboard/components/DrawerTopUpModal.tsx). Also no
// data-testid on the modal root itself, same overlay-scoping treatment. ────
async function openDrawerTopUpModal(page: Page): Promise<Locator> {
  await navigateTo(page, "/");
  const btn = page.getByRole("button", { name: "Top Up", exact: true });
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: "Top Up General Drawer" });
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

function drawerAmountInput(modal: Locator, currency: "USD" | "LBP"): Locator {
  const label = currency === "USD" ? "USD Amount" : "LBP Amount";
  return modal
    .locator(`label:text-is("${label}")`)
    .locator("xpath=following-sibling::div[1]//input");
}

async function readSelectedSourceDrawer(modal: Locator): Promise<string> {
  const button = modal
    .locator('label:text-is("Source Drawer")')
    .locator("xpath=following-sibling::div[1]//button");
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).not.toHaveText("No drawers available", {
    timeout: 8_000,
  });
  const text = (await button.innerText()).trim();
  return text.replace(/ /g, "_");
}

async function submitDrawerTopUp(modal: Locator) {
  const btn = modal.getByTestId("drawer-topup-submit");
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

// ── /audit cash-flow-badge reader, shared by both checkpoints. Bounces
// through "/" first (README "Assertion discipline" -- a viewer already
// parked on /audit from an earlier step does NOT remount on a same-route
// hash click, so it would keep showing a stale pre-fetch). Matched by
// IDENTITY (a run-unique amount/marker embedded in the row's own summary
// text), never row position. ────────────────────────────────────────────
async function assertCashFlowBadge(
  page: Page,
  matchText: string,
  expectedDirection: "in" | "out" | "both",
  label: string,
) {
  await navigateTo(page, "/");
  await navigateTo(page, "/audit");
  await expect(page.locator("tbody tr").first()).toBeVisible({
    timeout: 10_000,
  });
  const row = page.locator("tr", { hasText: matchText });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const badge = row.locator('[data-testid="cash-flow-badge"]');
  await expect(badge).toBeVisible({ timeout: 8_000 });
  const direction = await badge.getAttribute("data-direction");
  const badgeText = (await badge.innerText()).replace(/\n/g, " ");
  const cellText = (await row.locator("td").nth(1).innerText()).replace(
    /\n/g,
    " | ",
  );
  console.warn(
    `\n=== /audit row -- ${label} ===\n` +
      `  matched by: "${matchText}"\n` +
      `  cash-flow-badge data-direction="${direction}"  text="${badgeText}"\n` +
      `  Amount-cell (badge + summary) rendered content: "${cellText}"`,
  );
  expect(direction).toBe(expectedDirection);
}

test.describe("LIRA-141 -- settlement modes & top-up cash-flow arrows", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("Checkpoint 1 -- Top-up vs Other payment on a Katsh bill settlement", async ({
    appPage,
  }) => {
    const CLIENT = `L141 Katsh ${ts}`;
    const PHONE = `78${String(ts).slice(-6)}`;

    await closeAllActiveSessions(appPage);

    const katshId = (await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const found = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "Katsh",
      );
      return found ? found.id : null;
    })) as number | null;
    if (katshId === null) throw new Error("Katsh supplier not found");

    async function drawerSnap() {
      const d = await getDrawers(appPage);
      return {
        katsh: d["Katsh"] ?? { usd: 0, lbp: 0 },
        general: d["General"] ?? { usd: 0, lbp: 0 },
      };
    }
    async function supplierLbpBalance(): Promise<number> {
      return appPage.evaluate(async (id) => {
        const w = window as unknown as Api;
        return (
          (await w.api.suppliers.getBalances(true)).find(
            (b) => b.supplier_id === id,
          )?.total_lbp ?? 0
        );
      }, katshId);
    }

    // ── 1. Create BOTH bills upfront, in ONE checkout (mirrors lira-137's
    // own pattern). See the file-header "Fix-round 2" note #1 for exactly
    // why interleaving "settle bill A, THEN create bill B, THEN return to
    // Suppliers" broke on the first real run (a TanStack Query staleTime
    // gap), and why creating both bills before either settlement sidesteps
    // it rather than working around it with a timing hack. ─────────────────
    await navigateTo(appPage, "/recharge");
    await providerTabKatsh(appPage);
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });
    await addBill(appPage, BILL_TOPUP_LBP);
    await addBill(appPage, BILL_OTHER_LBP);
    await payCashWithClient(appPage, CLIENT, PHONE);
    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });

    // Confirm BOTH bills exist via IPC BEFORE ever touching the Suppliers
    // UI -- isolates "was it created" (this check) from "does the UI show
    // it" (the row-visibility wait inside settleOneBillRow below), per the
    // coordinator's explicit diagnostic ask.
    const unsettled = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return w.api.suppliers.getUnsettledTransactions("Katsh");
    });
    const foundTopUpBill = unsettled.find(
      (r) => r.service_type === "BILL" && r.amount === BILL_TOPUP_LBP,
    );
    const foundOtherBill = unsettled.find(
      (r) => r.service_type === "BILL" && r.amount === BILL_OTHER_LBP,
    );
    console.warn(
      `\n=== CHECKPOINT1 pre-flight -- bill existence confirmed via IPC (before touching the Suppliers UI) ===\n` +
        `  bill ${BILL_TOPUP_LBP.toLocaleString()} LBP present in unsettled queue: ${!!foundTopUpBill}\n` +
        `  bill ${BILL_OTHER_LBP.toLocaleString()} LBP present in unsettled queue: ${!!foundOtherBill}`,
    );
    expect(
      foundTopUpBill,
      `bill ${BILL_TOPUP_LBP} LBP missing from the unsettled queue right after creation`,
    ).toBeTruthy();
    expect(
      foundOtherBill,
      `bill ${BILL_OTHER_LBP} LBP missing from the unsettled queue right after creation`,
    ).toBeTruthy();

    // ── 2. Visit Suppliers ONCE -- both bills are already known from this
    // single fetch, so neither settlement below depends on the unsettled-
    // list query refetching to see its own target row. ─────────────────────
    await navigateTo(appPage, "/suppliers");
    await selectKatshSupplierTile(appPage);

    async function settleOneBillRow(
      mode: "TOP_UP" | "OTHER_PAYMENT",
      billLbp: number,
      rateLbp: number,
    ) {
      // Select just this ONE bill for settlement (identity, never "select
      // all" -- the settle tab carries stale unsettled bills from every
      // other Katsh-bill spec in the suite, plus this run's OWN other bill).
      const row = billRowLabel(appPage, billLbp);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.locator('input[type="checkbox"]').check();

      const settleBtn = appPage.getByRole("button", { name: /^Settle \(1\)$/ });
      await expect(settleBtn).toBeVisible();
      await expect(settleBtn).toBeEnabled();
      await settleBtn.click();
      await expect(settleModalRoot(appPage)).toBeVisible({ timeout: 10_000 });

      const capOpen = await captureModalState(
        appPage,
        `CHECKPOINT1 [${mode}] -- modal just opened (always defaults to Top-up)`,
      );
      // The toggle always opens on Top-up, no matter which mode this run
      // will end up exercising -- so no MultiPaymentInput yet either way.
      expect(capOpen.mpiVisibleCount).toBe(0);

      // Overwrite RATE with a run-unique value (COUNT stays at its
      // auto-prefilled 1 -- exactly the one bill just selected) so the
      // resulting commission is unambiguous and unique to this run.
      const rateInput = beforeContentBlock(appPage)
        .locator('label:text-is("Rate per unit")')
        .locator("xpath=following-sibling::input[1]");
      await rateInput.fill(String(rateLbp));

      if (mode === "OTHER_PAYMENT") {
        await appPage
          .getByRole("button", { name: "Other payment", exact: true })
          .click();
        await expect(appPage.getByTestId("multi-payment-input")).toBeVisible({
          timeout: 10_000,
        });
        const methodSelect = appPage
          .locator('[data-testid^="payment-method-"]')
          .first();
        await expect(methodSelect).toBeVisible();
        await methodSelect.selectOption("CASH");
      }

      const capFinal = await captureModalState(
        appPage,
        `CHECKPOINT1 [${mode}] -- RATE edited to ${rateLbp.toLocaleString()} LBP` +
          (mode === "OTHER_PAYMENT"
            ? ", toggled to Other payment"
            : " (left on Top-up)"),
      );
      console.warn(
        `\n=== CHECKPOINT1 [${mode}] toggle + MultiPaymentInput summary ===\n` +
          `  toggle selected: ${mode}\n` +
          `  MultiPaymentInput rendered: ${capFinal.mpiVisibleCount > 0}\n` +
          `  computed "rate x count" line: "${capFinal.computedLineText.replace(/\n/g, " ")}"\n` +
          `  "owes you" / net-pay row: "${capFinal.netPayText.replace(/\n/g, " ")}"\n` +
          `  payment sheet "Total Amount" row: "${capFinal.totalAmountText.replace(/\n/g, " ")}"`,
      );
      if (mode === "OTHER_PAYMENT") {
        expect(capFinal.mpiVisibleCount).toBeGreaterThan(0);
        expect(capFinal.totalAmountText).toContain(
          `${rateLbp.toLocaleString()} LBP`,
        );
      } else {
        expect(capFinal.mpiVisibleCount).toBe(0);
      }
      expect(capFinal.confirmDisabled).toBe(false);

      // Snapshot drawers/ledger bracketing ONLY the Confirm click.
      const before = {
        drawers: await drawerSnap(),
        supplierLbp: await supplierLbpBalance(),
      };
      const confirmBtn = settleModalRoot(appPage).getByRole("button", {
        name: "Confirm Settlement",
      });
      await confirmBtn.click();
      await expect(settleModalRoot(appPage)).toBeHidden({ timeout: 15_000 });
      const after = {
        drawers: await drawerSnap(),
        supplierLbp: await supplierLbpBalance(),
      };

      // Assert the money.
      const katshLbpDelta = after.drawers.katsh.lbp - before.drawers.katsh.lbp;
      const katshUsdDelta = after.drawers.katsh.usd - before.drawers.katsh.usd;
      const generalLbpDelta =
        after.drawers.general.lbp - before.drawers.general.lbp;
      const generalUsdDelta =
        after.drawers.general.usd - before.drawers.general.usd;
      const supplierDelta = after.supplierLbp - before.supplierLbp;

      console.warn(
        `\n=== CHECKPOINT1 [${mode}] drawer/ledger deltas (bracketing ONLY the Confirm click) ===\n` +
          `  Katsh drawer:   LBP ${katshLbpDelta >= 0 ? "+" : ""}${katshLbpDelta}   USD ${katshUsdDelta >= 0 ? "+" : ""}${katshUsdDelta}\n` +
          `  General drawer: LBP ${generalLbpDelta >= 0 ? "+" : ""}${generalLbpDelta}   USD ${generalUsdDelta >= 0 ? "+" : ""}${generalUsdDelta}\n` +
          `  Katsh supplier-ledger LBP balance delta: ${supplierDelta}`,
      );

      if (mode === "TOP_UP") {
        expect(katshLbpDelta).toBe(rateLbp);
        expect(katshUsdDelta).toBe(0);
        expect(generalLbpDelta).toBe(0);
        expect(generalUsdDelta).toBe(0);
      } else {
        expect(generalLbpDelta).toBe(rateLbp);
        expect(generalUsdDelta).toBe(0);
        expect(katshLbpDelta).toBe(0);
        expect(katshUsdDelta).toBe(0);
      }
      // Rule 20: this money is not a debt either way -- the supplier ledger
      // never moves for a bills-only commission-at-settlement.
      expect(supplierDelta).toBe(0);

      // Read back the SUPPLIER_SETTLEMENT transaction itself -- matched by
      // THIS run's own unique commission_lbp, never "the newest row" (rule
      // 15) -- and capture the full audit trail: the payment detail
      // recorded in metadata, the real payment legs (if any), the amount
      // fields, and the /audit row's rendered content.
      const recent = await fetchRecentByType(appPage, "SUPPLIER_SETTLEMENT");
      const txn = recent.find((t) => {
        try {
          const m = JSON.parse(t.metadata_json ?? "{}") as {
            commission_lbp?: number;
          };
          return m.commission_lbp === rateLbp;
        } catch {
          return false;
        }
      });
      expect(txn, `SUPPLIER_SETTLEMENT txn for ${mode} not found`).toBeTruthy();
      const meta = JSON.parse(txn!.metadata_json ?? "{}") as {
        commission_collection_mode?: string;
        counterparty?: { flow?: string; method?: string };
      };
      // NOTE (fix-round 2 finding #3, NOT fixed in this spec -- see file
      // header): `.method` is expected/known to read "CASH" for TOP_UP even
      // though nothing was paid by CASH (SupplierRepository.ts's
      // `settlementMethod` defaults to "CASH" whenever `data.payments` is
      // empty, a leftover assumption from before this batch shape existed).
      // Logged, not asserted, for EITHER mode -- capturing reality without
      // baking in a value that may change once the orchestrator decides how
      // to fix it.
      console.warn(
        `\n=== CHECKPOINT1 [${mode}] transaction metadata + payment detail ===\n` +
          `  metadata.commission_collection_mode: "${meta.commission_collection_mode}"\n` +
          `  metadata.counterparty.flow: "${meta.counterparty?.flow}"   .method (as currently recorded -- see fix-round 2 finding #3): "${meta.counterparty?.method}"\n` +
          `  row amount_usd/amount_lbp: ${txn!.amount_usd} / ${txn!.amount_lbp} (contractually 0/0 -- a bill's principal never reaches the ledger)\n` +
          `  real payment legs on this transaction: ${JSON.stringify(txn!.payments ?? [])}\n` +
          `  summary: "${txn!.summary}"`,
      );
      expect(meta.commission_collection_mode).toBe(mode);
      expect(meta.counterparty?.flow).toBe("IN");
      expect(txn!.amount_usd).toBe(0);
      expect(txn!.amount_lbp).toBe(0);
      if (mode === "OTHER_PAYMENT") {
        // The real CASH/LBP leg the operator picked -- lands in row.payments
        // because General is NOT a provider-stock drawer.
        const cashLeg = (txn!.payments ?? []).find(
          (p) => p.method === "CASH" && p.currency_code === "LBP",
        );
        expect(
          cashLeg,
          "expected a CASH/LBP payment leg on the Other-payment settlement",
        ).toBeTruthy();
        expect(cashLeg!.amount).toBe(rateLbp);
      } else {
        // TOP_UP: the drawer-credit leg targets the Katsh drawer, which
        // PROVIDER_STOCK_DRAWERS hides from the customer-facing legs array
        // BY DESIGN (TransactionRepository._attachPaymentLegs/isInternalLegJs)
        // -- an empty array here is the documented shape, not a miss.
        expect((txn!.payments ?? []).length).toBe(0);
      }

      // The /audit row itself -- rendered Amount cell, cash-flow badge,
      // summary text. Both modes carry the SAME "IN" flow (Katsh funds the
      // commission either way) -- what differs is HOW it arrived, captured
      // above via metadata/payments, not via the badge direction.
      await assertCashFlowBadge(
        appPage,
        `${rateLbp.toLocaleString()} LBP`,
        "in",
        `Checkpoint1 [${mode}] SUPPLIER_SETTLEMENT row`,
      );
    }

    await settleOneBillRow("TOP_UP", BILL_TOPUP_LBP, RATE_TOPUP_LBP);

    // ── 3. Return to Suppliers for the second settlement. The /audit check
    // inside settleOneBillRow just navigated away from /suppliers, so a
    // fresh visit + re-selecting the tile is required -- but bill B was
    // already present in the VERY FIRST fetch (step 1 above), so this
    // second visit's cache -- fresh or not -- correctly still shows it;
    // this is exactly the gap fix-round 2 note #1 closes. ──────────────────
    await navigateTo(appPage, "/suppliers");
    await selectKatshSupplierTile(appPage);
    await settleOneBillRow("OTHER_PAYMENT", BILL_OTHER_LBP, RATE_OTHER_LBP);
  });

  test("Checkpoint 2 -- top-up cash-flow arrows follow what actually moved", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    // ── Case A -- topUpFromSupplier (Katsh): the OWNER'S OWN reported bug.
    // Debt-funded, zero legs -> "in" (green down arrow). ───────────────────
    const AMOUNT_A = 700_211 + (ts % 700);
    await navigateTo(appPage, "/recharge");
    await providerTabKatsh(appPage);
    const modalA = await openTopUpModal(appPage, "Katsh");
    await fillPlainAmount(modalA, AMOUNT_A, "LBP");
    const katshBefore = (await getDrawers(appPage))["Katsh"] ?? {
      usd: 0,
      lbp: 0,
    };
    await modalA
      .getByRole("button", { name: "Confirm Supplier Credit", exact: true })
      .click();
    await expectModalClosed(modalA);
    const katshAfter = (await getDrawers(appPage))["Katsh"] ?? {
      usd: 0,
      lbp: 0,
    };
    const katshDelta = katshAfter.lbp - katshBefore.lbp;
    console.warn(
      `\n=== CHECKPOINT2 [topUpFromSupplier] Katsh drawer LBP delta: ${katshDelta >= 0 ? "+" : ""}${katshDelta} (expect +${AMOUNT_A}) ===`,
    );
    expect(katshDelta).toBe(AMOUNT_A);
    await assertCashFlowBadge(
      appPage,
      `${AMOUNT_A} LBP`,
      "in",
      "topUpFromSupplier (the owner's own reported case)",
    );

    // ── Case B -- topUpFromClient (Whish App), cashPaid > 0 -> "both"
    // (cash really leaves General). ────────────────────────────────────────
    const AMOUNT_B = 512 + (ts % 300);
    await navigateTo(appPage, "/recharge");
    await providerTab(
      appPage,
      "Whish App",
      appPage.getByRole("button", { name: "Bills", exact: true }),
    );
    const modalB = await openTopUpModal(appPage, "Whish App");
    await fillWhishClientAmount(modalB, AMOUNT_B, "LBP");
    await modalB
      .getByRole("button", { name: "Buy Credits from Client", exact: true })
      .click();
    await expectModalClosed(modalB);
    await assertCashFlowBadge(
      appPage,
      `+${AMOUNT_B} credits`,
      "both",
      "topUpFromClient (cashPaid > 0 -- cash really leaves General)",
    );

    // ── Case C -- topUpApp (OMT App): General -> OMT_App, both
    // cash-equivalent -> "both". ────────────────────────────────────────────
    const AMOUNT_C = 613 + (ts % 300);
    await navigateTo(appPage, "/recharge");
    await providerTab(
      appPage,
      "OMT App",
      appPage.getByRole("button", { name: "Send", exact: true }),
    );
    const modalC = await openTopUpModal(appPage, "OMT App");
    await fillPlainAmount(modalC, AMOUNT_C, "LBP");
    await modalC
      .getByRole("button", { name: "Confirm Top-Up", exact: true })
      .click();
    await expectModalClosed(modalC);
    await assertCashFlowBadge(
      appPage,
      `General → OMT_App: ${AMOUNT_C} LBP`,
      "both",
      "topUpApp (General -> OMT_App, both cash-equivalent)",
    );

    // ── Case D -- DRAWER_TOPUP "External (Cash In)": genuinely new money,
    // no source drawer debited at all -> "in". ─────────────────────────────
    const NOTE_EXT = `L141-EXT-${ts}`;
    const AMOUNT_EXT = 700 + (ts % 200);
    const modalD = await openDrawerTopUpModal(appPage);
    await drawerAmountInput(modalD, "LBP").fill(String(AMOUNT_EXT));
    await modalD.getByPlaceholder("Add a note...").fill(NOTE_EXT);
    await submitDrawerTopUp(modalD);
    await assertCashFlowBadge(
      appPage,
      NOTE_EXT,
      "in",
      'DRAWER_TOPUP "External (Cash In)"',
    );

    // ── Case E -- DRAWER_TOPUP "From Drawer": a real cash-equivalent source
    // drawer (OMT_System/Whish_System) debited into General -> "both". This
    // type was PREVIOUSLY ABSENT from the switch entirely (no badge at all)
    // -- both DRAWER_TOPUP shapes are new coverage, not a re-check of an
    // already-covered case. ─────────────────────────────────────────────────
    const NOTE_FD = `L141-FD-${ts}`;
    const AMOUNT_FD = 400 + (ts % 200);
    const modalE = await openDrawerTopUpModal(appPage);
    await modalE
      .getByRole("button", { name: "From Drawer", exact: true })
      .click();
    const sourceDrawerName = await readSelectedSourceDrawer(modalE);
    await drawerAmountInput(modalE, "LBP").fill(String(AMOUNT_FD));
    await modalE.getByPlaceholder("Add a note...").fill(NOTE_FD);
    await submitDrawerTopUp(modalE);
    console.warn(
      `\n=== CHECKPOINT2 [DRAWER_TOPUP From Drawer] source drawer auto-selected: "${sourceDrawerName}" ===`,
    );
    await assertCashFlowBadge(
      appPage,
      NOTE_FD,
      "both",
      'DRAWER_TOPUP "From Drawer"',
    );
  });
});

// Keep typed references so the imports stay used even if a future edit
// trims a call site.
export type _Lira141SpecPage = Page;
export type _Lira141SpecLocator = Locator;
