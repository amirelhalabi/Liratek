/**
 * backendApi — 34 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 34).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  createProductSchema,
  productFormCreateSchema,
  type CreateProductPayload,
  auditPageFiltersSchema,
  transactionPageFiltersSchema,
  type MaintenanceUpdateMetadataInput,
  checkResetTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refundAddedChangeSchema,
  sessionItemRefundSchema,
  sessionItemRefundPreviewSchema,
  listSignupInvitationsQuerySchema,
  type ListSignupInvitationsQuery,
} from "@liratek/core";
import {
  login,
  ssoExchange,
  logout,
  adminListSignupInvitations,
} from "../backendApi";
import {
  getToken,
  setImpersonationToken,
  setToken,
  getImpersonationToken,
  setImpersonationTenantName,
  getImpersonationTenantName,
} from "../httpClient";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("backendApi.carrierLineOwedDeliveries.dualmode (LIRA-218)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate.
   *
   * getPendingCarrierLineOwedDeliveries / markCarrierLineOwedDeliverySent
   * dual-mode routing (#28, LIRA-218, v184) — closes the m4/both-transports
   * gap the 2026-09-24 adversarial review found: zero dual-mode adapter tests
   * existed for either function. Mirrors
   * `backendApi.getNetProfitLast30Days.dualmode.test.ts`'s own structure.
   */

  // A bare `export {}` makes this a module instead of a global script — without
  // it, TS merges this file's top-level `okJson` into the SAME global scope as
  // every other import-less `*.dualmode.test.ts` file's own `okJson`, which is
  // TS2393 "Duplicate function implementation" the moment two such files are
  // type-checked in the same run (see the other dualmode specs for the
  // no-import convention this one previously, and wrongly, matched).

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const DELIVERY = {
    id: 7,
    carrier_line_id: 1,
    transaction_id: 55,
    client_id: 3,
    client_name: "Jean",
    days_owed: 210,
    status: "PENDING",
    sent_at: null,
    sent_by: null,
    created_at: "2026-09-24 00:00:00",
    updated_at: "2026-09-24 00:00:00",
  };

  describe("backendApi.getPendingCarrierLineOwedDeliveries dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.carrierLines.getOwedDeliveriesPending() (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const getOwedDeliveriesPending = jest
        .fn()
        .mockResolvedValue({ success: true, data: [DELIVERY] });
      (globalThis as any).window.api = {
        carrierLines: { getOwedDeliveriesPending },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getPendingCarrierLineOwedDeliveries();

      expect(getOwedDeliveriesPending).toHaveBeenCalledWith();
      expect(result).toEqual({ success: true, data: [DELIVERY] });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/carrier-lines/owed-deliveries/pending", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: [DELIVERY] }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getPendingCarrierLineOwedDeliveries();

      expect(result).toEqual({ success: true, data: [DELIVERY] });
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(
        "/api/carrier-lines/owed-deliveries/pending",
      );
    });
  });

  describe("backendApi.markCarrierLineOwedDeliverySent dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.carrierLines.markOwedDeliverySent({deliveryId}) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const markOwedDeliverySent = jest.fn().mockResolvedValue({
        success: true,
        data: { ...DELIVERY, status: "SENT" },
      });
      (globalThis as any).window.api = {
        carrierLines: { markOwedDeliverySent },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.markCarrierLineOwedDeliverySent(7);

      expect(markOwedDeliverySent).toHaveBeenCalledWith({ deliveryId: 7 });
      expect(result).toEqual({
        success: true,
        data: { ...DELIVERY, status: "SENT" },
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs /api/carrier-lines/owed-deliveries/:id/mark-sent with no body needed (id is in the URL)", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: { ...DELIVERY, status: "SENT" } }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.markCarrierLineOwedDeliverySent(7);

      expect(result).toEqual({
        success: true,
        data: { ...DELIVERY, status: "SENT" },
      });
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(
        "/api/carrier-lines/owed-deliveries/7/mark-sent",
      );
    });

    it("in Web mode: a business rejection ({success:false}) is returned, not thrown — the envelope IS the return value here, not unwrapped like the read-and-throw functions", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: false,
          error: "Carrier line owed delivery #7 not found",
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.markCarrierLineOwedDeliverySent(7);

      expect(result).toEqual({
        success: false,
        error: "Carrier line owed delivery #7 not found",
      });
    });
  });
});

describe("backendApi.carrierLineUsage.dualmode (LIRA-145)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-145 — dual-mode (IPC vs REST) routing test for
   * `recordCarrierLineUsage`, the one carrier-line WRITE that moves money.
   *
   * `backendApi.dualmode.test.ts` is a single monolithic Electron-mode sweep
   * with no carrier-line stubs and no per-function table to extend, so the new
   * function gets its own focused file — the same shape as
   * `backendApi.serviceProviders.write.dualmode.test.ts`:
   * - In Electron (window.api present): routes via
   *   window.api.carrierLines.recordUsage, never fetch.
   * - In Web (no window.api): POSTs the exact payload to the static REST path
   *   /api/carrier-lines/record-usage and returns the envelope untouched.
   *
   * The failure envelope matters as much as the success one: the server
   * answers HTTP 200 with `{ success: false, error }` (IPC parity), and the
   * adapter must hand that straight back rather than throwing — the panel
   * renders `error` to the operator.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonCarrierLineUsage(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const USAGE_PAYLOAD = {
    carrierLineId: 7,
    newCredits: 62.5,
    expectedCurrentCredits: 100,
    note: "topped up a customer by hand",
  };

  const USAGE_SUCCESS = {
    success: true,
    data: {
      expenseId: 41,
      transactionId: 903,
      creditsUsed: 37.5,
      newCredits: 62.5,
    },
  };

  describe("backendApi recordCarrierLineUsage dual-mode routing (LIRA-145)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.carrierLines.recordUsage with the exact payload (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const recordUsage = jest.fn(async () => USAGE_SUCCESS);
      (globalThis as any).window.api = { carrierLines: { recordUsage } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.recordCarrierLineUsage(USAGE_PAYLOAD);

      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith(USAGE_PAYLOAD);
      expect(result).toEqual(USAGE_SUCCESS);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs the static /api/carrier-lines/record-usage path with the exact payload", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonCarrierLineUsage(USAGE_SUCCESS),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.recordCarrierLineUsage(USAGE_PAYLOAD);

      expect(result).toEqual(USAGE_SUCCESS);
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/carrier-lines/record-usage");
      // Static path — must not be mistaken for the /:id parameterized routes.
      expect(String(url)).not.toMatch(/\/api\/carrier-lines\/\d+/);
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual(USAGE_PAYLOAD);
    });

    it("in Web mode: a rejected usage comes back as the {success:false,error} envelope, not a throw", async () => {
      delete (globalThis as any).window.api;
      const rejection = {
        success: false,
        error:
          "Carrier line #7 balance changed since the form was opened (expected $100, line now holds $80) — reload and try again",
      };
      globalThis.fetch = jest.fn(async () =>
        okJsonCarrierLineUsage(rejection),
      ) as any;

      const apiMod = await import("../backendApi");
      await expect(
        apiMod.recordCarrierLineUsage(USAGE_PAYLOAD),
      ).resolves.toEqual(rejection);
    });

    it("omits the optional fields when the caller omits them", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const recordUsage = jest.fn(async () => USAGE_SUCCESS);
      (globalThis as any).window.api = { carrierLines: { recordUsage } };

      const apiMod = await import("../backendApi");
      await apiMod.recordCarrierLineUsage({
        carrierLineId: 7,
        newCredits: 62.5,
      });

      expect(recordUsage).toHaveBeenCalledWith({
        carrierLineId: 7,
        newCredits: 62.5,
      });
    });
  });
});

describe("backendApi.createProduct.dualmode (LIRA-297)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-297 (rule 21/24) — `createProduct` takes the product form payload
   * (`CreateProductPayload`, core's `productFormCreateSchema`). On desktop it
   * goes to IPC as-is; on web it is translated to the REST route's
   * `createProductSchema` names. Every key of the form schema must reach the
   * REST body under SOME name, or be listed below as deliberately not sent —
   * this is the test that catches the next silently dropped field.
   *
   * Field names are read from the schemas' own `.shape` (rule 24).
   */

  // module scope

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(data),
    } as any;
  }

  /** Form key → the REST body key it travels under. */
  const REST_NAME: Partial<Record<keyof CreateProductPayload, string>> = {
    cost_price: "cost_price_usd",
    retail_price: "retail_price_usd",
    stock_quantity: "stock",
    min_stock_level: "min_stock_threshold",
  };

  /** Form keys the REST create route has no field for — not sent on web.
   *  `whish_price` is not read by the desktop handler either; `image_url` is
   *  read on desktop but no caller sends it and REST has no column mapping. */
  const NOT_SENT_ON_WEB: ReadonlyArray<string> = ["whish_price", "image_url"];

  const PAYLOAD: CreateProductPayload = {
    barcode: "1234567890",
    name: "USB cable",
    category: "Accessories",
    cost_price: 2,
    retail_price: 5,
    whish_price: 6,
    stock_quantity: 3,
    min_stock_level: 4,
    image_url: "x.png",
    supplier: "Acme",
    warranty_months: 12,
    is_old_stock: true,
  };

  describe("backendApi.createProduct dual-mode", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("the fixture sets every form-schema key", () => {
      expect(Object.keys(PAYLOAD).sort()).toEqual(
        Object.keys(productFormCreateSchema.shape).sort(),
      );
    });

    it("in Electron mode: sends the payload to IPC unchanged", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const createProduct = jest.fn(async () => ({ success: true, id: 9 }));
      (globalThis as any).window.api = { inventory: { createProduct } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.createProduct(PAYLOAD);

      expect(createProduct).toHaveBeenCalledWith(PAYLOAD);
      expect(result).toEqual({ success: true, id: 9 });
    });

    it("in Web mode: every form key reaches the REST body (or is listed as not sent)", async () => {
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: { id: 9 } }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.createProduct(PAYLOAD);
      expect(result).toMatchObject({ success: true, id: 9 });

      const init = (globalThis.fetch as jest.Mock).mock.calls[0][1];
      const body = JSON.parse(init.body);
      const restKeys = Object.keys(createProductSchema.shape);

      for (const key of Object.keys(productFormCreateSchema.shape)) {
        if (NOT_SENT_ON_WEB.includes(key)) {
          continue;
        }
        const restKey = REST_NAME[key as keyof CreateProductPayload] ?? key;
        // The REST schema must know the name, or Zod strips it server-side.
        expect(restKeys).toContain(restKey);
        expect(body).toHaveProperty(
          restKey,
          PAYLOAD[key as keyof CreateProductPayload],
        );
      }
    });

    it.each([12, 0, null])(
      "in Web mode: the REST create schema accepts the body with warranty_months=%p and keeps it",
      async (warranty_months) => {
        globalThis.fetch = jest.fn(async () =>
          okJson({ success: true, data: { id: 9 } }),
        ) as any;

        const apiMod = await import("../backendApi");
        await apiMod.createProduct({ ...PAYLOAD, warranty_months });

        const body = JSON.parse(
          (globalThis.fetch as jest.Mock).mock.calls[0][1].body,
        );
        const parsed = createProductSchema.safeParse(body);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.warranty_months).toBe(warranty_months);
          expect(parsed.data.cost_price_usd).toBe(PAYLOAD.cost_price);
          expect(parsed.data.retail_price_usd).toBe(PAYLOAD.retail_price);
          expect(parsed.data.stock).toBe(PAYLOAD.stock_quantity);
        }
      },
    );

    it("in Web mode: a code-less product sends no barcode (the server generates one)", async () => {
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: { id: 9 } }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.createProduct({ ...PAYLOAD, barcode: null });

      const body = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body).not.toHaveProperty("barcode");
    });
  });
});

describe("backendApi.deleteDraft.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Web-only bug fix: `deleteDraft()` ("cancel draft" in the POS) called
   * `DELETE /api/sales/drafts/:id` over HTTP but backend/src/api/sales.ts
   * registered no such route — so cancelling a draft was broken on web while
   * working on desktop (IPC). This test locks the dual-mode routing contract
   * (rule 19/21) so the two transports can't drift again:
   * - In Electron (window.api present): routes via window.api.sales.deleteDraft,
   *   never fetch.
   * - In Web (no window.api): DELETEs the exact REST route the new backend
   *   handler (backend/src/api/sales.ts) listens on, and returns the envelope
   *   as-is (rule 19c: HTTP 200 even on a business-rule failure).
   *
   * Follows the harness in backendApi.serviceProviders.write.dualmode.test.ts.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonDeleteDraft(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  describe("backendApi.deleteDraft dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.sales.deleteDraft (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const deleteDraft = jest.fn(async () => ({ success: true }));
      (globalThis as any).window.api = { sales: { deleteDraft } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.deleteDraft(7);

      expect(deleteDraft).toHaveBeenCalledWith(7);
      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: DELETEs /api/sales/drafts/:id and returns the envelope as-is", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonDeleteDraft({ success: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.deleteDraft(7);

      expect(result).toEqual({ success: true });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/drafts/7");
      expect(options.method).toBe("DELETE");
    });

    it("in Web mode: a business-rule failure (e.g. not a draft) still resolves the envelope, not a thrown error", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonDeleteDraft({
          success: false,
          error: "Only draft sales can be deleted",
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.deleteDraft(7);

      expect(result).toEqual({
        success: false,
        error: "Only draft sales can be deleted",
      });
    });
  });
});

