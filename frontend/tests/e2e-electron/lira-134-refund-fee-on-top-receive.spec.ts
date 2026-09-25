/**
 * E2E: LIRA-134 — refund of an OMT system RECEIVE, driven through the REAL
 * `RefundMethodModal`, not a hand-built IPC payload.
 *
 * REWRITTEN 2026-09-23 for D1 (OWNER_NOTES_2026-09-21.md §2b, migration
 * v180): the original scenario this file drove — an OMT system RECEIVE with
 * the fee collected ON TOP via a customer-paid CASH leg, auto-seeded by the
 * Phase C "counter-flow" section — no longer exists. D1's owner decision is
 * that an OMT system RECEIVE NEVER takes a fee from the customer at all: the
 * fee is shown (it drives the commission calculation) but never collected,
 * never deducted from the payout, and never posts a drawer leg of its own.
 * `showFeeCounterFlow`/`feeCounterFlowActive` (`Services/index.tsx`) are now
 * gated `provider === "WHISH"` — the counter-flow card this file used to
 * assert on (`counter-flow-section`) simply does not render for OMT anymore.
 *
 * This file now proves two things instead:
 *
 *  1. The ORIGINAL purpose (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.3 item
 *     (ii)) survives in the shape D1 still supports: refunding a real OMT
 *     system RECEIVE through the actual /audit "Refund" button + the real
 *     `RefundMethodModal`, with UNTOUCHED defaults, nets every drawer the
 *     transaction touched — and the OMT supplier ledger — back to their
 *     pre-creation baseline (rule 20). The RECEIVE now carries exactly ONE
 *     customer-facing leg (the payout; no fee leg exists to collect), so
 *     `buildDefaultRefundLines` has only one line to default — still routed
 *     through the real modal (`handleRefund`'s gate is "any legs", not
 *     "more than one"), never the plain confirm() fallback.
 *  2. A short guard: the counter-flow section is ABSENT for an OMT system
 *     RECEIVE even with a nonzero fee typed into the OMT Fee field — the
 *     regression this rewrite exists to catch if D1's WHISH-only gate is
 *     ever accidentally widened back to OMT.
 *
 * Numbers (traced against FinancialServiceRepository.ts, not guessed):
 *   - Payout: `receiveFeeIncluded` is forced false for OMT RECEIVE
 *     (`omtSystemReceiveInformationalOnly`, Services/index.tsx), so
 *     `payoutAmount = receiveAmount` = the full $100 — never netted by the
 *     $5 fee. The fee-on-top leg itself is skipped outright for
 *     `data.provider === "OMT"` (the `!deferPayment && !receiveFeeIncluded
 *     && receiveFeeAmt > 0 && data.provider !== "OMT"` gate, ~:3892) — so
 *     OMT_System's ONLY leg is the payout: exactly −100.
 *   - Supplier ledger: `grossOwedDelta`'s RECEIVE branch reads the row's own
 *     `receive_fee_model` stamp; every new OMT RECEIVE is born
 *     `RECEIVE_FEE_MODEL_CUTOVER` (D1), so `ledgerAmount = −|amount| = −100`
 *     — the fee is never netted out of what OMT owes either. This ledger
 *     entry is `is_auto: true` with `source_ref_table: "financial_services"`
 *     (~:4290), so it cascade-reverses when the parent RECEIVE is
 *     voided/refunded (rule 26) — the same round trip the drawer assertion
 *     proves, on a second ledger.
 *
 * Rule 15/20: every assertion is a DELTA. The spec snapshots the drawer and
 * the OMT supplier ledger balance BEFORE the RECEIVE is created, and asserts
 * both net back to that same baseline after the refund — proving
 * create+reverse nets to 0 — while also proving the creation step itself was
 * non-trivial (so the round-trip assertion isn't vacuously true).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalance[]>;
    };
  };
};

async function omtSystemUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "OMT_System")?.usdBalance ?? 0;
  });
}

/** OMT supplier's ledger balance (USD) — the second ledger a RECEIVE moves,
 *  matched by identity (`provider === "OMT"`), never row position. */
async function omtSupplierUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const omt = (await w.api.suppliers.list("", true)).find(
      (s) => s.provider === "OMT",
    );
    if (!omt) throw new Error("OMT supplier not found");
    const bal = (await w.api.suppliers.getBalances(true)).find(
      (b) => b.supplier_id === omt.id,
    );
    return bal?.total_usd ?? 0;
  });
}

