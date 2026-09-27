/**
 * LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — session-basket
 * single-item refund + preview dual-mode routing contract (rule 19/21/22):
 * both transports must reach the SAME payload shape, built ONCE by the
 * caller (rule 22 — `ipcOrHttp` is the only transport branch).
 * - In Electron (window.api present): routes via
 *   window.api.transactions.refundSessionBasketItem /
 *   getSessionItemRefundPreview, never fetch.
 * - In Web (no window.api): POSTs/GETs the exact REST routes
 *   (backend/src/api/transactions.ts) with the SAME field names, and
 *   returns the envelope as-is (rule 19c: HTTP 200 even on a business-rule
 *   failure).
 *
 * Rule 24 — every expected request body/query below is produced by parsing
 * a fixture through the REAL core schemas (`sessionItemRefundSchema`/
 * `sessionItemRefundPreviewSchema`, imported un-mocked from `@liratek/core`,
 * same as every other dual-mode test in this directory never mocks
 * `@liratek/core`), so the field names asserted here can't silently drift
 * from the schema's own names.
 *
 * NOT PROVEN FAILING-FIRST (rule 17 disclosure): `backendApi.ts` /
 * `ElectronApiAdapter.ts` / `packages/ui/src/api/types.ts` were implemented
 * in the same pass as this file (after the handler + REST route layers were
 * already proven red/green separately — see
 * `transactionHandlers.refundSessionBasketItem.test.ts` and
 * `transactions.sessionItemRefund.api.test.ts`), so there is no
 * separately-committed "before" state to run this file against without
 * reverting finished code, which CLAUDE.md's task instructions for this
 * change explicitly forbid. Follows the harness in
 * `backendApi.refundLegOverride.dualmode.test.ts`.
 */

import { sessionItemRefundSchema, sessionItemRefundPreviewSchema } from "@liratek/core";

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const REFUND_PAYLOAD = sessionItemRefundSchema.parse({
  sessionId: 7,
  transactionId: 42,
  saleItemId: 5,
  quantity: 1,
});

const PREVIEW_PAYLOAD = sessionItemRefundPreviewSchema.parse({
  sessionId: 7,
  transactionId: 42,
  saleItemId: 5,
  quantity: 1,
});

describe("backendApi session-item-refund dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  describe("refundSessionBasketItem", () => {
    it("in Electron mode: routes via window.api.transactions.refundSessionBasketItem(payload) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const refundSessionBasketItem = jest.fn(async () => ({
        success: true,
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        legs: [],
      }));
      (globalThis as any).window.api = {
        transactions: { refundSessionBasketItem },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSessionBasketItem(REFUND_PAYLOAD);

      expect(refundSessionBasketItem).toHaveBeenCalledWith(REFUND_PAYLOAD);
      expect(result).toEqual({
        success: true,
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        legs: [],
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs /api/transactions/session-basket/:sessionId/items/refund with the schema's own field names (sessionId out of the body, everything else in it)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: true,
          refundTransactionId: 99,
          sessionId: 7,
          memberTransactionId: 42,
          itemAmount: 1500,
          itemCurrency: "USD",
          accountReductionUsd: 1500,
          accountReductionLbp: 0,
          remainderAmount: 0,
          legs: [],
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSessionBasketItem(REFUND_PAYLOAD);

      expect(result).toEqual({
        success: true,
        refundTransactionId: 99,
        sessionId: 7,
        memberTransactionId: 42,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        legs: [],
      });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(
        "/api/transactions/session-basket/7/items/refund",
      );
      expect(options.method).toBe("POST");
      const { sessionId: _sessionId, ...expectedBody } = REFUND_PAYLOAD;
      expect(JSON.parse(options.body)).toEqual(expectedBody);
    });

    it("in Web mode: a business-rule refusal resolves the envelope (not a thrown error), HTTP 200", async () => {
      delete (globalThis as any).window.api;
      const MESSAGE = "This basket was already whole-reversed.";
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: false, error: MESSAGE }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSessionBasketItem(REFUND_PAYLOAD);

      expect(result).toEqual({ success: false, error: MESSAGE });
    });

    it("in Web mode: forwards an operator-chosen refundLegs override alongside the other fields", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: true,
          refundTransactionId: 100,
          sessionId: 7,
          memberTransactionId: 42,
          itemAmount: 15,
          itemCurrency: "USD",
          accountReductionUsd: 0,
          accountReductionLbp: 0,
          remainderAmount: 15,
          legs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
        }),
      ) as any;
      const payloadWithLegs = sessionItemRefundSchema.parse({
        sessionId: 7,
        transactionId: 42,
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
      });

      const apiMod = await import("../backendApi");
      await apiMod.refundSessionBasketItem(payloadWithLegs);

      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body).refundLegs).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 15 },
      ]);
    });
  });

  describe("getSessionItemRefundPreview", () => {
    it("in Electron mode: routes via window.api.transactions.getSessionItemRefundPreview(payload) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const getSessionItemRefundPreview = jest.fn(async () => ({
        success: true,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        defaultLegs: [],
      }));
      (globalThis as any).window.api = {
        transactions: { getSessionItemRefundPreview },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getSessionItemRefundPreview(
        PREVIEW_PAYLOAD,
      );

      expect(getSessionItemRefundPreview).toHaveBeenCalledWith(
        PREVIEW_PAYLOAD,
      );
      expect(result).toEqual({
        success: true,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        defaultLegs: [],
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: GETs /api/transactions/session-basket/:sessionId/items/refund-preview with the schema's own query field names", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: true,
          itemAmount: 1500,
          itemCurrency: "USD",
          accountReductionUsd: 1500,
          accountReductionLbp: 0,
          remainderAmount: 0,
          defaultLegs: [],
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getSessionItemRefundPreview(
        PREVIEW_PAYLOAD,
      );

      expect(result).toEqual({
        success: true,
        itemAmount: 1500,
        itemCurrency: "USD",
        accountReductionUsd: 1500,
        accountReductionLbp: 0,
        remainderAmount: 0,
        defaultLegs: [],
      });
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(
        "/api/transactions/session-basket/7/items/refund-preview",
      );
      expect(String(url)).toContain(
        `transactionId=${PREVIEW_PAYLOAD.transactionId}`,
      );
      expect(String(url)).toContain(`saleItemId=${PREVIEW_PAYLOAD.saleItemId}`);
      expect(String(url)).toContain(`quantity=${PREVIEW_PAYLOAD.quantity}`);
    });

    it("in Web mode: omitting saleItemId/quantity omits them from the query string", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: true,
          itemAmount: 500,
          itemCurrency: "USD",
          accountReductionUsd: 0,
          accountReductionLbp: 0,
          remainderAmount: 500,
          defaultLegs: [],
        }),
      ) as any;
      const wholeMemberPayload = sessionItemRefundPreviewSchema.parse({
        sessionId: 7,
        transactionId: 43,
      });

      const apiMod = await import("../backendApi");
      await apiMod.getSessionItemRefundPreview(wholeMemberPayload);

      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).not.toContain("saleItemId");
      expect(String(url)).not.toContain("quantity");
    });
  });
});
