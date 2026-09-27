/**
 * Web-only bug fix: `deleteDraft()` ("cancel draft" in the POS) called
 * `DELETE /api/sales/drafts/:id` over HTTP but backend/src/api/sales.ts
 * registered no such route — so cancelling a draft was broken on web while
 * working on desktop (IPC). This test locks the dual-mode routing contract
 * (rule 19/21) so the two transports can't drift again:
 * - In Electron (window.api present): routes via window.api.sales.deleteDraft,
 *   never fetch.
 * - In Web (no window.api): DELETEs the exact REST route the new backend
 *   handler (backend/src/api/sales.ts) listens on, and returns the envelope
 *   as-is (rule 19c: HTTP 200 even on a business-rule failure).
 *
 * Follows the harness in backendApi.serviceProviders.write.dualmode.test.ts.
 */

export {}; // module scope: keeps helpers like okJson file-local (TS2393)

function okJsonDeleteDraft(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

describe("backendApi.deleteDraft dual-mode routing", () => {
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

  it("in Electron mode: routes via window.api.sales.deleteDraft (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const deleteDraft = jest.fn(async () => ({ success: true }));
    (globalThis as any).window.api = { sales: { deleteDraft } };

    const apiMod = await import("../backendApi");
    const result = await apiMod.deleteDraft(7);

    expect(deleteDraft).toHaveBeenCalledWith(7);
    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: DELETEs /api/sales/drafts/:id and returns the envelope as-is", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonDeleteDraft({ success: true }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.deleteDraft(7);

    expect(result).toEqual({ success: true });
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/sales/drafts/7");
    expect(options.method).toBe("DELETE");
  });

  it("in Web mode: a business-rule failure (e.g. not a draft) still resolves the envelope, not a thrown error", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      okJsonDeleteDraft({
        success: false,
        error: "Only draft sales can be deleted",
      }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.deleteDraft(7);

    expect(result).toEqual({
      success: false,
      error: "Only draft sales can be deleted",
    });
  });
});