describe("backendApi.downloadShopBackup.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Web "Download backup" — `downloadShopBackup()` dual-mode routing.
   *
   * NOT proven failing-first (rule 17): written after `requestFile` existed,
   * to pin how a file response is told apart from a refusal envelope.
   * - Desktop: answers "Available on the web app", never fetches.
   * - Web: GETs /api/backup/download?stamp=…; a JSON body is the refusal
   *   envelope; anything else is the file, named from Content-Disposition.
   */

  function fakeResponse(opts: {
    contentType: string;
    disposition?: string;
    json?: unknown;
    blob?: Blob;
    status?: number;
  }) {
    const headers: Record<string, string> = {
      "content-type": opts.contentType,
    };
    if (opts.disposition) headers["content-disposition"] = opts.disposition;
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => opts.json,
      blob: async () => opts.blob,
    } as any;
  }

  describe("backendApi.downloadShopBackup dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: refuses as web-only and never fetches", async () => {
      globalThis.fetch = jest.fn() as any;
      (globalThis as any).window.api = {};
      const apiMod = await import("../backendApi");
      const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
      expect(r).toEqual({ success: false, error: "Available on the web app" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: returns the file and the server's file name", async () => {
      const blob = new Blob(["SQLite format 3"]);
      globalThis.fetch = jest.fn(async () =>
        fakeResponse({
          contentType: "application/vnd.sqlite3",
          disposition:
            'attachment; filename="liratek-cornertech-2026-11-10-1430.db"',
          blob,
        }),
      ) as any;
      const apiMod = await import("../backendApi");
      const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
      expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toMatch(
        /\/api\/backup\/download\?stamp=2026-11-10-1430$/,
      );
      expect(r).toEqual({
        success: true,
        data: { blob, fileName: "liratek-cornertech-2026-11-10-1430.db" },
      });
    });

    it("in Web mode: a JSON answer is the refusal envelope", async () => {
      globalThis.fetch = jest.fn(async () =>
        fakeResponse({
          contentType: "application/json; charset=utf-8",
          status: 403,
          json: { success: false, error: "Forbidden" },
        }),
      ) as any;
      const apiMod = await import("../backendApi");
      const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
      expect(r).toEqual({ success: false, error: "Forbidden" });
    });
  });
});

describe("backendApi.dualmode", () => {
  beforeAll(resetBetweenFiles);

  // NOTE:
  // These tests enforce a key invariant:
  // - In Electron (window.api present), backendApi must NOT call fetch.
  // - In Web (no window.api), backendApi may call fetch.

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  describe("backendApi dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: all exported functions route via window.api (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const apiStub: any = {
        // Auth
        auth: {
          login: jest.fn(async () => ({
            success: true,
            user: { id: 1, username: "admin", role: "admin" },
            sessionToken: "tok",
          })),
          logout: jest.fn(async () => ({ success: true })),
          restoreSession: jest.fn(async () => ({
            success: true,
            user: { id: 1, username: "admin", role: "admin" },
            sessionToken: "tok",
          })),
          getNonAdminUsers: jest.fn(async () => []),
          setUserActive: jest.fn(async () => ({ success: true })),
          setUserRole: jest.fn(async () => ({ success: true })),
          createUser: jest.fn(async () => ({ success: true, id: 1 })),
          setUserPassword: jest.fn(async () => ({ success: true })),
        },

        // Clients
        clients: {
          getAll: jest.fn(async () => [{ id: 1 }]),
          delete: jest.fn(async () => ({ success: true })),
        },

        // Inventory
        inventory: {
          getProducts: jest.fn(async () => [{ id: 1 }]),
          getLowStockProducts: jest.fn(async () => []),
          createProduct: jest.fn(async () => ({ success: true, id: 1 })),
          updateProduct: jest.fn(async () => ({ success: true })),
          deleteProduct: jest.fn(async () => ({ success: true })),
          getStockStats: jest.fn(async () => ({
            stock_budget_usd: 1,
            stock_count: 1,
          })),
        },

        // Sales
        sales: {
          getDrafts: jest.fn(async () => []),
          process: jest.fn(async () => ({ success: true, id: 1 })),
          get: jest.fn(async () => ({ id: 1 })),
          getItems: jest.fn(async () => []),
          getTodaysSales: jest.fn(async () => []),
        },

        // Debts
        debt: {
          getDebtors: jest.fn(async () => []),
          getClientHistory: jest.fn(async () => []),
          getClientTotal: jest.fn(async () => 0),
          addRepayment: jest.fn(async () => ({ success: true })),
          getSummary: jest.fn(async () => ({ totalDebt: 0, topDebtors: [] })),
        },

        // Exchange
        exchange: {
          addTransaction: jest.fn(async () => ({ success: true, id: 1 })),
          getHistory: jest.fn(async () => []),
        },

        // Binance
        binance: {
          getHistory: jest.fn(async () => []),
          getTodayStats: jest.fn(async () => ({
            totalSent: 0,
            totalReceived: 0,
            count: 0,
          })),
          addTransaction: jest.fn(async () => ({ success: true, id: 1 })),
        },

        // Currencies
        currencies: {
          list: jest.fn(async () => []),
          create: jest.fn(async () => ({ success: true, id: 1 })),
          update: jest.fn(async () => ({ success: true })),
          delete: jest.fn(async () => ({ success: true })),
        },

        // Rates
        rates: {
          list: jest.fn(async () => []),
          set: jest.fn(async () => ({ success: true })),
        },

        // Expenses
        expenses: {
          getToday: jest.fn(async () => []),
          add: jest.fn(async () => ({ success: true, id: 1 })),
          delete: jest.fn(async () => ({ success: true })),
        },

        // Dashboard
        dashboard: {
          getStats: jest.fn(async () => ({ totalSalesUSD: 0 })),
          getProfitSalesChart: jest.fn(async () => []),
          getDrawerBalances: jest.fn(async () => ({
            generalDrawer: { usd: 0, lbp: 0 },
            omtDrawer: { usd: 0, lbp: 0 },
          })),
        },

        // Financial
        financial: {
          getDrawerNames: jest.fn(async () => []),
        },

        // Settings
        settings: {
          getAll: jest.fn(async () => [{ key_name: "x", value: "1" }]),
          update: jest.fn(async () => ({ success: true })),
        },

        // Recharge
        recharge: {
          getStock: jest.fn(async () => ({ mtc: 0, alfa: 0 })),
          process: jest.fn(async () => ({ success: true, id: 1 })),
        },

        // OMT Services
        omt: {
          getHistory: jest.fn(async () => []),
          getAnalytics: jest.fn(async () => ({
            today: { commissionUSD: 0, commissionLBP: 0, count: 0 },
          })),
          addTransaction: jest.fn(async () => ({ success: true, id: 1 })),
        },

        // Maintenance
        maintenance: {
          getJobs: jest.fn(async () => []),
          save: jest.fn(async () => ({ success: true, id: 1 })),
          delete: jest.fn(async () => ({ success: true })),
        },

        // Closing
        closing: {
          getSystemExpectedBalancesDynamic: jest.fn(async () => ({})),
          hasOpeningBalanceToday: jest.fn(async () => true),
          getDailyStatsSnapshot: jest.fn(async () => ({})),
          updateDailyClosing: jest.fn(async () => ({ success: true })),
        },

        // Suppliers
        suppliers: {
          list: jest.fn(async () => []),
          getBalances: jest.fn(async () => []),
          getLedger: jest.fn(async () => []),
          create: jest.fn(async () => ({ success: true, id: 1 })),
          addLedgerEntry: jest.fn(async () => ({ success: true, id: 1 })),
        },

        // Activity
        activity: {
          getRecent: jest.fn(async () => []),
        },

        // Reports
        report: {
          generatePDF: jest.fn(async () => ({
            success: true,
            path: "/tmp/x.pdf",
          })),
          backupDatabase: jest.fn(async () => ({
            success: true,
            path: "/tmp/bak",
          })),
          listBackups: jest.fn(async () => ({ success: true, backups: [] })),
          verifyBackup: jest.fn(async () => ({ success: true, ok: true })),
          restoreDatabase: jest.fn(async () => ({ success: true })),
        },
      };

      (globalThis as any).window.api = apiStub;
      localStorage.setItem("sessionToken", "tok");

      const apiMod = await import("../backendApi");

      // Invoke every export with a minimal argument set.
      await apiMod.login("admin", "admin123", false);
      await apiMod.logout();
      await apiMod.me();

      await apiMod.getClients("");
      await apiMod.deleteClient(1);

      await apiMod.getProducts("");
      await apiMod.getLowStockProducts();
      await apiMod.createProduct(
        {} as Parameters<typeof apiMod.createProduct>[0],
      );
      await apiMod.updateProduct(
        1,
        {} as Parameters<typeof apiMod.updateProduct>[1],
      );
      await apiMod.deleteProduct(1);

      await apiMod.getDrafts();
      await apiMod.processSale({} as Parameters<typeof apiMod.processSale>[0]);
      await apiMod.getSale(1);
      await apiMod.getSaleItems(1);

      await apiMod.getDebtors();
      await apiMod.getClientDebtHistory(1);
      await apiMod.getClientDebtTotal(1);
      await apiMod.addRepayment(
        {} as Parameters<typeof apiMod.addRepayment>[0],
      );

      await apiMod.getExchangeRates();
      await apiMod.getCurrenciesList();
      await apiMod.getExchangeHistory(10);
      // Transport routing only (no validation here) — the payload is typed from
      // the core schema since LIRA-258 (rule 21), so an empty stub needs a cast.
      await apiMod.addExchangeTransaction(
        {} as Parameters<typeof apiMod.addExchangeTransaction>[0],
      );

      await apiMod.getTodayExpenses();
      await apiMod.addExpense({} as Parameters<typeof apiMod.addExpense>[0]);
      await apiMod.deleteExpense(1);

      await apiMod.getDashboardStats();
      await apiMod.getProfitSalesChart("Sales");
      await apiMod.getTodaysSales();
      await apiMod.getDrawerBalances();
      await apiMod.getDebtSummary();
      await apiMod.getInventoryStockStats();

      await apiMod.getAllSettings();
      await apiMod.getSetting("x");
      await apiMod.updateSetting("x", "2");

      await apiMod.getRechargeStock();
      // Payload now typed from createRechargeSchema (rule 21, LIRA-185 #1).
      await apiMod.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 1,
        price: 1,
      });

      await apiMod.getOMTHistory();
      await apiMod.getOMTAnalytics();
      await apiMod.addOMTTransaction(
        {} as Parameters<typeof apiMod.addOMTTransaction>[0],
      );

      await apiMod.getMaintenanceJobs();
      // Transport routing only — the payload is typed from the core schema
      // since LIRA-263 (rule 21), so an empty stub needs a cast.
      await apiMod.saveMaintenanceJob(
        {} as Parameters<typeof apiMod.saveMaintenanceJob>[0],
      );
      await apiMod.deleteMaintenanceJob(1);

      await apiMod.getCurrencies();

      await apiMod.getSystemExpectedBalancesDynamic();
      await apiMod.hasOpeningBalanceToday();
      await apiMod.getDailyStatsSnapshot();
      await apiMod.updateDailyClosing(1, {});

      await apiMod.getSuppliers("");
      await apiMod.getSupplierBalances();
      await apiMod.getSupplierLedger(1, 10);
      await apiMod.createSupplier({ name: "s" });
      await apiMod.addSupplierLedgerEntry(1, {
        entry_type: "TOP_UP",
        amount_usd: 0,
        amount_lbp: 0,
      });

      await apiMod.getRates();
      await apiMod.setRate({
        to_code: "LBP",
        market_rate: 89000,
        buy_rate: 88500,
        sell_rate: 89500,
        is_stronger: -1,
      });

      await apiMod.getNonAdminUsers();
      await apiMod.createUser({ username: "u", password: "p", role: "staff" });
      await apiMod.setUserActive(1, true);
      await apiMod.setUserRole(1, "staff");
      await apiMod.setUserPassword(1, "p");

      await apiMod.getRecentActivity(10);

      await apiMod.generatePDF("<html></html>");
      await apiMod.backupDatabase();
      await apiMod.listBackups();
      await apiMod.verifyBackup("/tmp/x");
      await apiMod.restoreDatabase("/tmp/x");

      await apiMod.createCurrency("EUR", "Euro");
      await apiMod.updateCurrency(1, { name: "Euro" });
      await apiMod.deleteCurrency(1);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: a representative call uses HTTP fetch", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, users: [{ id: 1 }] }),
      ) as any;

      const apiMod = await import("../backendApi");
      await expect(apiMod.getNonAdminUsers()).resolves.toEqual([{ id: 1 }]);

      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });
});

