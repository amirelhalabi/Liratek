/**
 * E2E (desktop / IPC): LIRA-095 — commission at settlement for an OMT
 * (system) SEND: create → settle in LUMP mode → void nets every ledger,
 * drawer and profit figure back to 0 (COMMISSION_AT_SETTLEMENT_PLAN.md §4
 * Phase 4). Desktop twin of lira-web-052-omt-commission-settlement-void.
 *
 * Bills (Katsh, RATE mode) already have this proof on both transports
 * (lira-089 / lira-web-021). lira-158 settles an OMT SEND through the real
 * UI but never voids it; this file closes the void half over IPC, with the
 * same numbers as the web twin:
 *   x = 373, f = 7 (INTRA) → the SEND owes OMT the GROSS 380 (D1);
 *   settle with an entered commission of 1.37 (NOT the 0.70 auto estimate),
 *   paying net 378.63 in CASH from the Primary Cash Drawer (OMT_System);
 *   void the SUPPLIER_SETTLEMENT → owed back to +380, drawer back, Profits
 *   "Commission (at settlement)" delta back to 0, SEND back in the queue.
 *
 * Rule 15: deltas around each action, rows matched by identity (the SEND's
 * own id, the settlement's own ledger id). Amounts unique to this pair of
 * files. Not run locally (desktop e2e is never run on the owner's Mac) —
 * CI is the first run.
 */
import { test, expect, ensureProfitsUnlocked } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const X = 373;
const FEE = 7;
const GROSS = X + FEE;
const ENTERED_COMMISSION = 1.37;
const NET_PAY = Math.round((GROSS - ENTERED_COMMISSION) * 100) / 100; // 378.63
const WIDE_FROM = "2000-01-01";
const WIDE_TO = "2100-01-01";

type SupplierRow = { id: number; provider: string | null };
type SupplierBalanceRow = { supplier_id: number; total_usd: number };
type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  is_refunded?: number;
};
type UnsettledRow = { id: number; settlement_id: number | null };
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  metadata_json: string | null;
};
type DrawerRow = { name: string; usdBalance: number };

type Api = {
  api: {
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        omtServiceType?: string;
        omtFee?: number;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
        }>;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
      getUnsettledTransactions: (provider: string) => Promise<UnsettledRow[]>;
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        note?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxnRow[] | { transactions?: RecentTxnRow[] }>;
      void: (
        id: number,
      ) => Promise<{ success?: boolean; reversalId?: number; error?: string }>;
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
    async (args: { from: string; to: string }) => {
      const w = window as unknown as Api;
      const s = await w.api.profits.summary(args.from, args.to);
      return s.financial_services?.commission_at_settlement_usd ?? 0;
    },
    { from: WIDE_FROM, to: WIDE_TO },
  );
}

async function queuedRow(
  page: Page,
  sendId: number,
): Promise<UnsettledRow | null> {
  return page.evaluate(async (id: number) => {
    const w = window as unknown as Api;
    const rows = await w.api.suppliers.getUnsettledTransactions("OMT");
    return rows.find((r) => r.id === id) ?? null;
  }, sendId);
}

