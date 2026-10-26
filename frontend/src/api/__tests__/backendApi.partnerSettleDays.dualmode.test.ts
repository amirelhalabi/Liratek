/**
 * LIRA-346 — settle partners by day on both transports (rule 19): the three
 * calendar reads return the RAW rows array, the write returns the envelope;
 * IPC gets the same arguments the REST route gets as path / query / body.
 * Rule 17: written and run before the adapter functions existed.
 */
export {};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as any;
}

const ROWS = [{ id: 3, shop_day: "2026-10-21" }];
const PAYLOAD = {
  partnerId: 7,
  selections: [3],
  include_account_credits: true,
  credit_used: { usd: 5 },
  expected_owed: { usd: 95, lbp: 0 },
  per_currency: {
    USD: {
      payer: "PARTNER" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount: 90 }],
    },
  },
};

describe("backendApi — partner settle by day (LIRA-346)", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });
  afterEach(() => {
    delete (globalThis as any).window.api;
    delete (globalThis as any).fetch;
  });

  const webReturning = (body: unknown) => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () => jsonResponse(200, body)) as any;
  };
  const call = (i = 0) => (globalThis.fetch as jest.Mock).mock.calls[i];

  it("desktop: every function calls its IPC binding with the same arguments", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("no fetch on desktop");
    }) as any;
    const partners = {
      getSettleOpenRows: jest.fn(async () => ROWS),
      getSettleMonthRows: jest.fn(async () => ROWS),
      getSettleDayDetail: jest.fn(async () => ROWS),
      settleDays: jest.fn(async () => ({ success: true, id: 9 })),
    };
    (globalThis as any).window.api = { partners };
    const api = await import("../backendApi");
    await expect(api.partnersGetSettleOpenRows(7)).resolves.toEqual(ROWS);
    await expect(api.partnersGetSettleMonthRows(7, "2026-10")).resolves.toEqual(ROWS);
    await expect(api.partnersGetSettleDayDetail(7, "2026-10-21")).resolves.toEqual(ROWS);
    await expect(api.partnersSettleDays(PAYLOAD)).resolves.toEqual({ success: true, id: 9 });
    expect(partners.getSettleOpenRows).toHaveBeenCalledWith(7);
    expect(partners.getSettleMonthRows).toHaveBeenCalledWith(7, "2026-10");
    expect(partners.getSettleDayDetail).toHaveBeenCalledWith(7, "2026-10-21");
    expect(partners.settleDays).toHaveBeenCalledWith(PAYLOAD);
  });

  it("web: the reads hit their routes and return the rows array", async () => {
    webReturning({ success: true, rows: ROWS });
    const api = await import("../backendApi");
    await expect(api.partnersGetSettleOpenRows(7)).resolves.toEqual(ROWS);
    await expect(api.partnersGetSettleMonthRows(7, "2026-10")).resolves.toEqual(ROWS);
    await expect(api.partnersGetSettleDayDetail(7, "2026-10-21")).resolves.toEqual(ROWS);
    expect(String(call(0)[0])).toContain("/api/partners/7/settle-open-rows");
    expect(String(call(1)[0])).toContain("/api/partners/7/settle-month-rows?month=2026-10");
    expect(String(call(2)[0])).toContain("/api/partners/7/settle-day-detail?day=2026-10-21");
  });

  it("web: the write POSTs the payload unchanged and returns the envelope", async () => {
    webReturning({ success: false, error: "balance changed" });
    const api = await import("../backendApi");
    await expect(api.partnersSettleDays(PAYLOAD)).resolves.toEqual({
      success: false,
      error: "balance changed",
    });
    const [url, init] = call(0);
    expect(String(url)).toContain("/api/partners/settle-days");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });
});