test.describe("LIRA-134 — refund an OMT system RECEIVE through the real RefundMethodModal", () => {
  test("untouched defaults: the drawer AND the OMT supplier ledger net to 0 across create+refund", async ({
    appPage,
  }) => {
    // An active session would route this into the basket instead of
    // submitting directly.
    await closeAllActiveSessions(appPage);

    const ts = Date.now();
    const RECEIVER_NAME = `L134 Refund Receiver ${ts}`;

    // ── Create a plain OMT system RECEIVE through the real Services form ──
    await navigateTo(appPage, "/omt-whish");

    const omtReceiveTile = appPage
      .locator("button")
      .filter({ hasText: /OMT/ })
      .filter({ hasText: /↓/ })
      .first();
    await expect(omtReceiveTile).toBeVisible({ timeout: 15_000 });
    await omtReceiveTile.click();

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill("100");

    // The fee is shown (drives the commission calc) but D1 never collects
    // or deducts it for OMT — typing it must NOT open a counter-flow leg.
    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // Guard: the Phase C counter-flow card is WHISH-only after D1 — it must
    // not render for OMT even with a nonzero fee typed.
    await expect(
      appPage.getByTestId("counter-flow-section"),
    ).toHaveCount(0);

    const receiverNameInput = appPage.locator("#service-receiver-name");
    await expect(receiverNameInput).toBeVisible({ timeout: 5_000 });
    await receiverNameInput.fill(RECEIVER_NAME);

    const drawerBaseline = await omtSystemUsd(appPage);
    const ledgerBaseline = await omtSupplierUsd(appPage);

    await appPage.getByRole("button", { name: /Record Receive/i }).click();
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    // Sanity: creation actually moved money — payout is the FULL $100, not
    // netted by the $5 fee (D1: the fee never touches the drawer for OMT).
    // Guards against the round-trip assertion below passing vacuously
    // because nothing happened.
    await expect
      .poll(async () => (await omtSystemUsd(appPage)) - drawerBaseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(-100, 2);
    // The OMT supplier ledger moved too — the provider owes the shop the
    // full principal (RECEIVE_FEE_MODEL_CUTOVER), a second ledger this
    // refund must also reverse.
    await expect
      .poll(async () => (await omtSupplierUsd(appPage)) - ledgerBaseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(-100, 2);

    // ── Locate the row on /audit and open the REAL refund modal ───────────
    // Bounce through "/" for a fresh mount (README convention — a parked
    // viewer shows a stale list).
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const row = appPage
      .locator("tbody tr")
      .filter({ hasText: RECEIVER_NAME })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const refundBtn = row.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();

    // This row has ONE real customer-facing leg (the payout — D1 removed
    // the fee leg for OMT), but `handleRefund`'s gate is "any legs exist",
    // not "more than one" — so this must still open the tender-selection
    // modal, never the plain confirm() fallback.
    let sawDialog = false;
    appPage.once("dialog", (d) => {
      sawDialog = true;
      d.accept().catch(() => {});
    });

    await refundBtn.click();

    const modal = appPage.getByTestId("counterparty-settle-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(
      appPage.getByText("Refund — Choose Return Method"),
    ).toBeVisible();
    expect(sawDialog, "the modal path must not raise a confirm() dialog").toBe(
      false,
    );

    // Untouched defaults (the task's exact instruction): the single-line
    // mount-sync effect in MultiPaymentInput already fired `onChange` with
    // the pre-filled CASH/$100 line the instant the modal mounted — Confirm
    // is enabled with ZERO operator interaction beyond the click below.
    const confirmBtn = appPage.getByRole("button", { name: "Confirm Refund" });
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
    await confirmBtn.click();

    await expect(modal).not.toBeVisible({ timeout: 15_000 });

    // ── The reversal-symmetry proof (rule 20): back to the pre-creation
    // baseline for BOTH ledgers this transaction touched. ──────────────────
    await expect
      .poll(async () => (await omtSystemUsd(appPage)) - drawerBaseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(0, 2);
    await expect
      .poll(async () => (await omtSupplierUsd(appPage)) - ledgerBaseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(0, 2);
  });
});
