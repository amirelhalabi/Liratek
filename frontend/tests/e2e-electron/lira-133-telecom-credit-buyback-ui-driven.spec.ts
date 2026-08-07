/**
 * E2E: CARRIER_LINES_VALIDITY_PLAN.md Phase 6 — shop-line credit buy-back,
 * driven through the REAL Recharge → MTC → Credit tab UI (not a hand-built
 * IPC payload).
 *
 * WHY THIS SPEC EXISTS (mirrors lira-131's rationale). The shop-line
 * detection (`isSameLebanesePhone` comparison lifted into Recharge/index.tsx
 * and threaded down as `isShopLineMatch`), the Credit tab's UI flip
 * ("Proceed to Pay Out" / "Confirm Cashout" / "Price to Customer"), and the
 * PaymentSheet's `paymentMethods` filter + `autoDebtRemainder`/
 * `requiresClientForDebt` overrides all live in TelecomForm.tsx /
 * Recharge/index.tsx — the frontend↔repository seam a hand-built IPC payload
 * can never exercise. lira-131's header records that 42 of 84 desktop specs
 * call `window.api.*` directly and verify the repository against itself; this
 * spec types a phone number that matches a seeded primary MTC carrier line
 * into the real `#telecom-phone` input and asserts the UI actually flips
 * BEFORE the IPC call ever happens.
 *
 * Rule 15 throughout: identity via a distinctive credits face value (no
 * other spec in this shared-DB suite creates a TELECOM_CREDIT_BUYBACK row),
 * deltas snapshotted immediately before the action, never absolute totals or
 * row position.
 *
 * Rule 17 (NOT YET RUN — flagged for the orchestrating session, which runs
 * `yarn dev` → stop → `yarn test:e2e`, forbidden in this pass): this spec is
 * only a guard once shown failing against the pre-fix code. The predicted
 * failing-first procedure is to temporarily force `isShopLineMatch` to
 * `false` in `TelecomForm.tsx` (or pass `isShopLineMatch={false}` at its
 * call site in `Recharge/index.tsx`) — the "Proceed to Pay Out" /
 * `shop-line-buyback-note` assertions right after typing the phone number
 * should then fail (the form stays in its normal sell shape), and the
 * submit would go through `processRecharge`'s ordinary CREDIT_TRANSFER path
 * instead of `processCreditBuyback` — a completely different money
 * direction, so the drawer/line delta assertions would fail differently too.
 * Revert after confirming.
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
    carrierLines: {
      create: (data: {
        carrier: "alfa" | "mtc";
        phone_number: string;
        label?: string | null;
        credits?: number;
      }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      setPrimary: (id: number) => Promise<{ success: boolean; error?: string }>;
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: Array<{
          id: number;
          carrier: "alfa" | "mtc";
          credits: number;
          is_active: number;
        }>;
        error?: string;
      }>;
    };
  };
};

/**
 * §0.1's sum invariant, read directly (not re-derived): Σ credits of active
 * lines for a carrier, computed the SAME way
 * `CarrierLineRepository.getCarrierCreditsSum` does. Used instead of a
 * before/after DRAWER delta because the shared e2e DB accumulates drift
 * between the MTC drawer and Σ(lines) from every OTHER spec's grandfathered
 * paths (recharge sales/top-ups move the drawer without ever touching a
 * line — §0.6, Outbound Ticket D) — a buy-back is a NEW path that resyncs
 * the drawer to the true sum on every run (by design), so by the time this
 * spec executes deep into the full suite, that resync absorbs however much
 * OTHER specs had already drifted, not just this transaction's own credits.
 * The line's OWN credits delta (asserted separately, keyed by lineId) stays
 * exact regardless of that drift; asserting the drawer against the sum
 * (rather than against its own past value) is the version of the invariant
 * that is actually true here.
 */
async function activeCreditsSum(
  page: Page,
  carrier: "alfa" | "mtc",
): Promise<number> {
  return page.evaluate(async (c) => {
    const w = window as unknown as Api;
    const res = await w.api.carrierLines.getAllAdmin();
    const rows = res.success ? (res.data ?? []) : [];
    return rows
      .filter((r) => r.carrier === c && r.is_active === 1)
      .reduce((sum, r) => sum + r.credits, 0);
  }, carrier);
}

/** Named drawer balances — matched by name, never by position (rule 15). */
async function drawers(
  page: Page,
): Promise<{ mtcUsd: number; generalLbp: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pick = (n: string, cur: "usd" | "lbp") => {
      const row = rows.find((d) => d.name === n);
      return cur === "usd" ? (row?.usdBalance ?? 0) : (row?.lbpBalance ?? 0);
    };
    return { mtcUsd: pick("MTC", "usd"), generalLbp: pick("General", "lbp") };
  });
}