describe("backendApi.endsReplacedSession", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Signing in again on the same browser ends the PREVIOUS session there
   * (owner-approved 2026-10-08).
   *
   * Before: every sign-in (password, or the Google hand-off) minted a new
   * session and simply overwrote `liratek.jwt` in localStorage. The old
   * session stayed alive on the server until idle expiry (8 h, or 7 days with
   * "Keep me signed in"), so Settings -> Signed-in Devices filled up with
   * ghosts of this very browser.
   *
   * Now, when a new normal-login token is stored and a different one was
   * there, the old one is sent to POST /api/auth/logout — best effort: a
   * failing or slow logout never fails or holds up the new sign-in (≈2 s at
   * most), impersonation tokens (sessionStorage) are never touched, and the
   * session being stored is never the one ended.
   */
  describe("a new sign-in ends this browser's previous session", () => {
    const originalFetch = globalThis.fetch;
    let logoutAuth: string[];
    let logoutBehaviour: "ok" | "fail" | "hang";

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      delete (window as unknown as { api?: unknown }).api;
      logoutAuth = [];
      logoutBehaviour = "ok";
      globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (url.endsWith("/api/auth/logout")) {
          logoutAuth.push(headers.Authorization ?? "");
          if (logoutBehaviour === "fail") throw new Error("network down");
          if (logoutBehaviour === "hang") return new Promise(() => {});
          return reply(200, { success: true });
        }
        if (url.endsWith("/api/auth/login")) {
          const body = JSON.parse(String(init?.body)) as { password: string };
          if (body.password === "wrong") {
            return reply(401, {
              error: { message: "Invalid username or password" },
            });
          }
          return reply(200, {
            success: true,
            data: {
              token: "new-token",
              sessionToken: "s-new",
              user: { id: 7, username: "rami", role: "staff" },
            },
          });
        }
        if (url.endsWith("/api/auth/google/sso-exchange")) {
          return reply(200, {
            success: true,
            data: {
              token: "sso-token",
              sessionToken: "s-sso",
              user: { id: 7, username: "rami", role: "staff" },
            },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      jest.clearAllMocks();
    });

    function reply(status: number, body: unknown) {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      };
    }

    it("password sign-in: logs the OLD token out once, then the new token is the one stored", async () => {
      setToken("old-token");
      const res = await login("rami", "Right-Pass1!", false);
      expect(res.success).toBe(true);
      expect(logoutAuth).toEqual(["Bearer old-token"]);
      expect(getToken()).toBe("new-token");
    });

    it("Google hand-off: logs the OLD token out once, then the new token is the one stored", async () => {
      setToken("old-token");
      const res = await ssoExchange({ token: "handoff" });
      expect(res.success).toBe(true);
      expect(logoutAuth).toEqual(["Bearer old-token"]);
      expect(getToken()).toBe("sso-token");
    });

    it("a failing logout never fails the sign-in", async () => {
      setToken("old-token");
      logoutBehaviour = "fail";
      const res = await login("rami", "Right-Pass1!", false);
      expect(res.success).toBe(true);
      expect(getToken()).toBe("new-token");
    });

    it("a logout that never answers holds the sign-in up for about 2 seconds at most", async () => {
      setToken("old-token");
      logoutBehaviour = "hang";
      const started = Date.now();
      const res = await login("rami", "Right-Pass1!", false);
      expect(res.success).toBe(true);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(getToken()).toBe("new-token");
    });

    it("no previous token: no logout call", async () => {
      await login("rami", "Right-Pass1!", false);
      expect(logoutAuth).toEqual([]);
      expect(getToken()).toBe("new-token");
    });

    it("the same token again is never logged out", async () => {
      setToken("new-token");
      await login("rami", "Right-Pass1!", false);
      expect(logoutAuth).toEqual([]);
    });

    it("an impersonation token is never sent to logout", async () => {
      setImpersonationToken("impersonation-token");
      await login("rami", "Right-Pass1!", false);
      expect(logoutAuth).toEqual([]);
    });

    it("a FAILED sign-in ends nothing and keeps the old token", async () => {
      setToken("old-token");
      const res = await login("rami", "wrong", false);
      expect(res.success).toBe(false);
      expect(logoutAuth).toEqual([]);
      expect(getToken()).toBe("old-token");
    });
  });
});

describe("backendApi.getDailyStatsSnapshot.dualmode (LIRA-219)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-219 (C.4, rule 22) — `getDailyStatsSnapshot` dual-mode routing.
   * Proves ONE `input` object is built once and handed to BOTH branches
   * unchanged (rule 22 — `ipcOrHttp` is the only transport branch), that the
   * `?day=` query string is only appended when a day was actually supplied
   * (rule 27 — an omitted day lets the server fall back to `clientDay()`
   * rather than the adapter inventing a value), and rule 19c (a `{success:
   * false}` body — HTTP 200 — rejects the promise instead of silently
   * resolving to `undefined`, mirroring `getProfitSalesChart`'s own DC7-WEB
   * fix).
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonSnapshot(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const SNAPSHOT = {
    salesCount: 3,
    totalSalesUSD: 100,
    totalSalesLBP: 0,
    debtPaymentsUSD: 0,
    debtPaymentsLBP: 0,
    totalExpensesUSD: 5,
    totalExpensesLBP: 0,
    profitDay: "2026-09-20",
    totalProfitUSD: 12,
    totalProfitLBP: 0,
  };

  describe("backendApi.getDailyStatsSnapshot dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.closing.getDailyStatsSnapshot(input) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const getDailyStatsSnapshot = jest.fn(async () => SNAPSHOT);
      (globalThis as any).window.api = {
        closing: { getDailyStatsSnapshot },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getDailyStatsSnapshot({ day: "2026-09-20" });

      expect(getDailyStatsSnapshot).toHaveBeenCalledWith({ day: "2026-09-20" });
      expect(result).toEqual(SNAPSHOT);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Electron mode with NO input: still routes via IPC, passing input through unchanged (undefined)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const getDailyStatsSnapshot = jest.fn(async () => SNAPSHOT);
      (globalThis as any).window.api = {
        closing: { getDailyStatsSnapshot },
      };

      const apiMod = await import("../backendApi");
      await apiMod.getDailyStatsSnapshot();

      expect(getDailyStatsSnapshot).toHaveBeenCalledWith(undefined);
    });

    it("in Web mode: fetches GET /api/closing/daily-stats-snapshot?day=... when a day is supplied", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonSnapshot({ success: true, stats: SNAPSHOT }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getDailyStatsSnapshot({ day: "2026-09-20" });

      expect(result).toEqual(SNAPSHOT);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/closing/daily-stats-snapshot");
      expect(String(url)).toContain("day=2026-09-20");
    });

    it("in Web mode with NO day: fetches the bare route with no ?day= at all (server falls back to clientDay())", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonSnapshot({ success: true, stats: SNAPSHOT }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.getDailyStatsSnapshot();

      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/closing/daily-stats-snapshot");
      expect(String(url)).not.toContain("day=");
    });

    it("in Web mode: throws when the server answers {success:false} (rule 19c) instead of silently resolving to undefined stats", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonSnapshot({ success: false, error: "Failed to get daily stats" }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.getDailyStatsSnapshot()).rejects.toThrow(
        "Failed to get daily stats",
      );
    });

    it("in Web mode: throws a generic message when the server answers {success:false} with no error string", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonSnapshot({ success: false }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.getDailyStatsSnapshot()).rejects.toThrow();
    });
  });
});

describe("backendApi.getNetProfitLast30Days.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * getNetProfitLast30Days dual-mode routing — DC-11 (OWNER_NOTES_2026-09-21.md
   * §7.2). Mirrors `backendApi.getProfitSalesChart.dualmode.test.ts`'s own
   * structure (same rule-27 default-clientDay pattern, same DC-7-style
   * envelope-parity requirement on the web branch).
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonNetProfit(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const NET_PROFIT = {
    netProfitUSD: 49,
    netProfitLBP: 380_000,
    fromDate: "2026-08-26",
    toDate: "2026-09-24",
  };

  describe("backendApi.getNetProfitLast30Days dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.dashboard.getNetProfitLast30Days(clientDay) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const getNetProfitLast30Days = jest.fn(async () => NET_PROFIT);
      (globalThis as any).window.api = {
        dashboard: { getNetProfitLast30Days },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getNetProfitLast30Days();

      expect(getNetProfitLast30Days).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(result).toEqual(NET_PROFIT);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/dashboard/net-profit-last-30-days?client_day=... and returns netProfit on success", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonNetProfit({ success: true, netProfit: NET_PROFIT }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getNetProfitLast30Days("2026-09-24");

      expect(result).toEqual(NET_PROFIT);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/dashboard/net-profit-last-30-days");
      expect(String(url)).toContain("client_day=2026-09-24");
    });

    it("in Web mode: throws when the server answers {success:false} instead of silently resolving to undefined", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonNetProfit({ success: false, error: "Failed to get net profit" }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.getNetProfitLast30Days()).rejects.toThrow(
        "Failed to get net profit",
      );
    });
  });
});

describe("backendApi.getProfitModuleDetail.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (OWNER_NOTES_REMAINING_BUILD.md
   * #14 slice 2 batch process rule: implement first, verify at the end).
   *
   * getProfitModuleDetail dual-mode routing (2026-09-24,
   * OWNER_NOTES_REMAINING_BUILD.md #14 slice 2 — Profits page "Show
   * transactions" drill-down).
   *
   * Mirrors `backendApi.profitsCommissions.dualmode.test.ts`'s own harness and
   * its LC-2 precedent: the module-detail route's query is schema-validated
   * (`moduleDetailQuerySchema`), so a validation failure or an
   * unsupported-module error both come back as HTTP 200 `{success:false,
   * error}` (rule 19c) — this function must throw on `!res.success`, not
   * silently return `undefined`.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const DETAIL = {
    module: "SALE",
    counted: [
      {
        id: 1,
        date: "2026-09-01 10:00:00",
        counterpart: "Walk-in",
        detail: "Charger x1",
        amount_usd: 45,
        amount_lbp: 0,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 15,
        profit_lbp: 0,
        counted_pct: 100,
        counted_profit_usd: 15,
        counted_profit_lbp: 0,
        reason: null,
        fee_note: null,
      },
    ],
    not_counted: [],
    counted_total_profit_usd: 15,
    counted_total_profit_lbp: 0,
  };

  describe("backendApi.getProfitModuleDetail dual-mode routing (PROF-DD, #14 slice 2)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.profits.moduleDetail(moduleKey, from, to) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const moduleDetail = jest.fn(async () => DETAIL);
      (globalThis as any).window.api = { profits: { moduleDetail } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitModuleDetail(
        "SALE",
        "2026-09-01",
        "2026-09-30",
      );

      expect(moduleDetail).toHaveBeenCalledWith(
        "SALE",
        "2026-09-01",
        "2026-09-30",
      );
      expect(result).toEqual(DETAIL);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/profits/module-detail with module/from/to and returns data on success", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: DETAIL }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitModuleDetail(
        "RECHARGE_MTC",
        "2026-09-01",
        "2026-09-30",
      );

      expect(result).toEqual(DETAIL);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/profits/module-detail");
      expect(String(url)).toContain("module=RECHARGE_MTC");
      expect(String(url)).toContain("from=2026-09-01");
      expect(String(url)).toContain("to=2026-09-30");
    });

    it("in Web mode: throws when the server answers {success:false} (missing module / unsupported module) instead of silently returning undefined", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: false,
          error:
            'No transaction-level detail is available for "LOTO" yet (slice 3, a later ticket).',
        }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(
        apiMod.getProfitModuleDetail("LOTO", "2026-09-01", "2026-09-30"),
      ).rejects.toThrow(/slice 3/);
    });

    it("in Web mode: throws a generic message when the server answers {success:false} with no error string", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () => okJson({ success: false })) as any;

      const apiMod = await import("../backendApi");

      await expect(
        apiMod.getProfitModuleDetail("SALE", "2026-09-01", "2026-09-30"),
      ).rejects.toThrow();
    });
  });
});

describe("backendApi.getProfitSalesChart.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * getProfitSalesChart dual-mode routing + DC7-WEB (round-1 chart-lane
   * review, OWNER_NOTES_2026-09-21.md §7.1).
   *
   * DC7-WEB: `GET /api/dashboard/chart` now answers a thrown DatabaseError
   * with HTTP 200 `{success:false,error}` instead of an uncaught 500 (rule
   * 19c envelope parity with the IPC channel, which has no try/catch of its
   * own and simply rejects). `getProfitSalesChart` used to `return res.chart`
   * unconditionally, so that failure resolved to `undefined` — Dashboard.tsx's
   * `loadData` (`Array.isArray(profitChartResult.value)`) silently skipped it,
   * so the chart widget was never flagged even though the IPC transport
   * rejects on the identical failure. Fixed by throwing on `!res.success`,
   * mirroring `getProfitsCommissions`'s own LC-2 fix
   * (`backendApi.profitsCommissions.dualmode.test.ts`).
   *
   * RULE 17 (failing-first proof — OBSERVED, chart-lane round-1 fix
   * verification): reverted `backendApi.ts`'s `getProfitSalesChart` web
   * branch to the pre-fix `return res.chart;` (no `res.success` check) and
   * ran `npx jest backendApi.getProfitSalesChart.dualmode --maxWorkers=1`.
   * RED: 2 of 4 failed — both `{success:false}` tests ("throws when the
   * server answers {success:false} …" and "throws a generic message …")
   * failed with `Received promise resolved instead of rejected / Resolved to
   * value: undefined`, exactly the silent-`undefined` bug this guard exists
   * to catch. The other 2 (Electron-mode routing, Web-mode success path)
   * stayed green, as expected — the mutant only touches the failure branch.
   * Restored the fix and re-ran: 4/4 GREEN.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonChart(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const CHART = [
    { date: "2026-09-10", usd: 75, lbp: 1_170_000 },
    { date: "2026-09-11", usd: 0, lbp: 0 },
  ];

  describe("backendApi.getProfitSalesChart dual-mode routing + DC7-WEB", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.dashboard.getProfitSalesChart(type, clientDay) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const getProfitSalesChart = jest.fn(async () => CHART);
      (globalThis as any).window.api = {
        dashboard: { getProfitSalesChart },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitSalesChart("Sales");

      // DC-10 (rule 27): the adapter now ALSO sends the browser's own
      // localDay() as a second arg (default parameter) — a real calendar-day
      // string, not a fixed literal, so match its shape rather than an exact
      // value that would drift with the day this test happens to run on.
      expect(getProfitSalesChart).toHaveBeenCalledWith(
        "Sales",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(result).toEqual(CHART);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/dashboard/chart?type=...&client_day=... and returns the chart on success", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonChart({ success: true, chart: CHART }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitSalesChart("Sales");

      expect(result).toEqual(CHART);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/dashboard/chart");
      expect(String(url)).toContain("type=Sales");
      // DC-10 (rule 27): the browser's own calendar day now rides along too.
      expect(String(url)).toMatch(/client_day=\d{4}-\d{2}-\d{2}/);
    });

    it("in Web mode: throws when the server answers {success:false} (DC7-WEB — HTTP 200 envelope failure) instead of silently resolving to undefined", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonChart({ success: false, error: "Failed to get chart data" }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.getProfitSalesChart("Profit")).rejects.toThrow(
        "Failed to get chart data",
      );
    });

    it("in Web mode: throws a generic message when the server answers {success:false} with no error string", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonChart({ success: false }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.getProfitSalesChart("Sales")).rejects.toThrow();
    });
  });
});

