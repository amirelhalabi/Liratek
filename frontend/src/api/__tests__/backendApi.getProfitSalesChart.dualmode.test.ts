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

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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
