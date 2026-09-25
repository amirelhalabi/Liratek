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

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

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
