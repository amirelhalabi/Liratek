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
 * `OMT_System` is no longer a provider-side float that mirrors every move —
 * it is the physical cash drawer at the money-transfer counter, so exactly
 * ONE drawer moves per transaction and it is never General.
 *
 * RE-DERIVED 2026-09-23 for owner decision D1 (`docs/plans/todo_plans/
 * OWNER_NOTES_2026-09-21.md` §2b, case matrix row 1, migration v180):
 *
 *   RECEIVE (OMT system) : fee ALWAYS SHOWN (drives the commission estimate
 *                           only), NEVER collected, NEVER deducted —
 *                           PCD −x (the FULL principal), General UNTOUCHED.
 *
 * OLD rule this spec used to guard on RECEIVE (now removed, both from core
 * and from the UI): a "Fee included in payout" toggle let the operator
 * choose fee-on-top (customer collects x, separately pays f) vs
 * fee-included (customer collects x−f); a fee-on-top RECEIVE could also
 * route its fee through a real drawer-affecting method via a counter-flow
 * section (`MultiPaymentInput`'s `counterFlow` prop), including a wallet
 * other than cash. D1 deletes BOTH: `Services/index.tsx`'s "Including Fees
 * Checkbox" block now renders only for `(OMT, SEND)` or `(WHISH, RECEIVE)`
 * — never `(OMT, RECEIVE)` — and `showFeeCounterFlow` is now WHISH-only.
 * `FinancialServiceRepository.createTransaction` backs this with a
 * hard-reject: an OMT RECEIVE carrying `includingFees: true` or a non-empty
 * `feePayments` is refused outright (see lira-web-017 for the REST-level
 * proof of that guard). The third test below (previously "RECEIVE with a
 * fee: float FILLS by the full x, customer collects x−f") is rewritten to
 * prove the OPPOSITE — fee shown, payout is the full x, no drawer effect
 * from the fee at all. The fourth test (previously a Whish-wallet
 * counter-flow acceptance case) is rewritten into a guard that the old path
 * is NOT reachable from the UI anymore (rule 24): neither the toggle nor
 * the counter-flow section renders for OMT RECEIVE, regardless of the fee
 * typed in.
 *
 * The old "Σ(drawer deltas) = +f" identity is GONE, and its absence is the
 * clearest statement of what changed: under the float model the principal
 * left the float as fast as it entered the till, so the drawers netted to the
 * fee. Now the principal STAYS in the drawer as real banknotes, and what
 * balances it is the supplier ledger (`Σ drawer − Δ owed = commission`,
 * guarded with the ledger in view by lira-076). Asserting a drawer-only sum
 * here would be asserting half an equation.
 * UPDATE (2026-08-29, COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2, D1): the
 * ledger-side identity above was `Σ drawer − Δ owed = 0` for SEND. RE-UPDATE
 * (2026-09-23, D1 owner decision): for an OMT RECEIVE the identity is now
 * simply `Σ drawer = Δ owed` with no fee term anywhere — the fee never
 * enters either side of the equation. See lira-076 and
 * OmtSystemFeeCharacterization.test.ts for the re-derived numbers; this
 * spec's own assertions are drawer-only and unaffected either way.
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
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ supplier_id: number; total_usd: number }>>;
    };
  };
};

/** Named drawer balances — matched by name, never by position (rule 15). */
async function drawers(
  page: Page,
): Promise<{ general: number; omtSystem: number; whishApp: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pick = (n: string) => rows.find((d) => d.name === n)?.usdBalance ?? 0;
    return {
      general: pick("General"),
      omtSystem: pick("OMT_System"),
      whishApp: pick("Whish_App"),
    };
  });
}

/** The OMT supplier's USD balance ("what we owe OMT") — identity via
 *  provider, never position (rule 15), mirrors lira-076's own helper. */
