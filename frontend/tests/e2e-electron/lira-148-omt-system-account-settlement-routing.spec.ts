/**
 * E2E: LIRA-148 — an OMT *System* transaction paid on customer account, then
 * settled later, must put the cash in the OMT CASH DRAWER (the PCD), not in
 * General.
 *
 * OWNER QUESTION (2026-08-29). "If we did a transaction on OMT-System but with
 * payment method CUSTOMER_ACCOUNT, and the customer later settled that account
 * debt — does that money come back to the OMT System drawer?"
 *
 * The answer the code gives is YES, and this spec is the proof, walked through
 * the same three screens the owner would use by hand: Dashboard → OMT/Whish
 * (Services) → Debts → Dashboard.
 *
 * THE MECHANISM UNDER GUARD (two files, one invariant):
 *
 *  1. At transaction time, `CUSTOMER_ACCOUNT` is a non-drawer tender, so NO
 *     drawer moves at all — the shop is owed, not paid. Instead
 *     FinancialServiceRepository books a `Service Debt` row against the
 *     client, on a transaction whose `source_table = 'financial_services'`
 *     and `status = 'ACTIVE'` (FinancialServiceRepository.ts, the `debtLegs`
 *     block ~:3137).
 *
 *  2. At settlement, DebtRepository.addRepayment first credits the leg's own
 *     drawer (`CASH` → General), and then a routing block moves that share
 *     OUT of General and INTO `OMT_System` — a `RESERVE` row (General −) plus
 *     an `OMT` row (`OMT_System` +), noted "Move to OMT_System cash drawer".
 *     Routing is per-currency and CAPPED at the client's still-outstanding
 *     system-service debt (DebtRepository.ts ~:593).
 *
 * So the settlement's net effect is: **General 0, OMT_System +total**. The
 * General leg is real but transient — it is credited and routed out inside the
 * same DB transaction, which is exactly why this must be asserted as a DELTA
 * and never as an absolute (rule 15).
 *
 * WHY THIS SPEC EXISTS AT ALL. The routing itself is well covered at the
 * repository layer — nine cases in
 * `packages/core/src/repositories/__tests__/DebtRepository.serviceDebtRouting.test.ts`
 * (outstanding cap, per-currency isolation, refunded debts, voided repayments,
 * split legs). But every one of those cases HAND-INSERTS the
 * `financial_services` and `debt_ledger` rows. Nothing anywhere drives the real
 * OMT form into the real Debts modal, so nothing proves the two halves actually
 * meet: that the form's on-account SEND writes a `Service Debt` row the routing
 * query can still FIND. That join is load-bearing and narrow — it matches on
 * `fs.provider IN ('OMT','WHISH')` — and it is precisely the frontend↔repository
 * seam the suite is structurally blind to (see lira-131's header for the same
 * argument and the bug it caught).
 *
 * SYSTEM vs APP, the distinction the owner drew. The routing query keys on
 * `fs.provider IN ('OMT','WHISH')`, and the Services page's provider union is
 * literally `"OMT" | "WHISH"` — the SYSTEM providers. App transactions are
 * stored under `OMT_APP` / `WISH_APP` and are excluded, so an OMT *App* debt
 * settled later stays in General and never reaches the cash drawer. The second
 * test pins that down: without it, "the settlement went to OMT_System" could be
 * true for the wrong reason (routing everything, rather than routing system
 * debt).
 *
 * Rule 15 discipline: drawer figures are read off the dashboard by NAME
 * (`data-testid="cash-on-hand-<drawer>"`), snapshotted immediately before each
 * action, and asserted as deltas. Clients are uniquely named per run, so the
 * accumulating shared DB cannot leak another spec's debt into the totals.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// This spec asserts on the repayment toast — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

type Api = {
  api: {
    debt: {
      getDebtors: () => Promise<
        Array<{
          client_id: number;
          full_name?: string;
          client_name?: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
    };
  };
};

/**
 * The two USD figures the owner reads off the dashboard's "Cash on Hand"
 * strip. Matched by drawer NAME via test-id, never by position.
 *
 * A zero balance in one currency is filtered out of the strip (the cell shows
 * only the non-zero currencies), so a missing `$` span legitimately means zero
 * — not a broken locator. That is why the cell's visibility is asserted
 * separately from the amount.
 */