describe("backendApi.getRefundBookedRate.dualmode (LIRA-236)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-236 integration-gap follow-up (2026-09-27 coordinator review) —
   * `getRefundBookedRate` was wired end-to-end on BOTH transports (IPC channel
   * `transactions:get-refund-booked-rate`, REST route
   * `GET /api/transactions/:id/refund-booked-rate`, `ApiAdapter` entry) but
   * `backendApi.ts` never had a function calling either one — the Transactions
   * page instead derived its own rate from `row.exchange_rate` (rule 14). This
   * locks the dual-mode routing contract (rule 19/21) for the new function:
   * - In Electron (window.api present): routes via
   *   window.api.transactions.getRefundBookedRate, never fetch.
   * - In Web (no window.api): GETs the exact REST route
   *   (backend/src/api/transactions.ts) and returns the envelope as-is
   *   (rule 19c: HTTP 200 even on a business-rule failure).
   *
   * Follows the harness in backendApi.deleteDraft.dualmode.test.ts.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  describe("backendApi.getRefundBookedRate dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.transactions.getRefundBookedRate(id) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const getRefundBookedRate = jest.fn(async () => ({
        success: true,
        bookedRate: 91000,
        bookedRateSource: "sale",
      }));
      (globalThis as any).window.api = {
        transactions: { getRefundBookedRate },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getRefundBookedRate(7);

      expect(getRefundBookedRate).toHaveBeenCalledWith(7);
      expect(result).toEqual({
        success: true,
        bookedRate: 91000,
        bookedRateSource: "sale",
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: GETs /api/transactions/:id/refund-booked-rate and returns the envelope as-is", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({
          success: true,
          bookedRate: 89000,
          bookedRateSource: "fallback",
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getRefundBookedRate(7);

      expect(result).toEqual({
        success: true,
        bookedRate: 89000,
        bookedRateSource: "fallback",
      });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/transactions/7/refund-booked-rate");
      expect(options?.method ?? "GET").toBe("GET");
    });

    it("in Web mode: a business-rule failure still resolves the envelope, not a thrown error", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: false, error: "Transaction not found" }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getRefundBookedRate(999);

      expect(result).toEqual({
        success: false,
        error: "Transaction not found",
      });
    });
  });
});

describe("backendApi.holdMoney.dualmode (LIRA-214)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (owner process rule for this
   * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183):
   * holdMoneyCollect's signature (bare id -> payload) and holdMoneyVoidPickup
   * are new, so this whole file fails against pre-fix backendApi.ts by
   * construction (rule 17). Mirrors
   * backendApi.getNetProfitLast30Days.dualmode.test.ts's structure.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  describe("backendApi holdMoney* dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("holdMoneyCreate — Electron mode routes via window.api.holdMoney.create with no fetch", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const create = jest.fn(async () => ({ success: true, id: 1 }));
      (globalThis as any).window.api = { holdMoney: { create } };

      const apiMod = await import("../backendApi");
      const payload = { client_name: "Sami", usd_amount: 40, client_id: 7 };
      const result = await apiMod.holdMoneyCreate(payload as any);

      expect(create).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ success: true, id: 1 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("holdMoneyCreate — Web mode POSTs /api/hold-money with the full payload", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (_url: string, init?: any) => {
        expect(JSON.parse(init.body)).toEqual({
          client_name: "Sami",
          usd_amount: 40,
          client_id: 7,
        });
        return okJson({ success: true, id: 1 });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.holdMoneyCreate({
        client_name: "Sami",
        usd_amount: 40,
        client_id: 7,
      } as any);

      expect(result).toEqual({ success: true, id: 1 });
    });

    it("holdMoneyCollect — Electron mode passes the WHOLE payload object (not a bare id)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const collect = jest.fn(async () => ({ success: true, id: 2 }));
      (globalThis as any).window.api = { holdMoney: { collect } };

      const apiMod = await import("../backendApi");
      const payload = {
        id: 5,
        usd_amount: 20,
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      };
      const result = await apiMod.holdMoneyCollect(payload as any);

      expect(collect).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ success: true, id: 2 });
    });

    it("holdMoneyCollect — Web mode POSTs /api/hold-money/:id/collect with the body", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (url: string, init?: any) => {
        expect(url).toContain("/api/hold-money/5/collect");
        expect(JSON.parse(init.body).usd_amount).toBe(20);
        return okJson({ success: true, id: 2 });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.holdMoneyCollect({
        id: 5,
        usd_amount: 20,
      } as any);

      expect(result).toEqual({ success: true, id: 2 });
    });

    it("holdMoneyVoidPickup — Electron mode routes via window.api.holdMoney.voidPickup", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const voidPickup = jest.fn(async () => ({ success: true, id: 3 }));
      (globalThis as any).window.api = { holdMoney: { voidPickup } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.holdMoneyVoidPickup(9);

      expect(voidPickup).toHaveBeenCalledWith(9);
      expect(result).toEqual({ success: true, id: 3 });
    });

    it("holdMoneyVoidPickup — Web mode POSTs /api/hold-money/pickups/:pickupId/void", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (url: string) => {
        expect(url).toContain("/api/hold-money/pickups/9/void");
        return okJson({ success: true, id: 3 });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.holdMoneyVoidPickup(9);

      expect(result).toEqual({ success: true, id: 3 });
    });

    it("holdMoneyPickups — Web mode GETs /api/hold-money/:id/pickups", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (url: string) => {
        expect(url).toContain("/api/hold-money/5/pickups");
        return okJson({ success: true, data: [] });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.holdMoneyPickups(5);

      expect(result).toEqual({ success: true, data: [] });
    });
  });
});

describe("backendApi.impersonationLogout", () => {
  beforeAll(resetBetweenFiles);

  // This is the exact isolation guarantee the multi-tenant plan (§5) depends
  // on: logging out FROM an impersonation tab must never clobber the super
  // admin's own session in localStorage (shared across every tab of this
  // origin). See CLAUDE.md-style rule for this feature — advisor-flagged bug
  // class, guarded here.
  describe("backendApi.logout() impersonation isolation", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      delete (window as unknown as { api?: unknown }).api;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      jest.clearAllMocks();
    });

    function mockOkFetch() {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      })) as unknown as typeof fetch;
    }

    it("clears only the impersonation session, leaving the super admin's own JWT intact", async () => {
      setToken("super-admins-own-token");
      setImpersonationToken("impersonation-token");
      mockOkFetch();

      await logout();

      expect(localStorage.getItem("liratek.jwt")).toBe(
        "super-admins-own-token",
      );
      expect(getImpersonationToken()).toBeNull();

      // The bearer actually sent was the impersonation token (not the super
      // admin's own) — confirms getToken()'s precedence drove the request.
      const fetchMock = globalThis.fetch as jest.Mock;
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer impersonation-token");
    });

    it("clears the normal JWT when there is no impersonation session active", async () => {
      setToken("normal-login-token");
      mockOkFetch();

      await logout();

      expect(localStorage.getItem("liratek.jwt")).toBeNull();
    });
  });
});

describe("backendApi.lira348TablePaging.dualmode (LIRA-348)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-348 — the Audit & Transactions paging keys reach the server on both
   * transports (rule 19): desktop hands the filters object to IPC unchanged;
   * web puts `day_from` / `day_to` in the query string and JSON-encodes the
   * keyset cursor `before` (a plain `String(obj)` would send
   * "[object Object]"). Audit sends its keys in the POST body.
   * Field names come from the shared schema (rule 24).
   *
   * Written after the adapter change — NOT proven failing-first (rule 17);
   * the failing-first proofs are the route, handler and repository tests.
   */

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  const PAGING = transactionPageFiltersSchema.parse({
    day_from: "2026-10-26",
    day_to: "2026-10-26",
    before: { created_at: "2026-10-26 07:00:01", id: 41 },
  });
  const AUDIT_PAGING = auditPageFiltersSchema.parse({
    dayFrom: "2026-10-26",
    dayTo: "2026-10-26",
    beforeId: 900,
  });

  type Win = { window?: { api?: unknown } };

  describe("backendApi — LIRA-348 paging keys on both transports", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as Win).window = (globalThis as Win).window || {};
    });
    afterEach(() => {
      delete (globalThis as Win).window!.api;
      delete (globalThis as { fetch?: unknown }).fetch;
    });

    it("desktop: the filters object, paging keys included, goes to IPC unchanged", async () => {
      const getRecent = jest.fn(async () => []);
      (globalThis as Win).window!.api = { transactions: { getRecent } };
      const api = await import("../backendApi");
      await api.getRecentTransactions(150, { search: "x", ...PAGING });
      expect(getRecent).toHaveBeenCalledWith(150, { search: "x", ...PAGING });
    });

    it("web: day_from / day_to in the query, the cursor as JSON", async () => {
      delete (globalThis as Win).window!.api;
      const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) =>
        jsonResponse(200, { success: true, transactions: [] }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const api = await import("../backendApi");
      await api.getRecentTransactions(150, PAGING);
      const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
      expect(url.pathname).toBe("/api/transactions/recent");
      expect(url.searchParams.get("day_from")).toBe("2026-10-26");
      expect(url.searchParams.get("day_to")).toBe("2026-10-26");
      expect(JSON.parse(url.searchParams.get("before")!)).toEqual(
        PAGING.before,
      );
      expect(url.search).not.toContain("object");
    });

    it("web: a refused read (HTTP 200, success:false — rule 19c) rejects with the reason instead of reading as an empty table", async () => {
      delete (globalThis as Win).window!.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(200, {
          success: false,
          error: "Date must be in YYYY-MM-DD format",
        }),
      ) as unknown as typeof fetch;
      const api = await import("../backendApi");
      await expect(
        api.getRecentTransactions(150, { day_from: "26/10/2026" }),
      ).rejects.toThrow("Date must be in YYYY-MM-DD format");
    });

    it("web: audit search sends the paging keys in the POST body", async () => {
      delete (globalThis as Win).window!.api;
      const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) =>
        jsonResponse(200, { success: true, rows: [], total: 0 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const api = await import("../backendApi");
      await api.auditSearch({ limit: 50, ...AUDIT_PAGING });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(String(url)).toContain("/api/audit/search");
      expect(JSON.parse(String(init.body))).toMatchObject({
        limit: 50,
        ...AUDIT_PAGING,
      });
    });
  });
});

describe("backendApi.loginSupersedesImpersonation", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Signing in deliberately must SUPERSEDE an impersonation session in this tab.
   *
   * The bug, reproduced live on test.liratek.shop: a tab that had once been used
   * for the super admin's "Connect as admin" handoff still held an impersonation
   * token in sessionStorage — 7.5 hours old by the time it was found. Because
   * `getToken()` prefers sessionStorage over localStorage, that dead token kept
   * winning the lookup after a perfectly good normal login. The login itself
   * returned 200 (it sends no token), the dashboard's first requests raced
   * through, and then everything 401'd. sessionStorage survives a reload, so a
   * hard refresh did not help; only closing the tab did, which is not something
   * anyone would think to try.
   */
  describe("backendApi.login() supersedes an impersonation session", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      delete (window as unknown as { api?: unknown }).api;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      jest.clearAllMocks();
    });

    function mockLoginFetch(token: string) {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            success: true,
            data: { token, user: { id: 7, username: "Admin", role: "admin" } },
          }),
      })) as unknown as typeof fetch;
    }

    it("clears a stale impersonation token so the new login is the one that is sent", async () => {
      setImpersonationToken("stale-impersonation-token-from-hours-ago");
      setImpersonationTenantName("Test");
      mockLoginFetch("fresh-login-token");

      const res = await login("Admin", "Admin@123", false);
      expect(res.success).toBe(true);

      // The whole point: the token the app will actually SEND is the one the
      // user just logged in with, not the corpse that was shadowing it.
      expect(getToken()).toBe("fresh-login-token");
      expect(getImpersonationToken()).toBeNull();
      // The companion stash goes too, or the UI keeps claiming to be
      // impersonating a tenant it no longer has a token for.
      expect(getImpersonationTenantName()).toBeNull();
    });

    it("leaves a failed login alone — nothing is superseded by an attempt that did not work", async () => {
      setImpersonationToken("live-impersonation-token");
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            error: { message: "Invalid username or password" },
          }),
      })) as unknown as typeof fetch;

      const res = await login("Admin", "wrong", false);
      expect(res.success).toBe(false);

      // A typo in the password must not destroy an active impersonation session.
      expect(getImpersonationToken()).toBe("live-impersonation-token");
    });
  });
});

