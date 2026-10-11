/**
 * LIRA-306 T093 — `updateMaintenanceMetadata()` dual-mode routing (rules
 * 19/21). The IPC channel `maintenance:update-metadata` had no REST twin and
 * no adapter function; both now exist:
 * - Electron (window.api present): window.api.maintenance.updateMetadata,
 *   never fetch.
 * - Web (no window.api): POST /api/maintenance/update-metadata with the SAME
 *   payload object, envelope returned as-is (HTTP 200 even on a refusal).
 *
 * Harness copied from backendApi.deleteDraft.dualmode.test.ts.
 */
import type { MaintenanceUpdateMetadataInput } from "@liratek/core";

function okJsonMaintenanceMeta(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const PAYLOAD: MaintenanceUpdateMetadataInput = {
  id: 7,
  device_name: "iPhone 13 Pro",
  note: "fixed",
};

describe("backendApi.updateMaintenanceMetadata dual-mode routing", () => {
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

  it("in Electron mode: routes via window.api.maintenance.updateMetadata (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const updateMetadata = jest.fn(async () => ({ success: true, data: {} }));
    (globalThis as any).window.api = { maintenance: { updateMetadata } };

    const apiMod = await import("../backendApi");
    const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

    expect(updateMetadata).toHaveBeenCalledWith(PAYLOAD);
    expect(result).toEqual({ success: true, data: {} });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: POSTs /api/maintenance/update-metadata with the same payload", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonMaintenanceMeta({ success: true, data: { id: 7 } }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

    expect(result).toEqual({ success: true, data: { id: 7 } });
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/maintenance/update-metadata");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(PAYLOAD);
  });

  it("in Web mode: a refusal resolves the envelope, not a thrown error", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonMaintenanceMeta({
        success: false,
        error: "Maintenance job not found",
      }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.updateMaintenanceMetadata(PAYLOAD);

    expect(result).toEqual({
      success: false,
      error: "Maintenance job not found",
    });
  });
});
