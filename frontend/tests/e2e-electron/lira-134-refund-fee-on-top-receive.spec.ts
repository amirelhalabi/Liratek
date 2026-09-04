/**
 * E2E: LIRA-134 — refund of a fee-on-top RECEIVE, driven through the REAL
 * `RefundMethodModal`, not a hand-built IPC payload.
 *
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.3 item (ii): Phase B's reversal-
 * symmetry fix (`TransactionRepository.refundFeeOnTopReceive.test.ts`) is
 * unit-level only — it calls `refundTransaction` directly. No spec drives
 * the actual /audit "Refund" button + modal for a transaction that carries
 * TWO customer-facing legs (the payout AND the customer-paid fee), which is
 * exactly the shape `buildDefaultRefundLines` had to special-case (picking
 * the LARGEST-magnitude leg's method as the default return method, not
 * "first leg wins" — plan §2 bug 4).
 *
 * Setup: an OMT system RECEIVE, amount $100, fee $5, fee-on-top
 * (`includingFees` left unchecked) — created through the real Services
 * form (same pattern as lira-131). The Phase C counter-flow section
 * auto-seeds a CASH fee leg with no operator interaction needed, so this
 * transaction ends up with two CASH legs: payout −100, fee +5 — both routed
 * to the OMT_System primary cash drawer (`resolveServiceCashDrawer`, CASH +
 * primary provider).
 *
 * The refund itself is driven through the real `RefundMethodModal` with
 * UNTOUCHED defaults (per the task): `buildDefaultRefundLines` picks the
 * payout leg's method (CASH, the larger magnitude) and prefills the return
 * amount at the net (|−100 + 5| = 95); `MultiPaymentInput`'s single-line
 * mount-sync auto-fires `onChange` with exactly that line, so the modal's
 * Confirm button is enabled without the operator touching anything — the
 * same contract `linesMatchDefault` uses to send NO override, keeping this
 * a byte-identical mirror-reversal of the original legs.
 *
 * Rule 15/20: every assertion is a DELTA. The spec snapshots the ONE drawer
 * this transaction ever touches (OMT_System) BEFORE the RECEIVE is created,
 * and asserts it nets back to that same baseline after the refund — proving
 * create+reverse nets to 0 (rule 20) — while also proving the creation step
 * itself was non-trivial (so the round-trip assertion isn't vacuously true).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
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

test.describe("LIRA-134 — refund a fee-on-top RECEIVE through the real RefundMethodModal", () => {
  test("untouched defaults: every drawer this transaction touched nets to 0 across create+refund", async ({
    appPage,
  }) => {
    // A fee-on-top RECEIVE with an active session would route into the
    // basket instead of submitting directly (the Phase C counter-flow is
    // also hidden inside a session) — make sure none is active.
    await closeAllActiveSessions(appPage);

    const ts = Date.now();
    const RECEIVER_NAME = `L134 Refund Receiver ${ts}`;

    // ── Create the fee-on-top RECEIVE through the real Services form ──────
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

    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // includingFees toggle left OFF — fee-on-top. The Phase C counter-flow
    // card renders automatically and auto-seeds a CASH leg at the fee; no
    // interaction needed for the setup half of this spec.
    await expect(appPage.getByTestId("counter-flow-section")).toBeVisible({
      timeout: 10_000,
    });

    const receiverNameInput = appPage.locator("#service-receiver-name");
    await expect(receiverNameInput).toBeVisible({ timeout: 5_000 });
    await receiverNameInput.fill(RECEIVER_NAME);

    const baseline = await omtSystemUsd(appPage);

    await appPage.getByRole("button", { name: /Record Receive/i }).click();
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    // Sanity: creation actually moved money — payout −100 + fee +5 = −95.
    // Guards against the round-trip assertion below passing vacuously
    // because nothing happened.
    await expect
      .poll(async () => (await omtSystemUsd(appPage)) - baseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(-95, 2);

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

    // This row has TWO real customer-facing legs (payout + fee), so
    // `handleRefund` must open the tender-selection modal, never the plain
    // confirm() fallback — assert no confirm() dialog appears at all.
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
    // the pre-filled CASH/$95 line the instant the modal mounted — Confirm
    // is enabled with ZERO operator interaction beyond the click below.
    const confirmBtn = appPage.getByRole("button", { name: "Confirm Refund" });
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
    await confirmBtn.click();

    await expect(modal).not.toBeVisible({ timeout: 15_000 });

    // ── The reversal-symmetry proof (rule 20): back to the pre-creation
    // baseline for the ONE drawer this transaction ever touched. ──────────
    await expect
      .poll(async () => (await omtSystemUsd(appPage)) - baseline, {
        timeout: 10_000,
      })
      .toBeCloseTo(0, 2);
  });
});
