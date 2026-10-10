/**
 * LIRA-296 follow-up (owner decision 2026-10-10) — `searchWarranties` returns
 * the rows AND, when the server sends them, the in-stock units whose serial
 * is the query (`inStockUnits`, beside the envelope's `data`), on BOTH
 * transports (rule 19). Same harness as backendApi.refundLegOverride.dualmode.
 */

export {}; // module scope

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