describe("backendApi.lotoCheckpoints.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Dual-mode (IPC vs REST) routing tests for the loto adapter's checkpoint
   * (and related) READ functions in backendApi.ts.
   *
   * THE BUG (found by a live smoke run against the deployed test tenant):
   * every IPC handler in electron-app/handlers/lotoHandlers.ts for these reads
   * returns the full envelope — `{ success, checkpoint }` or
   * `{ success, checkpoints }` etc — and so does every matching REST route in
   * backend/src/api/loto.ts (`res.json({ success: true, checkpoint })`). But
   * the adapter's REST branch used to unwrap the response to the bare payload
   * (`return res.checkpoint ?? null;` / `return res.checkpoints ?? [];`),
   * silently dropping `success`/`error` on the floor. Every caller
   * (CheckpointScheduler.tsx, SettlementVerification.tsx, CheckpointHistory.tsx,
   * Loto/index.tsx's handleCreateCheckpoint) reads `.success` / the named field
   * off the resolved value, so on web:
   *   - lotoCheckpointGetLast with no checkpoint yet resolved bare `null` ->
   *     `lastResult.success` threw `TypeError: Cannot read properties of null`.
   *   - lotoCheckpointGetUnsettled/GetByDateRange resolved a bare array ->
   *     `.success` was `undefined`, so "not successful" branches ran even
   *     though the request worked, or (CheckpointHistory) the list silently
   *     stayed empty forever.
   *
   * THE FIX: each REST branch now returns the full `requestJson<...>(...)`
   * envelope, exactly like every WRITE function in this same file already does
   * (e.g. lotoCheckpointCreate, lotoCheckpointUpdate) — no field-stripping.
   *
   * Rule 17 (regression tests must fail on the pre-fix code) — verified by
   * hand for lotoCheckpointGetLast's "no checkpoint yet" case: temporarily
   * reverted its REST branch back to
   *   `const res = await requestJson(...); return res.checkpoint ?? null;`
   * re-ran this file with
   *   `cd frontend && npx jest --maxWorkers=2 --workerIdleMemoryLimit=1024MB src/api/__tests__/backendApi.lotoCheckpoints.dualmode.test.ts`
   * and watched "does NOT resolve bare null" fail with
   *   "expected {success:true, checkpoint:null}, received null" — then
   * restored the fix and confirmed the suite went green again. Not re-run here
   * on every future execution; recorded so the next person doesn't have to
   * take the guard's word for it.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  // Named distinctly from the identical helper in backendApi.sessions.dualmode.test.ts
  // and backendApi.serviceProviders*.dualmode.test.ts: none of these test files
  // have a top-level import/export, so TypeScript treats each as a global
  // script rather than a module, and a same-named top-level function collides
  // across files as "Duplicate function implementation" under the project's
  // full-program type-check.
  function jsonResponseForLotoCheckpoints(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  describe("backendApi loto checkpoint dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
      jest.clearAllMocks();
    });

    // ── lotoCheckpointGetLast ──────────────────────────────────────────────

    describe("lotoCheckpointGetLast", () => {
      it("in Electron mode: routes via window.api.loto.checkpoint.getLast (no fetch) — unchanged", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const getLast = jest.fn(async () => ({
          success: true,
          checkpoint: { id: 5, period_end: "2026-09-01" },
        }));
        (globalThis as any).window.api = {
          loto: { checkpoint: { getLast } },
        };

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetLast();

        expect(getLast).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
          success: true,
          checkpoint: { id: 5, period_end: "2026-09-01" },
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: resolves the FULL envelope, not the bare checkpoint", async () => {
        delete (globalThis as any).window.api;
        const envelope = {
          success: true,
          checkpoint: { id: 5, period_end: "2026-09-01" },
        };
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetLast();

        expect(result).toEqual(envelope);
        expect((result as any).success).toBe(true);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/loto/checkpoints/last");
      });

      it("in Web mode with NO checkpoint yet: resolves {success:true, checkpoint:null}, NOT bare null — this is exactly what threw in Loto/index.tsx's handleCreateCheckpoint", async () => {
        delete (globalThis as any).window.api;
        const envelope = { success: true, checkpoint: null };
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetLast();

        expect(result).not.toBeNull();
        expect(result).toEqual(envelope);
        expect((result as any).success).toBe(true);
        expect((result as any).checkpoint).toBeNull();
      });
    });

    // ── lotoCheckpointGetUnsettled ─────────────────────────────────────────

    describe("lotoCheckpointGetUnsettled", () => {
      it("in Electron mode: routes via window.api.loto.checkpoint.getUnsettled (no fetch) — unchanged", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const getUnsettled = jest.fn(async () => ({
          success: true,
          checkpoints: [{ id: 1 }, { id: 2 }],
        }));
        (globalThis as any).window.api = {
          loto: { checkpoint: { getUnsettled } },
        };

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetUnsettled();

        expect(getUnsettled).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
          success: true,
          checkpoints: [{ id: 1 }, { id: 2 }],
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: resolves the FULL envelope, not the bare checkpoints array", async () => {
        delete (globalThis as any).window.api;
        const envelope = { success: true, checkpoints: [{ id: 1 }, { id: 2 }] };
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetUnsettled();

        expect(result).toEqual(envelope);
        expect((result as any).success).toBe(true);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/loto/checkpoints/unssettled");
      });

      it("in Web mode with a {success:false,error} response: does not silently become an empty list", async () => {
        delete (globalThis as any).window.api;
        const envelope = { success: false, error: "boom" };
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetUnsettled();

        expect(result).toEqual(envelope);
        expect((result as any).success).toBe(false);
        expect((result as any).checkpoints).toBeUndefined();
      });
    });

    // ── lotoCheckpointGetByDateRange ───────────────────────────────────────

    describe("lotoCheckpointGetByDateRange", () => {
      it("in Electron mode: routes via window.api.loto.checkpoint.getByDateRange (no fetch) — unchanged", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const getByDateRange = jest.fn(async () => ({
          success: true,
          checkpoints: [{ id: 3 }],
        }));
        (globalThis as any).window.api = {
          loto: { checkpoint: { getByDateRange } },
        };

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetByDateRange(
          "2026-08-01",
          "2026-08-31",
        );

        expect(getByDateRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
        expect(result).toEqual({ success: true, checkpoints: [{ id: 3 }] });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: resolves the FULL envelope, not the bare checkpoints array", async () => {
        delete (globalThis as any).window.api;
        const envelope = { success: true, checkpoints: [{ id: 3 }] };
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.lotoCheckpointGetByDateRange(
          "2026-08-01",
          "2026-08-31",
        );

        expect(result).toEqual(envelope);
        expect((result as any).success).toBe(true);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain(
          "/api/loto/checkpoints?from=2026-08-01&to=2026-08-31",
        );
      });
    });

    // ── Regression sweep: every other loto* adapter function fixed alongside
    //    the 3 above, in backendApi.ts's loto block. Same defect class (IPC
    //    twin returns an envelope, REST branch used to strip it to a bare
    //    field) — verified per-function against its IPC handler / REST route
    //    before fixing (see the task report). Each case asserts the resolved
    //    value equals the FULL fetch body, not a stripped field, which is the
    //    one assertion the pre-fix code could not have passed. ──────────────

    const SWEEP_CASES: Array<{
      name: string;
      call: (m: typeof import("../backendApi")) => Promise<unknown>;
      path: string;
      envelope: Record<string, unknown>;
    }> = [
      {
        name: "lotoGet",
        call: (m) => m.lotoGet(9),
        path: "/api/loto/9",
        envelope: { success: true, ticket: { id: 9 } },
      },
      {
        name: "lotoGetByDateRange",
        call: (m) => m.lotoGetByDateRange("2026-01-01", "2026-01-31"),
        path: "/api/loto?from=2026-01-01&to=2026-01-31",
        envelope: { success: true, tickets: [{ id: 1 }] },
      },
      {
        name: "lotoReport",
        call: (m) => m.lotoReport("2026-01-01", "2026-01-31"),
        path: "/api/loto/report?from=2026-01-01&to=2026-01-31",
        envelope: { success: true, reportData: { total_tickets: 4 } },
      },
      {
        name: "lotoSettlement",
        call: (m) => m.lotoSettlement("2026-01-01", "2026-01-31"),
        path: "/api/loto/settlement?from=2026-01-01&to=2026-01-31",
        envelope: { success: true, settlement: { totalSales: 100 } },
      },
      {
        name: "lotoFeesGet",
        call: (m) => m.lotoFeesGet(2026),
        path: "/api/loto/fees?year=2026",
        envelope: { success: true, fees: [{ id: 2 }] },
      },
      {
        name: "lotoSettingsGet",
        call: (m) => m.lotoSettingsGet(),
        path: "/api/loto/settings",
        envelope: { success: true, settings: { commission_rate: "10" } },
      },
      {
        name: "lotoCashPrizeGetByDateRange",
        call: (m) => m.lotoCashPrizeGetByDateRange("2026-01-01", "2026-01-31"),
        path: "/api/loto/cash-prizes?from=2026-01-01&to=2026-01-31",
        envelope: { success: true, prizes: [{ id: 6 }] },
      },
      {
        name: "lotoCashPrizeGetUnreimbursed",
        call: (m) => m.lotoCashPrizeGetUnreimbursed(),
        path: "/api/loto/cash-prizes/unreimbursed",
        envelope: { success: true, prizes: [{ id: 7 }] },
      },
      {
        name: "lotoCashPrizeGetTotalUnreimbursed",
        call: (m) => m.lotoCashPrizeGetTotalUnreimbursed(),
        path: "/api/loto/cash-prizes/total-unreimbursed",
        envelope: { success: true, total: 42 },
      },
      {
        name: "lotoCheckpointGet",
        call: (m) => m.lotoCheckpointGet(11),
        path: "/api/loto/checkpoints/11",
        envelope: { success: true, checkpoint: { id: 11 } },
      },
      {
        name: "lotoCheckpointGetByDate",
        call: (m) => m.lotoCheckpointGetByDate("2026-08-15"),
        path: "/api/loto/checkpoints/date/2026-08-15",
        envelope: { success: true, checkpoint: { id: 12 } },
      },
      {
        name: "lotoCheckpointGetTotalSalesUnsettled",
        call: (m) => m.lotoCheckpointGetTotalSalesUnsettled(),
        path: "/api/loto/checkpoints/total-sales-unssettled",
        envelope: { success: true, totalSales: 555 },
      },
      {
        name: "lotoCheckpointGetTotalCommissionUnsettled",
        call: (m) => m.lotoCheckpointGetTotalCommissionUnsettled(),
        path: "/api/loto/checkpoints/total-commission-unssettled",
        envelope: { success: true, totalCommission: 77 },
      },
      {
        name: "lotoCheckpointCreateScheduled",
        call: (m) => m.lotoCheckpointCreateScheduled("2026-09-13"),
        path: "/api/loto/checkpoints/scheduled?date=2026-09-13",
        envelope: { success: true, checkpoint: { id: 13 } },
      },
    ];

    it.each(SWEEP_CASES)(
      "$name — Web mode resolves the FULL envelope from its static REST path",
      async ({ call, path, envelope }) => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponseForLotoCheckpoints(200, envelope),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await call(apiMod);

        expect(result).toEqual(envelope);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain(path);
      },
    );
  });
});

describe("backendApi.maintenanceUpdateMetadata.dualmode (LIRA-306)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-306 T093 — `updateMaintenanceMetadata()` dual-mode routing (rules
   * 19/21). The IPC channel `maintenance:update-metadata` had no REST twin and
   * no adapter function; both now exist:
   * - Electron (window.api present): window.api.maintenance.updateMetadata,
   *   never fetch.
   * - Web (no window.api): POST /api/maintenance/update-metadata with the SAME
   *   payload object, envelope returned as-is (HTTP 200 even on a refusal).
   *
   * Harness copied from backendApi.deleteDraft.dualmode.test.ts.
   */

  function okJsonMaintenanceMeta(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const PAYLOAD: MaintenanceUpdateMetadataInput = {
    id: 7,
    device_name: "iPhone 13 Pro",
    note: "fixed",
  };

  describe("backendApi.updateMaintenanceMetadata dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.maintenance.updateMetadata (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const updateMetadata = jest.fn(async () => ({ success: true, data: {} }));
      (globalThis as any).window.api = { maintenance: { updateMetadata } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

      expect(updateMetadata).toHaveBeenCalledWith(PAYLOAD);
      expect(result).toEqual({ success: true, data: {} });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs /api/maintenance/update-metadata with the same payload", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonMaintenanceMeta({ success: true, data: { id: 7 } }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

      expect(result).toEqual({ success: true, data: { id: 7 } });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/maintenance/update-metadata");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual(PAYLOAD);
    });

    it("in Web mode: a refusal resolves the envelope, not a thrown error", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonMaintenanceMeta({
          success: false,
          error: "Maintenance job not found",
        }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

      expect(result).toEqual({
        success: false,
        error: "Maintenance job not found",
      });
    });
  });
});

describe("backendApi.partnerSettleDays.dualmode (LIRA-346)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-346 — settle partners by day on both transports (rule 19): the three
   * calendar reads return the RAW rows array, the write returns the envelope;
   * IPC gets the same arguments the REST route gets as path / query / body.
   * Rule 17: written and run before the adapter functions existed.
   */

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  const ROWS = [{ id: 3, shop_day: "2026-10-21" }];
  const PAYLOAD = {
    partnerId: 7,
    selections: [3],
    include_account_credits: true,
    credit_used: { usd: 5 },
    expected_owed: { usd: 95, lbp: 0 },
    per_currency: {
      USD: {
        payer: "PARTNER" as const,
        payments: [{ method: "CASH", currency_code: "USD", amount: 90 }],
      },
    },
  };

  describe("backendApi — partner settle by day (LIRA-346)", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });
    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
    });

    const webReturning = (body: unknown) => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () => jsonResponse(200, body)) as any;
    };
    const call = (i = 0) => (globalThis.fetch as jest.Mock).mock.calls[i];

    it("desktop: every function calls its IPC binding with the same arguments", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("no fetch on desktop");
      }) as any;
      const partners = {
        getSettleOpenRows: jest.fn(async () => ROWS),
        getSettleMonthRows: jest.fn(async () => ROWS),
        getSettleDayDetail: jest.fn(async () => ROWS),
        settleDays: jest.fn(async () => ({ success: true, id: 9 })),
      };
      (globalThis as any).window.api = { partners };
      const api = await import("../backendApi");
      await expect(api.partnersGetSettleOpenRows(7)).resolves.toEqual(ROWS);
      await expect(
        api.partnersGetSettleMonthRows(7, "2026-10"),
      ).resolves.toEqual(ROWS);
      await expect(
        api.partnersGetSettleDayDetail(7, "2026-10-21"),
      ).resolves.toEqual(ROWS);
      await expect(api.partnersSettleDays(PAYLOAD)).resolves.toEqual({
        success: true,
        id: 9,
      });
      expect(partners.getSettleOpenRows).toHaveBeenCalledWith(7);
      expect(partners.getSettleMonthRows).toHaveBeenCalledWith(7, "2026-10");
      expect(partners.getSettleDayDetail).toHaveBeenCalledWith(7, "2026-10-21");
      expect(partners.settleDays).toHaveBeenCalledWith(PAYLOAD);
    });

    it("web: the reads hit their routes and return the rows array", async () => {
      webReturning({ success: true, rows: ROWS });
      const api = await import("../backendApi");
      await expect(api.partnersGetSettleOpenRows(7)).resolves.toEqual(ROWS);
      await expect(
        api.partnersGetSettleMonthRows(7, "2026-10"),
      ).resolves.toEqual(ROWS);
      await expect(
        api.partnersGetSettleDayDetail(7, "2026-10-21"),
      ).resolves.toEqual(ROWS);
      expect(String(call(0)[0])).toContain("/api/partners/7/settle-open-rows");
      expect(String(call(1)[0])).toContain(
        "/api/partners/7/settle-month-rows?month=2026-10",
      );
      expect(String(call(2)[0])).toContain(
        "/api/partners/7/settle-day-detail?day=2026-10-21",
      );
    });

    it("web: the write POSTs the payload unchanged and returns the envelope", async () => {
      webReturning({ success: false, error: "balance changed" });
      const api = await import("../backendApi");
      await expect(api.partnersSettleDays(PAYLOAD)).resolves.toEqual({
        success: false,
        error: "balance changed",
      });
      const [url, init] = call(0);
      expect(String(url)).toContain("/api/partners/settle-days");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual(PAYLOAD);
    });
  });
});

