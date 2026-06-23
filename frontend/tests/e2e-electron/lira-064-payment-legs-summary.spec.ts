/**
 * E2E: LIRA-064 — Transactions table: structured in/out payment breakdown
 *
 * Validates the feature end-to-end:
 *   - The backend (TransactionRepository.getRecent) now returns a structured
 *     `payments` array per row — in/out legs joined from the payments table —
 *     WITHOUT baking that text into the stored `summary` string.
 *   - The TransactionsViewer Summary cell renders those legs appended
 *     client-side (e.g. "in: $50 + 100,000 LBP · out: 20,000 LBP").
 *
 * Flow under test:
 *   - Create a recharge CREDIT_TRANSFER (the customer pays cash → an "in" leg
 *     lands in the payments table for the new transaction). This is the same
 *     stable flow exercised by recharge.spec.ts.
 *   - Assert via IPC that the newest transaction carries a non-empty,
 *     well-shaped `payments` array (direction / amount / currency_code / method).
 *   - Open Audit → Transactions and assert the first (newest) row's Summary
 *     cell shows the structured "in: …" leg WITH a currency, and that the
 *     stored summary text is unchanged (the legs are appended, not persisted).
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const TRANSFER_PHONE = "03999888";
const TRANSFER_USD = "5";

/**
 * Structured payment leg as returned by TransactionRepository.getRecent
 * (LIRA-064). `signed_amount` keeps the sign; `amount` is the absolute value;
 * `direction` is derived from the sign ("in" = customer paid the shop, "out" =
 * change returned). Internal ledger legs (cost outflows, *_System reserves,
 * provider stock drawers, fee/transfer rows) are filtered out by the repo.
 */
type PaymentLeg = {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
};

type TxnRow = {
  id: number;
  type: string;
  session_id: number | null;
  payments?: PaymentLeg[];
};

/**
 * Local Api type for the channels these scenarios drive. The generated
 * electron.d.ts types for omt.addTransaction / session.checkout are sometimes
 * stale, so we cast `window as unknown as Api` and declare exactly what we use.
 */
type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number }>;
      getActive: () => Promise<{ success: boolean; session?: { id: number } }>;
      checkout: (data: {
        sessionId: number;
        cartItems: Array<{
          id: string;
          module: string;
          label: string;
          amount: number;
          currency: string;
          formData: Record<string, unknown>;
          ipcChannel: string;
        }>;
        paidByMethod?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
        exchangeRate?: number;
        userId: number;
      }) => Promise<{ success: boolean; itemCount?: number; error?: string }>;
    };
    transactions: {
      getRecent: (limit?: number, filters?: unknown) => Promise<TxnRow[]>;
    };
  };
};

