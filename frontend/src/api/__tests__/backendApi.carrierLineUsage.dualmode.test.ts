/**
 * LIRA-145 — dual-mode (IPC vs REST) routing test for
 * `recordCarrierLineUsage`, the one carrier-line WRITE that moves money.
 *
 * `backendApi.dualmode.test.ts` is a single monolithic Electron-mode sweep
 * with no carrier-line stubs and no per-function table to extend, so the new
 * function gets its own focused file — the same shape as
 * `backendApi.serviceProviders.write.dualmode.test.ts`:
 * - In Electron (window.api present): routes via
 *   window.api.carrierLines.recordUsage, never fetch.
 * - In Web (no window.api): POSTs the exact payload to the static REST path
 *   /api/carrier-lines/record-usage and returns the envelope untouched.
 *
 * The failure envelope matters as much as the success one: the server
 * answers HTTP 200 with `{ success: false, error }` (IPC parity), and the
 * adapter must hand that straight back rather than throwing — the panel
 * renders `error` to the operator.
 */

function okJsonCarrierLineUsage(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const USAGE_PAYLOAD = {
  carrierLineId: 7,
  newCredits: 62.5,
  expectedCurrentCredits: 100,
  note: "topped up a customer by hand",
};

const USAGE_SUCCESS = {
  success: true,
  data: {
    expenseId: 41,
    transactionId: 903,
    creditsUsed: 37.5,
    newCredits: 62.5,
  },
};

describe("backendApi recordCarrierLineUsage dual-mode routing (LIRA-145)", () => {
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

  it("in Electron mode: routes via window.api.carrierLines.recordUsage with the exact payload (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const recordUsage = jest.fn(async () => USAGE_SUCCESS);
    (globalThis as any).window.api = { carrierLines: { recordUsage } };

    const apiMod = await import("../backendApi");
    const result = await apiMod.recordCarrierLineUsage(USAGE_PAYLOAD);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(USAGE_PAYLOAD);
    expect(result).toEqual(USAGE_SUCCESS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: POSTs the static /api/carrier-lines/record-usage path with the exact payload", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonCarrierLineUsage(USAGE_SUCCESS),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.recordCarrierLineUsage(USAGE_PAYLOAD);

    expect(result).toEqual(USAGE_SUCCESS);
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/carrier-lines/record-usage");
    // Static path — must not be mistaken for the /:id parameterized routes.
    expect(String(url)).not.toMatch(/\/api\/carrier-lines\/\d+/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(USAGE_PAYLOAD);
  });

  it("in Web mode: a rejected usage comes back as the {success:false,error} envelope, not a throw", async () => {
    delete (globalThis as any).window.api;
    const rejection = {
      success: false,
      error:
        "Carrier line #7 balance changed since the form was opened (expected $100, line now holds $80) — reload and try again",
    };
    globalThis.fetch = jest.fn(async () =>
      okJsonCarrierLineUsage(rejection),
    ) as any;

    const apiMod = await import("../backendApi");
    await expect(
      apiMod.recordCarrierLineUsage(USAGE_PAYLOAD),
    ).resolves.toEqual(rejection);
  });

  it("omits the optional fields when the caller omits them", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const recordUsage = jest.fn(async () => USAGE_SUCCESS);
    (globalThis as any).window.api = { carrierLines: { recordUsage } };

    const apiMod = await import("../backendApi");
    await apiMod.recordCarrierLineUsage({
      carrierLineId: 7,
      newCredits: 62.5,
    });

    expect(recordUsage).toHaveBeenCalledWith({
      carrierLineId: 7,
      newCredits: 62.5,
    });
  });
});