/** Seed a fresh primary MTC carrier line via IPC (same create+setPrimary
 *  path Settings/lira-125/lira-132 use) and return its id + starting
 *  credits so the test can track its delta by identity, not by row
 *  position.
 *
 *  `creditsBefore` MUST be 0: `carrierLines.create` never touches the
 *  provider drawer (only Setup/the Recharge panel's `updateBalance` path
 *  does that sync, per §0.5/§0.6) — seeding a nonzero starting balance here
 *  would leave the LINE ahead of the DRAWER by that amount, and the
 *  buy-back's drawer-follows-sum reconciliation (§0.1, correctly) would then
 *  "catch up" that pre-existing gap on top of the credits actually bought
 *  back, inflating the observed drawer delta by exactly the seeded amount.
 *  (Caught by a real run of this spec: seeding 20 produced a 33.37 delta
 *  for a 13.37 buy-back — the repository was right, this seed value was
 *  wrong.) */
async function seedPrimaryMtcLine(
  page: Page,
  phone: string,
): Promise<{ id: number; creditsBefore: number }> {
  const creditsBefore = 0;
  const created: { success: boolean; data?: { id: number }; error?: string } =
    await page.evaluate(
      async ({ p, credits }) => {
        return window.api.carrierLines.create({
          carrier: "mtc",
          phone_number: p,
          label: `E2E-133-${p}`,
          credits,
        });
      },
      { p: phone, credits: creditsBefore },
    );
  if (!created.success || !created.data) {
    throw new Error(`Failed to create carrier line: ${created.error}`);
  }
  const setPrimaryRes: { success: boolean; error?: string } =
    await page.evaluate(
      async (id) => window.api.carrierLines.setPrimary(id),
      created.data.id,
    );
  if (!setPrimaryRes.success) {
    throw new Error(`Failed to set primary line: ${setPrimaryRes.error}`);
  }
  return { id: created.data.id, creditsBefore };
}

async function readCarrierLineCredits(page: Page, id: number): Promise<number> {
  return page.evaluate(async (lineId) => {
    const w = window as unknown as Api;
    const res = await w.api.carrierLines.getAllAdmin();
    const rows = res.success ? (res.data ?? []) : [];
    return rows.find((r) => r.id === lineId)?.credits ?? 0;
  }, id);
}