test.describe("LIRA-095 — OMT commission at settlement, void nets to 0", () => {
  test("OMT SEND owes the gross amount, settles with a LUMP commission, and voiding the settlement nets ledger, drawer and profit back to 0", async ({
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

    // ── 1. SEND — gross payable ──────────────────────────────────────────
    const owedBeforeSend = await owedUsd(appPage, omtId);
    const sent = await appPage.evaluate(
      async (a: { x: number; fee: number; gross: number }) => {
        const w = window as unknown as Api;
        return w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: a.x,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: a.fee,
          payments: [{ method: "CASH", currencyCode: "USD", amount: a.gross }],
        });
      },
      { x: X, fee: FEE, gross: GROSS },
    );
    expect(sent.error ?? null).toBeNull();
    expect(sent.success).toBe(true);
    const sendId = sent.id!;
    expect(sendId).toBeTruthy();

    expect((await owedUsd(appPage, omtId)) - owedBeforeSend).toBeCloseTo(
      GROSS,
      2,
    );
    const queued = await queuedRow(appPage, sendId);
    expect(queued, "SEND did not join the unsettled queue").toBeTruthy();
    expect(queued!.settlement_id).toBeNull();

    // ── 2. Settle, LUMP commission ───────────────────────────────────────
    const pcdBefore = await pcdUsd(appPage);
    const commissionBefore = await commissionAtSettlementUsd(appPage);
    const settleRes = await appPage.evaluate(
      async (a: {
        supplierId: number;
        sendId: number;
        net: number;
        commission: number;
      }) => {
        const w = window as unknown as Api;
        return w.api.suppliers.settleTransactions({
          supplier_id: a.supplierId,
          financial_service_ids: [a.sendId],
          amount_usd: a.net,
          amount_lbp: 0,
          commission_usd: a.commission,
          commission_lbp: 0,
          entry_mode: "LUMP",
          note: "L-095 e2e LUMP settlement",
          payments: [{ method: "CASH", currency_code: "USD", amount: a.net }],
        });
      },
      {
        supplierId: omtId,
        sendId,
        net: NET_PAY,
        commission: ENTERED_COMMISSION,
      },
    );
    expect(settleRes.error ?? null).toBeNull();
    expect(settleRes.success).toBe(true);
    const settlementLedgerId = settleRes.id!;
    expect(settlementLedgerId).toBeTruthy();

    expect((await owedUsd(appPage, omtId)) - owedBeforeSend).toBeCloseTo(0, 2);
    expect((await pcdUsd(appPage)) - pcdBefore).toBeCloseTo(-NET_PAY, 2);
    expect(
      (await commissionAtSettlementUsd(appPage)) - commissionBefore,
    ).toBeCloseTo(ENTERED_COMMISSION, 2);
    expect(await queuedRow(appPage, sendId)).toBeNull();

    const settlementTxn = await appPage.evaluate(async (ledgerId: number) => {
      const w = window as unknown as Api;
      const recent = await w.api.transactions.getRecent(100, {
        source_table: "supplier_ledger",
      });
      const list = Array.isArray(recent) ? recent : (recent.transactions ?? []);
      return (
        list.find(
          (t) => t.type === "SUPPLIER_SETTLEMENT" && t.source_id === ledgerId,
        ) ?? null
      );
    }, settlementLedgerId);
    expect(
      settlementTxn,
      "SUPPLIER_SETTLEMENT transaction not found",
    ).toBeTruthy();
    const meta = JSON.parse(settlementTxn!.metadata_json ?? "{}") as {
      commission_model?: number;
      entry_mode?: string;
      commission_usd?: number;
    };
    expect(meta.commission_model).toBe(1);
    expect(meta.entry_mode).toBe("LUMP");
    expect(meta.commission_usd).toBeCloseTo(ENTERED_COMMISSION, 2);

    // ── 3. Void — every effect returns ───────────────────────────────────
    const voidRes = await appPage.evaluate(async (txnId: number) => {
      const w = window as unknown as Api;
      return w.api.transactions.void(txnId);
    }, settlementTxn!.id);
    expect(voidRes.error ?? null).toBeNull();
    expect(voidRes.success).toBe(true);

    expect((await owedUsd(appPage, omtId)) - owedBeforeSend).toBeCloseTo(
      GROSS,
      2,
    );
    const settlementRowAfterVoid = await appPage.evaluate(
      async (a: { id: number; ledgerId: number }) => {
        const w = window as unknown as Api;
        return (
          (await w.api.suppliers.getLedger(a.id, 500)).find(
            (l) => l.id === a.ledgerId,
          ) ?? null
        );
      },
      { id: omtId, ledgerId: settlementLedgerId },
    );
    expect(settlementRowAfterVoid?.is_refunded).toBe(1);
    expect((await pcdUsd(appPage)) - pcdBefore).toBeCloseTo(0, 2);
    expect(
      (await commissionAtSettlementUsd(appPage)) - commissionBefore,
    ).toBeCloseTo(0, 2);
    const requeued = await queuedRow(appPage, sendId);
    expect(requeued, "SEND did not re-join the unsettled queue").toBeTruthy();
    expect(requeued!.settlement_id).toBeNull();
  });
});
