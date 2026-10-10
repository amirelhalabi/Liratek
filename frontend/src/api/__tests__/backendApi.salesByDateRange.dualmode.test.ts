/**
 * LIRA-296 SF-2 (T025) — `getSalesByDateRange` routes IPC on desktop and
 * REST on the web, returning the SAME raw row array either way (rule 19).
 */
export {};

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