describe("backendApi.passwordReset (LIRA-275)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * The password-reset adapter functions (LIRA-275/276) are WEB ONLY and talk
   * to `/api/password-reset/*`:
   *   - forgot / check / reset are PUBLIC: no Authorization header is sent;
   *   - send/:userId is the admin's call: it carries the session token;
   *   - on desktop every one of them refuses before any request.
   * Bodies are parsed through the core schemas (rule 24).
   */

  // module scope (see backendApi.users.dualmode.test.ts)

  interface Captured {
    url: string;
    init: { method?: string; headers?: Record<string, string>; body?: string };
  }

  function jsonResponseForPasswordReset(body: unknown) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  describe("backendApi password reset (web only)", () => {
    let calls: Captured[];

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
      calls = [];
      globalThis.fetch = jest.fn(async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: init as Captured["init"] });
        return jsonResponseForPasswordReset({ success: true, data: {} });
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
      localStorage.clear();
      sessionStorage.clear();
      jest.clearAllMocks();
    });

    it("public calls POST their route with the schema-shaped body and no token", async () => {
      const api = await import("../backendApi");
      (await import("../httpClient")).setToken("a-session-token");

      const forgot = { email: "boss@shop.com", shop: "cellcity" };
      const check = { token: "tok" };
      const reset = { token: "tok", password: "N3w!Passw0rd" };
      expect(forgotPasswordSchema.parse(forgot)).toEqual(forgot);
      expect(checkResetTokenSchema.parse(check)).toEqual(check);
      expect(resetPasswordSchema.parse(reset)).toEqual(reset);

      await api.forgotPassword(forgot);
      await api.checkResetToken(check);
      await api.resetPassword(reset);

      expect(
        calls.map((c) => [c.url.replace(/^.*(\/api\/)/, "$1"), c.init.method]),
      ).toEqual([
        ["/api/password-reset/forgot", "POST"],
        ["/api/password-reset/check", "POST"],
        ["/api/password-reset/reset", "POST"],
      ]);
      expect(calls.map((c) => JSON.parse(c.init.body ?? "null"))).toEqual([
        forgot,
        check,
        reset,
      ]);
      for (const c of calls) {
        expect(c.init.headers?.Authorization).toBeUndefined();
      }
    });

    it("sendPasswordReset carries the admin's session token", async () => {
      const api = await import("../backendApi");
      (await import("../httpClient")).setToken("a-session-token");
      await api.sendPasswordReset(24);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toMatch(/\/api\/password-reset\/send\/24$/);
      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.init.headers?.Authorization).toBe(
        "Bearer a-session-token",
      );
    });

    it("refuses on desktop before any request", async () => {
      (globalThis as any).window.api = {};
      const api = await import("../backendApi");
      await expect(api.forgotPassword({ email: "a@b.co" })).rejects.toThrow(
        /web mode/,
      );
      await expect(api.checkResetToken({ token: "t" })).rejects.toThrow(
        /web mode/,
      );
      await expect(
        api.resetPassword({ token: "t", password: "N3w!Passw0rd" }),
      ).rejects.toThrow(/web mode/);
      await expect(api.sendPasswordReset(1)).rejects.toThrow(/web mode/);
      expect(calls).toHaveLength(0);
    });
  });
});

describe("backendApi.profitsCommissions.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * getProfitsCommissions dual-mode routing + LC-2 (round-2 review,
   * OWNER_NOTES_2026-09-21.md §6, lane LC).
   *
   * LC-2: `getProfitsCommissions` used to `return res.data` unconditionally.
   * `GET /api/profits/commissions` answers a validation failure with HTTP 200
   * `{success:false, error}` (rule 19c) — including an EMPTY `from`/`to`
   * (`commissionsReportQuerySchema`'s regex rejects `''`, which the other
   * Profits routes' own `|| todayISO()` fallback would have defaulted). The
   * old code turned that into `setCommissionsReport(undefined)`: no error box,
   * no loading state, a silently blank tab — defeating the PA-4.16 error
   * state this SAME lane shipped for every other failure mode.
   *
   * RULE 17 (failing-first proof, this session, `npx jest
   * backendApi.profitsCommissions.dualmode --maxWorkers=1`): the "throws"
   * test below was run against the pre-fix `getProfitsCommissions` (`return
   * res.data;` with no `res.success` check) and FAILED:
   *
   *   "in Web mode: throws when the server answers {success:false}..." ›
   *   expect(received).rejects.toThrow(expected)
   *   Received promise resolved instead of rejected
   *   Resolved to value: undefined
   *
   * `getProfitsCommissions` was then changed to throw on `!res.success`, and
   * the whole file was re-run: 4/4 passing.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonCommissions(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const REPORT = {
    from: "2026-09-01",
    to: "2026-09-30",
    realized_usd: 10,
    realized_lbp: 0,
    revenue_usd: 100,
    revenue_lbp: 0,
    pending_usd: 0,
    pending_lbp: 0,
    total_owed_usd: 0,
    total_owed_lbp: 0,
    awaiting_settlement_count: 0,
    bill_count: 0,
    byProvider: [],
    excludedProviders: [],
  };

  describe("backendApi.getProfitsCommissions dual-mode routing + LC-2", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.profits.commissions(from, to) (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const commissions = jest.fn(async () => REPORT);
      (globalThis as any).window.api = { profits: { commissions } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitsCommissions(
        "2026-09-01",
        "2026-09-30",
      );

      expect(commissions).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
      expect(result).toEqual(REPORT);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/profits/commissions with from/to and returns data on success", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonCommissions({ success: true, data: REPORT }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getProfitsCommissions(
        "2026-09-01",
        "2026-09-30",
      );

      expect(result).toEqual(REPORT);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/profits/commissions");
      expect(String(url)).toContain("from=2026-09-01");
      expect(String(url)).toContain("to=2026-09-30");
    });

    it("in Web mode: throws when the server answers {success:false} (LC-2 — HTTP 200 envelope failure, e.g. an empty from/to the query schema rejects) instead of silently returning undefined", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonCommissions({
          success: false,
          error: "from must be in YYYY-MM-DD format",
        }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(
        apiMod.getProfitsCommissions("", "2026-09-30"),
      ).rejects.toThrow("from must be in YYYY-MM-DD format");
    });

    it("in Web mode: throws a generic message when the server answers {success:false} with no error string", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonCommissions({ success: false }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(
        apiMod.getProfitsCommissions("2026-09-01", "2026-09-30"),
      ).rejects.toThrow();
    });
  });
});

describe("backendApi.refundAddedChange.dualmode (LIRA-342)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-342 — "+ Customer gives change" in the refund window: the claim
   * (`refundAddedChangeSchema`, rule 24 — fixture parsed through the core
   * schema) rides on BOTH transports with the same shape (rule 22):
   * - generic refund: IPC 6th positional arg / REST body `addedChange`;
   * - POS Refund Sale: IPC 6th positional arg / REST body `addedChange`.
   *
   * Rule 17 disclosure: written AFTER the adapter change — NOT proven
   * failing-first.
   */

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as unknown as Response;
  }

  const LEGS = [{ method: "CASH", currencyCode: "USD" as const, amount: 55 }];
  const ADDED = refundAddedChangeSchema.parse({
    added_change_usd: 2.78,
    added_change_lbp: 0,
    customerPayments: [
      { method: "CASH", currencyCode: "LBP", amount: 250_000 },
    ],
  });

  type Win = { api?: unknown };
  const win = (): Win => (globalThis as unknown as { window: Win }).window;

  describe("backendApi — refund added change, dual mode", () => {
    beforeEach(() => {
      jest.resetModules();
      const g = globalThis as unknown as { window?: Win };
      g.window = g.window || {};
    });
    afterEach(() => {
      delete win().api;
      jest.clearAllMocks();
    });

    it("refundTransaction, Electron: addedChange is the 6th positional arg", async () => {
      const refund = jest.fn(async () => ({ success: true, refundId: 1 }));
      win().api = { transactions: { refund } };
      const apiMod = await import("../backendApi");
      await apiMod.refundTransaction(
        9,
        LEGS,
        undefined,
        90_000,
        undefined,
        ADDED,
      );
      expect(refund).toHaveBeenCalledWith(
        9,
        LEGS,
        undefined,
        90_000,
        undefined,
        ADDED,
      );
    });

    it("refundTransaction, web: REST body carries addedChange", async () => {
      delete win().api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 2 }),
      ) as unknown as typeof fetch;
      const apiMod = await import("../backendApi");
      await apiMod.refundTransaction(
        9,
        LEGS,
        undefined,
        90_000,
        undefined,
        ADDED,
      );
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/transactions/9/refund");
      const body = JSON.parse(options.body);
      expect(refundAddedChangeSchema.parse(body.addedChange)).toEqual(ADDED);
      expect(body.refundLegs).toEqual(LEGS);
      expect(body.exchangeRate).toBe(90_000);
    });

    it("refundSale, Electron: addedChange is the 6th positional arg", async () => {
      const refund = jest.fn(async () => ({ success: true, refundId: 3 }));
      win().api = { sales: { refund } };
      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7, LEGS, undefined, 90_000, undefined, ADDED);
      expect(refund).toHaveBeenCalledWith(
        7,
        LEGS,
        undefined,
        90_000,
        undefined,
        ADDED,
      );
    });

    it("refundSale, web: REST body carries addedChange", async () => {
      delete win().api;
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, refundId: 4 }),
      ) as unknown as typeof fetch;
      const apiMod = await import("../backendApi");
      await apiMod.refundSale(7, LEGS, undefined, 90_000, undefined, ADDED);
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/sales/7/refund");
      expect(JSON.parse(options.body)).toEqual({
        refundLegs: LEGS,
        exchangeRate: 90_000,
        addedChange: ADDED,
      });
    });
  });
});

describe("backendApi.refundLegOverride.dualmode (LIRA-231)", () => {
  beforeAll(resetBetweenFiles);

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

  // module scope: keeps helpers like okJson file-local (TS2393)

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
        expect(refund).toHaveBeenCalledWith(
          7,
          REFUND_LEGS,
          undefined,
          undefined,
        );
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
        expect(refund).toHaveBeenCalledWith(
          7,
          REFUND_LEGS,
          unitExtras,
          undefined,
        );
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
        const unitExtras = [
          { unit_id: 9, warranty_override_until: "2027-01-01" },
        ];

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
        const keptChange = refundKeptChangeSchema.parse({
          kept_change_usd: 0.12,
        });

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
        const keptChange = refundKeptChangeSchema.parse({
          kept_change_usd: 0.12,
        });

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
        const unitExtras = [
          { unit_id: 9, warranty_override_until: "2027-01-01" },
        ];

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
        expect(result).toEqual({
          success: true,
          legs: [],
          sessionLinked: false,
        });
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

        expect(result).toEqual({
          success: true,
          legs: [],
          sessionLinked: true,
        });
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
});

describe("backendApi.salesByDateRange.dualmode (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 SF-2 (T025) — `getSalesByDateRange` routes IPC on desktop and
   * REST on the web, returning the SAME raw row array either way (rule 19).
   */

  function jsonResponseForRange(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  const ROWS = [{ id: 3, item_count: 2 }];

  describe("backendApi.getSalesByDateRange dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });
    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
    });

    it("desktop: window.api.sales.getByDateRange(from, to), no fetch", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("no fetch on desktop");
      }) as any;
      const getByDateRange = jest.fn(async () => ROWS);
      (globalThis as any).window.api = { sales: { getByDateRange } };
      const apiMod = await import("../backendApi");
      await expect(
        apiMod.getSalesByDateRange({ from: "2026-10-01", to: "2026-10-10" }),
      ).resolves.toEqual(ROWS);
      expect(getByDateRange).toHaveBeenCalledWith("2026-10-01", "2026-10-10");
    });

    it("web: GET /api/sales/by-date-range?from&to, unwrapped to the raw rows", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponseForRange(200, { success: true, data: ROWS }),
      ) as any;
      const apiMod = await import("../backendApi");
      await expect(
        apiMod.getSalesByDateRange({ from: "2026-10-01", to: "2026-10-10" }),
      ).resolves.toEqual(ROWS);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(
        "/api/sales/by-date-range?from=2026-10-01&to=2026-10-10",
      );
    });

    it("web: a refusal throws its message", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponseForRange(200, { success: false, error: "bad range" }),
      ) as any;
      const apiMod = await import("../backendApi");
      await expect(
        apiMod.getSalesByDateRange({ from: "2026-10-10", to: "2026-10-01" }),
      ).rejects.toThrow("bad range");
    });
  });
});

