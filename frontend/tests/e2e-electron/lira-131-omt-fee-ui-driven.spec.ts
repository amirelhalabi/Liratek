/**
 * E2E: LIRA-131 — the OMT system fee flows driven through the REAL Services
 * form, not a hand-built IPC payload.
 *
 * WHY THIS SPEC EXISTS. On 2026-07-30 the owner hand-tested a fee-included OMT
 * SEND and hit a hard reject:
 *
 *   "OMT SEND: payment legs do not reconcile — expected $99.00 USD-equivalent
 *    ($99.00 + 0 LBP), got $100.00 USD-equivalent (IN $100.00, OUT $0.00,
 *    kept $0.00), diff $1.00"
 *
 * 2344 unit tests and 284 e2e were green at the time. They could not see it,
 * for a structural reason worth stating plainly: 42 of the 84 desktop specs —
 * including EVERY OMT/Whish money spec (lira-074, lira-076, lira-077) — call
 * `window.api.omt.addTransaction(...)` with a hand-written object and never
 * touch a UI locator. Such specs verify the repository's contract with ITSELF.
 * They can never catch a mismatch across the frontend↔repository seam.
 *
 * That seam is exactly where the bug lived: the form back-calculates
 * `sentAmount = budget − fee` before the IPC call, and the repository was
 * subtracting the fee a SECOND time. Two layers, same subtraction, no test
 * crossing the boundary.
 *
 * So this spec types into the real inputs, ticks the real toggle, and clicks
 * the real button — the payload is whatever the page actually builds. It is
 * the only shape of test that covers the seam.
 *
 * MONEY INVARIANTS UNDER GUARD (float model, owner-confirmed 2026-07-29):
 *   SEND fee-on-top   : payment drawer +(x+f), system float −x
 *   SEND fee-included : payment drawer +x,     system float −(x−f)
 *   RECEIVE           : system float +x,       payout drawer −(x−f) when the
 *                       fee is included in the received amount
 * Σ(drawer deltas) = +f in every case — the fee is the only value created.
 *
 * Rule 15 discipline: every assertion is a DELTA snapshotted immediately
 * before the action, matched by drawer NAME. No absolute totals, no row
 * positions, no `getRecent()[0]` — this suite shares one accumulating DB.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

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

/** Named drawer balances — matched by name, never by position (rule 15). */
async function drawers(
  page: Page,
): Promise<{ general: number; omtSystem: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pick = (n: string) =>
      rows.find((d) => d.name === n)?.usdBalance ?? 0;
    return { general: pick("General"), omtSystem: pick("OMT_System") };
  });
}

/** Select the OMT tile for a direction: ↑ = SEND, ↓ = RECEIVE. */
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

test.describe("LIRA-131 — OMT system fees, driven through the real form", () => {
  test("SEND fee-on-top: till gains the full x+f, float pays only the principal x", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/services");
    await pickOmt(appPage, "SEND");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill("100");

    // Explicit fee so the tier auto-lookup cannot make this non-deterministic.
    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // Fee-included toggle deliberately LEFT OFF — the customer pays 100 + 5.
    const before = await drawers(appPage);

    await appPage.getByRole("button", { name: /Record Send/i }).click();
    // A successful submit clears the amount; a rejected one leaves it filled.
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const after = await drawers(appPage);

    // Customer's cash STAYS in the till: +(x+f). Pre-float-model a "Cash
    // reserve for settlement" row removed it again and this netted to 0.
    expect(after.general - before.general).toBeCloseTo(105, 2);
    // The float pays the far end the principal only.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(-100, 2);
    // Σ = +f: the fee is the only value the shop created.
    expect(
      after.general - before.general + (after.omtSystem - before.omtSystem),
    ).toBeCloseTo(5, 2);
  });

  test("SEND fee-included: the owner's reported hard-reject — budget 100 = principal 95 + fee 5", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/services");
    await pickOmt(appPage, "SEND");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill("100");

    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // THE TOGGLE. The form now back-calculates sentAmount = 100 − 5 = 95 and
    // sends amount=95 with a 100 customer leg. The repository must NOT net the
    // fee again — doing so made it expect a $95 leg against the real $100 and
    // hard-reject every fee-included SEND in the app.
    const toggle = appPage.getByTestId("service-including-fees-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.check();

    const before = await drawers(appPage);

    await appPage.getByRole("button", { name: /Record Send/i }).click();

    // The canonical failing-first assertion: pre-fix this submit was REJECTED,
    // so the amount field never cleared.
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const after = await drawers(appPage);

    // Customer handed over their whole budget.
    expect(after.general - before.general).toBeCloseTo(100, 2);
    // Float pays the principal: −95. NOT −90 (that was the second, latent
    // half of the same defect, hidden behind the reject).
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(-95, 2);
    // Σ = +f again — same fee, different split between the two drawers.
    expect(
      after.general - before.general + (after.omtSystem - before.omtSystem),
    ).toBeCloseTo(5, 2);
  });

  test("RECEIVE with a fee: float FILLS by the full x, customer collects x−f", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/services");
    await pickOmt(appPage, "RECEIVE");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill("100");

    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // Fee withheld from the received amount — the customer collects the net.
    const toggle = appPage.getByTestId("service-including-fees-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.check();

    const before = await drawers(appPage);

    await appPage.getByRole("button", { name: /Record Receive/i }).click();
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const after = await drawers(appPage);

    // A RECEIVE FILLS the float — credit the shop can immediately spend on a
    // future send (owner's words, 2026-07-29). Pre-float-model this went
    // NEGATIVE by the transfer amount.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(100, 2);
    // Customer collects the net of the withheld fee.
    expect(after.general - before.general).toBeCloseTo(-95, 2);
    expect(
      after.general - before.general + (after.omtSystem - before.omtSystem),
    ).toBeCloseTo(5, 2);
  });
});
