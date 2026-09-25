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

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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

    globalThis.fetch = jest.fn(async () =>
      okJson({ success: false }),
    ) as any;

    const apiMod = await import("../backendApi");

    await expect(
      apiMod.getProfitModuleDetail("SALE", "2026-09-01", "2026-09-30"),
    ).rejects.toThrow();
  });
});
