/**
 * E2E: LIRA-124 — carrier-legs void asymmetry, design B+
 * (docs/plans/todo_plans/CARRIER_LEGS_VOID_ASYMMETRY.md)
 *
 * A multi-unit split checkout (KatchForm bills / FinancialForm catalog
 * units) submits ONE unified transaction per unit, but the customer's full
 * tender books against exactly ONE unit — the CARRIER; every SIBLING unit
 * defers its own cost/commission only (`deferPayment: true`). Before this
 * fix, the generic void/refund was per-transaction: voiding the carrier
 * alone reversed the WHOLE checkout's customer cash but only the carrier's
 * own cost, and voiding a sibling alone reversed its cost but left the
 * customer charged for a "cancelled" unit. Neither case net to 0.
 *
 * Design B+ (no migration): every unit is stamped with `split_group` (uuid)
 * / `split_role` ('carrier'|'sibling') / `split_units` in its
 * `metadata_json`. The generic void/refund path refuses a lone member;
 * `voidCheckoutGroup` voids every non-voided member (siblings first,
 * carrier last) in ONE db transaction.
 *
 * WRITE-ONLY per W5's constraints (never run `yarn test:e2e` from this
 * workstream). Failing-first procedure for whoever runs this (Fable, the
 * verification phase):
 *   1. In packages/core/src/repositories/TransactionRepository.ts, comment
 *      out the `if (!opts.allowSplitGroupMember) { ... }` block inside
 *      `_assertReversible` (the split-group guard) — see the core jest
 *      failing-first output already captured in the W5 report for the exact
 *      lines.
 *   2. `cd packages/core && npm run build` + sync `node_modules/@liratek/core/dist`.
 *   3. `yarn dev` (rebuild electron-app/dist) → stop → `env -u ELECTRON_RUN_AS_NODE yarn test:e2e -- lira-124`.
 *   4. Expect: the guard assertions in the FIRST test (`voidCarrier`/
 *      `voidSibling`/`refundCarrier` all expected `success: false`) FAIL —
 *      the pre-fix void/refund succeeds instead of being blocked. The
 *      metadata-wiring and `voidCheckoutGroup`-netting assertions in the
 *      same test, and the SECOND test's "Void entire checkout" button
 *      assertion, are unaffected by the guard and should still pass — the
 *      guard is the ONLY thing disabled by this step.
 *   5. Restore the guard, rebuild + sync again, re-run → all pass.
 *
 * Identity-matched rows, delta assertions throughout (rule 15) — this spec
 * runs against the shared accumulating e2e DB.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    omt: {
      addTransaction: (
        data: Record<string, unknown>,
      ) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<unknown>;
      void: (
        id: number,
      ) => Promise<{ success?: boolean; reversalId?: number; error?: string }>;
      refund: (
        id: number,
      ) => Promise<{ success?: boolean; refundId?: number; error?: string }>;
      voidCheckoutGroup: (groupId: string) => Promise<{
        success?: boolean;
        memberCount?: number;
        voidedTransactionIds?: number[];
        reversalIds?: number[];
        error?: string;
      }>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
    recharge: {
      // All drawers, one entry per drawer (NOT a name-keyed object).
      getDrawerBalances: () => Promise<
        Array<{
          name: string;
          usdBalance: number;
          lbpBalance: number;
          usdtBalance: number;
        }>
      >;
    };
  };
};

type TxnRow = {
  id: number;
  source_id?: number | null;
  type?: string;
  status?: string;
  reverses_id?: number | null;
  metadata_json?: string | null;
};

// NOTE: no module-scope helpers inside page.evaluate() callbacks — the
// callback is serialized into the page, where outer values don't exist
// (a `ReferenceError: asList is not defined` shipped in this spec's first
// run). Coerce inline; module-scope TYPES are fine (erased at compile time).

test.describe("LIRA-124 — split-checkout void guard + whole-group void (design B+)", () => {
  test("a lone carrier or sibling of a split checkout cannot be voided/refunded alone; voidCheckoutGroup nets the Katsh drawer back to baseline", async ({
    appPage,
  }) => {
    // Unique amounts so this checkout's rows are identity-matched, never by
    // row position (rule 15) — the shared e2e DB accumulates rows from every
    // earlier spec. The group id MUST be a real uuid — the shared Zod schema
    // validates split_group with .uuid(), same as the forms' crypto.randomUUID().
    const groupId = crypto.randomUUID();
    const carrierAmount = 24.71;
    const siblingAmount = 18.53;

    const created = await appPage.evaluate(
      async (args: {
        groupId: string;
        carrierAmount: number;
        siblingAmount: number;
      }) => {
        const w = window as unknown as Api;
        const drawersBefore = await w.api.recharge.getDrawerBalances();

        // Mirrors KatchForm's real payload for a 2-bill checkout: unit 1
        // (carrier) carries the full customer tender + checkoutTotal; unit 2
        // (sibling) defers (cost/commission only). Both stamp the same
        // split_group/split_units; role differs.
        const carrier = await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount: args.carrierAmount,
          cost: args.carrierAmount,
          price: args.carrierAmount,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: args.carrierAmount + args.siblingAmount,
            },
          ],
          checkoutTotal: {
            usd: args.carrierAmount + args.siblingAmount,
            lbp: 0,
          },
          split_group: args.groupId,
          split_role: "carrier",
          split_units: 2,
        });
        const sibling = await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount: args.siblingAmount,
          cost: args.siblingAmount,
          price: args.siblingAmount,
          currency: "USD",
          commission: 0,
          deferPayment: true,
          split_group: args.groupId,
          split_role: "sibling",
          split_units: 2,
        });

        return {
          carrierOk: carrier.success === true,
          carrierError: carrier.error ?? null,
          carrierFsId: carrier.id ?? null,
          siblingOk: sibling.success === true,
          siblingError: sibling.error ?? null,
          siblingFsId: sibling.id ?? null,
          katshUsdBefore:
            drawersBefore.find((d) => d.name === "Katsh")?.usdBalance ?? null,
          generalUsdBefore:
            drawersBefore.find((d) => d.name === "General")?.usdBalance ?? null,
        };
      },
      { groupId, carrierAmount, siblingAmount },
    );

    expect(created.carrierError).toBeNull();
    expect(created.carrierOk).toBe(true);
    expect(created.siblingError).toBeNull();
    expect(created.siblingOk).toBe(true);

    // Resolve the unified transaction ids by identity (source_id link, NOT
    // "newest row" — rule 15).
    const ids = await appPage.evaluate(
      async (args: { carrierFsId: number; siblingFsId: number }) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(100, {
          source_table: "financial_services",
        });
        const list = (
          Array.isArray(recent)
            ? recent
            : ((recent as { transactions?: unknown[] })?.transactions ?? [])
        ) as TxnRow[];
        const carrierTxn = list.find(
          (t) =>
            t.source_id === args.carrierFsId &&
            t.type === "FINANCIAL_SERVICE" &&
            !t.reverses_id,
        );
        const siblingTxn = list.find(
          (t) =>
            t.source_id === args.siblingFsId &&
            t.type === "FINANCIAL_SERVICE" &&
            !t.reverses_id,
        );
        return {
          carrierTxnId: carrierTxn?.id ?? null,
          siblingTxnId: siblingTxn?.id ?? null,
          carrierMeta: carrierTxn?.metadata_json ?? null,
        };
      },
      { carrierFsId: created.carrierFsId!, siblingFsId: created.siblingFsId! },
    );
    expect(ids.carrierTxnId).not.toBeNull();
    expect(ids.siblingTxnId).not.toBeNull();

    // Wiring sanity: the carrier row's metadata carries the split linkage.
    const carrierMeta = JSON.parse(ids.carrierMeta ?? "{}") as {
      split_group?: string;
      split_role?: string;
      split_units?: number;
    };
    expect(carrierMeta.split_group).toBe(groupId);
    expect(carrierMeta.split_role).toBe("carrier");
    expect(carrierMeta.split_units).toBe(2);

    // The guard: a lone void/refund of EITHER unit is refused.
    const guardResult = await appPage.evaluate(
      async (args: { carrierTxnId: number; siblingTxnId: number }) => {
        const w = window as unknown as Api;
        const voidCarrier = await w.api.transactions.void(args.carrierTxnId);
        const voidSibling = await w.api.transactions.void(args.siblingTxnId);
        const refundCarrier = await w.api.transactions.refund(
          args.carrierTxnId,
        );
        return { voidCarrier, voidSibling, refundCarrier };
      },
      { carrierTxnId: ids.carrierTxnId!, siblingTxnId: ids.siblingTxnId! },
    );
    expect(guardResult.voidCarrier.success).toBe(false);
    expect(guardResult.voidCarrier.error).toMatch(
      /2-unit checkout; void the whole checkout instead/i,
    );
    expect(guardResult.voidSibling.success).toBe(false);
    expect(guardResult.voidSibling.error).toMatch(
      /2-unit checkout; void the whole checkout instead/i,
    );
    expect(guardResult.refundCarrier.success).toBe(false);

    // voidCheckoutGroup: nets the Katsh USD drawer back to its exact
    // pre-checkout baseline (delta assertion, rule 15 — never an absolute
    // balance on the shared accumulating DB).
    const groupVoidResult = await appPage.evaluate(async (gid: string) => {
      const w = window as unknown as Api;
      const res = await w.api.transactions.voidCheckoutGroup(gid);
      const drawersAfter = await w.api.recharge.getDrawerBalances();
      return {
        res,
        katshUsdAfter:
          drawersAfter.find((d) => d.name === "Katsh")?.usdBalance ?? null,
      };
    }, groupId);
    expect(groupVoidResult.res.success).toBe(true);
    expect(groupVoidResult.res.memberCount).toBe(2);
    expect(groupVoidResult.res.voidedTransactionIds).toHaveLength(2);
    expect(groupVoidResult.katshUsdAfter).not.toBeNull();
    expect(
      groupVoidResult.katshUsdAfter! - created.katshUsdBefore!,
    ).toBeCloseTo(0, 2);

    // Both rows are now VOIDED.
    const finalStatuses = await appPage.evaluate(
      async (args: { carrierTxnId: number; siblingTxnId: number }) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(100, {
          source_table: "financial_services",
        });
        const list = (
          Array.isArray(recent)
            ? recent
            : ((recent as { transactions?: unknown[] })?.transactions ?? [])
        ) as TxnRow[];
        return {
          carrierStatus: list.find((t) => t.id === args.carrierTxnId)?.status,
          siblingStatus: list.find((t) => t.id === args.siblingTxnId)?.status,
        };
      },
      { carrierTxnId: ids.carrierTxnId!, siblingTxnId: ids.siblingTxnId! },
    );
    expect(finalStatuses.carrierStatus).toBe("VOIDED");
    expect(finalStatuses.siblingStatus).toBe("VOIDED");
  });

  test("Transactions viewer offers 'Void entire checkout (N units)' on a split-group row instead of Void/Refund", async ({
    appPage,
  }) => {
    const groupId = crypto.randomUUID(); // must be a real uuid (schema .uuid())
    const carrierAmount = 31.42;
    const siblingAmount = 12.09;

    const created = await appPage.evaluate(
      async (args: {
        groupId: string;
        carrierAmount: number;
        siblingAmount: number;
      }) => {
        const w = window as unknown as Api;
        const carrier = await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount: args.carrierAmount,
          cost: args.carrierAmount,
          price: args.carrierAmount,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: args.carrierAmount + args.siblingAmount,
            },
          ],
          checkoutTotal: {
            usd: args.carrierAmount + args.siblingAmount,
            lbp: 0,
          },
          split_group: args.groupId,
          split_role: "carrier",
          split_units: 2,
        });
        await w.api.omt.addTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount: args.siblingAmount,
          cost: args.siblingAmount,
          price: args.siblingAmount,
          currency: "USD",
          commission: 0,
          deferPayment: true,
          split_group: args.groupId,
          split_role: "sibling",
          split_units: 2,
        });
        return { carrierOk: carrier.success === true };
      },
      { groupId, carrierAmount, siblingAmount },
    );
    expect(created.carrierOk).toBe(true);

    await navigateTo(appPage, "/audit");

    // Identity match: the Katsh Bill row with this checkout's unique carrier
    // amount (never `tbody tr.first()` — rule 15).
    const row = appPage
      .locator("tbody tr")
      .filter({ hasText: "Katsh Bill" })
      .filter({ hasText: String(carrierAmount) })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const groupVoidBtn = row.getByRole("button", {
      name: /Void entire checkout \(2 units\)/i,
    });
    await expect(groupVoidBtn).toBeVisible();
    // The ordinary Void/Refund buttons must NOT appear on a split-group row
    // — offering them would just surface the guard's error on click.
    await expect(row.getByRole("button", { name: /^Void$/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /^Refund$/ })).toHaveCount(0);

    // Click through (dialogs auto-accept globally per fixtures.ts) and
    // confirm the checkout flips to VOIDED. NOTE: after the group void the
    // reloaded table ALSO contains the reversal rows, whose summaries carry
    // the same "Katsh Bill"/amount text but whose status is ACTIVE — so
    // "first row matching the amount" is ambiguous post-void (this exact
    // trap failed the spec's first run). Assert instead that a row with this
    // checkout's unique amount now displays VOIDED.
    await groupVoidBtn.click();
    await expect(
      appPage
        .locator("tbody tr")
        .filter({ hasText: "Katsh Bill" })
        .filter({ hasText: String(carrierAmount) })
        .filter({ hasText: /VOIDED/ })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