describe("backendApi.serviceProviders.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a — dual-mode
   * (IPC vs REST) routing test for `getActiveServiceProviders`, alongside
   * backendApi.dualmode.test.ts (same invariant, scoped to the new fn):
   * - In Electron (window.api present): routes via window.api, never fetch.
   * - In Web (no window.api): calls fetch and unwraps the REST envelope's
   *   `providers` array to the same raw shape the IPC handler returns.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  // Named distinctly from backendApi.dualmode.test.ts's own `okJson` helper —
  // this file has no top-level import/export, so TS treats it as a global
  // script; two same-named top-level `function`s across such files collide
  // ("Duplicate function implementation") even though each file's tests run
  // in isolated Jest module registries.
  function okJsonServiceProviders(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const PROVIDERS = [
    {
      id: 1,
      code: "OMT",
      label: "OMT",
      drawer_name: "OMT_System",
      is_system_provider: 1,
      sort_order: 0,
      is_active: 1,
      is_system: 1,
      created_at: "2026-08-01T00:00:00Z",
    },
    {
      id: 2,
      code: "WHISH",
      label: "Whish",
      drawer_name: "Whish_System",
      is_system_provider: 1,
      sort_order: 1,
      is_active: 1,
      is_system: 1,
      created_at: "2026-08-01T00:00:00Z",
    },
  ];

  describe("backendApi.getActiveServiceProviders dual-mode routing", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    it("in Electron mode: routes via window.api.serviceProviders.listActive (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;

      const listActive = jest.fn(async () => PROVIDERS);
      (globalThis as any).window.api = {
        serviceProviders: { listActive },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getActiveServiceProviders();

      expect(listActive).toHaveBeenCalledTimes(1);
      expect(result).toEqual(PROVIDERS);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/service-providers/active and unwraps `providers` to the raw array", async () => {
      delete (globalThis as any).window.api;

      globalThis.fetch = jest.fn(async () =>
        okJsonServiceProviders({ success: true, providers: PROVIDERS }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getActiveServiceProviders();

      expect(result).toEqual(PROVIDERS);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/service-providers/active");
    });
  });
});

describe("backendApi.serviceProviders.write.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 5 — dual-mode (IPC vs
   * REST) routing tests for the service-provider WRITE path (getServiceProviders/
   * createServiceProvider/updateServiceProvider/deleteServiceProvider),
   * alongside backendApi.serviceProviders.dualmode.test.ts (same invariant,
   * scoped to phase 4a's read-only `getActiveServiceProviders`):
   * - In Electron (window.api present): routes via window.api.serviceProviders.*,
   *   never fetch.
   * - In Web (no window.api): calls fetch against the matching REST route and
   *   unwraps the envelope to the same raw shape the IPC handler returns.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJsonServiceProvidersWrite(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const WRITE_PATH_PROVIDERS = [
    {
      id: 1,
      code: "OMT",
      label: "OMT",
      drawer_name: "OMT_System",
      is_system_provider: 1,
      sort_order: 0,
      is_active: 1,
      is_system: 1,
      created_at: "2026-08-01T00:00:00Z",
    },
    {
      id: 10,
      code: "SYRIA",
      label: "Syria",
      drawer_name: "General",
      is_system_provider: 0,
      sort_order: 9,
      is_active: 1,
      is_system: 0,
      created_at: "2026-08-10T00:00:00Z",
    },
  ];

  describe("backendApi service-provider WRITE path dual-mode routing (§5b phase 5)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      globalThis.fetch = originalFetch as any;
      jest.clearAllMocks();
    });

    describe("getServiceProviders", () => {
      it("in Electron mode: routes via window.api.serviceProviders.list (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const list = jest.fn(async () => WRITE_PATH_PROVIDERS);
        (globalThis as any).window.api = { serviceProviders: { list } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.getServiceProviders();

        expect(list).toHaveBeenCalledTimes(1);
        expect(result).toEqual(WRITE_PATH_PROVIDERS);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: fetches GET /api/service-providers and unwraps `providers` to the raw array", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          okJsonServiceProvidersWrite({
            success: true,
            providers: WRITE_PATH_PROVIDERS,
          }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.getServiceProviders();

        expect(result).toEqual(WRITE_PATH_PROVIDERS);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/service-providers");
        expect(String(url)).not.toContain("/active");
      });
    });

    describe("createServiceProvider", () => {
      it("in Electron mode: routes via window.api.serviceProviders.create (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const create = jest.fn(async () => ({ success: true, id: 42 }));
        (globalThis as any).window.api = { serviceProviders: { create } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.createServiceProvider({
          code: "SYRIA",
          label: "Syria",
        });

        expect(create).toHaveBeenCalledWith({ code: "SYRIA", label: "Syria" });
        expect(result).toEqual({ success: true, id: 42 });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: POSTs /api/service-providers with the exact payload and returns the envelope as-is", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          okJsonServiceProvidersWrite({ success: true, id: 42 }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.createServiceProvider({
          code: "SYRIA",
          label: "Syria",
        });

        expect(result).toEqual({ success: true, id: 42 });
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/service-providers");
        expect(options.method).toBe("POST");
        expect(JSON.parse(options.body)).toEqual({
          code: "SYRIA",
          label: "Syria",
        });
      });
    });

    describe("updateServiceProvider", () => {
      it("in Electron mode: routes via window.api.serviceProviders.update (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const update = jest.fn(async () => ({ success: true }));
        (globalThis as any).window.api = { serviceProviders: { update } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.updateServiceProvider(7, {
          label: "Syria Remit",
          is_active: 0,
        });

        expect(update).toHaveBeenCalledWith(7, {
          label: "Syria Remit",
          is_active: 0,
        });
        expect(result).toEqual({ success: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: PUTs /api/service-providers/:id with the exact payload", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          okJsonServiceProvidersWrite({ success: true }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.updateServiceProvider(7, {
          label: "Syria Remit",
        });

        expect(result).toEqual({ success: true });
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/service-providers/7");
        expect(options.method).toBe("PUT");
        expect(JSON.parse(options.body)).toEqual({ label: "Syria Remit" });
      });
    });

    describe("deleteServiceProvider", () => {
      it("in Electron mode: routes via window.api.serviceProviders.delete (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const del = jest.fn(async () => ({ success: true }));
        (globalThis as any).window.api = { serviceProviders: { delete: del } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.deleteServiceProvider(7);

        expect(del).toHaveBeenCalledWith(7);
        expect(result).toEqual({ success: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: DELETEs /api/service-providers/:id", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          okJsonServiceProvidersWrite({ success: true }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.deleteServiceProvider(7);

        expect(result).toEqual({ success: true });
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/service-providers/7");
        expect(options.method).toBe("DELETE");
      });
    });
  });
});

describe("backendApi.sessionBasketReversal.dualmode (LIRA-201)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (owner process rule for this
   * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): `voidSessionBasket`
   * / `refundSessionBasket` are brand new backendApi.ts functions, so this
   * whole file fails against pre-fix backendApi.ts by construction (rule 17).
   * Mirrors backendApi.holdMoney.dualmode.test.ts's structure.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  describe("backendApi voidSessionBasket / refundSessionBasket dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("voidSessionBasket — Electron mode routes via window.api.transactions.voidSessionBasket with no fetch", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const voidSessionBasket = jest.fn(async () => ({
        success: true,
        sessionId: 7,
        itemCount: 2,
        reversedTransactionIds: [10, 11],
        reversalIds: [20, 21],
      }));
      (globalThis as any).window.api = {
        transactions: { voidSessionBasket },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.voidSessionBasket(7);

      expect(voidSessionBasket).toHaveBeenCalledWith(7);
      expect(result).toEqual({
        success: true,
        sessionId: 7,
        itemCount: 2,
        reversedTransactionIds: [10, 11],
        reversalIds: [20, 21],
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("voidSessionBasket — Web mode POSTs /api/transactions/session-basket/:sessionId/void with no body needed", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (url: string, init?: any) => {
        expect(url).toContain("/api/transactions/session-basket/7/void");
        expect(init.method).toBe("POST");
        return okJson({
          success: true,
          sessionId: 7,
          itemCount: 2,
          reversedTransactionIds: [10, 11],
          reversalIds: [20, 21],
        });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.voidSessionBasket(7);

      expect(result).toEqual({
        success: true,
        sessionId: 7,
        itemCount: 2,
        reversedTransactionIds: [10, 11],
        reversalIds: [20, 21],
      });
    });

    it("refundSessionBasket — Electron mode routes via window.api.transactions.refundSessionBasket with no fetch", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const refundSessionBasket = jest.fn(async () => ({
        success: true,
        sessionId: 8,
        itemCount: 1,
        reversedTransactionIds: [30],
        reversalIds: [31],
      }));
      (globalThis as any).window.api = {
        transactions: { refundSessionBasket },
      };

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSessionBasket(8);

      expect(refundSessionBasket).toHaveBeenCalledWith(8);
      expect(result).toEqual({
        success: true,
        sessionId: 8,
        itemCount: 1,
        reversedTransactionIds: [30],
        reversalIds: [31],
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("refundSessionBasket — Web mode POSTs /api/transactions/session-basket/:sessionId/refund", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async (url: string, init?: any) => {
        expect(url).toContain("/api/transactions/session-basket/8/refund");
        expect(init.method).toBe("POST");
        return okJson({
          success: true,
          sessionId: 8,
          itemCount: 1,
          reversedTransactionIds: [30],
          reversalIds: [31],
        });
      }) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.refundSessionBasket(8);

      expect(result).toEqual({
        success: true,
        sessionId: 8,
        itemCount: 1,
        reversedTransactionIds: [30],
        reversalIds: [31],
      });
    });
  });
});

describe("backendApi.sessionItemRefund.dualmode (LIRA-232)", () => {
  beforeAll(resetBetweenFiles);

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

  // module scope: keeps helpers like okJson file-local (TS2393)

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
        const result =
          await apiMod.getSessionItemRefundPreview(PREVIEW_PAYLOAD);

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
        const result =
          await apiMod.getSessionItemRefundPreview(PREVIEW_PAYLOAD);

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
        expect(String(url)).toContain(
          `saleItemId=${PREVIEW_PAYLOAD.saleItemId}`,
        );
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
});

describe("backendApi.sessions.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Dual-mode (IPC vs REST) routing tests for the "Signed-in Devices" session
   * functions — listUserSessions/revokeSession/revokeOtherSessions — alongside
   * backendApi.dualmode.test.ts and backendApi.serviceProviders*.dualmode.test.ts
   * (same invariant, different module):
   * - In Electron (window.api present): routes via window.api.auth.*, never fetch.
   * - In Web (no window.api): calls fetch against the matching REST route.
   *
   * Also guards FIX 3: revokeSession/revokeOtherSessions's web-mode branch used
   * to call `requestJson` with no try/catch, so any non-2xx (a 401/403 ahead of
   * the route, or an unhandled 500) escaped as a THROWN plain
   * `{status,message,details}` object instead of the `{success:false,error}`
   * envelope the write contract promises (rule 19) — SignedInDevices.tsx's
   * primary `if (!res.success)` branch never ran, and its catch fallback used
   * `e instanceof Error` on a non-Error throw, discarding the real reason (the
   * exact failure `apiError.ts`'s `messageFrom` doc comment records). Proven
   * failing-first below (rule 17): reverting the `try/catch` in backendApi.ts
   * around each `requestJson` call makes the corresponding
   * "does not throw" test reject instead of resolving.
   *
   * `listUserSessions` is a READ and, like `getDatabaseResetPreview`, is
   * documented to THROW on failure rather than return an envelope (its own
   * doc comment in backendApi.ts) — SignedInDevices.tsx's `load()` already
   * wraps it in try/catch for exactly that reason. So its third case below
   * asserts the opposite of the two writes': the rejection propagates as a
   * throw, not an envelope. That is the correct, unchanged contract, not a
   * gap — only the two writes were missing the try/catch.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  describe("backendApi session functions dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
      jest.clearAllMocks();
    });

    describe("listUserSessions", () => {
      const SESSIONS = [
        {
          id: 1,
          device_type: "electron",
          device_info: "Desktop",
          ip_address: "127.0.0.1",
          created_at: "2026-09-01T00:00:00Z",
          last_activity_at: "2026-09-01T00:00:00Z",
          is_current: true,
        },
      ];

      it("in Electron mode: routes via window.api.auth.listSessions (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const listSessions = jest.fn(async () => ({
          success: true,
          data: SESSIONS,
        }));
        (globalThis as any).window.api = { auth: { listSessions } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.listUserSessions();

        expect(listSessions).toHaveBeenCalledTimes(1);
        expect(result).toEqual(SESSIONS);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: fetches GET /api/auth/sessions and unwraps to the raw array", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(200, { success: true, data: SESSIONS }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.listUserSessions();

        expect(result).toEqual(SESSIONS);
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/auth/sessions");
        expect(options?.method ?? "GET").toBe("GET");
      });

      it("in Web mode: a rejecting requestJson propagates as a THROW (read contract, unchanged)", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(500, { error: "boom" }),
        ) as any;

        const apiMod = await import("../backendApi");

        await expect(apiMod.listUserSessions()).rejects.toBeTruthy();
      });
    });

    describe("revokeSession", () => {
      it("in Electron mode: routes via window.api.auth.revokeSession (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const revokeSession = jest.fn(async () => ({ success: true }));
        (globalThis as any).window.api = { auth: { revokeSession } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.revokeSession(7);

        expect(revokeSession).toHaveBeenCalledWith(7);
        expect(result).toEqual({ success: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: DELETEs /api/auth/sessions/:id and returns the envelope as-is on success", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(200, { success: true }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.revokeSession(7);

        expect(result).toEqual({ success: true });
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/auth/sessions/7");
        expect(options.method).toBe("DELETE");
      });

      it("in Web mode: a rejecting requestJson (403) resolves to {success:false,error} instead of throwing — FIX 3", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(403, { error: "Not your session" }),
        ) as any;

        const apiMod = await import("../backendApi");

        let thrown = false;
        let result: { success: boolean; error?: string } | undefined;
        try {
          result = await apiMod.revokeSession(7);
        } catch {
          thrown = true;
        }

        expect(thrown).toBe(false);
        expect(result).toEqual({ success: false, error: "Not your session" });
      });

      it("in Web mode: an unhandled 500 with no JSON error field still resolves to an envelope, not a throw", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () => jsonResponse(500, {})) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.revokeSession(7);

        expect(result.success).toBe(false);
        expect(typeof result.error).toBe("string");
        expect(result.error).toBeTruthy();
      });
    });

    describe("revokeOtherSessions", () => {
      it("in Electron mode: routes via window.api.auth.revokeOtherSessions (no fetch)", async () => {
        globalThis.fetch = jest.fn(async () => {
          throw new Error("fetch should not be called in Electron mode");
        }) as any;
        const revokeOtherSessions = jest.fn(async () => ({
          success: true,
          data: { revoked: 3 },
        }));
        (globalThis as any).window.api = { auth: { revokeOtherSessions } };

        const apiMod = await import("../backendApi");
        const result = await apiMod.revokeOtherSessions();

        expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, data: { revoked: 3 } });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("in Web mode: POSTs /api/auth/sessions/revoke-others and returns the envelope as-is on success", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(200, { success: true, data: { revoked: 3 } }),
        ) as any;

        const apiMod = await import("../backendApi");
        const result = await apiMod.revokeOtherSessions();

        expect(result).toEqual({ success: true, data: { revoked: 3 } });
        const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toContain("/api/auth/sessions/revoke-others");
        expect(options.method).toBe("POST");
      });

      it("in Web mode: a rejecting requestJson (401) resolves to {success:false,error} instead of throwing — FIX 3", async () => {
        delete (globalThis as any).window.api;
        globalThis.fetch = jest.fn(async () =>
          jsonResponse(401, { error: "Unauthenticated" }),
        ) as any;

        const apiMod = await import("../backendApi");

        let thrown = false;
        let result:
          | { success: boolean; data?: { revoked: number }; error?: string }
          | undefined;
        try {
          result = await apiMod.revokeOtherSessions();
        } catch {
          thrown = true;
        }

        expect(thrown).toBe(false);
        expect(result).toEqual({ success: false, error: "Unauthenticated" });
      });
    });
  });
});

