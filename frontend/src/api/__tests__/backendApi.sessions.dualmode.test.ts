/**
 * Dual-mode (IPC vs REST) routing tests for the "Signed-in Devices" session
 * functions — listUserSessions/revokeSession/revokeOtherSessions — alongside
 * backendApi.dualmode.test.ts and backendApi.serviceProviders*.dualmode.test.ts
 * (same invariant, different module):
 * - In Electron (window.api present): routes via window.api.auth.*, never fetch.
 * - In Web (no window.api): calls fetch against the matching REST route.
 *
 * Also guards FIX 3: revokeSession/revokeOtherSessions's web-mode branch used
 * to call `requestJson` with no try/catch, so any non-2xx (a 401/403 ahead of
 * the route, or an unhandled 500) escaped as a THROWN plain
 * `{status,message,details}` object instead of the `{success:false,error}`
 * envelope the write contract promises (rule 19) — SignedInDevices.tsx's
 * primary `if (!res.success)` branch never ran, and its catch fallback used
 * `e instanceof Error` on a non-Error throw, discarding the real reason (the
 * exact failure `apiError.ts`'s `messageFrom` doc comment records). Proven
 * failing-first below (rule 17): reverting the `try/catch` in backendApi.ts
 * around each `requestJson` call makes the corresponding
 * "does not throw" test reject instead of resolving.
 *
 * `listUserSessions` is a READ and, like `getDatabaseResetPreview`, is
 * documented to THROW on failure rather than return an envelope (its own
 * doc comment in backendApi.ts) — SignedInDevices.tsx's `load()` already
 * wraps it in try/catch for exactly that reason. So its third case below
 * asserts the opposite of the two writes': the rejection propagates as a
 * throw, not an envelope. That is the correct, unchanged contract, not a
 * gap — only the two writes were missing the try/catch.
 */

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as any;
}

describe("backendApi session functions dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    delete (globalThis as any).fetch;
    jest.clearAllMocks();
  });

  describe("listUserSessions", () => {
    const SESSIONS = [
      {
        id: 1,
        device_type: "electron",
        device_info: "Desktop",
        ip_address: "127.0.0.1",
        created_at: "2026-09-01T00:00:00Z",
        last_activity_at: "2026-09-01T00:00:00Z",
        is_current: true,
      },
    ];

    it("in Electron mode: routes via window.api.auth.listSessions (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const listSessions = jest.fn(async () => ({
        success: true,
        data: SESSIONS,
      }));
      (globalThis as any).window.api = { auth: { listSessions } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.listUserSessions();

      expect(listSessions).toHaveBeenCalledTimes(1);
      expect(result).toEqual(SESSIONS);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: fetches GET /api/auth/sessions and unwraps to the raw array", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(200, { success: true, data: SESSIONS }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.listUserSessions();

      expect(result).toEqual(SESSIONS);
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/auth/sessions");
      expect(options?.method ?? "GET").toBe("GET");
    });

    it("in Web mode: a rejecting requestJson propagates as a THROW (read contract, unchanged)", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(500, { error: "boom" }),
      ) as any;

      const apiMod = await import("../backendApi");

      await expect(apiMod.listUserSessions()).rejects.toBeTruthy();
    });
  });

  describe("revokeSession", () => {
    it("in Electron mode: routes via window.api.auth.revokeSession (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const revokeSession = jest.fn(async () => ({ success: true }));
      (globalThis as any).window.api = { auth: { revokeSession } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.revokeSession(7);

      expect(revokeSession).toHaveBeenCalledWith(7);
      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: DELETEs /api/auth/sessions/:id and returns the envelope as-is on success", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(200, { success: true }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.revokeSession(7);

      expect(result).toEqual({ success: true });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/auth/sessions/7");
      expect(options.method).toBe("DELETE");
    });

    it("in Web mode: a rejecting requestJson (403) resolves to {success:false,error} instead of throwing — FIX 3", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(403, { error: "Not your session" }),
      ) as any;

      const apiMod = await import("../backendApi");

      let thrown = false;
      let result: { success: boolean; error?: string } | undefined;
      try {
        result = await apiMod.revokeSession(7);
      } catch {
        thrown = true;
      }

      expect(thrown).toBe(false);
      expect(result).toEqual({ success: false, error: "Not your session" });
    });

    it("in Web mode: an unhandled 500 with no JSON error field still resolves to an envelope, not a throw", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () => jsonResponse(500, {})) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.revokeSession(7);

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error).toBeTruthy();
    });
  });

  describe("revokeOtherSessions", () => {
    it("in Electron mode: routes via window.api.auth.revokeOtherSessions (no fetch)", async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error("fetch should not be called in Electron mode");
      }) as any;
      const revokeOtherSessions = jest.fn(async () => ({
        success: true,
        data: { revoked: 3 },
      }));
      (globalThis as any).window.api = { auth: { revokeOtherSessions } };

      const apiMod = await import("../backendApi");
      const result = await apiMod.revokeOtherSessions();

      expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data: { revoked: 3 } });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("in Web mode: POSTs /api/auth/sessions/revoke-others and returns the envelope as-is on success", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(200, { success: true, data: { revoked: 3 } }),
      ) as any;

      const apiMod = await import("../backendApi");
      const result = await apiMod.revokeOtherSessions();

      expect(result).toEqual({ success: true, data: { revoked: 3 } });
      const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain("/api/auth/sessions/revoke-others");
      expect(options.method).toBe("POST");
    });

    it("in Web mode: a rejecting requestJson (401) resolves to {success:false,error} instead of throwing — FIX 3", async () => {
      delete (globalThis as any).window.api;
      globalThis.fetch = jest.fn(async () =>
        jsonResponse(401, { error: "Unauthenticated" }),
      ) as any;

      const apiMod = await import("../backendApi");

      let thrown = false;
      let result:
        | { success: boolean; data?: { revoked: number }; error?: string }
        | undefined;
      try {
        result = await apiMod.revokeOtherSessions();
      } catch {
        thrown = true;
      }

      expect(thrown).toBe(false);
      expect(result).toEqual({ success: false, error: "Unauthenticated" });
    });
  });
});