async function cashOnHand(
  page: Page,
): Promise<{ general: number; omtSystem: number }> {
  await navigateTo(page, "/");

  const read = async (drawer: string): Promise<number> => {
    const cell = page.getByTestId(`cash-on-hand-${drawer}`);
    await expect(cell).toBeVisible({ timeout: 15_000 });
    const spans = await cell.locator("span").allTextContents();
    // USD is the prefix-symbol currency ("$1,234.56"); LBP is suffix-style.
    const usd = spans.find((t) => t.trim().startsWith("$"));
    if (!usd) return 0;
    const parsed = Number(usd.replace(/[$,\s]/g, ""));
    expect(
      Number.isFinite(parsed),
      `unparsable ${drawer} figure: "${usd}"`,
    ).toBe(true);
    return parsed;
  };

  return {
    general: await read("General"),
    omtSystem: await read("OMT_System"),
  };
}

/** This client's outstanding debt, by identity — never by row position. */
async function debtorTotals(
  page: Page,
  clientName: string,
): Promise<{ usd: number; lbp: number }> {
  return page.evaluate(async (name) => {
    const w = window as unknown as Api;
    const rows = await w.api.debt.getDebtors();
    const row = rows.find(
      (d) => (d.full_name ?? d.client_name ?? "").trim() === name,
    );
    return {
      usd: row?.total_debt_usd ?? 0,
      lbp: row?.total_debt_lbp ?? 0,
    };
  }, clientName);
}

/** Select the OMT system tile for a direction: ↑ = SEND, ↓ = RECEIVE. */
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

/**
 * Drive the REAL OMT/Whish form: a fee-on-top system SEND charged entirely to
 * the customer's account. Returns the total the customer now owes (x + f).
 */
async function recordOmtSystemSendOnAccount(
  page: Page,
  opts: { client: string; phone: string; amount: number; fee: number },
): Promise<number> {
  await navigateTo(page, "/omt-whish");
  await pickOmt(page, "SEND");

  const amountInput = page.locator("#service-amount");
  await expect(amountInput).toBeVisible({ timeout: 15_000 });
  await amountInput.fill(String(opts.amount));

  // Explicit fee so the tier auto-lookup cannot make this non-deterministic.
  const feeInput = page.getByTestId("service-omt-fee-input");
  await expect(feeInput).toBeVisible({ timeout: 10_000 });
  await feeInput.fill(String(opts.fee));

  // Fee-included toggle deliberately LEFT OFF: the customer owes 100 + 5.

  // Name + phone are REQUIRED for an on-account leg — the repository resolves
  // (or auto-creates) the client from them, and that client_id is what the
  // settlement routing later keys on.
  await page.locator("#service-sender-name").fill(opts.client);
  await page.keyboard.press("Escape"); // dismiss the autocomplete dropdown
  await page.locator("#service-sender-phone").fill(opts.phone);
  await page.keyboard.press("Escape");

  // THE PAYMENT METHOD under test. The single payment line is pre-filled with
  // the form's own total; switching it to CUSTOMER_ACCOUNT turns the whole
  // amount into debt and must move NO drawer.
  await page
    .locator('[data-testid^="payment-method-"]')
    .first()
    .selectOption("CUSTOMER_ACCOUNT");

  await page.getByRole("button", { name: /Record Send/i }).click();
  // A successful submit clears the amount; a rejected one leaves it filled.
  await expect(amountInput).toHaveValue("", { timeout: 15_000 });

  return opts.amount + opts.fee;
}