test.describe("CARRIER_LINES_VALIDITY_PLAN.md Phase 6 — telecom credit buy-back (UI-driven)", () => {
  test("typing the shop's own MTC line flips the Credit tab to a buy-back; a CASH cashout moves the drawer + the line, and Void nets everything back to zero", async ({
    appPage,
  }) => {
    const phone = `03${Date.now().toString().slice(-6)}`;
    const CREDITS = 13.37; // distinctive — no other spec mints this type
    const PAYOUT_LBP = 543_210;

    const { id: lineId, creditsBefore } = await seedPrimaryMtcLine(
      appPage,
      phone,
    );

    // Force a fresh mount of MobileRecharge/TelecomForm so the (lifted)
    // primaryLine fetch in Recharge/index.tsx runs AFTER the line above
    // exists. That fetch is keyed on `activeProvider`, not a live
    // subscription — re-visiting an already-mounted page would otherwise
    // keep serving a stale (pre-seed) primaryLine.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/recharge");

    // MTC + Credit tab is the default landing state.
    const phoneInput = appPage.locator("#telecom-phone");
    await expect(phoneInput).toBeVisible({ timeout: 15_000 });
    await phoneInput.fill(phone);

    // ── The seam this spec exists to prove: the UI detects the shop's own
    // line and flips, BEFORE any IPC call happens. ────────────────────────
    await expect(appPage.getByTestId("shop-line-buyback-note")).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText("Price to Customer")).toBeVisible();
    const submitBtn = appPage.getByRole("button", {
      name: /Proceed to Pay Out/i,
    });
    await expect(submitBtn).toBeVisible();

    await appPage.locator("#telecom-amount").fill(String(CREDITS));
    await appPage.locator("#telecom-price").fill(String(PAYOUT_LBP));

    const before = await drawers(appPage);
    const beforeCredits = await readCarrierLineCredits(appPage, lineId);
    expect(beforeCredits).toBeCloseTo(creditsBefore, 2);
    // Snapshotted BEFORE the submit — this is the independent baseline the
    // review-finding #3 fix below derives its expectation from, not a value
    // the code under test computes as part of producing `after.mtcUsd`.
    const sumBefore = await activeCreditsSum(appPage, "mtc");

    await submitBtn.click();

    const confirmBtn = appPage.getByRole("button", {
      name: /Confirm Cashout/i,
    });
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    // A successful submit clears the amount field (handleTelecomSubmit's
    // reset path); a rejected one leaves it filled — lira-131's convention.
    await expect(appPage.locator("#telecom-amount")).toHaveValue("", {
      timeout: 15_000,
    });

    const after = await drawers(appPage);
    const afterCredits = await readCarrierLineCredits(appPage, lineId);
    const sumAfter = await activeCreditsSum(appPage, "mtc");

    // §0.1's actual invariant: the drawer equals Σ(active mtc lines) — NOT
    // "the drawer's own prior value + CREDITS". This suite's shared,
    // accumulating DB means OTHER specs' grandfathered paths (recharge
    // sales/top-ups moving the drawer with no line attribution, §0.6) may
    // have already drifted the MTC drawer away from the line sum long
    // before this spec ever runs; a buy-back resyncs the drawer to the true
    // sum on every transaction (by design), so it absorbs that pre-existing
    // drift too. Asserting against the CURRENT sum — not a delta from this
    // spec's own "before" snapshot — is the version of the invariant that
    // holds regardless of how much other specs have already drifted it.
    //
    // Review finding #3: kept AS a real self-consistency check (drawer ==
    // Σlines is still worth asserting), but it is NOT sufficient alone —
    // `sumAfter` is read via the exact same Σ query the repository itself
    // used to SET the drawer, from the same committed transaction, so this
    // one line passes by construction whenever the repository's
    // "set drawer = Σlines" code path runs at all, regardless of whether the
    // credits amount fed into it was itself correct (a units/rate bug that
    // corrupted the credited amount would leave the drawer and the sum
    // wrong together, in lockstep, and this assertion would never notice).
    expect(after.mtcUsd).toBeCloseTo(sumAfter, 2);
    // The primary line itself gained exactly the credits bought back (D9:
    // this is the ONLY thing that should have moved on the line — validity
    // is untouched) — keyed by lineId, so unaffected by any other line's
    // drift.
    expect(afterCredits - beforeCredits).toBeCloseTo(CREDITS, 2);
    // Review finding #3's actual fix: an assertion on the DRAWER that is
    // independent of the repository's own post-transaction sum computation.
    // `sumBefore` is a snapshot taken BEFORE the submit — a fixed, external
    // fact, not something the code under test computed to produce
    // `after.mtcUsd` — combined with the test's OWN hardcoded `CREDITS`
    // input (the same pattern as the `afterCredits`/`generalLbp` deltas
    // above). Since this spec's own action is the only thing that can move
    // any mtc line's credits between the two snapshots, Σlines must have
    // grown by EXACTLY `CREDITS` — so the drawer, which is supposed to
    // track that sum, must land at `sumBefore + CREDITS` too. A units/rate
    // bug that credited the wrong amount would move `sumAfter` (and thus
    // `after.mtcUsd`, which tracks it) away from this fixed, hardcoded
    // target — unlike the `sumAfter`-relative assertion above, this one
    // cannot pass "in lockstep" with a wrong credited amount. Proven per
    // rule 17: temporarily multiplying `credits` by a wrong constant inside
    // `RechargeRepository.processCreditBuyback` made this assertion fail
    // (while the `after.mtcUsd ≈ sumAfter` line above kept passing) before
    // being reverted.
    expect(after.mtcUsd).toBeCloseTo(sumBefore + CREDITS, 2);
    // The CASH payout leg debits General LBP — an ordinary IN leg with no
    // `direction` key (D7), NOT the change-leg OUT loop.
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(-PAYOUT_LBP, 0);

    // ── Void from the Audit page — every ledger nets back to zero ────────
    // Identity match (rule 15): the void reversal row's OWN summary is
    // `VOID: <original summary>`, which still contains the same credits
    // substring — filtering it back OUT is what keeps this locator matching
    // exactly the original row both before AND after the void click below.
    await navigateTo(appPage, "/audit");
    const row = appPage
      .locator("tbody tr")
      .filter({ hasText: `+$${CREDITS} credits` })
      .filter({ hasNotText: "VOID:" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const voidBtn = row.getByRole("button", { name: /^Void$/ });
    await expect(voidBtn).toBeVisible();
    // Dialogs auto-accept globally per fixtures.ts.
    await voidBtn.click();
    await expect(row).toContainText("VOIDED", { timeout: 10_000 });

    const afterVoid = await drawers(appPage);
    const afterVoidCredits = await readCarrierLineCredits(appPage, lineId);
    expect(afterVoid.mtcUsd - before.mtcUsd).toBeCloseTo(0, 2);
    expect(afterVoidCredits - beforeCredits).toBeCloseTo(0, 2);
    expect(afterVoid.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
  });
});
