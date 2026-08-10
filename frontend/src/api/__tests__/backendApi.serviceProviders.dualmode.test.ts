/**
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a — dual-mode
 * (IPC vs REST) routing test for `getActiveServiceProviders`, alongside
 * backendApi.dualmode.test.ts (same invariant, scoped to the new fn):
 * - In Electron (window.api present): routes via window.api, never fetch.
 * - In Web (no window.api): calls fetch and unwraps the REST envelope's
 *   `providers` array to the same raw shape the IPC handler returns.
 */

// Named distinctly from backendApi.dualmode.test.ts's own `okJson` helper —
// this file has no top-level import/export, so TS treats it as a global
// script; two same-named top-level `function`s across such files collide
// ("Duplicate function implementation") even though each file's tests run
// in isolated Jest module registries.
function okJsonServiceProviders(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const PROVIDERS = [
  {
    id: 1,
    code: "OMT",
    label: "OMT",
    drawer_name: "OMT_System",
    is_system_provider: 1,
    sort_order: 0,
    is_active: 1,
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: 2,
    code: "WHISH",
    label: "Whish",
    drawer_name: "Whish_System",
    is_system_provider: 1,
    sort_order: 1,
    is_active: 1,
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
  },
];

describe("backendApi.getActiveServiceProviders dual-mode routing", () => {
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

  it("in Electron mode: routes via window.api.serviceProviders.listActive (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;

    const listActive = jest.fn(async () => PROVIDERS);
    (globalThis as any).window.api = {
      serviceProviders: { listActive },
    };

    const apiMod = await import("../backendApi");
    const result = await apiMod.getActiveServiceProviders();

    expect(listActive).toHaveBeenCalledTimes(1);
    expect(result).toEqual(PROVIDERS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: fetches GET /api/service-providers/active and unwraps `providers` to the raw array", async () => {
    delete (globalThis as any).window.api;

    globalThis.fetch = jest.fn(async () =>
      okJsonServiceProviders({ success: true, providers: PROVIDERS }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getActiveServiceProviders();

    expect(result).toEqual(PROVIDERS);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/service-providers/active");
  });
});