/** Drive the REAL Debts page: settle this client's whole debt in cash. */
async function settleFullDebtInCash(page: Page, clientName: string) {
  await navigateTo(page, "/debts");
  await page.getByPlaceholder(/Search client/i).fill(clientName);
  await page.locator("button").filter({ hasText: clientName }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Settle Debt|Cash Out/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible({
    timeout: 15_000,
  });

  // The modal pre-fills the single CASH line with the remaining USD due, so a
  // full settlement needs no typing — confirm as-is.
  await page.getByRole("button", { name: /^Confirm Payment$/ }).click();
  await expect(
    page.locator('[role="alert"]', { hasText: /Repayment processed/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("LIRA-148 — OMT System on account: settlement routes cash to the PCD", () => {
  test("SEND on account moves no drawer; settling it puts the full amount in OMT_System, not General", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L148 Routing ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;
    const AMOUNT = 100;
    const FEE = 5;

    // ─── Step 1: dashboard BEFORE the transaction ──────────────────────────
    const beforeTxn = await cashOnHand(appPage);

    // ─── Step 2: the OMT System SEND, charged to the customer account ──────
    const owed = await recordOmtSystemSendOnAccount(appPage, {
      client: CLIENT,
      phone: PHONE,
      amount: AMOUNT,
      fee: FEE,
    });
    expect(owed).toBe(105);

    // ─── Step 3: dashboard AFTER the transaction ───────────────────────────
    const afterTxn = await cashOnHand(appPage);

    // Nobody handed over any banknotes, so NOTHING moved. If a regression ever
    // credits the PCD at transaction time for an on-account leg, the shop's
    // cash drawer would claim money it never received AND the customer would
    // still owe it — this assertion is the one that catches that.
    expect(
      afterTxn.omtSystem - beforeTxn.omtSystem,
      "an on-account SEND must not credit the OMT cash drawer",
    ).toBeCloseTo(0, 2);
    expect(
      afterTxn.general - beforeTxn.general,
      "an on-account SEND must not credit General either",
    ).toBeCloseTo(0, 2);

    // The debt is the whole customer-facing total: principal + fee.
    const debt = await debtorTotals(appPage, CLIENT);
    expect(debt.usd).toBeCloseTo(owed, 2);

    // ─── Step 4: settle the debt in cash, from the Debts page ──────────────
    await settleFullDebtInCash(appPage, CLIENT);

    // ─── Step 5: dashboard AFTER the settlement — the owner's question ─────
    const afterSettle = await cashOnHand(appPage);

    // THE ANSWER. The cash the customer just handed over lands in the OMT cash
    // drawer, because that is where it would have landed had they paid at the
    // counter on the day. Deferring payment must not change WHICH drawer ends
    // up holding the banknotes.
    expect(
      afterSettle.omtSystem - afterTxn.omtSystem,
      "settling an OMT-System service debt must route the cash into OMT_System",
    ).toBeCloseTo(owed, 2);

    // And General nets to ZERO. This is the subtle half: the repayment leg IS
    // credited to General first and then routed out, both inside one DB
    // transaction. A regression that books the credit but skips the routing
    // leaves +105 sitting here instead — so this assertion and the one above
    // fail together and name the failure between them.
    expect(
      afterSettle.general - afterTxn.general,
      "General must net to zero — credited, then routed into the cash drawer",
    ).toBeCloseTo(0, 2);

    // Debt is gone.
    const remaining = await debtorTotals(appPage, CLIENT);
    expect(Math.abs(remaining.usd)).toBeLessThan(0.05);
  });

  test("an OMT APP debt settled later stays in General — routing is system-only", async ({
    appPage,
  }) => {
    // The negative control for the test above. `financial_services.provider`
    // separates system ('OMT') from app ('OMT_APP'), and the routing query
    // matches system providers ONLY. Without this case, "the money reached
    // OMT_System" would not distinguish correct routing from routing
    // everything a client ever owes into the cash drawer — which is the exact
    // over-routing bug DebtRepository.serviceDebtRouting.test.ts was written
    // for, one layer down.
    //
    // Seeded through the API rather than the UI on purpose: the app-wallet form
    // is a different screen with its own flow, and what is under test here is
    // the SETTLEMENT side's provider discrimination, not that form.
    const ts = Date.now();
    const CLIENT = `L148 AppOnly ${ts}`;
    const PHONE = `78${String(ts).slice(-6)}`;
    const DEBT = 40;

    const seeded = await appPage.evaluate(
      async ({ name, phone, debt }) => {
        const w = window as unknown as {
          api: {
            omt: {
              addTransaction: (d: Record<string, unknown>) => Promise<{
                success?: boolean;
                error?: string;
              }>;
            };
          };
        };
        return w.api.omt.addTransaction({
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: debt,
          currency: "USD",
          clientName: name,
          phoneNumber: phone,
          senderName: name,
          senderPhone: phone,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: debt },
          ],
        });
      },
      { name: CLIENT, phone: PHONE, debt: DEBT },
    );
    expect(seeded?.success, seeded?.error).toBe(true);
    expect((await debtorTotals(appPage, CLIENT)).usd).toBeCloseTo(DEBT, 2);

    const before = await cashOnHand(appPage);
    await settleFullDebtInCash(appPage, CLIENT);
    const after = await cashOnHand(appPage);

    // App debt is not system debt: the cash stays in the till.
    expect(
      after.general - before.general,
      "an OMT App debt repayment belongs in General",
    ).toBeCloseTo(DEBT, 2);
    expect(
      after.omtSystem - before.omtSystem,
      "an OMT App debt repayment must NOT reach the OMT cash drawer",
    ).toBeCloseTo(0, 2);
  });
});
