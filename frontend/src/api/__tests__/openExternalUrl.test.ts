/**
 * LIRA-333 T020 (contracts/open-external.md) — `openExternalUrl` is the ONLY
 * place the "open outside LiraTek" transport is branched on:
 *  - desktop: `window.api.app.openExternal` (Electron shell), never
 *    `window.open` — which would open a LiraTek window (FR-016), and no
 *    HTTP fallback;
 *  - web: `window.open(url, "_blank")` called SYNCHRONOUSLY (popup gesture
 *    rule), without "noopener" (that always returns null); a null return
 *    means the pop-up was blocked (FR-018).
 */

export {};

describe("openExternalUrl (LIRA-333)", () => {
  const url = "https://wa.me/9613123456?text=Receipt";
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    openSpy = jest.spyOn(window, "open");
  });

  afterEach(() => {
    openSpy.mockRestore();
    delete (window as unknown as { api?: unknown }).api;
  });

  it("web: opens a new tab synchronously, detaches the opener, reports success", async () => {
    const tab = { opener: window } as unknown as Window;
    openSpy.mockReturnValue(tab);
    const { openExternalUrl } = await import("../backendApi");

    const pending = openExternalUrl({ url });
    // synchronous: window.open already ran before anything was awaited
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(url, "_blank");
    await expect(pending).resolves.toEqual({ success: true });
    expect(tab.opener).toBeNull();
  });

  it("web: a blocked pop-up (null) is reported, not swallowed", async () => {
    openSpy.mockReturnValue(null);
    const { openExternalUrl } = await import("../backendApi");
    await expect(openExternalUrl({ url })).resolves.toEqual({
      success: false,
      error: "blocked",
    });
  });

  it("web: a URL off the allow-list is refused before window.open", async () => {
    const { openExternalUrl } = await import("../backendApi");
    await expect(
      openExternalUrl({ url: "https://evil.com/x" }),
    ).resolves.toEqual({ success: false, error: "URL not allowed" });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("desktop: goes through the Electron shell, never window.open", async () => {
    const openExternal = jest.fn(async () => ({ success: true }));
    (window as unknown as { api: unknown }).api = { app: { openExternal } };
    const { openExternalUrl } = await import("../backendApi");

    await expect(openExternalUrl({ url })).resolves.toEqual({
      success: true,
    });
    expect(openExternal).toHaveBeenCalledWith({ url });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("desktop: an IPC failure is reported, with no window.open fallback", async () => {
    const openExternal = jest.fn(async () => {
      throw new Error("ipc down");
    });
    (window as unknown as { api: unknown }).api = { app: { openExternal } };
    const { openExternalUrl } = await import("../backendApi");

    await expect(openExternalUrl({ url })).resolves.toEqual({
      success: false,
      error: "ipc down",
    });
    expect(openSpy).not.toHaveBeenCalled();
  });
});
