/**
 * E2E: LIRA-101 — App-wallet RECEIVE fee handling, driven through the real UI
 * (Whish App vs OMT App)
 *
 * RE-DERIVED 2026-09-23 for owner decision D1 (`docs/plans/todo_plans/
 * OWNER_NOTES_2026-09-21.md` §2b, case matrix row 5, migration v180):
 * "OMT App RECEIVE — no fee, for now." OMT App used to share the SAME
 * fee/profit contract as Whish App — the shop keeps the FULL fee as profit
 * (`LEFT_TO_DO.md` §"C4/C5 app-transfer fee split", decided 2026-07-04) — via
 * a manual fee typed on top of the entered amount (OMT App has no auto-fee
 * and no "fee included in amount" toggle, unlike Whish App). D1 removes that
 * manual-fee path entirely: `OmtWhishAppTransferForm.tsx`'s whole "Fee
 * Breakdown" block (the fee input AND every fee-mode radio) is now HIDDEN for
 * `(OMT_APP, RECEIVE)` — see that component's own D1 comment just above the
 * block's render gate — and `FinancialServiceRepository.createTransaction`
 * backs it with a hard-reject: an OMT_APP RECEIVE carrying a non-zero
 * `commission`, `includingFees: true`, or a non-empty `feePayments` is
 * refused outright, with the SAME `OMT_RECEIVE_NO_FEE_MESSAGE` OMT-system
 * RECEIVE throws (owner decision 2026-09-25 — one shared constant, not a
 * bespoke OMT_APP string). Whish App is UNTOUCHED by D1 — its three RECEIVE
 * fee modes (no fee / fee excluded / fee included) are unchanged and kept
 * verbatim below.
 *
 * OLD rule this spec used to guard for OMT App RECEIVE (now removed): a
 * manual fee typed into `#transfer-fee`, charged on top of the entered
 * amount, kept in full as shop profit — the "OMT App RECEIVE, manual $5 fee"
 * test below used to prove exactly that. It is rewritten (rule 24) to prove
 * the OPPOSITE: the fee input is now ABSENT from the DOM for this provider/
 * direction combination, and a plain submit carries no fee regardless. The
 * former "no leaked state" test (Whish App's "deducted" radio must not leak
 * into OMT App) is kept, but its final assertion — submitting OMT App RECEIVE
 * WITH a manual fee — is no longer reachable through the UI, so it is
 * rewritten the same way: prove the fee UI stays absent even after the
 * cross-provider interaction, and that a plain (fee-less) submit still books
 * zero fee/commission, closing the same "no leak" loop without a fee input
 * that no longer exists.
 *
 * Every scenario is driven through the real form (amount/fee inputs, the
 * checkbox, Proceed to Pay → PaymentSheet confirm) rather than the IPC
 * shortcut other specs use, specifically so the frontend fee math and the
 * wiring into the transactions table are exercised end-to-end, not just the
 * repository. Assertions are drawer DELTAS + the stored row's own
 * commission/fee fields + the /audit table's rendered row (rule 15: deltas
 * and identity, never absolute totals or row position).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ─── Shared helpers ──────────────────────────────────────────────────────────

type HistoryRow = {
  id: number;
  amount: number;
  commission: number;
  whish_fee: number | null;
  omt_fee: number | null;
  client_name: string | null;
};

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };

type Api = {
  api: {
    recharge: { getDrawerBalances: () => Promise<DrawerBalance[]> };
    omt: {
      getHistory: (provider?: string) => Promise<HistoryRow[]>;
    };
    session: {
      getActiveSessions: () => Promise<
        { sessions?: Array<{ id: number }> } | Array<{ id: number }>
      >;
      close: (id: number, actor: string) => Promise<unknown>;
    };
  };
};

/** Close every active customer session via IPC (clean slate) — Whish/OMT App
 *  autofill sender/receiver from an active session, which would clobber the
 *  unique identity name this suite relies on. */
