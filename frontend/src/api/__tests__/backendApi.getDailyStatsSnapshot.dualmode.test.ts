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

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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

    globalThis.fetch = jest.fn(async () => okJsonSnapshot({ success: false })) as any;

    const apiMod = await import("../backendApi");

    await expect(apiMod.getDailyStatsSnapshot()).rejects.toThrow();
  });
});