test.describe("LIRA-064 — structured in/out payment legs in summary", () => {
  test("recharge transfer: newest txn exposes structured payment legs and the table renders them", async ({
    appPage,
  }) => {
    // ── Create a transaction that produces a real payment leg ────────────────
    await navigateTo(appPage, "/recharge");

    const mtcTab = appPage
      .locator("button")
      .filter({ hasText: /^MTC$/ })
      .first();
    await expect(mtcTab).toBeVisible({ timeout: 8_000 });
    await mtcTab.click();

    const phoneInput = appPage.locator("#telecom-phone");
    await expect(phoneInput).toBeVisible({ timeout: 8_000 });
    await phoneInput.fill(TRANSFER_PHONE);

    const amountInput = appPage.locator("#telecom-amount");
    await expect(amountInput).toBeVisible({ timeout: 5_000 });
    await amountInput.fill(TRANSFER_USD);

    const proceedBtn = appPage.getByRole("button", { name: /Proceed to Pay/i });
    await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
    await proceedBtn.click();

    const confirmBtn = appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();
    await expect(confirmBtn).toBeHidden({ timeout: 8_000 });

    // ── Backend assertion: structured payments array on the newest txn ───────
    await expect
      .poll(() => readNewestPaymentLegsShape(appPage), { timeout: 10_000 })
      .toBe("ok");

    // ── Frontend assertion: legs rendered, appended, with currency ───────────
    await navigateTo(appPage, "/audit");

    // Find a row whose structured-legs cell shows an "in:" leg (the recharge
    // produces one). NOT tbody tr.first(): over the shared worker DB a newer row
    // — e.g. a supplier-payment "out:" leg from an earlier spec — can sit on top,
    // so the first row is not necessarily the one carrying the in-leg under test.
    // This validates the LIRA-064 rendering (an "in:" leg with a currency marker)
    // independent of which transaction happens to be newest.
    const legsCell = appPage
      .locator('tbody tr [data-testid="payment-legs"]')
      .filter({ hasText: "in:" })
      .first();
    await expect(legsCell).toBeVisible({ timeout: 10_000 });
    await expect(legsCell).toContainText(/in:/);
    // A currency marker must appear ($ for USD, or an "LBP" suffix).
    await expect(legsCell).toContainText(/\$|LBP/);
  });

  // ── Gap scenario 1: mixed IN + OUT change, multiple currencies ──────────────
  // A basket paid with [$40 IN, 100,000 LBP IN, 50,000 LBP OUT change]. The
  // session row must expose ALL three legs: two distinct IN legs (USD + LBP) and
  // one OUT leg with signed_amount −50000. Assertions target this session's own
  // legs by currency/direction (never index 0) so they are delta-safe in the
  // shared worker DB.
  test("mixed IN + OUT change basket exposes both in-legs and the signed out-leg", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const started = await w.api.session.start({
        customer_name: "E2E 064 Mixed Legs",
        customer_phone: "03064101",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      // One clean custom-service item (no provider drawer mechanics) so the
      // basket legs are the ONLY customer legs on the row.
      const item = {
        id: "e2e-064-mixed",
        module: "custom_service",
        label: "E2E 064 Mixed Svc",
        amount: 40,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: "E2E 064 Mixed Svc",
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 40,
          price_lbp: 0,
          paid_by: "CASH",
        },
      };

      const checkout = await w.api.session.checkout({
        sessionId: sessionId as number,
        cartItems: [item],
        paidByMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 40, direction: "IN" },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 100_000,
            direction: "IN",
          },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 50_000,
            direction: "OUT",
          },
        ],
        exchangeRate: 90_000,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const row = recent.find((t) => t.session_id === sessionId);
      const legs = row?.payments ?? [];

      const usdIn = legs.find(
        (p) => p.direction === "in" && p.currency_code === "USD",
      );
      const lbpIn = legs.find(
        (p) => p.direction === "in" && p.currency_code === "LBP",
      );
      const lbpOut = legs.find(
        (p) => p.direction === "out" && p.currency_code === "LBP",
      );

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        foundRow: row != null,
        usdInAmount: usdIn?.amount ?? null,
        lbpInAmount: lbpIn?.amount ?? null,
        lbpOutSigned: lbpOut?.signed_amount ?? null,
        lbpOutAmount: lbpOut?.amount ?? null,
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.foundRow).toBe(true);

    // Both customer IN legs are surfaced with their own currency…
    expect(result.usdInAmount).toBeCloseTo(40, 2);
    expect(result.lbpInAmount).toBeCloseTo(100_000, 0);
    // …and the OUT change leg carries a NEGATIVE signed_amount (−50,000 LBP),
    // proving the in/out direction is derived from the sign (LIRA-064).
    expect(result.lbpOutSigned).toBe(-50_000);
    expect(result.lbpOutAmount).toBeCloseTo(50_000, 0);
  });

  // ── Gap scenario 2: same-currency summing ───────────────────────────────────
  // A basket paid with two same-currency IN legs [$30, $20]. The backend keeps
  // BOTH legs (the viewer collapses them to a single "in: $50" client-side).
  // The IPC-assertable invariant is the two-leg shape summing to $50.
  test("two same-currency IN legs are both present and sum to $50", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const started = await w.api.session.start({
        customer_name: "E2E 064 Same Currency",
        customer_phone: "03064201",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      const item = {
        id: "e2e-064-samecur",
        module: "custom_service",
        label: "E2E 064 SameCur Svc",
        amount: 50,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: "E2E 064 SameCur Svc",
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 50,
          price_lbp: 0,
          paid_by: "CASH",
        },
      };

      const checkout = await w.api.session.checkout({
        sessionId: sessionId as number,
        cartItems: [item],
        paidByMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 30, direction: "IN" },
          { method: "CASH", currency_code: "USD", amount: 20, direction: "IN" },
        ],
        exchangeRate: 90_000,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const row = recent.find((t) => t.session_id === sessionId);
      const legs = row?.payments ?? [];

      const usdInLegs = legs.filter(
        (p) => p.direction === "in" && p.currency_code === "USD",
      );

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        foundRow: row != null,
        usdInLegCount: usdInLegs.length,
        usdInSum: usdInLegs.reduce((s, p) => s + p.amount, 0),
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.foundRow).toBe(true);

    // The backend preserves BOTH legs (no premature merge)…
    expect(result.usdInLegCount).toBe(2);
    // …and together they sum to exactly $50 (what the viewer renders as one leg).
    expect(result.usdInSum).toBeCloseTo(50, 2);
  });

  // ── Gap scenario 3: internal-leg exclusion ──────────────────────────────────
  // An OMT App SEND basket. The SEND's own ledger legs (cost outflow on the
  // OMT_App provider drawer, note "Cost: OMT_APP") are internal and filtered by
  // the repo; the SEND is run deferred so it writes no own customer-cash leg.
  // The row therefore inherits ONLY the single basket CASH $52 IN leg.
  // Positive-only assertion (the renderer leg shape omits drawer_name/note, so
  // we assert the expected customer leg is present and is the ONLY one).
  test("OMT App SEND basket: row legs contain only the customer CASH in-leg", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const started = await w.api.session.start({
        customer_name: "E2E 064 Internal Exclusion",
        customer_phone: "03064301",
        started_by: "admin",
      });
      let sessionId = started.sessionId;
      if (!sessionId) {
        const active = await w.api.session.getActive();
        sessionId = active.session?.id;
      }

      // OMT App SEND cart item — cost/price flow. In deferred (basket) mode the
      // customer cash inflow is skipped and only the (filtered) cost outflow leg
      // is written, so the row falls back to the basket's customer legs.
      const item = {
        id: "e2e-064-omtsend",
        module: "omt_app",
        label: "E2E 064 OMT App Send",
        amount: 52,
        currency: "USD",
        ipcChannel: "omt:add-transaction",
        formData: {
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: 52,
          currency: "USD",
          cost: 50,
          price: 52,
          paidByMethod: "CASH",
        },
      };

      const checkout = await w.api.session.checkout({
        sessionId: sessionId as number,
        cartItems: [item],
        paidByMethod: "CASH",
        // The single customer-facing payment for the basket: $52 CASH IN.
        payments: [
          { method: "CASH", currency_code: "USD", amount: 52, direction: "IN" },
        ],
        exchangeRate: 90_000,
        userId: 1,
      });

      const recent = await w.api.transactions.getRecent(50);
      const row = recent.find((t) => t.session_id === sessionId);
      const legs = row?.payments ?? [];

      const internalMethods = new Set([
        "COMMISSION",
        "PM_FEE",
        "TRANSFER",
        "CREDIT_RETURN",
        "CREDIT_USED",
        "SMS_COST",
        "RESERVE",
      ]);

      return {
        checkoutOk: checkout.success,
        checkoutError: checkout.error ?? null,
        foundRow: row != null,
        legCount: legs.length,
        onlyLeg: legs[0]
          ? {
              direction: legs[0].direction,
              amount: legs[0].amount,
              currency_code: legs[0].currency_code,
              method: legs[0].method,
            }
          : null,
        // No surfaced leg may use a known internal method, and every leg must be
        // denominated in customer cash (USD/LBP) — the cost outflow on OMT_App
        // must have been filtered out.
        anyInternalMethod: legs.some((p) => internalMethods.has(p.method)),
        anyNonCashCurrency: legs.some(
          (p) => p.currency_code !== "USD" && p.currency_code !== "LBP",
        ),
      };
    });

    expect(result.checkoutError).toBeNull();
    expect(result.checkoutOk).toBe(true);
    expect(result.foundRow).toBe(true);

    // Exactly ONE customer-facing leg survives — the basket CASH $52 IN leg.
    expect(result.legCount).toBe(1);
    expect(result.onlyLeg).not.toBeNull();
    expect(result.onlyLeg?.direction).toBe("in");
    expect(result.onlyLeg?.method).toBe("CASH");
    expect(result.onlyLeg?.amount).toBeCloseTo(52, 2);
    expect(["USD", "LBP"]).toContain(result.onlyLeg?.currency_code);

    // The internal cost outflow (OMT_App provider drawer) is not surfaced.
    expect(result.anyInternalMethod).toBe(false);
    expect(result.anyNonCashCurrency).toBe(false);
  });
});

