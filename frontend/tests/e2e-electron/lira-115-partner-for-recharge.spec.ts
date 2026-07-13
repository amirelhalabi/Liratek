/**
 * E2E: LIRA-115 (PFT-3a) — a mobile RECHARGE (MTC/Alfa) "for the partner"
 * books its unpaid remainder to partner_ledger (FOR_RECHARGE DEBIT) instead
 * of a client's debt_ledger, and voiding the recharge reverses that partner
 * row to net 0.
 *
 * Mirrors lira-113-partner-for-pos.spec.ts (PFT-2, the POS template) for the
 * mobile RECHARGE family. A FOR-partner recharge is a normal recharge (stock
 * consumed, cash collected to the drawer as usual) except the remainder the
 * customer did NOT pay lands on the selected partner's account, not a
 * client's — no partner is a client here (clientId is never set), so
 * pre-PFT-3a the remainder had nowhere to go but debt_ledger, which throws
 * for a missing client.
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - routing: partner USD balance rises by exactly the remainder ($97 on a
 *     $137 recharge paid $40 cash).
 *   - the drawer still takes the $40 cash the customer paid.
 *   - reversal (rule 20, type-agnostic in TransactionRepository): voiding the
 *     RECHARGE transaction writes the negating partner_ledger CREDIT so the
 *     partner balance nets back to exactly 0, and the drawer nets back to 0.
 *
 * Rule 17 (failing-first): pre-PFT-3a, RechargeRepository.processRecharge has
 * no partnerMode branch — `data.partnerId`/`data.partnerMode` are inert, the
 * unpaid $97 falls into the `hasDebt` path with no clientId, and
 * `data.payments` containing only a drawer-affecting CASH leg means
 * `hasDebt` never even gets set, so process() returns `{ success: true }`
 * with the $97 silently unrouted (no partner_ledger row is written at all).
 * The `result.ok === true` assertion still passes, but the very next
 * assertion — `partnerBalAfterRecharge - partnerBalBefore ≈ 97` — fails
 * (delta is 0, not 97). That is the failing-first assertion.
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
    recharge: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number }>
      >;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "General")?.usdBalance ?? 0;
  });
}

test.describe("LIRA-115 — mobile RECHARGE for a partner books the remainder to partner_ledger", () => {
  test("remainder → partner FOR_RECHARGE DEBIT (not client debt); cash to drawer; void nets partner to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();

    const drawerBefore = await generalUsd(appPage);

    const result = await appPage.evaluate(async ({ ts }) => {
      const w = window as unknown as Api;

      const created = await w.api.partners.create({
        name: `L115 Partner ${ts}`,
        phone: `L115${ts}`.slice(0, 12),
      });
      if (!created.success || !created.data) {
        return {
          ok: false,
          error: created.error ?? "partner create failed",
          partnerId: 0,
          partnerBalBefore: 0,
          partnerBalAfterRecharge: 0,
        };
      }
      const partnerId = created.data.id;
      const balUsd = async () =>
        (await w.api.partners.getBalance(partnerId)).usd;

      const partnerBalBefore = await balUsd();

      // cost 0, price 137 (VOUCHER); customer pays $40 CASH now → partner
      // owes the $97 remainder on their account.
      const res = await w.api.recharge.process({
        provider: "MTC",
        type: "VOUCHER",
        amount: 137,
        cost: 0,
        price: 137,
        currency: "USD",
        partnerId,
        partnerMode: "FOR",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 40, direction: "IN" },
        ],
        note: `L115 ${ts}`,
      });

      return {
        ok: res.success,
        error: res.error ?? null,
        partnerId,
        partnerBalBefore,
        partnerBalAfterRecharge: await balUsd(),
      };
    }, { ts });

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // Routing: the partner now owes the $97 remainder — booked as
    // FOR_RECHARGE DEBIT (positive balance = partner owes the shop). This is
    // the failing-first assertion: pre-PFT-3a the $97 is unrouted (delta 0).
    expect(
      result.partnerBalAfterRecharge - result.partnerBalBefore,
    ).toBeCloseTo(97, 2);

    // The drawer still takes the $40 cash the customer paid.
    const drawerAfterRecharge = await generalUsd(appPage);
    expect(drawerAfterRecharge - drawerBefore).toBeCloseTo(40, 2);

    // Reversal symmetry (rule 20): voiding the RECHARGE writes the negating
    // partner_ledger CREDIT → partner balance nets back to exactly 0.
    // Match by identity (type + summary containing the distinctive $137
    // price — kept under 1000 so toLocaleString() emits no thousands comma).
    const netted = await appPage.evaluate(
      async ({ partnerId, partnerBalBefore }) => {
        const w = window as unknown as Api;
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) => t.type === "RECHARGE" && (t.summary ?? "").includes("137"),
        );
        const voided = row
          ? await w.api.transactions.void(row.id)
          : { success: false, error: "recharge txn not found" };
        const after = (await w.api.partners.getBalance(partnerId)).usd;
        return {
          ok: voided.success,
          error: voided.error ?? null,
          netPartnerDelta: after - partnerBalBefore,
        };
      },
      { partnerId: result.partnerId, partnerBalBefore: result.partnerBalBefore },
    );

    expect(netted.error).toBeNull();
    expect(netted.ok).toBe(true);
    expect(netted.netPartnerDelta).toBeCloseTo(0, 2);

    // And the drawer gives the $40 cash back on void.
    const drawerAfterVoid = await generalUsd(appPage);
    expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
  });
});
