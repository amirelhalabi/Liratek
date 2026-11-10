/**
 * Web "Download backup" — `downloadShopBackup()` dual-mode routing.
 *
 * NOT proven failing-first (rule 17): written after `requestFile` existed,
 * to pin how a file response is told apart from a refusal envelope.
 * - Desktop: answers "Available on the web app", never fetches.
 * - Web: GETs /api/backup/download?stamp=…; a JSON body is the refusal
 *   envelope; anything else is the file, named from Content-Disposition.
 */
export {};

function fakeResponse(opts: {
  contentType: string;
  disposition?: string;
  json?: unknown;
  blob?: Blob;
  status?: number;
}) {
  const headers: Record<string, string> = { "content-type": opts.contentType };
  if (opts.disposition) headers["content-disposition"] = opts.disposition;
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => opts.json,
    blob: async () => opts.blob,
  } as any;
}

describe("backendApi.downloadShopBackup dual-mode routing", () => {
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

  it("in Electron mode: refuses as web-only and never fetches", async () => {
    globalThis.fetch = jest.fn() as any;
    (globalThis as any).window.api = {};
    const apiMod = await import("../backendApi");
    const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
    expect(r).toEqual({ success: false, error: "Available on the web app" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: returns the file and the server's file name", async () => {
    const blob = new Blob(["SQLite format 3"]);
    globalThis.fetch = jest.fn(async () =>
      fakeResponse({
        contentType: "application/vnd.sqlite3",
        disposition: 'attachment; filename="liratek-cornertech-2026-11-10-1430.db"',
        blob,
      }),
    ) as any;
    const apiMod = await import("../backendApi");
    const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toMatch(
      /\/api\/backup\/download\?stamp=2026-11-10-1430$/,
    );
    expect(r).toEqual({
      success: true,
      data: { blob, fileName: "liratek-cornertech-2026-11-10-1430.db" },
    });
  });

  it("in Web mode: a JSON answer is the refusal envelope", async () => {
    globalThis.fetch = jest.fn(async () =>
      fakeResponse({
        contentType: "application/json; charset=utf-8",
        status: 403,
        json: { success: false, error: "Forbidden" },
      }),
    ) as any;
    const apiMod = await import("../backendApi");
    const r = await apiMod.downloadShopBackup({ stamp: "2026-11-10-1430" });
    expect(r).toEqual({ success: false, error: "Forbidden" });
  });
});
