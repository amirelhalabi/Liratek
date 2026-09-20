/**
 * E2E: LIRA-069 — Receipt-printing gate (W1.a/W1.d)
 *
 * `isReceiptableTransaction` (frontend/src/features/audit/receiptGating.ts)
 * is the single provider-aware predicate driving:
 *   - the Transactions viewer's per-row Print button (asserted here),
 *   - each module's History-modal Print button (same predicate, not
 *     re-asserted per-surface — see the unit-test matrix for the exhaustive
 *     include/exclude cases).
 *
 * The auto-print-on-success hook (useAutoPrintReceipt) was DISABLED per
 * owner request (2026-07-28). A third test here asserted it never fires —
 * removed 2026-09-20 on owner request: it drove two full recharge
 * submissions plus a session open/close and two deliberate 1.5s waits for
 * something that must not happen, which is a lot of suite time to prove a
 * negative about a hook that is switched off at the source. Do NOT
 * reinstate it as "missing coverage" without asking. The manual Print
 * buttons are a separate code path and are still covered below.
 *
 * Row identity (CLAUDE.md rule 15): every created row carries a unique
 * `clientName` marker (Date.now()-seeded) and is located via the /audit
 * search box — NEVER by row position (`tbody tr.first()` / `getRecent()[0]`)
 * in this shared, accumulating per-worker DB.
 *
 * Failing-first procedure (rule 17):
 *  - Print-button tests: temporarily revert `isReceiptableTransaction` in
 *    receiptGating.ts to the old type-only gate (`return type ===
 *    "FINANCIAL_SERVICE" || ALWAYS_RECEIPTABLE_TYPES.has(type)`) — the
 *    "excluded provider rows show no Print button" test must FAIL.
 *  Restore the fix and confirm it passes again.
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
  partnerId?: number;
  partnerMode?: "THROUGH" | "FOR";
};

/** Create a partner, needed to book a SECONDARY-system (WHISH, when the shop's
 *  base system is OMT) transfer — see the WHISH row in the excluded-providers
 *  test below. */
async function createPartner(page: Page, tag: string): Promise<number> {
  return page.evaluate(async (t) => {
    const created = await (
      window as unknown as {
        api: {
          partners: {
            create: (d: { name: string; phone?: string }) => Promise<{
              success: boolean;
              data?: { id: number };
              error?: string;
            }>;
          };
        };
      }
    ).api.partners.create({ name: `${t}`, phone: `${Date.now()}` });
    if (!created.success || !created.data) {
      throw new Error(created.error ?? "partner create failed");
    }
    return created.data.id;
  }, tag);
}

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

    // The WHISH row needs a partner. The shop's base system is OMT here, so
    // WHISH is the SECONDARY system, and a walk-in transfer booked directly
    // against it is rejected by FinancialServiceRepository (float-model change,
    // 2026-07-30): it used to skip the supplier-ledger entry and book the
    // obligation into NO ledger at all. The UI already forbade this state
    // (app.spec.ts:391 "WHISH disabled without partner (OMT-base)"); this spec
    // reached it only by calling IPC directly. Routing through a partner is
    // faithful to what the app actually permits, and the row is still a
    // provider-WHISH FINANCIAL_SERVICE — which is all the print gate reads.
    const whishPartnerId = await createPartner(
      appPage,
      `LIRA069 WhishPartner ${ts}`,
    );

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
        partnerId: whishPartnerId,
        partnerMode: "THROUGH",
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

  test("included rows show a Print button (iPick, Katsh, Whish App Bill, MTC recharge, LOTO ticket sale)", async ({
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
    // LOTO (LIRA-100): a ticket sale row — one of the always-receiptable
    // types (receiptGating.ts ALWAYS_RECEIPTABLE_TYPES), same as MAINTENANCE/
    // CUSTOM_SERVICE, but never previously exercised end-to-end by this spec
    // despite being pinned in the unit-test matrix
    // (receiptGating.test.ts: `{ type: "LOTO" } -> true`).
    const lotoSaleAmount = 500_000 + (ts % 89_999);
    const markers = {
      ipick: `iPick Bill: ${ipickAmount} LBP`,
      katsh: `Katsh Bill: ${katshAmount} LBP`,
      whishBill: `LIRA069 WHISHBILL ${ts}`,
      mtc: `LIRA069 MTC ${ts}`,
      loto: `LIRA069 LOTO ${ts}`,
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

    const lotoResult = await appPage.evaluate(
      ({ clientName, saleAmount }) =>
        (
          window as unknown as {
            api: {
              loto: {
                sell: (d: Record<string, unknown>) => Promise<{
                  success?: boolean;
                  error?: string;
                  ticket?: { id?: number };
                }>;
              };
            };
          }
        ).api.loto.sell({
          sale_amount: saleAmount,
          currency: "LBP",
          payment_method: "CASH",
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: saleAmount },
          ],
          clientName,
        }),
      { clientName: markers.loto, saleAmount: lotoSaleAmount },
    );
    expect(lotoResult.success, JSON.stringify(lotoResult)).toBe(true);

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
});

// Keep a typed reference to Page so the import is always used (matches the
// convention in lira-062-ipick-katsh-bill.spec.ts).
export type _ReceiptGatingSpecPage = Page;
