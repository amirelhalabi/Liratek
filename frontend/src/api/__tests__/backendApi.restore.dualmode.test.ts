/**
 * LIRA-377 web shop restore — adapter dual-mode routing.
 *
 * Written failing-first (rule 17): the five functions did not exist on the
 * first run. Payload keys come from the core schemas (rule 24): each body is
 * asserted equal to the schema's own parse of the same payload.
 * - Desktop: every function answers "Available on the web app", never fetches.
 * - Web: GET /api/restore/points; POST /prepare, /confirm, /cancel with the
 *   JSON payload; POST /file with the raw file (octet-stream), the offset on
 *   the query string, gzipped when the browser can.
 */
import {
  cancelRestoreSchema,
  confirmRestoreSchema,
  prepareRestoreSchema,
  restoreFileQuerySchema,
} from "@liratek/core";

type FetchCall = [string, { method?: string; headers: Record<string, string>; body?: unknown }];

function jsonResponse(json: unknown, status = 200) {
  const text = JSON.stringify(json);
  return {
    ok: status < 400,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    text: async () => text,
    json: async () => json,
  } as unknown as Response;
}

const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
const w = globalThis as unknown as { window: { api?: unknown } };

function lastCall(): FetchCall {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as FetchCall;
}

describe("backendApi shop restore dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    w.window = w.window || {};
  });

  afterEach(() => {
    delete w.window.api;
    globalThis.fetch = originalFetch;
    delete (globalThis as { CompressionStream?: unknown }).CompressionStream;
  });

  it("in Electron mode: every restore call refuses as web-only and never fetches", async () => {
    w.window.api = {};
    const apiMod = await import("../backendApi");
    const refusal = { success: false, error: "Available on the web app" };
    expect(await apiMod.getRestorePoints()).toEqual(refusal);
    expect(
      await apiMod.prepareRestore({ kind: "undo", restoreId: 1, clientTzOffsetMin: 120 }),
    ).toEqual(refusal);
    expect(await apiMod.uploadRestoreFile(new Blob(["x"]), 120)).toEqual(refusal);
    expect(await apiMod.confirmRestore({ restoreId: 1, typedShopName: "A" })).toEqual(refusal);
    expect(await apiMod.cancelRestore({ restoreId: 1 })).toEqual(refusal);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in Web mode: reads the restore points", async () => {
    const data = { earliest: "2026-11-03T12:40:00Z", latest: "2026-11-10T12:39:30Z", beforeCopies: [], lastRestore: null };
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data }));
    const apiMod = await import("../backendApi");
    const r = await apiMod.getRestorePoints();
    expect(lastCall()[0]).toMatch(/\/api\/restore\/points$/);
    expect(r).toEqual({ success: true, data });
  });

  it.each([
    ["time", { kind: "time" as const, restoredTo: "2026-11-10T12:00:00.000Z", clientTzOffsetMin: 120 }],
    ["undo", { kind: "undo" as const, restoreId: 12, clientTzOffsetMin: 120 }],
  ])("in Web mode: prepare (%s) posts the schema-shaped payload", async (_k, payload) => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { restoreId: 13 } }));
    const apiMod = await import("../backendApi");
    await apiMod.prepareRestore(payload);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/api\/restore\/prepare$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(prepareRestoreSchema.parse(payload));
  });

  it("in Web mode: confirm and cancel post the schema-shaped payloads", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
    const apiMod = await import("../backendApi");
    const confirm = { restoreId: 13, typedShopName: "CornerTech" };
    await apiMod.confirmRestore(confirm);
    expect(lastCall()[0]).toMatch(/\/api\/restore\/confirm$/);
    expect(JSON.parse(String(lastCall()[1].body))).toEqual(confirmRestoreSchema.parse(confirm));
    const cancel = { restoreId: 13 };
    await apiMod.cancelRestore(cancel);
    expect(lastCall()[0]).toMatch(/\/api\/restore\/cancel$/);
    expect(JSON.parse(String(lastCall()[1].body))).toEqual(cancelRestoreSchema.parse(cancel));
  });

  it("in Web mode: a refusal envelope (code + shopName) comes back untouched", async () => {
    const refusal = { success: false, code: "OTHER_SHOP", error: "OTHER_SHOP", shopName: "Canary" };
    fetchMock.mockResolvedValue(jsonResponse(refusal));
    const apiMod = await import("../backendApi");
    expect(await apiMod.uploadRestoreFile(new Blob(["x"]), 120)).toEqual(refusal);
  });

  it("in Web mode: uploads the raw file as octet-stream with the offset on the query (no gzip available)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { restoreId: 14 } }));
    const apiMod = await import("../backendApi");
    const file = new Blob(["SQLite format 3"]);
    await apiMod.uploadRestoreFile(file, -300);
    const [url, init] = lastCall();
    const query = Object.fromEntries(new URL(url).searchParams);
    expect(new URL(url).pathname).toBe("/api/restore/file");
    expect(restoreFileQuerySchema.parse(query)).toEqual({ clientTzOffsetMin: -300 });
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["Content-Encoding"]).toBeUndefined();
    expect(init.body).toBe(file);
  });

  it("in Web mode: gzips the upload when CompressionStream exists", async () => {
    const gz = new Blob(["gz"]);
    const compress = jest.fn(async () => gz);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { restoreId: 15 } }));
    (globalThis as { CompressionStream?: unknown }).CompressionStream = function () {};
    const apiMod = await import("../backendApi");
    await apiMod.uploadRestoreFile(new Blob(["SQLite format 3"]), 120, compress);
    const [, init] = lastCall();
    expect(compress).toHaveBeenCalled();
    expect(init.headers["Content-Encoding"]).toBe("gzip");
    expect(init.body).toBe(gz);
  });

  it("in Web mode: a 413 that is not JSON reads as 'file too large'", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      headers: { get: () => "text/html" },
      text: async () => "<html>Payload Too Large</html>",
    } as unknown as Response);
    const apiMod = await import("../backendApi");
    expect(await apiMod.uploadRestoreFile(new Blob(["x"]), 120)).toEqual({
      success: false,
      code: "FILE_TOO_LARGE",
      error: "FILE_TOO_LARGE",
    });
  });
});
