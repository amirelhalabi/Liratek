/**
 * E2E: LIRA-063 — OMT App / Whish App: make client name / phone optional
 *
 * Validates the fix in OmtWhishAppTransferForm.tsx: the SEND/RECEIVE
 * "Proceed to Pay" flow no longer blocks on empty sender/receiver name+phone.
 *
 * Flow under test:
 *   - Open Recharge → OMT App provider, SEND (defaults)
 *   - Leave Sender Name AND Sender Phone empty
 *   - Enter an amount and Proceed to Pay
 *   - Before the fix this raised an alert and the PaymentSheet never opened;
 *     after the fix the sheet opens and the payment confirms.
 *   - The transaction is then created with NO client, and propagates to the
 *     Audit → Transactions table where the first (newest) row shows the
 *     OMT App Send transaction with the Client column rendered as "—".
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const AMOUNT_USD = "25";

test.describe("LIRA-063 — OMT App / Whish App optional client name/phone", () => {
  test("OMT App SEND with empty name/phone: proceeds, creates txn, shows '—' client in first table row", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // ── Select the OMT App provider tab ──────────────────────────────────────
    const omtAppTab = appPage
      .locator("button")
      .filter({ hasText: /^OMT App$/ })
      .first();
    await expect(omtAppTab).toBeVisible({ timeout: 8_000 });
    // force:true matches goToRechargeForm — bypasses transient header z-layer
    // interception right after navigation.
    await omtAppTab.click({ force: true });

    // The OMT/Whish transfer form renders with SEND + USD by default.
    const amountInput = appPage.locator("#transfer-amount");
    await expect(amountInput).toBeVisible({ timeout: 8_000 });

    // Be explicit about SEND (it is the default, but guard against leakage).
    const sendTab = appPage
      .locator("button")
      .filter({ hasText: /^Send$/ })
      .first();
    if (await sendTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendTab.click();
    }

    // ── The crux of LIRA-063: name + phone are left EMPTY ───────────────────
    await expect(appPage.locator("#sender-name")).toHaveValue("");
    await expect(appPage.locator("#sender-phone")).toHaveValue("");

    await amountInput.fill(AMOUNT_USD);

    // Proceed to Pay must be enabled (gated only on a valid amount now).
    const proceedBtn = appPage.getByRole("button", { name: /Proceed to Pay/i });
    await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
    await proceedBtn.click();

    // PaymentSheet opening (the "Pay $X" confirm button appearing) is the
    // regression check: before the fix, an alert fired and the sheet stayed
    // closed because name/phone were empty.
    const confirmBtn = appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Sheet closes once the submit fires.
    await expect(confirmBtn).toBeHidden({ timeout: 8_000 });

    // ── Wait for the transaction to commit (avoids racing the table load) ────
    // Newest transaction must be the OMT App SEND with no client attached.
    await expect
      .poll(() => readNewestOmtAppSend(appPage), { timeout: 10_000 })
      .toBe("FINANCIAL_SERVICE|OMT_APP|SEND|null");

    // ── Verify propagation in the Transactions table (first row) ─────────────
    await navigateTo(appPage, "/audit");

    const firstRow = appPage.locator("tbody tr").first();
    // Type column (3rd cell): "OMT App Send"
    await expect(firstRow.locator("td").nth(2)).toContainText("OMT App Send", {
      timeout: 10_000,
    });
    // Client column (4th cell): no client → em dash
    await expect(firstRow.locator("td").nth(3)).toHaveText("—");
    // Amount column (5th cell): the $25 transfer
    await expect(firstRow.locator("td").nth(4)).toContainText("$25");
  });
});

/**
 * Returns a "type|provider|service_type|client_id" fingerprint of the newest
 * transaction via IPC, so the test can wait for the SEND to be persisted.
 */
async function readNewestOmtAppSend(appPage: Page): Promise<string> {
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
      type?: string;
      metadata_json?: string | null;
      client_id?: number | null;
    }>;
    const newest = list[0];
    if (!newest) return "none";
    let provider = "";
    let serviceType = "";
    try {
      const meta = JSON.parse(newest.metadata_json ?? "{}") as {
        provider?: string;
        service_type?: string;
      };
      provider = meta.provider ?? "";
      serviceType = meta.service_type ?? "";
    } catch {
      /* ignore malformed metadata */
    }
    return `${newest.type ?? ""}|${provider}|${serviceType}|${
      newest.client_id ?? "null"
    }`;
  });
}
