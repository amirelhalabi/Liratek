/**
 * lira-web-034 — "Cash Out to OMT" (LIRA-192, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md
 * §8, D10-D16), over REST + the real browser UI. Web twin of the desktop
 * `lira-192-omt-app-cashout.spec.ts` (L10).
 *
 * The mirror of the OMT-credit top-up (lira-web-033): `OMT_App` drawer DOWN,
 * the OMT account CREDITED principal + a 0.1% commission
 * (`OMT_APP_CASHOUT_COMMISSION_RATE`, `packages/core/src/constants/
 * omtAppCashout.ts`), `OMT_System` (OMT Cash Drawer) untouched — no physical
 * cash moves either way (D2/§8.1). `profit_usd`/`profit_lbp` are stamped 0 at
 * creation (D14 — recognised at OMT account settlement, LIRA-189, wave 2,
 * NOT built this run); the commission figure is still stored on the
 * transaction so LIRA-189 can sum it later.
 *
 * Layers, cheapest/most-structural first:
 *  (a) REST core proof, USD AND LBP: create, assert every delta + the
 *      commission arithmetic + profit=0-at-creation, then VOID and assert
 *      create+void nets every touched ledger to exactly 0 (rule 20) — proven
 *      possible here (unlike lira-web-033's RECHARGE_TOPUP) because
 *      `WALLET_CASHOUT` is deliberately kept OUT of
 *      `NON_REVERSIBLE_TRANSACTION_TYPES` (transactionTypes.ts) and its
 *      wallet leg is written as a real `payments` row precisely so the
 *      generic `_reversePayments`/supplier cascade-void can restore it.
 *  (b) D15 over-draw guard: rejected per currency, nothing written.
 *  (c) Real-UI proof of the commission PREVIEW — the one piece of frontend
 *      arithmetic in this ticket (rule: drive the UI wherever the frontend
 *      computes something, a hand-built REST payload can't catch a
 *      preview-vs-stamp divergence). The preview must come from the SAME
 *      shared `omtAppCashoutCommission` core function the repository stamps
 *      with (`OmtAppCashoutModal.tsx`'s own doc comment) — never a second
 *      hardcoded 0.1% in the frontend. This spec does not re-implement that
 *      function to "grade" the UI against; it recomputes the expected number
 *      from the DOCUMENTED rate (D13: 0.1%) and the documented rounding rule
 *      (`roundMoneyForCurrency` — cents for USD, whole units for LBP), the
 *      same numbers the plan and the constant's own doc comment state, so a
 *      divergence between the UI and the actual constant would still show up
 *      as a UI-vs-expected mismatch.
 *
 * Rule 15 (accumulating, single-worker suite): every cashout amount is
 * run-unique (derived from Date.now()) so the "locate my WALLET_CASHOUT row"
 * lookups below can never collide with another run's row of the same
 * amount — never "newest row" by position.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

async function authHeaders(
  page: Page,
): Promise<{ Authorization: string }> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

interface DrawerBalance {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
}
async function drawerBalances(
  page: Page,
  headers: { Authorization: string },
): Promise<DrawerBalance[]> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/recharge/drawer-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances as DrawerBalance[];
}
function drawerOf(balances: DrawerBalance[], name: string): DrawerBalance {
  const d = balances.find((b) => b.name === name);
  expect(d, JSON.stringify(balances)).toBeTruthy();
  return d!;
}

interface AccountChildBalance {
  supplier_id: number;
  provider: string | null;
  total_usd: number;
  total_lbp: number;
}
interface AccountBalance {
  account_name: string;
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
}
async function omtAppChildBalance(
  page: Page,
  headers: { Authorization: string },
): Promise<AccountChildBalance> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/account-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const account = (r.balances as AccountBalance[]).find(
    (a) => a.account_name === "OMT",
  );
  expect(account, JSON.stringify(r)).toBeTruthy();
  const child = account!.children.find((c) => c.provider === "OMT_APP");
  expect(child, JSON.stringify(account)).toBeTruthy();
  return child!;
}

/**
 * Mirrors `packages/core/src/utils/omtFees.ts`'s `roundMoneyForCurrency`
 * (0.01 for USD, 1 for LBP) applied to D13's documented 0.1% rate — used
 * ONLY to compute this test's own expectation, never fed back into the app.
 */
