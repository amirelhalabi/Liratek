/**
 * E2E: LIRA-115 (PFT-R) — a mobile RECHARGE (MTC/Alfa) "for the partner"
 * books the FULL price to partner_ledger (FOR_RECHARGE DEBIT), with NO
 * counter cash taken from any customer, and voiding the recharge reverses
 * that partner row to net 0.
 *
 * Supersedes the original PFT-3a "remainder" model (owner-validated revision,
 * docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md, "VALIDATED FLOW CATALOG"): a
 * "for partner" transaction has NO walk-in customer in between — the shop
 * acts for the partner, who owes the shop the FULL amount, settled later on
 * the Partners page. No cash is taken at the counter, so partner mode must
 * now REJECT any counter payment leg outright instead of booking a
 * remainder.
 *
 * Money invariants under guard (rule 15 — deltas + identity only):
 *   - routing: partner USD balance rises by exactly the FULL price ($137 on
 *     a $137 recharge with zero payment legs) — no counter cash at all.
 *   - the General drawer does NOT move (no customer cash step in partner
 *     mode).
 *   - reversal (rule 20, type-agnostic in TransactionRepository): voiding
 *     the RECHARGE transaction writes the negating partner_ledger CREDIT so
 *     the partner balance nets back to exactly 0; the drawer stays at 0.
 *   - a counter payment leg sent alongside partnerMode "FOR" is rejected
 *     outright (result.success === false) — there is no walk-in customer to
 *     collect cash from in this model.
 *
 * Rule 17 (failing-first): the currently-committed RechargeRepository
 * (6a8dc06) implements the superseded remainder model — it REQUIRES
 * `data.payments` to be non-empty in partner mode ("A partner FOR-recharge
 * requires explicit payment legs") and, when a drawer-affecting same-currency
 * IN leg is supplied, happily accepts it and books only the unpaid remainder
 * (price − paidNow) to the partner. Concretely, sending the $40 CASH leg
 * below in partner mode on committed code does NOT get rejected — it
 * succeeds (`result.success === true`) and books a $97 remainder, not the
 * full $137. The failing-first assertion is
 * `expect(rejected.ok).toBe(false)` in the second sub-test: on committed
 * code `rejected.ok` is `true` (the leg is accepted), so that assertion
 * fails. (The first sub-test — no payment legs at all — also fails on
 * committed code, but for a different reason: committed code throws "A
 * partner FOR-recharge requires explicit payment legs" and returns
 * `success: false`, so `expect(result.ok).toBe(true)` fails too. Both
 * confirm the revision; the task calls out the leg-rejection case
 * specifically.)
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    partners: {
      create: (d: { name: string; phone?: string; notes?: string }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
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

async function createPartner(page: Page, label: string): Promise<number> {
  const ts = Date.now();
  return page.evaluate(
    async ({ label, ts }) => {
      const w = window as unknown as Api;
      const created = await w.api.partners.create({
        name: `${label} ${ts}`,
        // Keep the label's letters in the phone (not just the timestamp) so
        // the two partners in this file never collide even if both tests
        // happened to run within the same millisecond.
        phone: `${label}${ts}`.slice(0, 12),
      });
      if (!created.success || !created.data) {
        throw new Error(created.error ?? "partner create failed");
      }
      return created.data.id;
    },
    { label, ts },
  );
}

test.describe("LIRA-115 — mobile RECHARGE for a partner books the FULL amount, no counter cash", () => {
  test("no payment legs → partner FOR_RECHARGE DEBIT for the full $137; drawer untouched; void nets partner and drawer to 0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partnerId = await createPartner(appPage, "L115FullA");

    const drawerBefore = await generalUsd(appPage);
    const partnerBalBefore = (
      await appPage.evaluate(
        async (id) => (window as unknown as Api).api.partners.getBalance(id),
        partnerId,
      )
    ).usd;

    const result = await appPage.evaluate(
      async ({ partnerId, ts }) => {
        const w = window as unknown as Api;
        // Partner mode: no walk-in customer, no counter cash — the full price
        // goes straight on the partner's tab. No `payments` array at all.
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 137,
          cost: 0,
          price: 137,
          currency: "USD",
          partnerId,
          partnerMode: "FOR",
          note: `L115 full ${ts}`,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, ts },
    );

    // Failing-first (see file header): committed code throws "A partner
    // FOR-recharge requires explicit payment legs" here → ok would be false.
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    const partnerBalAfter = (
      await appPage.evaluate(
        async (id) => (window as unknown as Api).api.partners.getBalance(id),
        partnerId,
      )
    ).usd;

    // Routing: the partner owes the FULL $137 — no remainder math, no
    // counter cash collected first.
    expect(partnerBalAfter - partnerBalBefore).toBeCloseTo(137, 2);

    // No customer cash step in partner mode → the General drawer must not
    // move at all.
    const drawerAfterRecharge = await generalUsd(appPage);
    expect(drawerAfterRecharge - drawerBefore).toBeCloseTo(0, 2);

    // Reversal symmetry (rule 20): voiding the RECHARGE writes the negating
    // partner_ledger CREDIT → partner balance nets back to exactly 0.
    // Match by identity (type + summary containing the distinctive $137
    // price — kept under 1000 so toLocaleString() emits no thousands comma).
    const netted = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const row = (await w.api.transactions.getRecent(100)).find(
        (t) => t.type === "RECHARGE" && (t.summary ?? "").includes("137"),
      );
      const voided = row
        ? await w.api.transactions.void(row.id)
        : { success: false, error: "recharge txn not found" };
      const after = (await w.api.partners.getBalance(partnerId)).usd;
      return { ok: voided.success, error: voided.error ?? null, after };
    }, partnerId);

    expect(netted.error).toBeNull();
    expect(netted.ok).toBe(true);
    expect(netted.after - partnerBalBefore).toBeCloseTo(0, 2);

    // And the drawer, which never moved, stays at 0 delta after void too.
    const drawerAfterVoid = await generalUsd(appPage);
    expect(drawerAfterVoid - drawerBefore).toBeCloseTo(0, 2);
  });

  test("a counter payment leg in partner mode is rejected outright — there is no walk-in customer to collect cash from", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partnerId = await createPartner(appPage, "L115Reject");

    const drawerBefore = await generalUsd(appPage);
    const partnerBalBefore = (
      await appPage.evaluate(
        async (id) => (window as unknown as Api).api.partners.getBalance(id),
        partnerId,
      )
    ).usd;

    const rejected = await appPage.evaluate(
      async ({ partnerId, ts }) => {
        const w = window as unknown as Api;
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "VOUCHER",
          amount: 137,
          cost: 0,
          price: 137,
          currency: "USD",
          partnerId,
          partnerMode: "FOR",
          // Gotcha: payment legs use currencyCode (camelCase), not
          // currency_code.
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 40,
              direction: "IN",
            },
          ],
          note: `L115 reject ${ts}`,
        });
        return { ok: res.success, error: res.error ?? null };
      },
      { partnerId, ts },
    );

    // Failing-first (see file header): on committed code this leg is
    // ACCEPTED (drawer-affecting, same currency) and only the $97 remainder
    // (137 − 40) books to the partner — `rejected.ok` is `true` there, not
    // `false`. This is the assertion the task calls out explicitly. (On new
    // code this call throws and its whole db.transaction() rolls back before
    // any recharge/transaction row is written, so it can never collide with
    // the $137-priced recharge created — and voided — in the first sub-test.)
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain("no counter payment");

    // Nothing should have moved — the whole attempt rolled back inside the
    // repository's db.transaction() on throw.
    const partnerBalAfter = (
      await appPage.evaluate(
        async (id) => (window as unknown as Api).api.partners.getBalance(id),
        partnerId,
      )
    ).usd;
    expect(partnerBalAfter - partnerBalBefore).toBeCloseTo(0, 2);

    const drawerAfter = await generalUsd(appPage);
    expect(drawerAfter - drawerBefore).toBeCloseTo(0, 2);
  });
});
