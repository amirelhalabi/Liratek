/**
 * E2E (desktop / IPC): LIRA-256 — OMT statement commission types.
 * Desktop twin of lira-web-053-omt-statement-commission-types (same amounts,
 * same assertions, through `window.api.*` instead of REST).
 *
 *  1. The statement check with covered = [INTRA] subtracts only the INTRA
 *     transfer's commission; with no choice it subtracts both.
 *     `commission_by_type` counts each type.
 *  2. A settlement naming INTRA that includes the Western Union transfer is
 *     refused (the error names the transfer) and books nothing.
 *  3. An INTRA-only settlement succeeds, stamps the choice, and the WU
 *     transfer stays queued.
 *  4. Voiding it nets the OMT balance, the Primary Cash Drawer and Profits
 *     "Commission (at settlement)" back to 0.
 *  5. Steps 2–4 again through `suppliers.settleAccount`.
 *
 * Rule 15: deltas, identity matching; amounts (461 / 517) unique to this pair
 * of files. Not run locally (desktop e2e never runs on the owner's Mac) — CI
 * is the first run.
 */
import { test, expect, ensureProfitsUnlocked } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const INTRA_X = 461;
const INTRA_FEE = 7;
const WU_X = 517;
const WU_FEE = 9;
const INTRA_GROSS = INTRA_X + INTRA_FEE;
const WIDE_FROM = "2000-01-01";
const WIDE_TO = "2100-01-01";

type SupplierRow = { id: number; provider: string | null };
type SupplierBalanceRow = { supplier_id: number; total_usd: number };
type UnsettledRow = {
  id: number;
  settlement_id: number | null;
  commission: number;
};
type ByType = { omt_service_type: string; count: number };
type Statement = {
  unsettled_commission_usd: number;
  covered_omt_service_types: string[] | null;
  commission_by_type: ByType[];
};
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  metadata_json: string | null;
};
type DrawerRow = { name: string; usdBalance: number };
type Leg = { method: string; currency_code: string; amount: number };
type Result = { success?: boolean; id?: number; error?: string };

type Api = {
  api: {
    omt: {
      addTransaction: (data: Record<string, unknown>) => Promise<Result>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getUnsettledTransactions: (provider: string) => Promise<UnsettledRow[]>;
      getAccountExpectedStatement: (
        accountSupplierId: number,
        coveredTypes?: string[],
      ) => Promise<Statement>;
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        payments?: Leg[];
        covered_omt_service_types?: string[];
      }) => Promise<Result>;
      settleAccount: (data: {
        account_supplier_id: number;
        direction: "PAY" | "COLLECT";
        selections: Array<{ kind: "FINANCIAL_SERVICE" | "LEDGER"; id: number }>;
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        payments?: Leg[];
        covered_omt_service_types?: string[];
      }) => Promise<Result>;
    };
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxnRow[] | { transactions?: RecentTxnRow[] }>;
      void: (id: number) => Promise<Result>;
    };
    profits: {
      summary: (
        from: string,
        to: string,
      ) => Promise<{
        financial_services?: { commission_at_settlement_usd?: number };
      }>;
    };
  };
};

async function owedUsd(page: Page, supplierId: number): Promise<number> {
  return page.evaluate(async (id: number) => {
    const w = window as unknown as Api;
    const rows = await w.api.suppliers.getBalances(true);
    return rows.find((b) => b.supplier_id === id)?.total_usd ?? 0;
  }, supplierId);
}

async function pcdUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === "OMT_System")?.usdBalance ?? 0;
  });
}

async function commissionAtSettlementUsd(page: Page): Promise<number> {
  await ensureProfitsUnlocked(page);
  return page.evaluate(
    async (a: { from: string; to: string }) => {
      const w = window as unknown as Api;
      const s = await w.api.profits.summary(a.from, a.to);
      return s.financial_services?.commission_at_settlement_usd ?? 0;
    },
    { from: WIDE_FROM, to: WIDE_TO },
  );
}

