/**
 * E2E: LIRA-079 (A6) — consistent created_at format keeps ordering correct
 *
 * The supplier settlement/cashflow paths used to stamp created_at with JS
 * toISOString() ('2026-07-02T20:55:08.710Z') while everything else uses
 * CURRENT_TIMESTAMP ('2026-07-02 20:55:19'). 'T' > ' ' in string ordering, so
 * ISO rows sorted as permanently-newest for their whole day — settlement rows
 * pinned above genuinely newer transactions in every created_at DESC list.
 *
 * This spec drives the cashflow path (same stamping as settlements), then
 * creates a NEWER ordinary transaction and asserts it sorts ABOVE the supplier
 * row in transactions.getRecent — and that the supplier row's created_at is
 * SQLite-format, not ISO.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      recordCashflow: (data: {
        supplier_id: number;
        direction: "PAY" | "RECEIVE";
        payments: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
        note?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND";
        amount: number;
        currency?: string;
        commission?: number;
        omtServiceType?: string;
        clientName?: string;
        paidByMethod?: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (limit: number) => Promise<
        Array<{
          id: number;
          type: string;
          source_table: string;
          source_id: number;
          summary: string | null;
          created_at: string;
        }>
      >;
    };
  };
};

test.describe("LIRA-079 (A6) — created_at format & ordering", () => {
  test("a newer transaction sorts ABOVE an earlier supplier cashflow row", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const marker = `A6 ORDER ${ts}`;
    // Unique cents make the supplier row identity-matchable in the shared DB.
    const payAmount = 3 + (ts % 89) / 100;

    const result = await appPage.evaluate(async ({ marker, payAmount }) => {
      const w = window as unknown as Api;

      // 1. Supplier cashflow row (the path that used to stamp ISO).
      const omt = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "OMT",
      );
      if (!omt) throw new Error("OMT supplier not found");
      const pay = await w.api.suppliers.recordCashflow({
        supplier_id: omt.id,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: payAmount }],
        note: marker,
      });

      // 2. A NEWER ordinary transaction (CURRENT_TIMESTAMP format).
      const send = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 7,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        clientName: marker,
        paidByMethod: "CASH",
      });

      const recent = await w.api.transactions.getRecent(200);
      const payLabel = `$${payAmount.toFixed(2)}`;
      const supplierIdx = recent.findIndex(
        (t) => t.type === "SUPPLIER_PAYMENT" && t.summary?.includes(payLabel),
      );
      const supplierRow = supplierIdx >= 0 ? recent[supplierIdx] : null;
      const sendIdx = recent.findIndex(
        (t) =>
          t.type === "FINANCIAL_SERVICE" &&
          t.source_table === "financial_services" &&
          t.source_id === (send.id ?? -1),
      );

      return {
        payOk: pay.success === true,
        payError: pay.error ?? null,
        sendOk: send.success === true,
        sendError: send.error ?? null,
        supplierIdx,
        sendIdx,
        supplierCreatedAt: supplierRow?.created_at ?? null,
      };
    }, { marker, payAmount });

    expect(result.payError).toBeNull();
    expect(result.payOk).toBe(true);
    expect(result.sendError).toBeNull();
    expect(result.sendOk).toBe(true);

    // Both rows found in the recent list.
    expect(result.supplierIdx).toBeGreaterThanOrEqual(0);
    expect(result.sendIdx).toBeGreaterThanOrEqual(0);

    // The supplier row's stamp is SQLite-format — an ISO stamp would sort it
    // above every same-day row forever.
    expect(result.supplierCreatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );

    // getRecent is created_at DESC, id DESC: the newer SEND must sort ABOVE
    // (lower index than) the earlier supplier row. Pre-A6 the ISO-stamped
    // supplier row pinned itself above the SEND despite being older.
    expect(result.sendIdx).toBeLessThan(result.supplierIdx);
  });
});
