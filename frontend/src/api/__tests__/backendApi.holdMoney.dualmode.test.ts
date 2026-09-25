/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183):
 * holdMoneyCollect's signature (bare id -> payload) and holdMoneyVoidPickup
 * are new, so this whole file fails against pre-fix backendApi.ts by
 * construction (rule 17). Mirrors
 * backendApi.getNetProfitLast30Days.dualmode.test.ts's structure.
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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
