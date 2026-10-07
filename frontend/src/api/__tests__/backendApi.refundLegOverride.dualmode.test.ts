/**
 * LIRA-231 — POS "Refund Sale"/"Refund item" refund-leg-override + preview
 * dual-mode routing contract (rule 19/21): both transports must reach the
 * SAME payload shape.
 * - In Electron (window.api present): routes via window.api.sales.refund /
 *   refundItem / getRefundPreview, never fetch.
 * - In Web (no window.api): POSTs/GETs the exact REST routes
 *   (backend/src/api/sales.ts) with the SAME `refundLegs` field, and
 *   returns the envelope as-is (rule 19c: HTTP 200 even on a business-rule
 *   failure, e.g. the session-basket refusal).
 *
 * Follows the harness in backendApi.deleteDraft.dualmode.test.ts.
 *
 * 2026-09-26 addition — the "forwards unitExtras" cases (POS "Returned
 * phones" per-unit flagging) are labelled NOT PROVEN FAILING-FIRST: the
 * `refundSale`/`refundSaleItem` change in `backendApi.ts` landed in the same
 * pass as these tests. The pre-existing `refundLegs`-only cases above them
 * WERE already proven failing-first for this file (see the original LIRA-231
 * commit); they were additionally updated here ONLY to append the new
 * `unitExtras`/`undefined` positional argument the Electron-mode calls now
 * always pass, so their original assertions keep holding byte-for-byte.
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const REFUND_LEGS = [
  { method: "OMT", currencyCode: "USD" as const, amount: 500 },
];
const SESSION_MESSAGE =
  "This sale was paid through a customer session — refund it from the session basket.";

describe("backendApi refund-leg-override dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  describe("refundSale", () => {
    it("in Electron mode: routes via window.api.sales.refund(saleId, refundLegs) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const refund = jest.fn(async () => ({ success: true, refundId: 501 }));
      (globalThis as any).window.api = { sales: { refund } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSale(7, REFUND_LEGS);

      // LIRA-236: refundSale now always forwards a 4th (exchangeRate) arg —
      // undefined here since the caller didn't pass one.
      expect(refund).toHaveBeenCalledWith(7, REFUND_LEGS, undefined, undefined);
      expect(result).toEqual({ success: true, refundId: 501 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Electron mode: forwards unitExtras as the 3rd arg (not proven failing-first)", async () => {
      const refund = jest.fn(async () => ({ success: true, refundId: 505 }));
      (globalThis as any).window.api = { sales: { refund } };
      const unitExtras = [{ unit_id: 9, is_defective: true }];

      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7, REFUND_LEGS, unitExtras);

      // LIRA-236: + the always-forwarded 4th (exchangeRate) arg, undefined here.
      expect(refund).toHaveBeenCalledWith(7, REFUND_LEGS, unitExtras, undefined);
    });

    it("in Web mode: POSTs /api/sales/:id/refund with { refundLegs } and returns the envelope as-is", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 501 }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSale(7, REFUND_LEGS);

      expect(result).toEqual({ success: true, refundId: 501 });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/7/refund");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ refundLegs: REFUND_LEGS });
    });

    it("in Web mode: POSTs unitExtras alongside refundLegs (not proven failing-first)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 506 }),
      ) as any;
      const unitExtras = [{ unit_id: 9, is_defective: true }];

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSale(7, REFUND_LEGS, unitExtras);

      expect(result).toEqual({ success: true, refundId: 506 });
      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        refundLegs: REFUND_LEGS,
        unitExtras,
      });
    });

    it("in Web mode: a session-basket refusal resolves the envelope (not a thrown error), exact message", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: false, error: SESSION_MESSAGE }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSale(7);

      expect(result).toEqual({ success: false, error: SESSION_MESSAGE });
    });

    it("in Web mode: omitting refundLegs sends no body (byte-identical to pre-LIRA-231 default reversal)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 502 }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7);

      // httpClient.ts serializes an omitted body to `null` (never calls
      // JSON.stringify on `undefined`) — see its own `body: options?.body
      // !== undefined ? JSON.stringify(...) : null`.
      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toBeNull();
    });

    // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — written failing-first: at
    // authoring time `refundSale` took only (saleId, refundLegs, unitExtras);
    // a 4th `exchangeRate` argument was a TypeScript error.
    it("in Electron mode: forwards exchangeRate as the 4th arg", async () => {
      const refund = jest.fn(async () => ({ success: true, refundId: 507 }));
      (globalThis as any).window.api = { sales: { refund } };

      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7, REFUND_LEGS, undefined, 90000);

      expect(refund).toHaveBeenCalledWith(7, REFUND_LEGS, undefined, 90000);
    });

    it("in Web mode: POSTs exchangeRate alongside refundLegs", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 508 }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7, REFUND_LEGS, undefined, 90000);

      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        refundLegs: REFUND_LEGS,
        unitExtras: undefined,
        exchangeRate: 90000,
      });
    });
  });

  describe("refundSaleItem", () => {
    it("in Electron mode: routes via window.api.sales.refundItem(saleId, saleItemId, refundQuantity, refundLegs) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const refundItem = jest.fn(async () => ({
        success: true,
        refundId: 601,
      }));
      (globalThis as any).window.api = { sales: { refundItem } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSaleItem(7, 3, 1, REFUND_LEGS);

      // LIRA-236: refundSaleItem now always forwards a 6th (exchangeRate)
      // arg too — undefined here since the caller didn't pass one.
      expect(refundItem).toHaveBeenCalledWith(
        7,
        3,
        1,
        REFUND_LEGS,
        undefined,
        undefined,
      );
      expect(result).toEqual({ success: true, refundId: 601 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Electron mode: forwards unitExtras as the 5th arg (not proven failing-first)", async () => {
      const refundItem = jest.fn(async () => ({
        success: true,
        refundId: 603,
      }));
      (globalThis as any).window.api = { sales: { refundItem } };
      const unitExtras = [{ unit_id: 9, warranty_override_until: "2027-01-01" }];

      const apiMod = await import("../backendApi");
      await apiMod.refundSaleItem(7, 3, 1, REFUND_LEGS, unitExtras);

      expect(refundItem).toHaveBeenCalledWith(
        7,
        3,
        1,
        REFUND_LEGS,
        unitExtras,
        undefined,
      );
    });

    // Owner decision 2026-10-07 — refund kept change on the per-item refund.
    // Not proven failing-first (adapter change landed before these cases).
    it("in Electron mode: forwards keptChange as the 7th arg, schema-named (not proven failing-first)", async () => {
      const refundItem = jest.fn(async () => ({
        success: true,
        refundId: 605,
      }));
      (globalThis as any).window.api = { sales: { refundItem } };
      const { refundKeptChangeSchema } = await import("@liratek/core");
      const keptChange = refundKeptChangeSchema.parse({ kept_change_usd: 0.12 });

      const apiMod = await import("../backendApi");
      await apiMod.refundSaleItem(
        7,
        3,
        1,
        REFUND_LEGS,
        undefined,
        90000,
        keptChange,
      );

      expect(refundItem).toHaveBeenCalledWith(
        7,
        3,
        1,
        REFUND_LEGS,
        undefined,
        90000,
        keptChange,
      );
    });

    it("in Web mode: POSTs keptChange in the body, schema-named (not proven failing-first)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 606 }),
      ) as any;
      const { refundKeptChangeSchema } = await import("@liratek/core");
      const keptChange = refundKeptChangeSchema.parse({ kept_change_usd: 0.12 });

      const apiMod = await import("../backendApi");
      await apiMod.refundSaleItem(
        7,
        3,
        1,
        REFUND_LEGS,
        undefined,
        90000,
        keptChange,
      );

      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: REFUND_LEGS,
        exchangeRate: 90000,
        keptChange,
      });
    });

    it("in Web mode: POSTs /api/sales/:id/refund-item with saleItemId/refundQuantity/refundLegs", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 601 }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSaleItem(7, 3, 1, REFUND_LEGS);

      expect(result).toEqual({ success: true, refundId: 601 });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/7/refund-item");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: REFUND_LEGS,
      });
    });

    it("in Web mode: POSTs unitExtras alongside refundLegs (not proven failing-first)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 604 }),
      ) as any;
      const unitExtras = [{ unit_id: 9, warranty_override_until: "2027-01-01" }];

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSaleItem(
        7,
        3,
        1,
        REFUND_LEGS,
        unitExtras,
      );

      expect(result).toEqual({ success: true, refundId: 604 });
      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: REFUND_LEGS,
        unitExtras,
      });
    });

    // LIRA-236 — written failing-first: a 6th `exchangeRate` argument was a
    // TypeScript error before this ticket.
    it("in Electron mode: forwards exchangeRate as the 6th arg", async () => {
      const refundItem = jest.fn(async () => ({
        success: true,
        refundId: 605,
      }));
      (globalThis as any).window.api = { sales: { refundItem } };

      const apiMod = await import("../backendApi");
      await apiMod.refundSaleItem(7, 3, 1, REFUND_LEGS, undefined, 90000);

      expect(refundItem).toHaveBeenCalledWith(
        7,
        3,
        1,
        REFUND_LEGS,
        undefined,
        90000,
      );
    });

    it("in Web mode: POSTs exchangeRate alongside refundLegs", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 606 }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.refundSaleItem(7, 3, 1, REFUND_LEGS, undefined, 90000);

      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        saleItemId: 3,
        refundQuantity: 1,
        refundLegs: REFUND_LEGS,
        unitExtras: undefined,
        exchangeRate: 90000,
      });
    });
  });

  describe("getSaleRefundPreview", () => {
    it("in Electron mode: routes via window.api.sales.getRefundPreview(saleId, item) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const getRefundPreview = jest.fn(async () => ({
        success: true,
        legs: [],
        sessionLinked: false,
      }));
      (globalThis as any).window.api = { sales: { getRefundPreview } };

      const apiMod = await import("../backendApi");
      const item = { saleItemId: 3, refundQuantity: 1 };
      const result = await apiMod.getSaleRefundPreview(7, item);

      expect(getRefundPreview).toHaveBeenCalledWith(7, item);
      expect(result).toEqual({ success: true, legs: [], sessionLinked: false });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // LIRA-236 — written failing-first: `bookedRate`/`bookedRateSource`
    // weren't on the return type before this ticket, so reading them off
    // `result` was a TypeScript compile error.
    it("in Electron mode: passes through bookedRate/bookedRateSource from the preview", async () => {
      const getRefundPreview = jest.fn(async () => ({
        success: true,
        legs: [],
        sessionLinked: false,
        bookedRate: 91000,
        bookedRateSource: "sale" as const,
      }));
      (globalThis as any).window.api = { sales: { getRefundPreview } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getSaleRefundPreview(7);

      if (result.success) {
        expect(result.bookedRate).toBe(91000);
        expect(result.bookedRateSource).toBe("sale");
      } else {
        throw new Error("expected success");
      }
    });

    it("in Web mode: GETs /api/sales/:id/refund-preview with saleItemId/refundQuantity query params", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, legs: [], sessionLinked: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getSaleRefundPreview(7, {
        saleItemId: 3,
        refundQuantity: 1,
      });

      expect(result).toEqual({ success: true, legs: [], sessionLinked: true });
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/7/refund-preview");
      expect(String(url)).toContain("saleItemId=3");
      expect(String(url)).toContain("refundQuantity=1");
    });

    it("in Web mode: no item omits the query string entirely (whole-sale preview)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, legs: [], sessionLinked: false }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.getSaleRefundPreview(7);

      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/7/refund-preview");
      expect(String(url)).not.toContain("?");
    });
  });

  // LIRA-236 — the Transactions-page generic refund (`refundTransaction`)
  // gets the same optional `exchangeRate` the POS refund functions above do.
  // Written failing-first: at authoring time `refundTransaction` took only
  // (id, refundLegs, unitExtras); a 4th `exchangeRate` argument was a
  // TypeScript error.
  describe("refundTransaction", () => {
    it("in Electron mode: forwards exchangeRate as the 4th arg", async () => {
      const refund = jest.fn(async () => ({ success: true, refundId: 701 }));
      (globalThis as any).window.api = { transactions: { refund } };

      const apiMod = await import("../backendApi");
      await apiMod.refundTransaction(9, REFUND_LEGS, undefined, 90000);

      // 5th arg = refund kept change (LIRA-266); absent here, so undefined.
      expect(refund).toHaveBeenCalledWith(
        9,
        REFUND_LEGS,
        undefined,
        90000,
        undefined,
      );
    });

    it("in Web mode: POSTs exchangeRate alongside refundLegs", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 702 }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.refundTransaction(9, REFUND_LEGS, undefined, 90000);

      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/transactions/9/refund");
      expect(JSON.parse(options.body)).toEqual({
        refundLegs: REFUND_LEGS,
        refundUnitExtras: undefined,
        exchangeRate: 90000,
      });
    });

    it("in Web mode: omitting everything sends no body (byte-identical to today)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 703 }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.refundTransaction(9);

      const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toBeNull();
    });
  });
});
