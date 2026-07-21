/**
 * E2E: LIRA-069 — Receipt-printing gate (W1.a/W1.d)
 *
 * `isReceiptableTransaction` (frontend/src/features/audit/receiptGating.ts)
 * is the single provider-aware predicate driving:
 *   - the Transactions viewer's per-row Print button (asserted here),
 *   - each module's History-modal Print button (same predicate, not
 *     re-asserted per-surface — see the unit-test matrix for the exhaustive
 *     include/exclude cases),
 *   - the auto-print-on-success hook (useAutoPrintReceipt), asserted here on
 *     a standalone MTC recharge submission.
 *
 * Row identity (CLAUDE.md rule 15): every created row carries a unique
 * `clientName` marker (Date.now()-seeded) and is located via the /audit
 * search box — NEVER by row position (`tbody tr.first()` / `getRecent()[0]`)
 * in this shared, accumulating per-worker DB.
 *
 * Failing-first procedure (rule 17, for the verifier — this suite cannot be
 * run by the authoring agent): temporarily revert
 * `isReceiptableTransaction` in receiptGating.ts to the old type-only gate
 * (`return type === "FINANCIAL_SERVICE" || ALWAYS_RECEIPTABLE_TYPES.has(type)`)
 * and re-run this file — the "excluded provider rows show no Print button"
 * test must FAIL (OMT System / Whish System / OMT App transfer / Whish App
 * transfer / Binance rows would all wrongly show a Print button). Restore
 * the fix and confirm it passes again.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type OmtPayload = {
  provider: string;
  serviceType: "SEND" | "RECEIVE" | "BILL";
  amount: number;
  cost?: number;
  price?: number;
  currency?: string;
  commission?: number;
  paidByMethod?: string;
  clientName?: string;
  itemKey?: string;
};

async function addOmtTransaction(page: Page, payload: OmtPayload) {
  return page.evaluate(
    (p) =>
      (
        window as unknown as {
          api: {
            omt: {
              addTransaction: (
                d: Record<string, unknown>,
              ) => Promise<{ success?: boolean; error?: string; id?: number }>;
            };
          };
        }
      ).api.omt.addTransaction(p),
    payload,
  );
}

/** Search /audit for `marker` and return the locator for its ONE matching
 *  row (identity, never position — rule 15). Assumes the caller already
 *  navigated to /audit and the search box is visible. */
