/**
 * E2E: LIRA-116 (PFT-4) — a Loto ticket sale "for the partner" books its
 * unpaid remainder to partner_ledger (FOR_LOTO DEBIT) instead of a client's
 * debt_ledger. Loto is LBP-denominated, so the remainder is native LBP.
 *
 * Mirrors LIRA-113 (PFT-2, POS) but for the Loto module. UNLIKE lira-113,
 * there is NO void step: LOTO is in NON_REVERSIBLE_TRANSACTION_TYPES
 * (packages/core/src/constants/transactionTypes.ts), so
 * TransactionRepository.voidTransaction/refundTransaction THROW before ever
 * reaching `_reversePartnerLedger` for a LOTO transaction — there is no loto
 * void path to exercise. The FOR_LOTO row's reversal owner is partner
 * settlement, exactly like the pre-existing non-reversible 'Loto Debt' row
 * (rule 20 is satisfied because the type is already gated non-reversible).
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - routing: partner LBP balance rises by exactly the remainder
 *     (500,000 − 200,000 = 300,000 LBP) — booked as FOR_LOTO DEBIT.
 *   - the General LBP drawer still takes the 200,000 LBP cash paid.
 *
 * Rule 17 (failing-first): pre-fix, lotoSellSchema strips partnerId/
 * partnerMode (not in the schema) before they ever reach the repository, so
 * LotoService.sellTicket's rebuilt ticketData object also never carries them
 * (the field-pick bug named in the task). No FOR branch runs, no partner
 * ledger entry is written, and the 300,000 LBP remainder lands nowhere — the
 * `partnerLbpDelta ≈ 300000` assertion below fails (observed delta 0).
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: {
        name: string;
        phone?: string;
        notes?: string;
      }) => Promise<{ success: boolean; data?: { id: number }; error?: string }>;
      getBalance: (partnerId: number) => Promise<{ usd: number; lbp: number }>;
    };
    loto: {
      sell: (d: unknown) => Promise<{
        success: boolean;
        ticket?: { id: number };
        error?: string;
      }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
  };
};

async function generalLbp(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.lbpBalance ?? 0;
  });
}

test.describe("LIRA-116 — Loto ticket for a partner books the remainder to partner_ledger", () => {
  test("remainder → partner FOR_LOTO DEBIT; cash to drawer", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const NOTE = `L116 ${ts}`;

    const drawerBefore = await generalLbp(appPage);

    const result = await appPage.evaluate(
      async ({ note }) => {
        const w = window as unknown as Api;

        const created = await w.api.partners.create({
          name: `L116 Partner ${Date.now()}`,
          phone: `L116${Date.now()}`.slice(0, 12),
        });
        if (!created.success || !created.data) {
          return {
            ok: false,
            error: created.error ?? "partner create failed",
            partnerId: 0,
            partnerBalBefore: 0,
            partnerBalAfterSale: 0,
          };
        }
        const partnerId = created.data.id;
        const balLbp = async () =>
          (await w.api.partners.getBalance(partnerId)).lbp;

        const partnerBalBefore = await balLbp();

        // 500,000 LBP ticket, customer pays 200,000 LBP cash now → partner
        // owes the 300,000 LBP remainder on their account.
        const res = await w.api.loto.sell({
          sale_amount: 500000,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 200000,
              direction: "IN",
            },
          ],
          exchange_rate: 100000,
          note,
        });

        return {
          ok: res.success,
          error: res.error ?? null,
          partnerId,
          partnerBalBefore,
          partnerBalAfterSale: await balLbp(),
        };
      },
      { note: NOTE },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // Routing (the failing-first assertion): the partner now owes the
    // 300,000 LBP remainder — booked as FOR_LOTO DEBIT (positive balance =
    // partner owes the shop). Pre-PFT-4, partnerId/partnerMode never reach
    // the repository (schema strip + service field-pick), so no FOR branch
    // runs and this delta is 0.
    expect(
      result.partnerBalAfterSale - result.partnerBalBefore,
    ).toBeCloseTo(300000, 0);

    // The General drawer still takes the 200,000 LBP cash the customer paid.
    const drawerAfterSale = await generalLbp(appPage);
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(200000, 0);
  });
});
