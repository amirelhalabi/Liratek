/**
 * E2E: LIRA-117 (PFT-5) — settling a partner's USDT balance must pick its
 * DEBIT/CREDIT direction off the USDT balance itself, not the USD balance's
 * SIGN.
 *
 * The bug: PartnerService.settle() derived settlement direction from
 * `data.currency === "LBP" ? balance.lbp : balance.usd` — any non-LBP
 * currency (including the newly-surfaced USDT bucket) fell through to
 * balance.usd. A partner can simultaneously owe USDT (positive) while the
 * shop owes them USD (negative) — settling the USDT balance then reads the
 * USD sign, picks the WRONG direction, and the settlement DOUBLES the USDT
 * balance instead of netting it toward zero. Real money bug: a "settle"
 * action that moves the ledger further from zero.
 *
 * Money invariant under guard (rule 15 — deltas + identity only):
 *   - Two manual ADJUSTMENT entries force balance.usd negative (-30) while
 *     balance.usdt / breakdown.usdt.total stays positive (+50).
 *   - Settling exactly the USDT remainder (50 USDT via BINANCE) must net
 *     breakdown.usdt.total back to ~0 — the direction must come from the
 *     USDT balance, not the USD balance's sign.
 *
 * Rule 17 (failing-first): pre-fix, settle() reads balance.usd (=-30,
 * negative) → direction "DEBIT" → records ANOTHER USDT DEBIT 50 →
 * breakdown.usdt.total becomes +100 (50 + 50), not 0. The
 * `expect(result.usdtAfterSettle).toBeCloseTo(0, 2)` assertion below FAILS
 * on pre-fix code (100 !== 0) and PASSES post-fix (settle() reads
 * balance.usdt = +50 → direction "CREDIT" → 50 - 50 = 0).
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: {
        name: string;
        phone?: string;
        notes?: string;
      }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      recordTransaction: (d: {
        partnerId: number;
        transactionType?: string;
        amount: number;
        currency: string;
        direction: "DEBIT" | "CREDIT";
        notes?: string;
      }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
      settle: (d: {
        partnerId: number;
        amount: number;
        currency: string;
        settlementMethod: string;
        notes?: string;
      }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
      getLedger: (partnerId: number) => Promise<{
        balance: { usd: number; lbp: number; usdt: number };
        breakdown: {
          usd: { for: number; through: number; other: number; total: number };
          lbp: { for: number; through: number; other: number; total: number };
          usdt: {
            for: number;
            through: number;
            other: number;
            total: number;
          };
        };
      }>;
    };
  };
};

test.describe("LIRA-117 — partner USDT settlement direction is keyed off the USDT balance, not USD", () => {
  test("USDT DEBIT 50 + USD CREDIT 30 (USD negative, USDT positive); settling 50 USDT nets usdt.total to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const NAME = `L117 PartnerUSDT ${ts}`;

    const result = await appPage.evaluate(
      async ({ name }) => {
        const w = window as unknown as Api;

        const created = await w.api.partners.create({
          name,
          phone: `L117${Date.now()}`.slice(0, 12),
        });
        if (!created.success || !created.data) {
          return {
            ok: false,
            error: created.error ?? "partner create failed",
            usdtBeforeSettle: 0,
            usdtAfterSettle: 0,
          };
        }
        const partnerId = created.data.id;

        // USDT DEBIT 50 → partner owes the shop 50 USDT (usdt.total = +50).
        const usdtDebit = await w.api.partners.recordTransaction({
          partnerId,
          transactionType: "ADJUSTMENT",
          currency: "USDT",
          amount: 50,
          direction: "DEBIT",
        });

        // USD CREDIT 30 → the shop owes the partner $30 (usd = -30). This is
        // the trap: a settle() that keys off balance.usd's SIGN for any
        // non-LBP currency picks the wrong direction for the USDT leg.
        const usdCredit = await w.api.partners.recordTransaction({
          partnerId,
          transactionType: "ADJUSTMENT",
          currency: "USD",
          amount: 30,
          direction: "CREDIT",
        });

        if (!usdtDebit.success || !usdCredit.success) {
          return {
            ok: false,
            error: usdtDebit.error ?? usdCredit.error ?? "record failed",
            usdtBeforeSettle: 0,
            usdtAfterSettle: 0,
          };
        }

        const before = await w.api.partners.getLedger(partnerId);

        const settled = await w.api.partners.settle({
          partnerId,
          amount: 50,
          currency: "USDT",
          settlementMethod: "BINANCE",
        });
        if (!settled.success) {
          return {
            ok: false,
            error: settled.error ?? "settle failed",
            usdtBeforeSettle: before.breakdown.usdt.total,
            usdtAfterSettle: 0,
          };
        }

        const after = await w.api.partners.getLedger(partnerId);

        return {
          ok: true,
          error: null,
          usdtBeforeSettle: before.breakdown.usdt.total,
          usdtAfterSettle: after.breakdown.usdt.total,
        };
      },
      { name: NAME },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // Sanity: the two manual entries land the USDT bucket at exactly +50
    // before settlement — the USD leg going negative must not bleed into it.
    expect(result.usdtBeforeSettle).toBeCloseTo(50, 2);

    // THE failing-first assertion (rule 17). Pre-fix: settle() reads
    // balance.usd (-30, negative) → direction "DEBIT" → a SECOND USDT DEBIT
    // 50 is recorded → usdt.total becomes +100. Post-fix: settle() reads
    // balance.usdt (+50, positive) → direction "CREDIT" → nets to 0.
    expect(result.usdtAfterSettle).toBeCloseTo(0, 2);
  });
});