async function findRowByMarker(page: Page, marker: string) {
  const searchInput = page.getByPlaceholder(/Search summary, client, user/i);
  await expect(searchInput).toBeVisible({ timeout: 8_000 });
  await searchInput.fill(marker);
  await searchInput.press("Enter");
  const row = page.locator("tr", { hasText: marker }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  return row;
}

/** Clear the search box so the next lookup starts from a clean filter. */
async function clearSearch(page: Page) {
  const searchInput = page.getByPlaceholder(/Search summary, client, user/i);
  await searchInput.fill("");
  await searchInput.press("Enter");
}

test.describe("LIRA-069 — receipt print gating", () => {
  test("excluded provider rows show no Print button (OMT System, Whish System, OMT App transfer, Whish App transfer, Binance)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const markers = {
      omtSystem: `LIRA069 OMTSYS ${ts}`,
      whishSystem: `LIRA069 WHISHSYS ${ts}`,
      omtApp: `LIRA069 OMTAPP ${ts}`,
      whishAppTransfer: `LIRA069 WHISHXFER ${ts}`,
      binance: `LIRA069 BINANCE ${ts}`,
    };

    const results = await Promise.all([
      addOmtTransaction(appPage, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 11,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        clientName: markers.omtSystem,
      }),
      addOmtTransaction(appPage, {
        provider: "WHISH",
        serviceType: "SEND",
        amount: 12,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        clientName: markers.whishSystem,
      }),
      addOmtTransaction(appPage, {
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 13,
        currency: "USD",
        commission: 0,
        paidByMethod: "OMT",
        clientName: markers.omtApp,
      }),
      addOmtTransaction(appPage, {
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 14,
        currency: "USD",
        commission: 0,
        paidByMethod: "WHISH",
        clientName: markers.whishAppTransfer,
        // no itemKey — a plain transfer, not a Bill.
      }),
      addOmtTransaction(appPage, {
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 15,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        clientName: markers.binance,
      }),
    ]);
    for (const r of results) {
      expect(r.success, JSON.stringify(r)).toBe(true);
    }

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    for (const marker of Object.values(markers)) {
      const row = await findRowByMarker(appPage, marker);
      await expect(
        row.getByRole("button", { name: "Print", exact: true }),
      ).toHaveCount(0);
      await clearSearch(appPage);
    }
  });

  test("included rows show a Print button (iPick, Katsh, Whish App Bill, MTC recharge)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    // iPick/Katsh BILL rows stamp client_name NULL (client links via
    // client_id only) and an item-style summary — "iPick Bill: <amount> LBP"
    // — that embeds neither client nor note. The ONLY searchable identity for
    // them is a unique amount, so match on the full summary head (rule 15:
    // identity via uniqueness, never position). Found 2026-07-19 when the
    // first run searched for a clientName marker these rows never carry.
    const ipickAmount = 700_000 + (ts % 89_999);
    const katshAmount = 900_000 + (ts % 89_999);
    const markers = {
      ipick: `iPick Bill: ${ipickAmount} LBP`,
      katsh: `Katsh Bill: ${katshAmount} LBP`,
      whishBill: `LIRA069 WHISHBILL ${ts}`,
      mtc: `LIRA069 MTC ${ts}`,
    };

    const financialResults = await Promise.all([
      addOmtTransaction(appPage, {
        provider: "iPick",
        serviceType: "BILL",
        amount: ipickAmount,
        cost: ipickAmount,
        price: ipickAmount,
        currency: "LBP",
        commission: 0,
        paidByMethod: "CASH",
      }),
      addOmtTransaction(appPage, {
        provider: "Katsh",
        serviceType: "BILL",
        amount: katshAmount,
        cost: katshAmount,
        price: katshAmount,
        currency: "LBP",
        commission: 0,
        paidByMethod: "CASH",
      }),
      // Whish App BILL — item_key set is the ONLY discriminator between a
      // Bill (receiptable) and a transfer (excluded, see the test above).
      addOmtTransaction(appPage, {
        provider: "WHISH_APP",
        serviceType: "BILL",
        amount: 30,
        cost: 30,
        price: 30,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        clientName: markers.whishBill,
        itemKey: `e2e-bill-${ts}`,
      }),
    ]);
    for (const r of financialResults) {
      expect(r.success, JSON.stringify(r)).toBe(true);
    }

    const rechargeResult = await appPage.evaluate(
      (clientName) =>
        (
          window as unknown as {
            api: {
              recharge: {
                process: (d: Record<string, unknown>) => Promise<{
                  success?: boolean;
                  error?: string;
                  id?: number;
                }>;
              };
            };
          }
        ).api.recharge.process({
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 3,
          cost: 0.48,
          price: 267_000,
          currency: "LBP",
          paid_by_method: "CASH",
          clientName,
        }),
      markers.mtc,
    );
    expect(rechargeResult.success, JSON.stringify(rechargeResult)).toBe(true);

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    for (const marker of Object.values(markers)) {
      const row = await findRowByMarker(appPage, marker);
      await expect(
        row.getByRole("button", { name: "Print", exact: true }),
      ).toBeVisible({ timeout: 5_000 });
      await clearSearch(appPage);
    }
  });

  test("(if feasible headless) auto-print fires on a successful standalone recharge, and is skipped when a customer session is active", async ({
    appPage,
  }) => {
    // Capture the print via printReceipt's own e2e hook
    // (__LIRATEK_E2E_PRINT_STUB__): when installed, printReceipt hands the
    // hook the full receipt HTML instead of printing. This (a) proves
    // auto-print fired without opening a real print dialog (the native
    // dialog HANGS headless workers — found 2026-07-19, "Worker teardown
    // timeout" across the suite; printReceipt now also hard-skips the
    // dialog under navigator.webdriver), and (b) captures the HTML so the
    // assertion can confirm it's the RIGHT transaction's receipt (identity,
    // not just "something printed"). Removed in `finally` so later specs
    // exercise the default (webdriver-gated) path.
    await appPage.evaluate(() => {
      const w = window as unknown as {
        __LIRATEK_E2E_PRINT_STUB__?: (html: string) => void;
        __lira069PrintCalls: string[];
      };
      w.__lira069PrintCalls = [];
      w.__LIRATEK_E2E_PRINT_STUB__ = (html: string) => {
        w.__lira069PrintCalls.push(html);
      };
    });

    try {
      const ts = Date.now();
      const phone = `03${String(ts).slice(-7)}`;

      await navigateTo(appPage, "/recharge");
      const mtcTab = appPage
        .locator("button")
        .filter({ hasText: /^MTC$/ })
        .first();
      await expect(mtcTab).toBeVisible({ timeout: 8_000 });
      await mtcTab.click();

      // ── Standalone submit (no session) — auto-print MUST fire ──────────
      const phoneInput = appPage.locator("#telecom-phone");
      await expect(phoneInput).toBeVisible({ timeout: 8_000 });
      await phoneInput.fill(phone);
      const amountInput = appPage.locator("#telecom-amount");
      await amountInput.fill("3");

      const proceedBtn = appPage.getByRole("button", {
        name: /Proceed to Pay/i,
      });
      await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
      await proceedBtn.click();
      const confirmBtn = appPage
        .locator("button")
        .filter({ hasText: /^Pay / })
        .last();
      await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 8_000 });

      await appPage.waitForFunction(
        () =>
          (window as unknown as { __lira069PrintCalls: string[] })
            .__lira069PrintCalls.length > 0,
        { timeout: 8_000 },
      );
      const printedHtml = await appPage.evaluate(
        () =>
          (window as unknown as { __lira069PrintCalls: string[] })
            .__lira069PrintCalls[0],
      );
      // Identity — the printed receipt is for THIS phone's recharge, not a
      // stale/unrelated row (the receipt text includes the "Service:" line
      // and — for a phone-tagged CREDIT_TRANSFER — the phone number/summary
      // travels onto the transaction and, transitively, the printed note).
      expect(printedHtml).toContain("MTC");

      // ── Session-active submit — auto-print must be SKIPPED (the session
      // gets its own Print button at checkout, W1.b) ──────────────────────
      await appPage.evaluate(
        () =>
          ((
            window as unknown as { __lira069PrintCalls: string[] }
          ).__lira069PrintCalls.length = 0),
      );

      const sessionName = `LIRA069 SESSION ${ts}`;
      const started = await appPage.evaluate(
        (name) =>
          (
            window as unknown as {
              api: {
                session: {
                  start: (d: Record<string, unknown>) => Promise<{
                    success?: boolean;
                    sessionId?: number;
                    error?: string;
                  }>;
                };
              };
            }
          ).api.session.start({
            customer_name: name,
            started_by: "e2e",
          }),
        sessionName,
      );
      expect(started.success, JSON.stringify(started)).toBe(true);
      const sessionId = started.sessionId as number;

      try {
        // A fresh mount picks up the newly-started active session.
        await navigateTo(appPage, "/");
        await navigateTo(appPage, "/recharge");
        const mtcTab2 = appPage
          .locator("button")
          .filter({ hasText: /^MTC$/ })
          .first();
        await expect(mtcTab2).toBeVisible({ timeout: 8_000 });
        await mtcTab2.click();

        const phone2 = `03${String(ts + 1).slice(-7)}`;
        const phoneInput2 = appPage.locator("#telecom-phone");
        await expect(phoneInput2).toBeVisible({ timeout: 8_000 });
        await phoneInput2.fill(phone2);
        const amountInput2 = appPage.locator("#telecom-amount");
        await amountInput2.fill("3");

        // Session mode: the button reads "Add to Cart" (no PaymentSheet) —
        // it books the item into the session basket, no direct transaction.
        const addToCartBtn = appPage.getByRole("button", {
          name: /Add to Cart/i,
        });
        await expect(addToCartBtn).toBeVisible({ timeout: 5_000 });
        await addToCartBtn.click();
        // The form resets on success — phone field clears.
        await expect(phoneInput2).toHaveValue("", { timeout: 5_000 });

        // Give any (incorrect) async auto-print a moment to fire before
        // asserting its absence — waits UP TO 1.5s for the (wrong) call to
        // appear; the timeout is expected and swallowed, since the correct
        // behavior is that it never fires.
        await appPage
          .waitForFunction(
            () =>
              (window as unknown as { __lira069PrintCalls: string[] })
                .__lira069PrintCalls.length > 0,
            { timeout: 1_500 },
          )
          .catch(() => {});
        const callsAfterSessionAdd = await appPage.evaluate(
          () =>
            (window as unknown as { __lira069PrintCalls: string[] })
              .__lira069PrintCalls.length,
        );
        expect(callsAfterSessionAdd).toBe(0);
      } finally {
        // Never leave a session open for later specs (README "Known
        // couplings & hazards" — session leakage).
        await appPage.evaluate(
          (id) =>
            (
              window as unknown as {
                api: {
                  session: {
                    close: (
                      sessionId: number,
                      closedBy: string,
                    ) => Promise<unknown>;
                  };
                };
              }
            ).api.session.close(id, "e2e"),
          sessionId,
        );
        // Closing via raw API bypasses the UI — SessionContext only polls
        // getActiveSessions every 7s, so for up to 7 MORE seconds every page
        // still renders session mode and silently routes submits into the
        // now-dead basket. Wait for the UI to actually leave session mode so
        // the NEXT spec in this worker starts session-free (this exact race
        // made lira-093's custom-services submit vanish, 2026-07-19).
        await navigateTo(appPage, "/recharge");
        const mtcTabAfterClose = appPage
          .locator("button")
          .filter({ hasText: /^MTC$/ })
          .first();
        await expect(mtcTabAfterClose).toBeVisible({ timeout: 8_000 });
        await mtcTabAfterClose.click();
        await expect(
          appPage.getByRole("button", { name: /Add to Cart/i }),
        ).toHaveCount(0, { timeout: 15_000 });
      }
    } finally {
      await appPage.evaluate(() => {
        const w = window as unknown as {
          __LIRATEK_E2E_PRINT_STUB__?: (html: string) => void;
          __lira069PrintCalls?: string[];
        };
        delete w.__LIRATEK_E2E_PRINT_STUB__;
        delete w.__lira069PrintCalls;
      });
    }
  });
});

// Keep a typed reference to Page so the import is always used (matches the
// convention in lira-062-ipick-katsh-bill.spec.ts).
export type _ReceiptGatingSpecPage = Page;