async function closeAllActiveSessions(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as Api;
    const r = await w.api.session.getActiveSessions();
    const list = (Array.isArray(r) ? r : (r.sessions ?? [])) as Array<{
      id: number;
    }>;
    for (const s of list) {
      await w.api.session.close(s.id, "admin");
    }
  });
}

/** Snapshot the app-wallet + General drawer balances this suite cares about. */
async function drawers(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      general: get("General")?.usdBalance ?? 0,
      omtApp: get("OMT_App")?.usdBalance ?? 0,
      whishApp: get("Whish_App")?.usdBalance ?? 0,
    };
  });
}

/** Fetch a provider's history and locate the row by its unique identity name
 *  (identity, never position — rule 15). The form sends the typed
 *  receiver/sender name as `clientName`, which lands in the `client_name`
 *  column — `receiver_name`/`sender_name` stay NULL on this (non-session)
 *  submit path. */
async function findRow(
  page: Page,
  provider: string,
  receiverName: string,
): Promise<HistoryRow> {
  const rows = await page.evaluate(
    (p) => (window as unknown as Api).api.omt.getHistory(p),
    provider,
  );
  const row = rows.find((r) => r.client_name === receiverName);
  if (!row) {
    throw new Error(
      `No ${provider} history row found for receiver "${receiverName}"`,
    );
  }
  return row;
}

// Provider tab → a DOM marker that confirms the right form actually rendered.
// Whish App keeps its inner Transfer/Bills tab state across provider
// switches, so its reliable marker is the inner "Transfer" tab, not
// #transfer-amount (hidden while Bills mode is selected) — same pattern as
// the shared helper in lira-094/095.
const PROVIDER_MARKERS: Record<string, string> = {
  "Whish App": "btn:Transfer",
  "OMT App": "#transfer-amount",
};

/** Click a recharge provider tab and verify its form actually rendered. */
async function providerTab(page: Page, label: "Whish App" | "OMT App") {
  const marker = PROVIDER_MARKERS[label];
  const tab = page
    .locator("button")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();

  const target = marker.startsWith("#")
    ? page.locator(marker).first()
    : page
        .locator("button")
        .filter({ hasText: new RegExp(`^${marker.slice(4)}$`) })
        .first();
  await expect(target).toBeVisible({ timeout: 10_000 });

  if (label === "Whish App") {
    // Force the Transfer sub-tab explicitly — whishAppMode is parent state
    // that can be left on "Bills" by an earlier interaction.
    await target.click();
    await expect(page.locator("#transfer-amount")).toBeVisible({
      timeout: 5_000,
    });
  }
}

async function selectReceive(page: Page) {
  const receiveTab = page
    .locator("button")
    .filter({ hasText: /^Receive$/ })
    .first();
  await expect(receiveTab).toBeVisible({ timeout: 5_000 });
  await receiveTab.click();
  await expect(page.locator("#receiver-name")).toBeVisible({
    timeout: 5_000,
  });
}

/** Fill the RECEIVE form, submit, and confirm payment. Assumes the correct
 *  provider tab + Receive tab are already active. */
async function submitReceive(
  page: Page,
  opts: {
    amount: string;
    fee?: string; // omit = leave auto/blank; "0" = explicit zero
    includingFees?: boolean; // Whish App only — the checkbox
    receiverName: string;
  },
) {
  await page.locator("#transfer-amount").fill(opts.amount);

  if (opts.fee !== undefined) {
    await page.locator("#transfer-fee").fill(opts.fee);
  }

  if (opts.includingFees) {
    // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D — the old "Fee included
    // in amount" checkbox was replaced by a 3-way "Fee paid by" radio group
    // (OmtWhishAppTransferForm.tsx:744-783). The old checked-checkbox
    // semantics map to selecting "Deducted from payout"
    // (`fee-mode-deducted`, Whish-App-only — mirrors the checkbox's old
    // reachability).
    const deductedRadio = page.getByTestId("fee-mode-deducted");
    await deductedRadio.check();
  }

  await page.locator("#receiver-name").fill(opts.receiverName);

  const proceedBtn = page.getByRole("button", { name: /Proceed to Pay/i });
  await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
  await proceedBtn.click();

  const confirmBtn = page.locator("button").filter({ hasText: /^Pay / }).last();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();
  await expect(confirmBtn).toBeHidden({ timeout: 8_000 });
}

