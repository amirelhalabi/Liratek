/**
 * getNetProfitLast30Days dual-mode routing — DC-11 (OWNER_NOTES_2026-09-21.md
 * §7.2). Mirrors `backendApi.getProfitSalesChart.dualmode.test.ts`'s own
 * structure (same rule-27 default-clientDay pattern, same DC-7-style
 * envelope-parity requirement on the web branch).
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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
