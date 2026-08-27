/**
 * E2E: LIRA-137 — Katsh BILL settlement commission books as a provider-drawer
 * top-up (BILL_COMMISSION_SETTLEMENT_PLAN.md).
 *
 * ⚠ THIS FILE REPLACES `lira-137-katsh-bill-settlement-modal-
 * characterization.spec.ts` (deleted). That file documented KNOWN-WRONG
 * behaviour empirically and was explicit that a fix would make it obsolete —
 * this is that fix's guard, not a rename of the old assertions.
 *
 * THE OWNER'S REPORT (2026-08-11, verbatim where quoted): 2 Katsh bills
 * selected -> Settle -> in the modal, RATE PER UNIT 20000, CURRENCY LBP,
 * COUNT 5 correctly computed "20000 LBP x 5 = 100,000 LBP", but "the Net
 * Payment to Katsh is not changing in the modal... still at zero... so I
 * cannot do any payments." Plus the business correction: "When katsh owes
 * us 100,000lbp they pay it to us via topup to our katsh account (so katsh
 * drawer should increase by the payment)" and "The commission should be a
 * separate payment regardless of if katsh owes us or we owe them."
 *
 * THE FIX (traced in the plan doc, proved live here):
 *   1. "Total owed to Katsh (fee-net)" and the old "Net payment to Katsh:
 *      $0.00" tender line are GONE for a bills-only batch — replaced by
 *      "Katsh owes you: <entered commission>", which DOES react to
 *      COUNT/RATE (proved at TWO different COUNT values, 2 then 5, matching
 *      the task's ask).
 *   2. NO payment-method tender form renders at all for this batch shape —
 *      no "Total Amount"/"Paid" row, no amount input, no method dropdown.
 *      There is nothing for the operator to type, so "I cannot do any
 *      payments" can no longer happen — there is no payment to make.
 *   3. Confirm Settlement is enabled (no legs are required or accepted for
 *      a $0/0-LBP-owed batch).
 *   4. What actually POSTS on Confirm: the Katsh provider DRAWER credits by
 *      EXACTLY the entered commission (a real top-up, funded by Katsh) —
 *      proved via real IPC read-back deltas bracketing ONLY the Confirm
 *      click. The supplier LEDGER balance is UNCHANGED (no
 *      `SUPPLIER_PAYS_US` receivable is booked for this money — it is not a
 *      debt, Katsh funds it directly) and no OTHER drawer moves.
 *
 * Rule 15 (shared accumulating DB): every row is matched by IDENTITY (two
 * freshly-created bills with unique, Date.now()-derived LBP amounts that
 * cannot collide with any other spec's fixed bill amounts), and every money
 * assertion is a DELTA snapshotted immediately before/after the Confirm
 * click — never an absolute balance or list position. The old
 * characterization spec's own bug (captured `drawersBefore` BEFORE its bill
 * creation, so the bill's own cost leg fell inside the measurement window)
 * is fixed here: every snapshot below brackets ONLY the Confirm click.
 *
 * The KatchForm/Suppliers-settle-modal helpers this spec drives (providerTab
 * Katsh, addBill, captureModalState, etc.) live in
 * `helpers/katshSettlement.ts` (LIRA-141) so a second spec,
 * `lira-141-settlement-modes-and-topup-arrows.spec.ts`, can reuse them
 * without re-deriving the same DOM navigation — Playwright refuses to let
 * one spec file import another, so a plain `helpers/` module (the same
 * convention `helpers/nav.ts`/`helpers/seed.ts` already use) is the only
 * place both specs can pull them from. No logic changed by the move.
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

// This spec consumes helpers/katshSettlement.ts's providerTabKatsh (waits on
// [role="alert"] toast state) — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

// Unique to this spec file -- not reused by any other Katsh-bill spec
// (lira-062: 50,000; lira-089: 486,000; lira-095: 130k/220k/140k/160k/111k/
// 222k/250k/120k/180k; the deleted characterization spec used
// 711k/822k+ts%1000 — this file uses a disjoint offset so a same-second
// re-run of both during the migration window still can't collide).
const ts = Date.now();
const BILL_A_LBP = 611_000 + (ts % 1000);
const BILL_B_LBP = 922_000 + (ts % 1000);

// Katsh's OWN saved settlement preference, seeded by migration v151
// (packages/core/src/db/migrations/index.ts) -- NOT typed by this spec.
// Asserted (not assumed) at CAPTURE 1 below.
const KATSH_DEFAULT_RATE_LBP = 20_000;
const COUNT_INITIAL = 2; // == number of bills this spec selects (auto-prefilled)
const COUNT_EDITED = 5; // the owner's own reported value
const COMMISSION_AT_COUNT_2 = KATSH_DEFAULT_RATE_LBP * COUNT_INITIAL; // 40,000
const COMMISSION_AT_COUNT_5 = KATSH_DEFAULT_RATE_LBP * COUNT_EDITED; // 100,000

type SupplierRow = { id: number; provider: string | null };
type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  is_refunded?: number;
};
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  commission: number;
  settlement_id: number | null;
  is_settled: number;
};
type DrawerRow = { name: string; usdBalance: number; lbpBalance: number };
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
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

test.describe("LIRA-137 -- Katsh bill settlement commission books as a drawer top-up", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("commission reacts live to COUNT (2 then 5), no tender form renders, Confirm posts a Katsh-drawer top-up with the supplier ledger UNTOUCHED", async ({
    appPage,
  }) => {
    const CLIENT = `L137 Katsh ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;

    // ── 1. Create 2 real Katsh bills through the REAL KatchForm UI, one
    // payment (mirrors lira-095's multi-bill checkout). ─────────────────────
    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTabKatsh(appPage);
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    const katsh = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "Katsh",
      );
    });
    expect(katsh, "Katsh supplier not found").toBeTruthy();
    const katshId = katsh!.id;

    await addBill(appPage, BILL_A_LBP);
    await addBill(appPage, BILL_B_LBP);
    await payCashWithClient(appPage, CLIENT, PHONE);
    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });

    // ── 2. Navigate to Suppliers -> Katsh -> select exactly the 2 NEW bills
    // by identity (never "select all" -- the settle tab already carries
    // stale unsettled bills from lira-062/078/089/095). ─────────────────────
    await navigateTo(appPage, "/suppliers");
    await selectKatshSupplierTile(appPage);

    const rowA = billRowLabel(appPage, BILL_A_LBP);
    const rowB = billRowLabel(appPage, BILL_B_LBP);
    await expect(rowA).toBeVisible({ timeout: 15_000 });
    await expect(rowB).toBeVisible({ timeout: 15_000 });
    await rowA.locator('input[type="checkbox"]').check();
    await rowB.locator('input[type="checkbox"]').check();

    // The pre-modal strip -- BILL_COMMISSION_SETTLEMENT_PLAN.md also fixed
    // this text (was "Owed $0.00 - commission / Net you pay: 0 LBP", which
    // implied a payment that never happens).
    const preModalStrip = appPage
      .locator("div.flex.items-center.justify-between", {
        hasText: "owes you a settlement commission",
      })
      .first();
    await expect(preModalStrip).toBeVisible({ timeout: 10_000 });
    console.warn(
      `\n=== PRE-MODAL STRIP (under the row list, before clicking Settle) ===`,
    );
    console.warn(
      `  "${(await preModalStrip.innerText()).replace(/\n/g, " | ")}"`,
    );
    // The old "Net you pay:" framing no longer appears for this batch.
    await expect(appPage.getByText(/Net you pay:/).first()).toHaveCount(0);

    const settleBtn = appPage.getByRole("button", { name: /^Settle \(2\)$/ });
    await expect(settleBtn).toBeVisible();
    await expect(settleBtn).toBeEnabled();

    // ── 3. Open the Settle confirm modal. Katsh's OWN saved preference
    // (migration v151) means it opens ALREADY in RATE/20000/LBP -- the
    // owner's exact reported configuration -- with COUNT auto-prefilled to
    // the number of rows selected (2). Nothing has been typed yet. ─────────
    await settleBtn.click();
    await expect(settleModalRoot(appPage)).toBeVisible({ timeout: 10_000 });

    const cap1 = await captureModalState(
      appPage,
      "CAPTURE 1 -- modal just opened, COUNT=2 (Katsh's own defaults, untouched)",
    );

    // Katsh's saved preference is what's on screen -- proves the operator
    // didn't need to configure RATE/CURRENCY at all, only ever COUNT.
    expect(cap1.rateVal).toBe(String(KATSH_DEFAULT_RATE_LBP));
    expect(cap1.countVal).toBe(String(COUNT_INITIAL));
    expect(cap1.lbpActive).toBe(true);
    expect(cap1.computedLineText).toContain(
      `${COMMISSION_AT_COUNT_2.toLocaleString()} LBP`,
    );

    // THE FIX, at COUNT=2: "Total owed" is gone entirely, and "Katsh owes
    // you:" already shows the real, nonzero, correctly-computed commission
    // -- not frozen at 0.
    expect(cap1.totalOwedText).toBe("<not found>");
    expect(cap1.netPayText).toContain(
      `${COMMISSION_AT_COUNT_2.toLocaleString()} LBP`,
    );
    expect(cap1.netPayText).toContain("owes you");
    // No tender form at all -- nothing to type, nothing to mismatch.
    expect(cap1.mpiVisibleCount).toBe(0);
    expect(cap1.totalAmountText).toBe("<not found>");
    // Confirm is enabled: no cash owed, no legs required.
    expect(cap1.confirmDisabled).toBe(false);

    // ── 4. Edit COUNT to 5 (the owner's own reported value) -- the ONLY
    // field the owner needed to change, since RATE/CURRENCY already matched
    // their report by default. ──────────────────────────────────────────────
    const countInput = beforeContentBlock(appPage)
      .locator('label:text-is("Count")')
      .locator("xpath=following-sibling::input[1]");
    await countInput.fill(String(COUNT_EDITED));

    const cap2 = await captureModalState(
      appPage,
      "CAPTURE 2 -- COUNT edited to 5 (owner's reported value)",
    );

    // The computed line reacts to COUNT (as it always did)...
    expect(cap2.countVal).toBe(String(COUNT_EDITED));
    expect(cap2.computedLineText).toContain(
      `${COMMISSION_AT_COUNT_5.toLocaleString()} LBP`,
    );
    expect(cap2.rateVal).toBe(String(KATSH_DEFAULT_RATE_LBP));
    expect(cap2.lbpActive).toBe(true);

    // ...and now "Katsh owes you:" reacts too -- 40,000 -> 100,000, the
    // EXACT owner complaint ("not changing... still at zero"), fixed.
    expect(cap2.netPayText).toContain(
      `${COMMISSION_AT_COUNT_5.toLocaleString()} LBP`,
    );
    expect(cap2.totalOwedText).toBe("<not found>");
    expect(cap2.mpiVisibleCount).toBe(0);
    expect(cap2.confirmDisabled).toBe(false);

    // No payment-amount input exists anywhere in the modal -- "I cannot do
    // any payments" cannot recur: there is no payment box to type into.
    expect(
      await appPage.locator('[data-testid^="payment-amount-"]').count(),
    ).toBe(0);

    // ── 5. Snapshot balances/drawers, bracketing ONLY the Confirm click
    // (the deleted characterization spec's own bug: it captured
    // `drawersBefore` BEFORE creating the bills, so the bills' own cost legs
    // fell inside the measurement window). ─────────────────────────────────
    const balBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);
    const drawersBefore = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const rows = await w.api.recharge.getDrawerBalances();
      const pick = (n: string) => ({
        usd: rows.find((d) => d.name === n)?.usdBalance ?? 0,
        lbp: rows.find((d) => d.name === n)?.lbpBalance ?? 0,
      });
      return { general: pick("General"), katsh: pick("Katsh") };
    });
    const priorPaysUsRows = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) => l.entry_type === "SUPPLIER_PAYS_US",
      ).length;
    }, katshId);

    // ── 6. Confirm Settlement and prove what actually posts. ────────────────
    const confirmBtn = settleModalRoot(appPage).getByRole("button", {
      name: "Confirm Settlement",
    });
    await confirmBtn.click();
    await expect(settleModalRoot(appPage)).toBeHidden({ timeout: 15_000 });

    // The Katsh provider DRAWER credits by EXACTLY the entered commission --
    // a real top-up, funded by Katsh (owner's own model, 2026-08-11).
    const drawersAfter = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const rows = await w.api.recharge.getDrawerBalances();
      const pick = (n: string) => ({
        usd: rows.find((d) => d.name === n)?.usdBalance ?? 0,
        lbp: rows.find((d) => d.name === n)?.lbpBalance ?? 0,
      });
      return { general: pick("General"), katsh: pick("Katsh") };
    });
    expect(drawersAfter.katsh.lbp - drawersBefore.katsh.lbp).toBe(
      COMMISSION_AT_COUNT_5,
    );
    // No other drawer/currency moves -- the commission is NOT a cash
    // payment, and it never touches General or Katsh USD.
    expect(drawersAfter.katsh.usd - drawersBefore.katsh.usd).toBe(0);
    expect(drawersAfter.general.usd - drawersBefore.general.usd).toBe(0);
    expect(drawersAfter.general.lbp - drawersBefore.general.lbp).toBe(0);

    // The supplier LEDGER balance is UNCHANGED -- this money is not a debt
    // (rule 20 "one obligation, one owner": there is nothing here for a
    // receivable to net against). This is the OPPOSITE of what the deleted
    // characterization spec proved for the pre-fix code (a -100,000 ledger
    // delta from a cashless SUPPLIER_PAYS_US credit).
    const balAfter = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);
    expect(balAfter - balBefore).toBe(0);

    // No NEW SUPPLIER_PAYS_US row was written for this settlement.
    const afterPaysUsRows = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) => l.entry_type === "SUPPLIER_PAYS_US",
      ).length;
    }, katshId);
    expect(afterPaysUsRows).toBe(priorPaysUsRows);

    // The SUPPLIER_SETTLEMENT transaction itself -- matched by identity
    // (this batch's own commission_lbp figure, never by time proximity,
    // the LIRA-085 lesson) -- carries the CQ-8 "IN" flow (money arrived,
    // never "OUT" the way a real net payment settlement stamps it).
    const settlementTxn = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const recent = await w.api.transactions.getRecent(50, {
        source_table: "supplier_ledger",
      });
      const list = Array.isArray(recent) ? recent : (recent.transactions ?? []);
      return (
        list
          .filter((t) => t.type === "SUPPLIER_SETTLEMENT")
          .sort((a, b) => b.id - a.id)[0] ?? null
      );
    });
    expect(
      settlementTxn,
      "SUPPLIER_SETTLEMENT transaction not found",
    ).toBeTruthy();
    const meta = JSON.parse(settlementTxn!.metadata_json ?? "{}") as {
      commission_model?: number;
      entry_mode?: string;
      commission_lbp?: number;
      counterparty?: { flow?: string };
    };
    expect(meta.commission_model).toBe(1);
    expect(meta.entry_mode).toBe("RATE");
    expect(meta.commission_lbp).toBe(COMMISSION_AT_COUNT_5);
    expect(meta.counterparty?.flow).toBe("IN");
    // Amounts stay 0/0 -- no cash was paid OUT (only credited IN, above).
    expect(settlementTxn!.amount_usd).toBe(0);
    expect(settlementTxn!.amount_lbp).toBe(0);

    // Both bills are now settled -- no longer in the unsettled queue.
    for (const amount of [BILL_A_LBP, BILL_B_LBP]) {
      const row = await appPage.evaluate(async (amt: number) => {
        const w = window as unknown as Api;
        const rows = await w.api.suppliers.getUnsettledTransactions("Katsh");
        return rows.find((r) => r.service_type === "BILL" && r.amount === amt);
      }, amount);
      expect(
        row,
        `bill ${amount} should be settled, not in the queue`,
      ).toBeUndefined();
    }

    console.warn(
      `\n=== SUMMARY ===\n` +
        `  Katsh LBP drawer delta: +${drawersAfter.katsh.lbp - drawersBefore.katsh.lbp} (== +${COMMISSION_AT_COUNT_5}, a real top-up funded by Katsh)\n` +
        `  Katsh USD / General USD / General LBP deltas: all 0\n` +
        `  Katsh supplier LEDGER balance delta: ${balAfter - balBefore} (== 0 -- this money is not a debt)\n` +
        `  Modal: "Total owed"/"Net payment" gone; "Katsh owes you:" tracked 40,000 -> 100,000 live\n`,
    );
  });
});

// Keep a typed reference to Page/Locator so the imports are always used.
export type _KatshSettlementCommissionTopUpSpecPage = Page;
export type _KatshSettlementCommissionTopUpSpecLocator = Locator;
