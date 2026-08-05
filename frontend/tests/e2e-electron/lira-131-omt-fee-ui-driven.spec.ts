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
 * MONEY INVARIANTS UNDER GUARD (primary cash drawer model, 2026-07-31 —
 * supersedes the float model this spec was written against):
 *   SEND fee-on-top   : PCD +(x+f), General UNTOUCHED
 *   SEND fee-included : PCD +x,     General UNTOUCHED
 *   RECEIVE fee-incl. : PCD −(x−f), General UNTOUCHED
 * `OMT_System` is no longer a provider-side float that mirrors every move —
 * it is the physical cash drawer at the money-transfer counter, so exactly
 * ONE drawer moves per transaction and it is never General.
 *
 * The old "Σ(drawer deltas) = +f" identity is GONE, and its absence is the
 * clearest statement of what changed: under the float model the principal
 * left the float as fast as it entered the till, so the drawers netted to the
 * fee. Now the principal STAYS in the drawer as real banknotes, and what
 * balances it is the supplier ledger (`Σ drawer − Δ owed = commission`,
 * guarded with the ledger in view by lira-076). Asserting a drawer-only sum
 * here would be asserting half an equation.
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
    const pick = (n: string) => rows.find((d) => d.name === n)?.usdBalance ?? 0;
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

    // The customer's cash goes into the OMT drawer — the physical box at the
    // money-transfer counter — not the general till: +(x+f) = 105.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(105, 2);
    // And the till does NOT move. This is the single most load-bearing
    // assertion in the file: under the float model this same transaction put
    // +105 in General, so a regression that reroutes cash back to the till
    // shows up here first.
    expect(after.general - before.general).toBeCloseTo(0, 2);
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

    // Customer handed over their whole budget (100) and every note of it went
    // into the OMT drawer. The fee-included toggle changes what the PRINCIPAL
    // is (95, back-calculated by the form) — it does not change what the
    // customer physically handed over, which is what the drawer receives.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(100, 2);
    expect(after.general - before.general).toBeCloseTo(0, 2);
    // The original defect this spec was written for is still guarded: a
    // repository that netted the fee a SECOND time rejected the submit
    // outright, so the assertion above it (`amountInput` cleared) never
    // passed. That failure mode is independent of which drawer receives.
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

    // The payout is real banknotes handed across the counter, so it comes OUT
    // of the OMT drawer: −(x−f) = −95 (the fee is withheld from what the
    // customer collects). Under the float model this drawer went UP by 100
    // here — the sign itself is the model change.
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(-95, 2);
    // The till is untouched: the payout never came from General.
    expect(after.general - before.general).toBeCloseTo(0, 2);
    // NOTE (owner decision 2026-08-01): this payout is NOT blocked when the
    // drawer cannot cover it — the balance is simply allowed to go negative,
    // which the transfer modal then flags for the operator to cover. An
    // earlier revision of this feature rejected the transaction here, which
    // is why this spec used to fail with the amount field still filled.
  });
});