async function unsettledOmt(page: Page): Promise<UnsettledRow[]> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    return w.api.suppliers.getUnsettledTransactions("OMT");
  });
}

async function statement(
  page: Page,
  omtId: number,
  covered?: string[],
): Promise<Statement> {
  return page.evaluate(
    async (a: { id: number; covered?: string[] }) => {
      const w = window as unknown as Api;
      return a.covered
        ? w.api.suppliers.getAccountExpectedStatement(a.id, a.covered)
        : w.api.suppliers.getAccountExpectedStatement(a.id);
    },
    { id: omtId, covered },
  );
}

const countOf = (s: Statement, type: string) =>
  s.commission_by_type.find((t) => t.omt_service_type === type)?.count ?? 0;

test.describe("LIRA-256 — OMT statement commission types", () => {
  test("the check subtracts only covered types, a settlement refuses uncovered transfers, and a covered settle → void nets to 0 on both settle channels", async ({
    appPage,
  }) => {
    const omt = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "OMT",
      );
    });
    expect(omt, "OMT supplier not found").toBeTruthy();
    const omtId = omt!.id;

    const send = async (x: number, fee: number, type: string) => {
      const r = await appPage.evaluate(
        async (a: { x: number; fee: number; type: string }) => {
          const w = window as unknown as Api;
          return w.api.omt.addTransaction({
            provider: "OMT",
            serviceType: "SEND",
            amount: a.x,
            currency: "USD",
            omtServiceType: a.type,
            omtFee: a.fee,
            payments: [
              { method: "CASH", currencyCode: "USD", amount: a.x + a.fee },
            ],
          });
        },
        { x, fee, type },
      );
      expect(r.error ?? null).toBeNull();
      expect(r.success).toBe(true);
      return r.id!;
    };

    // ── 1. statement check by type ──
    const beforeIntra = await statement(appPage, omtId, ["INTRA"]);
    const beforeAll = await statement(appPage, omtId);
    expect(beforeAll.covered_omt_service_types).toBeNull();
    const intraId = await send(INTRA_X, INTRA_FEE, "INTRA");
    const wuId = await send(WU_X, WU_FEE, "WESTERN_UNION");
    const queue = await unsettledOmt(appPage);
    const intraC = queue.find((r) => r.id === intraId)!.commission;
    const wuC = queue.find((r) => r.id === wuId)!.commission;
    expect(intraC).toBeGreaterThan(0);
    expect(wuC).toBeGreaterThan(0);
    const afterIntra = await statement(appPage, omtId, ["INTRA"]);
    const afterAll = await statement(appPage, omtId);
    expect(afterIntra.covered_omt_service_types).toEqual(["INTRA"]);
    expect(
      afterIntra.unsettled_commission_usd -
        beforeIntra.unsettled_commission_usd,
    ).toBeCloseTo(intraC, 4);
    expect(
      afterAll.unsettled_commission_usd - beforeAll.unsettled_commission_usd,
    ).toBeCloseTo(intraC + wuC, 4);
    expect(countOf(afterAll, "INTRA") - countOf(beforeAll, "INTRA")).toBe(1);
    expect(
      countOf(afterAll, "WESTERN_UNION") - countOf(beforeAll, "WESTERN_UNION"),
    ).toBe(1);

    const run = async (via: "tx" | "account", commission: number) => {
      const net = Math.round((INTRA_GROSS - commission) * 100) / 100;
      const settle = (ids: number[], amount: number) =>
        appPage.evaluate(
          async (a: {
            via: "tx" | "account";
            omtId: number;
            ids: number[];
            amount: number;
            commission: number;
          }) => {
            const w = window as unknown as Api;
            const legs = [
              { method: "CASH", currency_code: "USD", amount: a.amount },
            ];
            return a.via === "tx"
              ? w.api.suppliers.settleTransactions({
                  supplier_id: a.omtId,
                  financial_service_ids: a.ids,
                  amount_usd: a.amount,
                  amount_lbp: 0,
                  commission_usd: a.commission,
                  commission_lbp: 0,
                  entry_mode: "LUMP",
                  payments: legs,
                  covered_omt_service_types: ["INTRA"],
                })
              : w.api.suppliers.settleAccount({
                  account_supplier_id: a.omtId,
                  direction: "PAY",
                  selections: a.ids.map((id) => ({
                    kind: "FINANCIAL_SERVICE" as const,
                    id,
                  })),
                  amount_usd: a.amount,
                  amount_lbp: 0,
                  commission_usd: a.commission,
                  commission_lbp: 0,
                  entry_mode: "LUMP",
                  payments: legs,
                  covered_omt_service_types: ["INTRA"],
                });
          },
          { via, omtId, ids, amount, commission },
        );

      // ── 2. refused ──
      const owedBeforeRefusal = await owedUsd(appPage, omtId);
      const refused = await settle(
        [intraId, wuId],
        INTRA_GROSS + WU_X + WU_FEE - commission,
      );
      expect(refused.success).toBe(false);
      expect(String(refused.error)).toContain(`#${wuId}`);
      expect((await owedUsd(appPage, omtId)) - owedBeforeRefusal).toBeCloseTo(
        0,
        2,
      );

      // ── 3. INTRA-only ──
      const owedBefore = await owedUsd(appPage, omtId);
      const pcdBefore = await pcdUsd(appPage);
      const commissionBefore = await commissionAtSettlementUsd(appPage);
      const settled = await settle([intraId], net);
      expect(settled.error ?? null).toBeNull();
      expect(settled.success).toBe(true);
      const ledgerId = settled.id!;
      const q = await unsettledOmt(appPage);
      expect(q.find((r) => r.id === intraId)).toBeUndefined();
      expect(
        q.find((r) => r.id === wuId)?.settlement_id ?? "missing",
      ).toBeNull();
      expect((await pcdUsd(appPage)) - pcdBefore).toBeCloseTo(-net, 2);
      expect(
        (await commissionAtSettlementUsd(appPage)) - commissionBefore,
      ).toBeCloseTo(commission, 2);

      const txn = await appPage.evaluate(async (id: number) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(100, {
          source_table: "supplier_ledger",
        });
        const list = Array.isArray(recent)
          ? recent
          : (recent.transactions ?? []);
        return (
          list.find(
            (t) => t.type === "SUPPLIER_SETTLEMENT" && t.source_id === id,
          ) ?? null
        );
      }, ledgerId);
      expect(txn, "SUPPLIER_SETTLEMENT transaction not found").toBeTruthy();
      const meta = JSON.parse(txn!.metadata_json ?? "{}") as {
        covered_omt_service_types?: string[];
      };
      expect(meta.covered_omt_service_types).toEqual(["INTRA"]);

      // ── 4. void ──
      const voidRes = await appPage.evaluate(async (id: number) => {
        const w = window as unknown as Api;
        return w.api.transactions.void(id);
      }, txn!.id);
      expect(voidRes.error ?? null).toBeNull();
      expect(voidRes.success).toBe(true);
      expect((await owedUsd(appPage, omtId)) - owedBefore).toBeCloseTo(0, 2);
      expect((await pcdUsd(appPage)) - pcdBefore).toBeCloseTo(0, 2);
      expect(
        (await commissionAtSettlementUsd(appPage)) - commissionBefore,
      ).toBeCloseTo(0, 2);
      const requeued = (await unsettledOmt(appPage)).find(
        (r) => r.id === intraId,
      );
      expect(requeued, "INTRA transfer did not re-join the queue").toBeTruthy();
      expect(requeued!.settlement_id).toBeNull();
    };

    await run("tx", 1.11);
    await run("account", 1.23);
  });
});