function expectedCashoutCommission(
  amount: number,
  currency: "USD" | "LBP",
): number {
  const raw = Math.abs(amount) * 0.001;
  const unit = currency === "LBP" ? 1 : 0.01;
  return Math.round(raw / unit) * unit;
}

/** Strip currency symbols/commas/labels from a rendered money string. */
function parseMoneyText(text: string): number {
  const match = text.replace(/,/g, "").match(/-?[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
}

interface Txn {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  status: string;
  metadata_json: string | null;
}
async function findCashoutTxn(
  page: Page,
  headers: { Authorization: string },
  amount: number,
  currency: "USD" | "LBP",
): Promise<Txn> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=WALLET_CASHOUT&limit=200`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const field = currency === "USD" ? "amount_usd" : "amount_lbp";
  const digits = currency === "USD" ? 2 : 0;
  const tol = digits === 2 ? 0.01 : 0.6;
  const txn = (r.transactions as Txn[]).find(
    (t) => Math.abs(t[field] - amount) <= tol,
  );
  expect(
    txn,
    `WALLET_CASHOUT transaction not found for amount ${amount} ${currency}`,
  ).toBeTruthy();
  return txn!;
}

test.describe("OMT App cash-out (LIRA-192)", () => {
  for (const currency of ["USD", "LBP"] as const) {
    test(`REST ${currency}: create books principal+commission and profit=0, void nets everything to 0 (rule 20)`, async ({
      page,
    }) => {
      const headers = await authHeaders(page);
      const marker = Date.now();

      // Run-unique cashout amount. LBP kept a multiple of 1000 so its 0.1%
      // commission is already a clean integer with no rounding surprise to
      // reason about by hand; USD kept at 2 decimals.
      const amount =
        currency === "USD"
          ? Number((84 + (marker % 977) / 100).toFixed(2))
          : 137_000 + (marker % 53) * 1000;
      const expectedCommission = expectedCashoutCommission(amount, currency);

      // Seed enough OMT_App wallet balance to cash out from (supplier
      // credit — no drawer drained, per lira-web-033).
      const seedAmount = currency === "USD" ? amount + 500 : amount + 5_000_000;
      const seeded = await (
        await page.request.post(
          `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
          { headers, data: { provider: "OMT_APP", amount: seedAmount, currency } },
        )
      ).json();
      expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

      const before = await drawerBalances(page, headers);
      const omtSystemBefore = drawerOf(before, "OMT_System");
      const omtAppBefore = drawerOf(before, "OMT_App");
      const childBefore = await omtAppChildBalance(page, headers);

      const result = await (
        await page.request.post(
          `${BACKEND_URL}/api/recharge/cashout-to-supplier`,
          { headers, data: { provider: "OMT_APP", amount, currency } },
        )
      ).json();
      expect(result.success, JSON.stringify(result)).toBeTruthy();
      expect(result.commission).toBeCloseTo(
        expectedCommission,
        currency === "USD" ? 2 : 0,
      );

      const field = currency === "USD" ? "usdBalance" : "lbpBalance";
      const acctField = currency === "USD" ? "total_usd" : "total_lbp";
      const digits = currency === "USD" ? 2 : 0;

      const afterCashout = await drawerBalances(page, headers);
      const omtSystemAfterCashout = drawerOf(afterCashout, "OMT_System");
      const omtAppAfterCashout = drawerOf(afterCashout, "OMT_App");
      const childAfterCashout = await omtAppChildBalance(page, headers);

      // D2: no physical cash moves.
      expect(
        omtSystemAfterCashout[field] - omtSystemBefore[field],
      ).toBeCloseTo(0, digits);
      // The wallet balance leaves by exactly `amount`.
      expect(omtAppAfterCashout[field] - omtAppBefore[field]).toBeCloseTo(
        -amount,
        digits,
      );
      // The account is credited principal + commission (D11) — OMT now owes
      // the shop, so the child's signed total moves DOWN by that sum.
      expect(
        childAfterCashout[acctField] - childBefore[acctField],
      ).toBeCloseTo(-(amount + expectedCommission), digits);

      // Locate the created transaction by identity (run-unique amount) and
      // confirm D14: commission is STORED, but profit is 0 at creation.
      const txn = await findCashoutTxn(page, headers, amount, currency);
      expect(txn.profit_usd).toBe(0);
      expect(txn.profit_lbp).toBe(0);
      const meta = JSON.parse(txn.metadata_json ?? "{}") as {
        commission?: number;
      };
      expect(meta.commission).toBeCloseTo(
        expectedCommission,
        currency === "USD" ? 2 : 0,
      );

      // ── Void: rule 20 — create + void must net every touched ledger to
      // exactly 0, relative to BEFORE the cashout (not before the seed —
      // the seed top-up is a separate, non-reversed transaction). ────────
      const voided = await (
        await page.request.post(
          `${BACKEND_URL}/api/transactions/${txn.id}/void`,
          { headers },
        )
      ).json();
      expect(voided.success, JSON.stringify(voided)).toBeTruthy();

      const afterVoid = await drawerBalances(page, headers);
      const omtSystemAfterVoid = drawerOf(afterVoid, "OMT_System");
      const omtAppAfterVoid = drawerOf(afterVoid, "OMT_App");
      const childAfterVoid = await omtAppChildBalance(page, headers);

      expect(omtSystemAfterVoid[field] - omtSystemBefore[field]).toBeCloseTo(
        0,
        digits,
      );
      expect(omtAppAfterVoid[field] - omtAppBefore[field]).toBeCloseTo(
        0,
        digits,
      );
      expect(childAfterVoid[acctField] - childBefore[acctField]).toBeCloseTo(
        0,
        digits,
      );

      const detail = await (
        await page.request.get(`${BACKEND_URL}/api/transactions/${txn.id}`, {
          headers,
        })
      ).json();
      expect(detail.success, JSON.stringify(detail)).toBeTruthy();
      expect(detail.transaction.status).toBe("VOIDED");
    });
  }

  test("D15: cashing out more than the wallet holds is BLOCKED, per currency, and writes nothing", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    for (const currency of ["USD", "LBP"] as const) {
      const before = await drawerBalances(page, headers);
      const omtAppBefore = drawerOf(before, "OMT_App");
      const childBefore = await omtAppChildBalance(page, headers);
      const field = currency === "USD" ? "usdBalance" : "lbpBalance";
      const acctField = currency === "USD" ? "total_usd" : "total_lbp";
      const digits = currency === "USD" ? 2 : 0;

      const hugeAmount =
        Math.max(omtAppBefore[field], 0) +
        (currency === "USD" ? 1_000_000 : 50_000_000_000);

      const result = await (
        await page.request.post(
          `${BACKEND_URL}/api/recharge/cashout-to-supplier`,
          {
            headers,
            data: { provider: "OMT_APP", amount: hugeAmount, currency },
          },
        )
      ).json();
      expect(result.success, JSON.stringify(result)).toBe(false);
      expect(typeof result.error).toBe("string");

      const after = await drawerBalances(page, headers);
      const omtAppAfter = drawerOf(after, "OMT_App");
      const childAfter = await omtAppChildBalance(page, headers);

      // Nothing written: the wallet and the account are byte-for-byte
      // unchanged (delta 0), not just "not decreased by hugeAmount".
      expect(omtAppAfter[field] - omtAppBefore[field]).toBeCloseTo(0, digits);
      expect(childAfter[acctField] - childBefore[acctField]).toBeCloseTo(
        0,
        digits,
      );
    }
  });

  test("UI: the commission preview is computed (never a second hardcoded 0.1%), matches D13's rate in BOTH currencies, and a real submit reaches the same core deltas", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    // Seed plenty of USD wallet balance so the client-side "exceeds wallet"
    // guard never blocks the submit below.
    const seeded = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: { provider: "OMT_APP", amount: 900, currency: "USD" },
        },
      )
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

    await page.goto("/#/recharge");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
    await page.getByRole("button", { name: "OMT App" }).click();
    await page.waitForTimeout(500);

    const before = await drawerBalances(page, headers);
    const omtSystemBefore = drawerOf(before, "OMT_System");
    const omtAppBefore = drawerOf(before, "OMT_App");
    const childBefore = await omtAppChildBalance(page, headers);

    await page.getByTestId("omt-app-cashout-button").click();
    // Scoped to the <h2> specifically — the header BUTTON that opened the
    // modal carries the identical text "Cash Out to OMT" and stays visible
    // behind the overlay, so a bare getByText() here would match both and
    // throw a strict-mode violation.
    await expect(
      page.getByRole("heading", { name: "Cash Out to OMT" }),
    ).toBeVisible({ timeout: 10_000 });

    // ── USD preview, no submit yet. ─────────────────────────────────────
    const USD_AMOUNT = 250;
    await page.getByTestId("omt-app-cashout-amount").fill(String(USD_AMOUNT));
    const usdPreviewText = await page
      .getByTestId("omt-app-cashout-commission-preview")
      .innerText();
    expect(parseMoneyText(usdPreviewText)).toBeCloseTo(
      expectedCashoutCommission(USD_AMOUNT, "USD"),
      2,
    );

    // ── Switch to LBP: the preview must re-derive from the SAME shared
    // function for the new currency's rounding unit, not carry over the USD
    // figure or reuse a second, LBP-blind constant. No submit — the REST
    // test above already proves the LBP create path end to end. ─────────
    await page.getByTestId("omt-app-cashout-currency").selectOption("LBP");
    const LBP_AMOUNT = 340_000;
    await page.getByTestId("omt-app-cashout-amount").fill(String(LBP_AMOUNT));
    const lbpPreviewText = await page
      .getByTestId("omt-app-cashout-commission-preview")
      .innerText();
    expect(parseMoneyText(lbpPreviewText)).toBeCloseTo(
      expectedCashoutCommission(LBP_AMOUNT, "LBP"),
      0,
    );

    // ── Back to USD and submit for real — proves the previewed number is
    // also what actually gets stamped, not a display-only figure. ────────
    await page.getByTestId("omt-app-cashout-currency").selectOption("USD");
    await page.getByTestId("omt-app-cashout-amount").fill(String(USD_AMOUNT));
    await expect(
      page.getByTestId("omt-app-cashout-commission-preview"),
    ).toBeVisible();
    await page.getByTestId("omt-app-cashout-submit").click();

    await expect(
      page.getByRole("heading", { name: "Cash Out to OMT" }),
    ).toHaveCount(0, { timeout: 10_000 });

    const after = await drawerBalances(page, headers);
    const omtSystemAfter = drawerOf(after, "OMT_System");
    const omtAppAfter = drawerOf(after, "OMT_App");
    const childAfter = await omtAppChildBalance(page, headers);
    const expectedCommission = expectedCashoutCommission(USD_AMOUNT, "USD");

    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      0,
      2,
    );
    expect(omtAppAfter.usdBalance - omtAppBefore.usdBalance).toBeCloseTo(
      -USD_AMOUNT,
      2,
    );
    expect(childAfter.total_usd - childBefore.total_usd).toBeCloseTo(
      -(USD_AMOUNT + expectedCommission),
      2,
    );
  });
});
