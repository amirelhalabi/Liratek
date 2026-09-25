/**
 * E2E: LIRA-135 — a same-currency net-negative mixed session basket, driven
 * through the REAL `SessionCheckoutModal` UI (not a hand-built IPC payload).
 *
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.3 item (iii) / §2 bug 2: the
 * payment-widget render-gate used to key off the basket's NET total
 * (`totals.usd > 0 || totals.lbp > 0` — charges minus payouts). A basket
 * with a $50 charge (a custom service) and a $100 same-currency payout
 * nets to −$50, so `MultiPaymentInput` never mounted, `paymentLines` stayed
 * `[]`, and `isPaymentValid` — which compares against the GROSS
 * `combinedTotalUSD` ($50, from `splitBasketCashSides`) — could never be
 * satisfied: Confirm Checkout stayed permanently disabled and the $50
 * charge could never be collected. Phase 0 fixed the gate to read GROSS
 * charge buckets (`chargeUsd > 0 || chargeLbp > 0`).
 *
 * `SessionCheckoutModal.paymentGate.test.tsx` guards this at the unit level
 * with a stubbed `MultiPaymentInput` and a hand-built `cartItems` array
 * (a $50 custom-service charge + a $100 `omt_system` RECEIVE payout) — this
 * spec is its UI-driven twin, built the same way but through the real Custom
 * Services and Recharge (Binance Cash Out) forms while a session is active.
 * Binance is used for the payout leg instead of an OMT/WHISH system RECEIVE
 * purely as an e2e-setup simplification — its fee field has no tier
 * auto-lookup (a bare, deterministic $100 payout with zero fee needs no
 * extra fighting with the fee UI); the render-gate bug and its fix are
 * module-agnostic (`isCashoutItem`/`splitBasketCashSides` treat every
 * cashout module the same way).
 *
 * Both existing mixed-basket specs (`lira-session-payout.spec.ts`,
 * `lira-session-debt-payout-signs.spec.ts`) bypass the modal entirely via
 * `window.api.session.checkout(...)` — neither could ever have caught this
 * bug, since the render gate lives in the React component, not the IPC
 * handler. This is the first mixed-basket spec to drive the modal itself.
 *
 * Rule 15: every money assertion is a DELTA snapshotted immediately before
 * the Confirm Checkout click, compared immediately after — never an
 * absolute drawer total (this suite shares one accumulating DB).
 *
 * UPDATED 2026-09-24 (fix-round finding #6, owner decision #11-A netted
 * session checkout): a Binance cash-out is a General-drawer CASH payout, so
 * it is now netting-eligible against the $50 charge — the render gate this
 * spec guards now correctly does NOT mount MultiPaymentInput for this exact
 * basket (net charge is $0). See the inline comment at the assertion for the
 * updated reasoning; `SessionCheckoutModal.paymentGate.test.tsx`'s
 * SYSTEM-payout basket (never netted) still covers the original gate.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    session: {
      start: (d: {
        customer_name: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } | null }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
  };
};

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

test.describe("LIRA-135 — session checkout, net-negative mixed basket, driven through the real modal", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("$50 charge + $100 same-currency General payout (net −$50): #11-A nets the charge away, Confirm Checkout completes with no widget", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    const ts = Date.now();
    const SERVICE_DESC = `L135 mixed basket charge ${ts}`;

    const sessionId = await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      const started = await w.api.session.start({
        customer_name: name,
        started_by: "admin",
      });
      return started.sessionId ?? (await w.api.session.getActive()).session?.id;
    }, `L135 Mixed Basket Customer ${ts}`);
    expect(sessionId).toBeTruthy();

    // ── Item 1: a $50 charge, via the real Custom Services form ───────────
    await navigateTo(appPage, "/custom-services");
    // Wait for the session context to actually pick up the active session
    // before driving the form — otherwise the page's activeSession is still
    // null at submit time and it takes the STANDALONE path (never adds to
    // the session cart), which is silent (no error, just no cart badge).
    await expect(
      appPage
        .locator("button")
        .filter({ hasText: /Session - / })
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // Hooked by data-testid (not placeholder copy — the owner rewords that text).
    const search = appPage.getByTestId("custom-service-item-search");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(SERVICE_DESC);
    await search.press("Enter");
    await expect(appPage.locator("#svc-description")).toHaveValue(SERVICE_DESC);
    await appPage.locator("#svc-price").fill("50");
    await appPage.getByRole("button", { name: /Submit Service/i }).click();
    await expect(
      appPage.locator("button").filter({ hasText: "items: 1" }),
    ).toBeVisible({ timeout: 10_000 });

    // ── Item 2: a $100 same-currency payout, via the real Recharge
    // (Binance Cash Out) form — a bare cashout item, module
    // "binance_receive", no fee — exactly bug 2's scenario, module-agnostic.
    await navigateTo(appPage, "/recharge");
    await appPage
      .locator("button")
      .filter({ hasText: /^Binance$/ })
      .first()
      .click({ force: true });
    const cryptoAmountInput = appPage.locator("#crypto-amount");
    await expect(cryptoAmountInput).toBeVisible({ timeout: 20_000 });
    await appPage
      .locator("button")
      .filter({ hasText: /^Cash Out$/ })
      .first()
      .click();
    await cryptoAmountInput.fill("100");
    // Fee left untouched (""): unlike OMT/WHISH, Binance's fee field has no
    // tier auto-lookup — the payout stays a clean $100/0-fee without any
    // extra fighting with a fee UI.
    // With a session active, clicking this button adds directly to the
    // cart (bypasses the PaymentSheet entirely — the basket owns payment).
    await appPage
      .getByRole("button", { name: "Confirm Cash Out", exact: true })
      .click();
    await expect(cryptoAmountInput).toHaveValue("", { timeout: 15_000 });
    await expect(
      appPage.locator("button").filter({ hasText: "items: 2" }),
    ).toBeVisible({ timeout: 10_000 });

    // ── Open the session popup: the basket's own GROSS split display
    // already proves charge/payout are tracked separately (splitBasketCashSides,
    // the same helper the checkout modal's render gate consumes). ──────────
    const sessionButton = appPage
      .locator("button")
      .filter({ hasText: /Session - / })
      .first();
    await sessionButton.hover();
    const grossSplit = appPage.getByTestId("session-cart-gross-split");
    await expect(grossSplit).toBeVisible({ timeout: 10_000 });
    await expect(grossSplit).toContainText("$50.00");
    await expect(grossSplit).toContainText("$100.00");

    // ── Open the REAL checkout modal ────────────────────────────────────
    await appPage
      .getByRole("button", { name: /Checkout \(2 items?\)/i })
      .click();
    await expect(appPage.getByText("Session Checkout")).toBeVisible({
      timeout: 10_000,
    });

    // ORIGINAL fix-under-guard (LIRA-135, pre-#11-A): this basket's GROSS
    // charge nets to −$50 and the OLD render gate hid the widget entirely —
    // `queryByTestId` would find nothing and Confirm would stay disabled
    // forever. The render-gate fix made it read the GROSS $50 charge bucket
    // instead, and the widget mounted.
    //
    // Owner decision #11-A (2026-09-24, netted session checkout, applied
    // AFTER this spec was written — fix-round finding #6): a Binance cash-out
    // is a General-drawer CASH payout, so it is now netting-eligible. This
    // basket's $50 charge is fully absorbed into the $100 payout
    // (netCashPayoutAgainstCharge($50 charge, $100 payout) -> $0 still owed,
    // $50 excess payout), so `netChargeUsd` — what the gate and
    // `combinedTotalUSD` now read (never the GROSS charge, see the modal's
    // own comment on that gate) — is 0. There is nothing left to COLLECT:
    // MultiPaymentInput correctly does NOT mount, and Confirm is trivially
    // enabled (`combinedTotalUSD <= 0`). This is the CORRECT #11-A behavior
    // for a General-drawer payout, not a regression of the original
    // render-gate fix — that fix's own guard (`SessionCheckoutModal.
    // paymentGate.test.tsx`) already covers a SYSTEM-payout basket (never
    // netted), which still needs and gets the widget.
    const paymentWidget = appPage.getByTestId("multi-payment-input");
    await expect(paymentWidget).not.toBeVisible();

    // The GROSS payout panel still shows the full $100 — payoutUsd is
    // unaffected by netting, only the leg(s) actually sent are reduced.
    await expect(appPage.getByText("Payout to customer")).toBeVisible();

    const confirmBtn = appPage.getByRole("button", {
      name: "Confirm Checkout",
    });
    await expect(confirmBtn).toBeVisible();
    // No payment collection is needed (net charge is 0) — Confirm is
    // enabled with ZERO extra operator interaction, exactly the
    // untouched-basket contract this modal promises.
    await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });

    const before = await drawers(appPage);

    await confirmBtn.click();

    // Checkout completion signal: the success view replaces the cart/payment
    // form (checkout always closes the session).
    await expect(appPage.getByText("Checkout Complete")).toBeVisible({
      timeout: 15_000,
    });

    const after = await drawers(appPage);

    // Money sanity (rule 15 delta, not the spec's primary ask but cheap to
    // prove once the button is finally clickable): neither item in this
    // basket is on the primary system (custom_service never is; BINANCE
    // never equals baseSystem "OMT"), and Binance is a General-drawer payout
    // (never SYSTEM, binanceCart.ts's SYSTEM_PAYOUT_MODULES), so #11-A's
    // `payoutOrigin: "GENERAL"` forces the single $50 EXCESS leg
    // (netCashPayoutAgainstCharge's `change`, see above) 100% to General —
    // no charge-collection leg is sent at all, since netChargeUsd is 0. Net
    // effect is still the same −$50 the pre-netting GROSS math produced
    // (+$50 collected, −$100 paid out): net −$50. The PCD (OMT_System) is
    // untouched either way — proving no leakage.
    expect(after.general - before.general).toBeCloseTo(-50, 2);
    expect(after.omtSystem - before.omtSystem).toBeCloseTo(0, 2);
    // No explicit "Close" click here: checkout already closed the session
    // server-side (`is_active = 0`), and the success view's parent
    // (`SessionPopupPanel`) unmounts the instant `activeSession` goes null
    // client-side — unrelated to this bug, not asserted either way.
  });
});