async function omtOwedUsd(page: Page): Promise<number> {
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
    await navigateTo(appPage, "/omt-whish");
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
    await navigateTo(appPage, "/omt-whish");
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

  test("RECEIVE: the fee is shown for the commission estimate only — payout is the FULL x, PCD −x, OMT is owed the full x (D1, 2026-09-23)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/omt-whish");
    await pickOmt(appPage, "RECEIVE");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill("100");

    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("5");

    // D1: the informational note replaces any on-top/deducted choice for an
    // OMT RECEIVE — it renders unconditionally once serviceType is RECEIVE,
    // right under the (still-visible, still-editable) fee input.
    await expect(
      appPage.getByTestId("service-omt-receive-fee-informational-note"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      appPage.getByTestId("service-omt-receive-fee-informational-note"),
    ).toContainText("doesn't affect your drawer or what's owed to OMT");

    // The "Including Fees Checkbox" block (on-top vs deducted) no longer
    // renders at all for (OMT, RECEIVE) — it's (OMT, SEND) or (WHISH,
    // RECEIVE) only now (Services/index.tsx). Confirmed absent before
    // relying on that fact for the rest of this test.
    await expect(
      appPage.getByTestId("service-including-fees-toggle"),
    ).toHaveCount(0);

    const beforeD = await drawers(appPage);
    const beforeOwed = await omtOwedUsd(appPage);

    await appPage.getByRole("button", { name: /Record Receive/i }).click();
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const afterD = await drawers(appPage);
    const afterOwed = await omtOwedUsd(appPage);

    // The payout is the FULL requested amount — the $5 fee never reduces
    // what the customer collects, and never posts a separate collection
    // leg either: -100, not -95.
    expect(afterD.omtSystem - beforeD.omtSystem).toBeCloseTo(-100, 2);
    // The till is untouched, exactly as before D1 (the payout never came
    // from General).
    expect(afterD.general - beforeD.general).toBeCloseTo(0, 2);
    // Nor does the fee land in any wallet drawer — there is no fee leg to
    // route anywhere for an OMT RECEIVE under D1.
    expect(afterD.whishApp - beforeD.whishApp).toBeCloseTo(0, 2);
    // supplier_ledger: OMT is owed the FULL principal regardless of the fee
    // (`grossOwedDelta`'s RECEIVE_FEE_MODEL_CUTOVER branch returns
    // `-principal` unconditionally — the fee term never enters the
    // formula). -100, not -(100-5) = -95.
    expect(afterOwed - beforeOwed).toBeCloseTo(-100, 2);
    // NOTE (owner decision 2026-08-01, unaffected by D1): this payout is NOT
    // blocked when the drawer cannot cover it — the balance is simply
    // allowed to go negative, which the transfer modal then flags for the
    // operator to cover.
  });

  test("RECEIVE: the old fee-collection counter-flow is GONE from the UI — no toggle, no counter-flow section, regardless of the fee typed (D1 guard)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/omt-whish");
    await pickOmt(appPage, "RECEIVE");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    // Different amount from the previous test — keeps this test's drawer
    // delta unambiguous (rule 15 identity) if run adjacent to it.
    await amountInput.fill("60");

    const feeInput = appPage.getByTestId("service-omt-fee-input");
    await expect(feeInput).toBeVisible({ timeout: 10_000 });
    await feeInput.fill("6");

    // OLD behaviour this test used to prove: filling a RECEIVE fee here made
    // the "Customer pays — OMT fee" counter-flow section
    // (`counter-flow-section`) appear, letting the operator route the fee's
    // collection through any drawer-affecting method (this file's own prior
    // version switched it to Whish). D1 (`showFeeCounterFlow` is now
    // `provider === "WHISH"` only) removes that entirely for OMT — assert
    // it's simply not in the DOM, not just hidden, so a regression that
    // brings it back can't hide behind a visibility check alone.
    await expect(appPage.getByTestId("counter-flow-section")).toHaveCount(0);
    // And the on-top/deducted toggle is equally absent (same assertion as
    // the previous test, re-proven here with a fee actually typed in, to
    // rule out a fee-value-gated regression the previous test's blank-typed
    // check wouldn't catch).
    await expect(
      appPage.getByTestId("service-including-fees-toggle"),
    ).toHaveCount(0);

    const beforeD = await drawers(appPage);
    const beforeOwed = await omtOwedUsd(appPage);

    await appPage.getByRole("button", { name: /Record Receive/i }).click();
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const afterD = await drawers(appPage);
    const afterOwed = await omtOwedUsd(appPage);

    // With no fee-collection UI reachable at all, the submit still succeeds
    // (the fee stays purely informational) and books exactly the same shape
    // as the plain case above: full payout, no fee leg anywhere.
    expect(afterD.omtSystem - beforeD.omtSystem).toBeCloseTo(-60, 2);
    expect(afterD.general - beforeD.general).toBeCloseTo(0, 2);
    expect(afterD.whishApp - beforeD.whishApp).toBeCloseTo(0, 2);
    expect(afterOwed - beforeOwed).toBeCloseTo(-60, 2);
  });
});
