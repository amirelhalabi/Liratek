/**
 * LIRA-339 (T044) — vouchersCancel(id, data?) carries the refund payload on
 * both transports; vouchersCreate carries the tender legs unchanged.
 */
export {};

function okJson(data: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(data) } as any;
}

const cancelData = {
  payments: [{ method: "CASH" as const, currency_code: "USD" as const, amount: 20 }],
  exchange_rate: 89500,
  client_day: "2026-10-24",
};

describe("backendApi vouchers* dual-mode (LIRA-339)", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });
  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  it("vouchersCancel — Electron passes (id, data) to window.api.vouchers.cancel", async () => {
    globalThis.fetch = jest.fn() as any;
    const cancel = jest.fn(async () => ({ success: true }));
    (globalThis as any).window.api = { vouchers: { cancel } };
    const apiMod = await import("../backendApi");
    await apiMod.vouchersCancel(5, cancelData);
    expect(cancel).toHaveBeenCalledWith(5, cancelData);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("vouchersCancel — Web POSTs the refund payload to /api/vouchers/:id/cancel", async () => {
    delete (globalThis as any).window.api;
    let sent: { url: string; body: unknown } | null = null;
    globalThis.fetch = jest.fn(async (url: string, init?: any) => {
      sent = { url, body: JSON.parse(init.body) };
      return okJson({ success: true });
    }) as any;
    const apiMod = await import("../backendApi");
    await apiMod.vouchersCancel(5, cancelData);
    expect(sent!.url).toContain("/api/vouchers/5/cancel");
    expect(sent!.body).toEqual(cancelData);
  });

  it("vouchersCreate — Web sends the payment legs in the body", async () => {
    delete (globalThis as any).window.api;
    let body: any = null;
    globalThis.fetch = jest.fn(async (_u: string, init?: any) => {
      body = JSON.parse(init.body);
      return okJson({ success: true });
    }) as any;
    const apiMod = await import("../backendApi");
    const payload = {
      clientId: 7,
      amount: 50,
      payments: [{ method: "CUSTOMER_ACCOUNT" as const, currency_code: "USD" as const, amount: 50 }],
      exchange_rate: 89500,
    };
    await apiMod.vouchersCreate(payload);
    expect(body).toEqual(payload);
  });
});