/** Locate the /audit row by identity (unique receiver name in the summary/
 *  client column) — bounce through "/" first so a parked viewer remounts and
 *  fetches the fresh list (per README "assertion discipline"). */
async function auditRow(page: Page, identity: string) {
  await navigateTo(page, "/");
  await navigateTo(page, "/audit");
  const row = page.locator("tr", { hasText: identity }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  return row;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("LIRA-101 — App wallet RECEIVE fee handling", () => {
  test.beforeEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
    await navigateTo(appPage, "/recharge");
  });

  test("Whish App RECEIVE, no fee: wallet +100, payout −100, $0 profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `WHISH RECV NOFEE ${ts}`;

    await providerTab(appPage, "Whish App");
    await selectReceive(appPage);

    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100",
      fee: "0", // explicit zero — overrides the 1% auto-fee
      receiverName,
    });
    const after = await drawers(appPage);

    expect(after.whishApp - before.whishApp).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "WHISH_APP", receiverName);
    expect(row.amount).toBeCloseTo(100, 2);
    expect(row.commission).toBeCloseTo(0, 2);
    expect(row.whish_fee ?? 0).toBeCloseTo(0, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    await expect(trow).toContainText("$100");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $100");
  });

  test("Whish App RECEIVE, fee NOT included: wallet +101, payout −100, $1 profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `WHISH RECV EXCL ${ts}`;

    await providerTab(appPage, "Whish App");
    await selectReceive(appPage);

    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100", // fee left blank → 1% auto-fee ($1), includingFees stays unchecked
      receiverName,
    });
    const after = await drawers(appPage);

    // Wallet grosses up by the fee; customer still receives the entered amount.
    expect(after.whishApp - before.whishApp).toBeCloseTo(101, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "WHISH_APP", receiverName);
    expect(row.amount).toBeCloseTo(101, 2);
    expect(row.commission).toBeCloseTo(1, 2); // FULL fee, not fee × 10%
    expect(row.whish_fee).toBeCloseTo(1, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    await expect(trow).toContainText("$101");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $100");
  });

  test("Whish App RECEIVE, fee INCLUDED: wallet +100, payout −99, $1 profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `WHISH RECV INCL ${ts}`;

    await providerTab(appPage, "Whish App");
    await selectReceive(appPage);

    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100", // fee left blank → 1% auto-fee ($1), includingFees CHECKED
      includingFees: true,
      receiverName,
    });
    const after = await drawers(appPage);

    // Wallet gets exactly the entered amount; the fee comes out of the payout.
    expect(after.whishApp - before.whishApp).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(-99, 2);

    const row = await findRow(appPage, "WHISH_APP", receiverName);
    expect(row.amount).toBeCloseTo(100, 2);
    expect(row.commission).toBeCloseTo(1, 2);
    expect(row.whish_fee).toBeCloseTo(1, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    await expect(trow).toContainText("$100");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $99");
  });

  test("OMT App RECEIVE, no fee: wallet +100, payout −100, $0 profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `OMT RECV NOFEE ${ts}`;

    await providerTab(appPage, "OMT App");
    await selectReceive(appPage);

    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100", // fee left blank — OMT App has no auto-fee at all
      receiverName,
    });
    const after = await drawers(appPage);

    expect(after.omtApp - before.omtApp).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "OMT_APP", receiverName);
    expect(row.amount).toBeCloseTo(100, 2);
    expect(row.commission).toBeCloseTo(0, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    await expect(trow).toContainText("$100");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $100");
  });

  test("OMT App RECEIVE: the fee UI is ABSENT (D1, 2026-09-23) — wallet +100, payout −100, $0 profit regardless of provider history", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `OMT RECV NOFEEUI ${ts}`;

    await providerTab(appPage, "OMT App");
    await selectReceive(appPage);

    // D1: the entire "Fee Breakdown" block — heading, manual fee input, and
    // every fee-mode radio — is gone for (OMT_APP, RECEIVE)
    // (OmtWhishAppTransferForm.tsx's D1 comment just above its render gate).
    // No "fee included in amount" toggle either (pre-existing, never
    // reachable for OMT App at all).
    await expect(appPage.getByText("Fee Breakdown")).toHaveCount(0);
    await expect(appPage.locator("#transfer-fee")).toHaveCount(0);
    await expect(appPage.getByTestId("fee-mode-sender")).toHaveCount(0);
    await expect(appPage.getByTestId("fee-mode-deducted")).toHaveCount(0);
    await expect(appPage.getByTestId("fee-mode-separate")).toHaveCount(0);
    await expect(appPage.getByLabel("Fee included in amount")).toHaveCount(0);

    // With no fee input to fill, the only payload this form can send is
    // fee-less — same numbers the "no fee" test above proves, re-derived
    // here specifically to show the ABSENCE of the fee UI is what produces
    // them, not an operator choosing "0".
    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100",
      receiverName,
    });
    const after = await drawers(appPage);

    expect(after.omtApp - before.omtApp).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "OMT_APP", receiverName);
    expect(row.amount).toBeCloseTo(100, 2);
    expect(row.commission).toBeCloseTo(0, 2);
    expect(row.omt_fee ?? 0).toBeCloseTo(0, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    await expect(trow).toContainText("$100");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $100");
  });

  test("OMT App RECEIVE: 'fee deducted from payout' stays unreachable after D1 — no radio, no fee input, no leaked state from Whish App", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `OMT RECV NOLEAK ${ts}`;

    // First, actually select "Deducted from payout" on Whish App RECEIVE, to
    // prove its state does NOT leak into OMT App when switching tabs
    // (feeMode resets to SENDER whenever activeProvider !== "WHISH_APP" —
    // OmtWhishAppTransferForm.tsx:180-183 — the same remount-safety property
    // the old checkbox test guarded). Whish App RECEIVE fee UI is UNCHANGED
    // by D1.
    await providerTab(appPage, "Whish App");
    await selectReceive(appPage);
    await appPage.locator("#transfer-amount").fill("50");
    await expect(appPage.getByTestId("fee-mode-deducted")).toBeVisible();
    await appPage.getByTestId("fee-mode-deducted").check();
    await expect(appPage.getByTestId("fee-mode-deducted")).toBeChecked();

    await providerTab(appPage, "OMT App");
    await selectReceive(appPage);

    // D1: no fee UI at all for OMT App RECEIVE — not just the "deducted"
    // radio (the pre-D1 target of this test), but the whole Fee Breakdown
    // block, regardless of what was just selected on the Whish App tab.
    await expect(appPage.getByTestId("fee-mode-deducted")).toHaveCount(0);
    await expect(appPage.getByTestId("fee-mode-sender")).toHaveCount(0);
    await expect(appPage.locator("#transfer-fee")).toHaveCount(0);

    // Prove the non-leak isn't just cosmetic: submit a plain OMT App RECEIVE
    // (no fee input exists to fill) and confirm it books the SAME zero-fee
    // numbers the "fee UI is ABSENT" test above proves — NOT the Whish-App
    // "deducted" math (wallet +100, payout −95) a leaked feeMode would have
    // produced, and NOT the pre-D1 "fee on top" math (wallet +105, payout
    // −100) a leaked manual fee would have produced either.
    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100",
      receiverName,
    });
    const after = await drawers(appPage);

    expect(after.omtApp - before.omtApp).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "OMT_APP", receiverName);
    expect(row.amount).toBeCloseTo(100, 2);
    expect(row.commission).toBeCloseTo(0, 2);
    expect(row.omt_fee ?? 0).toBeCloseTo(0, 2);
  });
});