/**
 * Reads the newest transaction via IPC and asserts the structured `payments`
 * field is present and well-shaped (LIRA-064). Returns "ok" on success, or a
 * short diagnostic string otherwise so `expect.poll` surfaces the reason.
 *
 * Crucially also checks that the stored `summary` text does NOT contain the
 * client-side "in:"/"out:" formatting — proving the legs are not persisted.
 */
async function readNewestPaymentLegsShape(appPage: Page): Promise<string> {
  return appPage.evaluate(async () => {
    const res = await (
      window as unknown as {
        api: {
          transactions: {
            getRecent: (
              limit: number,
              filters?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        };
      }
    ).api.transactions.getRecent(5, {});

    const list = (
      Array.isArray(res)
        ? res
        : ((res as { transactions?: unknown[] })?.transactions ?? [])
    ) as Array<{
      summary?: string | null;
      payments?: Array<{
        direction?: string;
        amount?: number;
        signed_amount?: number;
        currency_code?: string;
        method?: string;
      }>;
    }>;

    const newest = list[0];
    if (!newest) return "no-rows";
    if (!Array.isArray(newest.payments)) return "payments-not-array";
    if (newest.payments.length === 0) return "payments-empty";

    const leg = newest.payments[0];
    if (leg.direction !== "in" && leg.direction !== "out") {
      return `bad-direction:${String(leg.direction)}`;
    }
    if (typeof leg.amount !== "number") return "amount-not-number";
    if (typeof leg.currency_code !== "string" || !leg.currency_code) {
      return "missing-currency";
    }
    if (typeof leg.method !== "string") return "missing-method";

    // The structured legs must NOT be baked into the stored summary text.
    if (
      typeof newest.summary === "string" &&
      /\bin:|\bout:/.test(newest.summary)
    ) {
      return "summary-contains-legs";
    }

    return "ok";
  });
}