describe("backendApi.signupInvitationsSource (LIRA-278)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-278: the admin Invitations list's Source filter reaches the server as
   * `?source=` — named from the core query schema (rule 24), and absent for
   * "all" so the server returns every source.
   */

  describe("adminListSignupInvitations(source)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      delete (window as unknown as { api?: unknown }).api;
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            data: { emailConfigured: true, invitations: [] },
          }),
      })) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function requestedQuery(): Record<string, string> {
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
      return Object.fromEntries(new URL(url, "http://x").searchParams);
    }

    it("a source filter is sent as the schema's query, and the schema accepts it", async () => {
      const query: ListSignupInvitationsQuery = { source: "self" };
      await adminListSignupInvitations(query.source);
      expect(requestedQuery()).toEqual(query);
      expect(listSignupInvitationsQuerySchema.parse(requestedQuery())).toEqual(
        query,
      );
    });

    it("no filter: no query string at all", async () => {
      await adminListSignupInvitations();
      expect(requestedQuery()).toEqual({});
    });
  });
});

describe("backendApi.supplierTxnsDayRange.dualmode (LIRA-343)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-343 T033a (FR-016c) — the supplier Transactions reads carry the
   * optional shop-day range on both transports (rule 19): IPC gets it as the
   * last argument, REST as `?from=&to=`. An empty bound (the cleared date
   * field) is not sent; no range → the request is exactly as before.
   */

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  const ROWS = [{ id: 3 }];
  const RANGE = { from: "2026-10-25", to: "2026-10-25" };

  describe("backendApi supplier Transactions reads — day range (LIRA-343 T033a)", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });
    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
    });

    const noFetch = () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("no fetch on desktop");
      }) as any;
    };
    const webReturning = (body: unknown) => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () => jsonResponse(200, body)) as any;
    };
    const fetchedUrl = () =>
      String((globalThis.fetch as jest.Mock).mock.calls[0][0]);

    it("desktop: the range is the last IPC argument of all three reads", async () => {
      noFetch();
      const suppliers = {
        getAllTransactions: jest.fn(async () => ROWS),
        getAccountTransactions: jest.fn(async () => ROWS),
        getAccountLedger: jest.fn(async () => ROWS),
      };
      (globalThis as any).window.api = { suppliers };
      const api = await import("../backendApi");
      await expect(
        api.getAllSupplierTransactions("OMT", undefined, RANGE),
      ).resolves.toEqual(ROWS);
      await expect(
        api.getSupplierAccountTransactions(3, 50, RANGE),
      ).resolves.toEqual(ROWS);
      await expect(
        api.getSupplierAccountLedger(3, undefined, RANGE),
      ).resolves.toEqual(ROWS);
      expect(suppliers.getAllTransactions).toHaveBeenCalledWith(
        "OMT",
        undefined,
        RANGE,
      );
      expect(suppliers.getAccountTransactions).toHaveBeenCalledWith(
        3,
        50,
        RANGE,
      );
      expect(suppliers.getAccountLedger).toHaveBeenCalledWith(
        3,
        undefined,
        RANGE,
      );
    });

    it("web: all-transactions sends ?from&to", async () => {
      webReturning({ success: true, transactions: ROWS });
      const api = await import("../backendApi");
      await expect(
        api.getAllSupplierTransactions("OMT", undefined, RANGE),
      ).resolves.toEqual(ROWS);
      expect(fetchedUrl()).toContain(
        "/api/suppliers/all-transactions?provider=OMT&from=2026-10-25&to=2026-10-25",
      );
    });

    it("web: account-transactions hits the account route with the range", async () => {
      webReturning({ success: true, transactions: ROWS });
      const api = await import("../backendApi");
      await expect(
        api.getSupplierAccountTransactions(3, undefined, RANGE),
      ).resolves.toEqual(ROWS);
      expect(fetchedUrl()).toContain(
        "/api/suppliers/3/account-transactions?from=2026-10-25&to=2026-10-25",
      );
    });

    it("web: account-ledger sends the range; an empty bound is not sent", async () => {
      webReturning({ success: true, ledger: ROWS });
      const api = await import("../backendApi");
      await expect(
        api.getSupplierAccountLedger(3, 20, { from: "2026-10-01", to: "" }),
      ).resolves.toEqual(ROWS);
      const url = fetchedUrl();
      expect(url).toContain(
        "/api/suppliers/3/account-ledger?limit=20&from=2026-10-01",
      );
      expect(url).not.toContain("to=");
    });

    it("web: no range → the request is exactly as before", async () => {
      webReturning({ success: true, transactions: ROWS });
      const api = await import("../backendApi");
      await api.getAllSupplierTransactions("OMT");
      expect(fetchedUrl()).toMatch(
        /\/api\/suppliers\/all-transactions\?provider=OMT$/,
      );
    });
  });
});

describe("backendApi.users.dualmode", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Dual-mode (IPC vs REST) routing test for `getNonAdminUsers`, alongside
   * `backendApi.sessions.dualmode.test.ts` (same invariant, different module):
   * - In Electron (window.api present): routes via window.api.auth.*, never fetch.
   * - In Web (no window.api): calls fetch against the matching REST route.
   *
   * Guards the fix for CLAUDE.md rule 19a: `getNonAdminUsers` used to be
   * `if (isElectron()) { return (window as any).api.auth.getNonAdminUsers(); }
   * else { ...fetch... }` — a raw `window.api.*` call plus a hand-rolled
   * transport gate, instead of going through `ipcOrHttp` like every other
   * dual-mode function in this file. That is exactly the pattern rule 19a
   * forbids, even though it happened to work on both transports. Proven
   * failing-first (rule 17) is not applicable in the usual sense here since the
   * old code was not actually broken in behavior — the guard instead pins the
   * OBSERVABLE contract (which branch is taken, and the raw-array unwrap) so a
   * future refactor can't silently reintroduce a raw `window.api` reference or
   * change a read to return the envelope instead of the raw array.
   */

  // module scope: keeps helpers like okJson file-local (TS2393)

  // Named distinctly from the identical helper in backendApi.sessions.dualmode.test.ts
  // and backendApi.lotoCheckpoints.dualmode.test.ts: none of these test files have a
  // top-level import/export, so TypeScript treats each as a global script rather than
  // a module, and a same-named top-level function collides across files as
  // "Duplicate function implementation" under the project's full-program type-check.
  function jsonResponseForUsers(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }

  describe("backendApi.getNonAdminUsers dual-mode routing", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      delete (globalThis as any).fetch;
      jest.clearAllMocks();
    });

    const USERS = [
      { id: 2, username: "cashier1", role: "staff", is_active: 1 },
      { id: 3, username: "cashier2", role: "staff", is_active: 0 },
    ];

    it("in Electron mode: routes via window.api.auth.getNonAdminUsers (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const getNonAdminUsers = jest.fn(async () => USERS);
      (globalThis as any).window.api = { auth: { getNonAdminUsers } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getNonAdminUsers();

      expect(getNonAdminUsers).toHaveBeenCalledTimes(1);
      expect(result).toEqual(USERS);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/users/non-admins and unwraps to the raw array (res.users), not the envelope", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponseForUsers(200, { success: true, users: USERS }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getNonAdminUsers();

      expect(result).toEqual(USERS);
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/users/non-admins");
      expect(options?.method ?? "GET").toBe("GET");
    });

    it("in Web mode: an empty/missing users field resolves to [] rather than throwing", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponseForUsers(200, { success: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getNonAdminUsers();

      expect(result).toEqual([]);
    });
  });
});

describe("backendApi.vouchers.dualmode (LIRA-339)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-339 (T044) — vouchersCancel(id, data?) carries the refund payload on
   * both transports; vouchersCreate carries the tender legs unchanged.
   */

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const cancelData = {
    payments: [
      { method: "CASH" as const, currency_code: "USD" as const, amount: 20 },
    ],
    exchange_rate: 89500,
    client_day: "2026-10-24",
  };

  describe("backendApi vouchers* dual-mode (LIRA-339)", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });
    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("vouchersCancel — Electron passes (id, data) to window.api.vouchers.cancel", async () => {
      globalThis.fetch = jest.fn() as any;
      const cancel = jest.fn(async () => ({ success: true }));
      (globalThis as any).window.api = { vouchers: { cancel } };
      const apiMod = await import("../backendApi");
      await apiMod.vouchersCancel(5, cancelData);
      expect(cancel).toHaveBeenCalledWith(5, cancelData);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("vouchersCancel — Web POSTs the refund payload to /api/vouchers/:id/cancel", async () => {
      delete (globalThis as any).window.api;
      let sent: { url: string; body: unknown } | null = null;
      globalThis.fetch = jest.fn(async (url: string, init?: any) => {
        sent = { url, body: JSON.parse(init.body) };
        return okJson({ success: true });
      }) as any;
      const apiMod = await import("../backendApi");
      await apiMod.vouchersCancel(5, cancelData);
      expect(sent!.url).toContain("/api/vouchers/5/cancel");
      expect(sent!.body).toEqual(cancelData);
    });

    it("vouchersCreate — Web sends the payment legs in the body", async () => {
      delete (globalThis as any).window.api;
      let body: any = null;
      globalThis.fetch = jest.fn(async (_u: string, init?: any) => {
        body = JSON.parse(init.body);
        return okJson({ success: true });
      }) as any;
      const apiMod = await import("../backendApi");
      const payload = {
        clientId: 7,
        amount: 50,
        payments: [
          {
            method: "CUSTOMER_ACCOUNT" as const,
            currency_code: "USD" as const,
            amount: 50,
          },
        ],
        exchange_rate: 89500,
      };
      await apiMod.vouchersCreate(payload);
      expect(body).toEqual(payload);
    });
  });
});

describe("backendApi.warrantySearch.dualmode (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 follow-up (owner decision 2026-10-10) — `searchWarranties` returns
   * the rows AND, when the server sends them, the in-stock units whose serial
   * is the query (`inStockUnits`, beside the envelope's `data`), on BOTH
   * transports (rule 19). Same harness as backendApi.refundLegOverride.dualmode.
   */

  // module scope

  function okJson(data: unknown) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    } as any;
  }

  const IN_STOCK = [{ imei: "350000111122223", productName: "Phone X" }];
  const INPUT = { q: "350000111122223", client_day: "2026-10-10" };

  describe("backendApi.searchWarranties dual-mode", () => {
    beforeEach(() => {
      jest.resetModules();
      (globalThis as any).window = (globalThis as any).window || {};
    });

    afterEach(() => {
      delete (globalThis as any).window.api;
      jest.clearAllMocks();
    });

    it("in Electron mode: returns rows and inStockUnits from the IPC envelope", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const search = jest.fn(async () => ({
        success: true,
        data: [],
        inStockUnits: IN_STOCK,
      }));
      (globalThis as any).window.api = { warranty: { search } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.searchWarranties(INPUT);

      expect(search).toHaveBeenCalledWith(INPUT);
      expect(result).toEqual({ rows: [], inStockUnits: IN_STOCK });
    });

    it("in Web mode: returns rows and inStockUnits from the REST envelope", async () => {
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: [], inStockUnits: IN_STOCK }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.searchWarranties(INPUT);

      const url = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
      expect(url).toContain("/api/warranty/search?");
      expect(url).toContain("q=350000111122223");
      expect(result).toEqual({ rows: [], inStockUnits: IN_STOCK });
    });

    it("leaves inStockUnits out when the server sent none", async () => {
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: [] }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.searchWarranties(INPUT);

      expect(result).toStrictEqual({ rows: [] });
    });
  });
});
