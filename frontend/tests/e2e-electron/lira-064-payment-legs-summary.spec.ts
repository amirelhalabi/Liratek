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

    const firstRow = appPage.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });

    // The dedicated structured-legs element is present and shows an "in:" leg.
    const legsCell = firstRow.locator('[data-testid="payment-legs"]');
    await expect(legsCell).toBeVisible({ timeout: 10_000 });
    await expect(legsCell).toContainText(/in:/);
    // A currency marker must appear ($ for USD, or an "LBP" suffix).
    await expect(legsCell).toContainText(/\$|LBP/);
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
    if (typeof newest.summary === "string" && /\bin:|\bout:/.test(newest.summary)) {
      return "summary-contains-legs";
    }

    return "ok";
  });
}
