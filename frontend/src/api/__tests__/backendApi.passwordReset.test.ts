/**
 * The password-reset adapter functions (LIRA-275/276) are WEB ONLY and talk
 * to `/api/password-reset/*`:
 *   - forgot / check / reset are PUBLIC: no Authorization header is sent;
 *   - send/:userId is the admin's call: it carries the session token;
 *   - on desktop every one of them refuses before any request.
 * Bodies are parsed through the core schemas (rule 24).
 */

import {
  checkResetTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@liratek/core";

export {}; // module scope (see backendApi.users.dualmode.test.ts)

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

function jsonResponseForPasswordReset(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("backendApi password reset (web only)", () => {
  let calls: Captured[];

  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
    calls = [];
    globalThis.fetch = jest.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as Captured["init"] });
      return jsonResponseForPasswordReset({ success: true, data: {} });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    delete (globalThis as any).fetch;
    localStorage.clear();
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it("public calls POST their route with the schema-shaped body and no token", async () => {
    const api = await import("../backendApi");
    (await import("../httpClient")).setToken("a-session-token");

    const forgot = { email: "boss@shop.com", shop: "cellcity" };
    const check = { token: "tok" };
    const reset = { token: "tok", password: "N3w!Passw0rd" };
    expect(forgotPasswordSchema.parse(forgot)).toEqual(forgot);
    expect(checkResetTokenSchema.parse(check)).toEqual(check);
    expect(resetPasswordSchema.parse(reset)).toEqual(reset);

    await api.forgotPassword(forgot);
    await api.checkResetToken(check);
    await api.resetPassword(reset);

    expect(calls.map((c) => [c.url.replace(/^.*(\/api\/)/, "$1"), c.init.method])).toEqual([
      ["/api/password-reset/forgot", "POST"],
      ["/api/password-reset/check", "POST"],
      ["/api/password-reset/reset", "POST"],
    ]);
    expect(calls.map((c) => JSON.parse(c.init.body ?? "null"))).toEqual([
      forgot,
      check,
      reset,
    ]);
    for (const c of calls) {
      expect(c.init.headers?.Authorization).toBeUndefined();
    }
  });

  it("sendPasswordReset carries the admin's session token", async () => {
    const api = await import("../backendApi");
    (await import("../httpClient")).setToken("a-session-token");
    await api.sendPasswordReset(24);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/password-reset\/send\/24$/);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers?.Authorization).toBe("Bearer a-session-token");
  });

  it("refuses on desktop before any request", async () => {
    (globalThis as any).window.api = {};
    const api = await import("../backendApi");
    await expect(api.forgotPassword({ email: "a@b.co" })).rejects.toThrow(/web mode/);
    await expect(api.checkResetToken({ token: "t" })).rejects.toThrow(/web mode/);
    await expect(api.resetPassword({ token: "t", password: "N3w!Passw0rd" })).rejects.toThrow(/web mode/);
    await expect(api.sendPasswordReset(1)).rejects.toThrow(/web mode/);
    expect(calls).toHaveLength(0);
  });
});
