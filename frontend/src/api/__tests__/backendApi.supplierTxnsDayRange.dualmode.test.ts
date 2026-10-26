/**
 * LIRA-343 T033a (FR-016c) — the supplier Transactions reads carry the
 * optional shop-day range on both transports (rule 19): IPC gets it as the
 * last argument, REST as `?from=&to=`. An empty bound (the cleared date
 * field) is not sent; no range → the request is exactly as before.
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

const ROWS = [{ id: 3 }];
const RANGE = { from: "2026-10-25", to: "2026-10-25" };

describe("backendApi supplier Transactions reads — day range (LIRA-343 T033a)", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });
  afterEach(() => {
    delete (globalThis as any).window.api;
    delete (globalThis as any).fetch;
  });

  const noFetch = () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("no fetch on desktop");
    }) as any;
  };
  const webReturning = (body: unknown) => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () => jsonResponse(200, body)) as any;
  };
  const fetchedUrl = () => String((globalThis.fetch as jest.Mock).mock.calls[0][0]);

  it("desktop: the range is the last IPC argument of all three reads", async () => {
    noFetch();
    const suppliers = {
      getAllTransactions: jest.fn(async () => ROWS),
      getAccountTransactions: jest.fn(async () => ROWS),
      getAccountLedger: jest.fn(async () => ROWS),
    };
    (globalThis as any).window.api = { suppliers };
    const api = await import("../backendApi");
    await expect(api.getAllSupplierTransactions("OMT", undefined, RANGE)).resolves.toEqual(ROWS);
    await expect(api.getSupplierAccountTransactions(3, 50, RANGE)).resolves.toEqual(ROWS);
    await expect(api.getSupplierAccountLedger(3, undefined, RANGE)).resolves.toEqual(ROWS);
    expect(suppliers.getAllTransactions).toHaveBeenCalledWith("OMT", undefined, RANGE);
    expect(suppliers.getAccountTransactions).toHaveBeenCalledWith(3, 50, RANGE);
    expect(suppliers.getAccountLedger).toHaveBeenCalledWith(3, undefined, RANGE);
  });

  it("web: all-transactions sends ?from&to", async () => {
    webReturning({ success: true, transactions: ROWS });
    const api = await import("../backendApi");
    await expect(api.getAllSupplierTransactions("OMT", undefined, RANGE)).resolves.toEqual(ROWS);
    expect(fetchedUrl()).toContain(
      "/api/suppliers/all-transactions?provider=OMT&from=2026-10-25&to=2026-10-25",
    );
  });

  it("web: account-transactions hits the account route with the range", async () => {
    webReturning({ success: true, transactions: ROWS });
    const api = await import("../backendApi");
    await expect(api.getSupplierAccountTransactions(3, undefined, RANGE)).resolves.toEqual(ROWS);
    expect(fetchedUrl()).toContain(
      "/api/suppliers/3/account-transactions?from=2026-10-25&to=2026-10-25",
    );
  });

  it("web: account-ledger sends the range; an empty bound is not sent", async () => {
    webReturning({ success: true, ledger: ROWS });
    const api = await import("../backendApi");
    await expect(
      api.getSupplierAccountLedger(3, 20, { from: "2026-10-01", to: "" }),
    ).resolves.toEqual(ROWS);
    const url = fetchedUrl();
    expect(url).toContain("/api/suppliers/3/account-ledger?limit=20&from=2026-10-01");
    expect(url).not.toContain("to=");
  });

  it("web: no range → the request is exactly as before", async () => {
    webReturning({ success: true, transactions: ROWS });
    const api = await import("../backendApi");
    await api.getAllSupplierTransactions("OMT");
    expect(fetchedUrl()).toMatch(/\/api\/suppliers\/all-transactions\?provider=OMT$/);
  });
});
