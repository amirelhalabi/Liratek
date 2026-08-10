/**
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 5 — dual-mode (IPC vs
 * REST) routing tests for the service-provider WRITE path (getServiceProviders/
 * createServiceProvider/updateServiceProvider/deleteServiceProvider),
 * alongside backendApi.serviceProviders.dualmode.test.ts (same invariant,
 * scoped to phase 4a's read-only `getActiveServiceProviders`):
 * - In Electron (window.api present): routes via window.api.serviceProviders.*,
 *   never fetch.
 * - In Web (no window.api): calls fetch against the matching REST route and
 *   unwraps the envelope to the same raw shape the IPC handler returns.
 */

function okJsonServiceProvidersWrite(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const WRITE_PATH_PROVIDERS = [
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
    id: 10,
    code: "SYRIA",
    label: "Syria",
    drawer_name: "General",
    is_system_provider: 0,
    sort_order: 9,
    is_active: 1,
    is_system: 0,
    created_at: "2026-08-10T00:00:00Z",
  },
];

describe("backendApi service-provider WRITE path dual-mode routing (§5b phase 5)", () => {
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

  describe("getServiceProviders", () => {
    it("in Electron mode: routes via window.api.serviceProviders.list (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const list = jest.fn(async () => WRITE_PATH_PROVIDERS);
      (globalThis as any).window.api = { serviceProviders: { list } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.getServiceProviders();

      expect(list).toHaveBeenCalledTimes(1);
      expect(result).toEqual(WRITE_PATH_PROVIDERS);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/service-providers and unwraps `providers` to the raw array", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonServiceProvidersWrite({ success: true, providers: WRITE_PATH_PROVIDERS }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.getServiceProviders();

      expect(result).toEqual(WRITE_PATH_PROVIDERS);
      const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/service-providers");
      expect(String(url)).not.toContain("/active");
    });
  });

  describe("createServiceProvider", () => {
    it("in Electron mode: routes via window.api.serviceProviders.create (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const create = jest.fn(async () => ({ success: true, id: 42 }));
      (globalThis as any).window.api = { serviceProviders: { create } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.createServiceProvider({
        code: "SYRIA",
        label: "Syria",
      });

      expect(create).toHaveBeenCalledWith({ code: "SYRIA", label: "Syria" });
      expect(result).toEqual({ success: true, id: 42 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs /api/service-providers with the exact payload and returns the envelope as-is", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonServiceProvidersWrite({ success: true, id: 42 }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.createServiceProvider({
        code: "SYRIA",
        label: "Syria",
      });

      expect(result).toEqual({ success: true, id: 42 });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/service-providers");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        code: "SYRIA",
        label: "Syria",
      });
    });
  });

  describe("updateServiceProvider", () => {
    it("in Electron mode: routes via window.api.serviceProviders.update (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const update = jest.fn(async () => ({ success: true }));
      (globalThis as any).window.api = { serviceProviders: { update } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.updateServiceProvider(7, {
        label: "Syria Remit",
        is_active: 0,
      });

      expect(update).toHaveBeenCalledWith(7, {
        label: "Syria Remit",
        is_active: 0,
      });
      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: PUTs /api/service-providers/:id with the exact payload", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonServiceProvidersWrite({ success: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.updateServiceProvider(7, {
        label: "Syria Remit",
      });

      expect(result).toEqual({ success: true });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/service-providers/7");
      expect(options.method).toBe("PUT");
      expect(JSON.parse(options.body)).toEqual({ label: "Syria Remit" });
    });
  });

  describe("deleteServiceProvider", () => {
    it("in Electron mode: routes via window.api.serviceProviders.delete (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const del = jest.fn(async () => ({ success: true }));
      (globalThis as any).window.api = { serviceProviders: { delete: del } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.deleteServiceProvider(7);

      expect(del).toHaveBeenCalledWith(7);
      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: DELETEs /api/service-providers/:id", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        okJsonServiceProvidersWrite({ success: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.deleteServiceProvider(7);

      expect(result).toEqual({ success: true });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/service-providers/7");
      expect(options.method).toBe("DELETE");
    });
  });
});
