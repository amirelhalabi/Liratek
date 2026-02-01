// NOTE:
// These tests enforce a key invariant:
// - In Electron (window.api present), backendApi must NOT call fetch.
// - In Web (no window.api), backendApi must NOT call window.api.

describe('backendApi dual-mode routing', () => {
  const originalWindowApi = (globalThis as any).window?.api;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset modules between tests so isElectron() checks re-evaluate.
    jest.resetModules();

    globalThis.fetch = jest.fn(async () => {
      throw new Error('fetch should not be called in this test');
    }) as any;
  });

  afterEach(() => {
    // Restore
    if ((globalThis as any).window) {
      (globalThis as any).window.api = originalWindowApi;
    }
    globalThis.fetch = originalFetch as any;
    jest.clearAllMocks();
  });

  it('routes to window.api in Electron mode (no HTTP) for getNonAdminUsers/getSupplierBalances/getRecentActivity/getExchangeHistory', async () => {
    (globalThis as any).window = (globalThis as any).window || {};

    const getNonAdminUsers = jest.fn(async () => [{ id: 1 }]);
    const getSupplierBalances = jest.fn(async () => [{ supplier_id: 1 }]);
    const getExchangeHistory = jest.fn(async () => [{ id: 1 }]);

    (globalThis as any).window.api = {
      getNonAdminUsers,
      getSupplierBalances,
      getExchangeHistory,
      activity: {
        getRecent: jest.fn(async () => [{ id: 1 }]),
      },
    };

    // Re-import after setting window.api
    const apiMod = await import('../backendApi');

    await expect(apiMod.getNonAdminUsers()).resolves.toEqual([{ id: 1 }]);
    await expect(apiMod.getSupplierBalances()).resolves.toEqual([{ supplier_id: 1 }]);
    await expect(apiMod.getRecentActivity(200)).resolves.toEqual([{ id: 1 }]);
    await expect(apiMod.getExchangeHistory()).resolves.toEqual([{ id: 1 }]);

    expect(getNonAdminUsers).toHaveBeenCalledTimes(1);
    expect(getSupplierBalances).toHaveBeenCalledTimes(1);
    expect(getExchangeHistory).toHaveBeenCalledTimes(1);
    expect((globalThis as any).window.api.activity.getRecent).toHaveBeenCalledWith(200);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes to HTTP in Web mode (no window.api) for getNonAdminUsers', async () => {
    // Ensure no window.api
    (globalThis as any).window = (globalThis as any).window || {};
    delete (globalThis as any).window.api;

    // Mock fetch response
    (globalThis.fetch as any) = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, users: [{ id: 1 }] }),
      } as any;
    });

    const apiMod = await import('../backendApi');

    await expect(apiMod.getNonAdminUsers()).resolves.toEqual([{ id: 1 }]);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
