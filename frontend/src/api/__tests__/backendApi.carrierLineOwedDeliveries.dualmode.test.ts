/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * getPendingCarrierLineOwedDeliveries / markCarrierLineOwedDeliverySent
 * dual-mode routing (#28, LIRA-218, v184) — closes the m4/both-transports
 * gap the 2026-09-24 adversarial review found: zero dual-mode adapter tests
 * existed for either function. Mirrors
 * `backendApi.getNetProfitLast30Days.dualmode.test.ts`'s own structure.
 */

// A bare `export {}` makes this a module instead of a global script — without
// it, TS merges this file's top-level `okJson` into the SAME global scope as
// every other import-less `*.dualmode.test.ts` file's own `okJson`, which is
// TS2393 "Duplicate function implementation" the moment two such files are
// type-checked in the same run (see the other dualmode specs for the
// no-import convention this one previously, and wrongly, matched).
export {};

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const DELIVERY = {
  id: 7,
  carrier_line_id: 1,
  transaction_id: 55,
  client_id: 3,
  client_name: "Jean",
  days_owed: 210,
  status: "PENDING",
  sent_at: null,
  sent_by: null,
  created_at: "2026-09-24 00:00:00",
  updated_at: "2026-09-24 00:00:00",
};

describe("backendApi.getPendingCarrierLineOwedDeliveries dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  it("in Electron mode: routes via window.api.carrierLines.getOwedDeliveriesPending() (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;

    const getOwedDeliveriesPending = jest
      .fn()
      .mockResolvedValue({ success: true, data: [DELIVERY] });
    (globalThis as any).window.api = {
      carrierLines: { getOwedDeliveriesPending },
    };

    const apiMod = await import("../backendApi");
    const result = await apiMod.getPendingCarrierLineOwedDeliveries();

    expect(getOwedDeliveriesPending).toHaveBeenCalledWith();
    expect(result).toEqual({ success: true, data: [DELIVERY] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: fetches GET /api/carrier-lines/owed-deliveries/pending", async () => {
    delete (globalThis as any).window.api;

    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, data: [DELIVERY] }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getPendingCarrierLineOwedDeliveries();

    expect(result).toEqual({ success: true, data: [DELIVERY] });
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain(
      "/api/carrier-lines/owed-deliveries/pending",
    );
  });
});

describe("backendApi.markCarrierLineOwedDeliverySent dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  it("in Electron mode: routes via window.api.carrierLines.markOwedDeliverySent({deliveryId}) (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;

    const markOwedDeliverySent = jest.fn().mockResolvedValue({
      success: true,
      data: { ...DELIVERY, status: "SENT" },
    });
    (globalThis as any).window.api = {
      carrierLines: { markOwedDeliverySent },
    };

    const apiMod = await import("../backendApi");
    const result = await apiMod.markCarrierLineOwedDeliverySent(7);

    expect(markOwedDeliverySent).toHaveBeenCalledWith({ deliveryId: 7 });
    expect(result).toEqual({
      success: true,
      data: { ...DELIVERY, status: "SENT" },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: POSTs /api/carrier-lines/owed-deliveries/:id/mark-sent with no body needed (id is in the URL)", async () => {
    delete (globalThis as any).window.api;

    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, data: { ...DELIVERY, status: "SENT" } }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.markCarrierLineOwedDeliverySent(7);

    expect(result).toEqual({
      success: true,
      data: { ...DELIVERY, status: "SENT" },
    });
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain(
      "/api/carrier-lines/owed-deliveries/7/mark-sent",
    );
  });

  it("in Web mode: a business rejection ({success:false}) is returned, not thrown — the envelope IS the return value here, not unwrapped like the read-and-throw functions", async () => {
    delete (globalThis as any).window.api;

    globalThis.fetch = jest.fn(async () =>
      okJson({ success: false, error: "Carrier line owed delivery #7 not found" }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.markCarrierLineOwedDeliverySent(7);

    expect(result).toEqual({
      success: false,
      error: "Carrier line owed delivery #7 not found",
    });
  });
});
