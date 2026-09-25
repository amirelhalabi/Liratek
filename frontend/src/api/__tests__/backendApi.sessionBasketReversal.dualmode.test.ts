/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): `voidSessionBasket`
 * / `refundSessionBasket` are brand new backendApi.ts functions, so this
 * whole file fails against pre-fix backendApi.ts by construction (rule 17).
 * Mirrors backendApi.holdMoney.dualmode.test.ts's structure.
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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
