/**
 * LIRA-348 — the Audit & Transactions paging keys reach the server on both
 * transports (rule 19): desktop hands the filters object to IPC unchanged;
 * web puts `day_from` / `day_to` in the query string and JSON-encodes the
 * keyset cursor `before` (a plain `String(obj)` would send
 * "[object Object]"). Audit sends its keys in the POST body.
 * Field names come from the shared schema (rule 24).
 *
 * Written after the adapter change — NOT proven failing-first (rule 17);
 * the failing-first proofs are the route, handler and repository tests.
 */
import {
  auditPageFiltersSchema,
  transactionPageFiltersSchema,
} from "@liratek/core";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PAGING = transactionPageFiltersSchema.parse({
  day_from: "2026-10-26",
  day_to: "2026-10-26",
  before: { created_at: "2026-10-26 07:00:01", id: 41 },
});
const AUDIT_PAGING = auditPageFiltersSchema.parse({
  dayFrom: "2026-10-26",
  dayTo: "2026-10-26",
  beforeId: 900,
});

type Win = { window?: { api?: unknown } };

describe("backendApi — LIRA-348 paging keys on both transports", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as Win).window = (globalThis as Win).window || {};
  });
  afterEach(() => {
    delete (globalThis as Win).window!.api;
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("desktop: the filters object, paging keys included, goes to IPC unchanged", async () => {
    const getRecent = jest.fn(async () => []);
    (globalThis as Win).window!.api = { transactions: { getRecent } };
    const api = await import("../backendApi");
    await api.getRecentTransactions(150, { search: "x", ...PAGING });
    expect(getRecent).toHaveBeenCalledWith(150, { search: "x", ...PAGING });
  });

  it("web: day_from / day_to in the query, the cursor as JSON", async () => {
    delete (globalThis as Win).window!.api;
    const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) =>
      jsonResponse(200, { success: true, transactions: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const api = await import("../backendApi");
    await api.getRecentTransactions(150, PAGING);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
    expect(url.pathname).toBe("/api/transactions/recent");
    expect(url.searchParams.get("day_from")).toBe("2026-10-26");
    expect(url.searchParams.get("day_to")).toBe("2026-10-26");
    expect(JSON.parse(url.searchParams.get("before")!)).toEqual(PAGING.before);
    expect(url.search).not.toContain("object");
  });

  it("web: a refused read (HTTP 200, success:false — rule 19c) rejects with the reason instead of reading as an empty table", async () => {
    delete (globalThis as Win).window!.api;
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, {
        success: false,
        error: "Date must be in YYYY-MM-DD format",
      }),
    ) as unknown as typeof fetch;
    const api = await import("../backendApi");
    await expect(
      api.getRecentTransactions(150, { day_from: "26/10/2026" }),
    ).rejects.toThrow("Date must be in YYYY-MM-DD format");
  });

  it("web: audit search sends the paging keys in the POST body", async () => {
    delete (globalThis as Win).window!.api;
    const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) =>
      jsonResponse(200, { success: true, rows: [], total: 0 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const api = await import("../backendApi");
    await api.auditSearch({ limit: 50, ...AUDIT_PAGING });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toContain("/api/audit/search");
    expect(JSON.parse(String(init.body))).toMatchObject({
      limit: 50,
      ...AUDIT_PAGING,
    });
  });
});
