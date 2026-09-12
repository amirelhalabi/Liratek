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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

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
      globalThis.fetch = jest.fn(async () => jsonResponseForLotoCheckpoints(200, envelope)) as any;

      const apiMod = await import("../backendApi");
      const result = await call(apiMod);

      expect(result).toEqual(envelope);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain(path);
    },
  );
});
