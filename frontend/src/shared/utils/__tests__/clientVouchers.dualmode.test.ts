/**
 * LIRA-258 (G39) — `fetchClientVouchers` must work on BOTH transports.
 *
 * It feeds MultiPaymentInput's gift-card picker on POS, Recharge, Loto,
 * Sessions and Custom Services. It used to call `window.api.vouchers.getAll`
 * directly (rule 19), so in the web app (no `window.api`) it threw / returned
 * nothing and a customer's gift card could never be used as a payment.
 *
 * - Web (no window.api): GETs /api/vouchers?status=pending&clientId=…&day=…
 *   and maps the REST envelope to VoucherOption[].
 * - Desktop (window.api present): routes via window.api.vouchers.getAll with
 *   the same filters, never fetch.
 * Both send the client's own calendar day (rule 27) so a voucher expiring
 * today is classified by the shop's day, not the UTC server's.
 */

export {};

function okJsonClientVouchers(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

const VOUCHERS_ENVELOPE = {
  success: true,
  vouchers: [
    {
      id: 1,
      code: "GC-AAAA",
      amount: 25,
      expiry_date: "2026-12-31",
      status: "pending",
      client_id: 7,
    },
    {
      id: 2,
      code: "GC-BBBB",
      amount: 10,
      expiry_date: null,
      status: "pending",
      client_id: 7,
    },
  ],
};

const EXPECTED_OPTIONS = [
  { code: "GC-AAAA", amount: 25, expiryDate: "2026-12-31" },
  { code: "GC-BBBB", amount: 10, expiryDate: null },
];

describe("fetchClientVouchers dual-mode routing (LIRA-258)", () => {
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

  it("in Web mode (no window.api): returns the client's vouchers from the REST route", async () => {
    delete (globalThis as any).window.api;
    const fetchMock = jest.fn(async () =>
      okJsonClientVouchers(VOUCHERS_ENVELOPE),
    );
    globalThis.fetch = fetchMock as any;

    const mod = await import("../clientVouchers");
    const result = await mod.fetchClientVouchers(7);

    expect(result).toEqual(EXPECTED_OPTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    const parsed = new URL(url, "http://x");
    expect(parsed.pathname).toBe("/api/vouchers");
    expect(parsed.searchParams.get("status")).toBe("pending");
    expect(parsed.searchParams.get("clientId")).toBe("7");
    expect(parsed.searchParams.get("day")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("in Web mode: a failure envelope yields an empty list (no throw)", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonClientVouchers({ success: false, error: "nope" }),
    ) as any;

    const mod = await import("../clientVouchers");
    await expect(mod.fetchClientVouchers(7)).resolves.toEqual([]);
  });

  it("in Desktop mode: routes via window.api.vouchers.getAll (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const getAll = jest.fn(async () => VOUCHERS_ENVELOPE);
    (globalThis as any).window.api = { vouchers: { getAll } };

    const mod = await import("../clientVouchers");
    const result = await mod.fetchClientVouchers(7);

    expect(result).toEqual(EXPECTED_OPTIONS);
    expect(getAll).toHaveBeenCalledTimes(1);
    const [filters, day] = getAll.mock.calls[0] as unknown[];
    expect(filters).toEqual({ status: "pending", clientId: 7 });
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
