/**
 * E2E: LIRA-101 — App-wallet RECEIVE fee handling, driven through the real UI
 * (Whish App vs OMT App)
 *
 * Both providers now share the SAME fee/profit contract — the shop keeps the
 * FULL fee as profit (`LEFT_TO_DO.md` §"C4/C5 app-transfer fee split",
 * decided 2026-07-04: "the fee is fully the shop's, OMT App + Whish App").
 * Whish App RECEIVE was fixed first (lira-100 —
 * `docs/plans/done_plans/WHISH_APP_RECEIVE_FEE_FIX_PLAN.md`); OMT App RECEIVE was fixed
 * in this cluster by extending `calculateOmtWhishAppFees`'s
 * `isAppWalletReceive` gate to both providers. OMT App has no auto-fee and no
 * "fee included in amount" toggle (that checkbox is Whish-App-only), so its
 * only reachable RECEIVE state is "fee charged on top of the entered amount"
 * — `includingFees` is always false in practice for OMT App.
 *
 * The last test proves "OMT App receive, fee included" is still not a
 * reachable UI state (no checkbox, and Whish App's checkbox state does not
 * leak across the provider-tab remount) — that part of the contract is
 * unchanged by this fix.
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
    const checkbox = page.getByLabel("Fee included in amount");
    await checkbox.check();
  }

  await page.locator("#receiver-name").fill(opts.receiverName);

  const proceedBtn = page.getByRole("button", { name: /Proceed to Pay/i });
  await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
  await proceedBtn.click();

  const confirmBtn = page
    .locator("button")
    .filter({ hasText: /^Pay / })
    .last();
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

  test("OMT App RECEIVE, manual $5 fee: wallet +105, payout −100, shop keeps the FULL fee as profit", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const receiverName = `OMT RECV FEE5 ${ts}`;

    await providerTab(appPage, "OMT App");
    await selectReceive(appPage);

    // No "fee included in amount" toggle exists for OMT App at all — confirm
    // it before relying on that fact for the rest of this test.
    await expect(
      appPage.getByLabel("Fee included in amount"),
    ).toHaveCount(0);

    const before = await drawers(appPage);
    await submitReceive(appPage, {
      amount: "100",
      fee: "5", // manual fee — the only fee mechanism OMT App has
      receiverName,
    });
    const after = await drawers(appPage);

    // Fixed behavior (was: identical to the no-fee case above — the $5 the
    // cashier typed never reached the money engine). Now mirrors Whish App's
    // "fee not included" case: the fee is charged on top of the entered
    // amount, grossing up the wallet inflow, and is kept in full as profit.
    expect(after.omtApp - before.omtApp).toBeCloseTo(105, 2);
    expect(after.general - before.general).toBeCloseTo(-100, 2);

    const row = await findRow(appPage, "OMT_APP", receiverName);
    expect(row.amount).toBeCloseTo(105, 2); // fee folded into the wallet amount
    expect(row.commission).toBeCloseTo(5, 2); // FULL fee counted as profit
    expect(row.omt_fee).toBeCloseTo(5, 2);

    const trow = await auditRow(appPage, receiverName);
    await expect(trow).toContainText("$105");
    await expect(trow.getByTestId("payment-legs")).toContainText("out: $100");
  });

  test("OMT App RECEIVE: 'fee included' is not a reachable UI state (no toggle, no leaked state from Whish App)", async ({
    appPage,
  }) => {
    // First, actually check the box on Whish App RECEIVE, to prove its state
    // does NOT leak into OMT App when switching tabs (different JSX branch
    // per provider in Recharge/index.tsx → full remount, not a prop change).
    await providerTab(appPage, "Whish App");
    await selectReceive(appPage);
    await appPage.locator("#transfer-amount").fill("50");
    await expect(appPage.getByLabel("Fee included in amount")).toBeVisible();
    await appPage.getByLabel("Fee included in amount").check();
    await expect(appPage.getByLabel("Fee included in amount")).toBeChecked();

    await providerTab(appPage, "OMT App");
    await selectReceive(appPage);

    // No checkbox at all for OMT App — the scenario "OMT App receive, fee
    // included" has no UI expression, regardless of prior Whish App state.
    await expect(
      appPage.getByLabel("Fee included in amount"),
    ).toHaveCount(0);
  });
});
