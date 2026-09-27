/**
 * LIRA-236 integration-gap follow-up (2026-09-27 coordinator review) —
 * `getRefundBookedRate` was wired end-to-end on BOTH transports (IPC channel
 * `transactions:get-refund-booked-rate`, REST route
 * `GET /api/transactions/:id/refund-booked-rate`, `ApiAdapter` entry) but
 * `backendApi.ts` never had a function calling either one — the Transactions
 * page instead derived its own rate from `row.exchange_rate` (rule 14). This
 * locks the dual-mode routing contract (rule 19/21) for the new function:
 * - In Electron (window.api present): routes via
 *   window.api.transactions.getRefundBookedRate, never fetch.
 * - In Web (no window.api): GETs the exact REST route
 *   (backend/src/api/transactions.ts) and returns the envelope as-is
 *   (rule 19c: HTTP 200 even on a business-rule failure).
 *
 * Follows the harness in backendApi.deleteDraft.dualmode.test.ts.
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

describe("backendApi.getRefundBookedRate dual-mode routing", () => {
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

  it("in Electron mode: routes via window.api.transactions.getRefundBookedRate(id) (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const getRefundBookedRate = jest.fn(async () => ({
      success: true,
      bookedRate: 91000,
      bookedRateSource: "sale",
    }));
    (globalThis as any).window.api = {
      transactions: { getRefundBookedRate },
    };

    const apiMod = await import("../backendApi");
    const result = await apiMod.getRefundBookedRate(7);

    expect(getRefundBookedRate).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      success: true,
      bookedRate: 91000,
      bookedRateSource: "sale",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: GETs /api/transactions/:id/refund-booked-rate and returns the envelope as-is", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, bookedRate: 89000, bookedRateSource: "fallback" }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getRefundBookedRate(7);

    expect(result).toEqual({
      success: true,
      bookedRate: 89000,
      bookedRateSource: "fallback",
    });
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/transactions/7/refund-booked-rate");
    expect(options?.method ?? "GET").toBe("GET");
  });

  it("in Web mode: a business-rule failure still resolves the envelope, not a thrown error", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: false, error: "Transaction not found" }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getRefundBookedRate(999);

    expect(result).toEqual({
      success: false,
      error: "Transaction not found",
    });
  });
});
