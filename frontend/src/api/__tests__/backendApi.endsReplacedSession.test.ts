import { login, ssoExchange } from "../backendApi";
import { getToken, setImpersonationToken, setToken } from "../httpClient";

/**
 * Signing in again on the same browser ends the PREVIOUS session there
 * (owner-approved 2026-10-08).
 *
 * Before: every sign-in (password, or the Google hand-off) minted a new
 * session and simply overwrote `liratek.jwt` in localStorage. The old
 * session stayed alive on the server until idle expiry (8 h, or 7 days with
 * "Keep me signed in"), so Settings -> Signed-in Devices filled up with
 * ghosts of this very browser.
 *
 * Now, when a new normal-login token is stored and a different one was
 * there, the old one is sent to POST /api/auth/logout — best effort: a
 * failing or slow logout never fails or holds up the new sign-in (≈2 s at
 * most), impersonation tokens (sessionStorage) are never touched, and the
 * session being stored is never the one ended.
 */
describe("a new sign-in ends this browser's previous session", () => {
  const originalFetch = globalThis.fetch;
  let logoutAuth: string[];
  let logoutBehaviour: "ok" | "fail" | "hang";

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { api?: unknown }).api;
    logoutAuth = [];
    logoutBehaviour = "ok";
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/api/auth/logout")) {
        logoutAuth.push(headers.Authorization ?? "");
        if (logoutBehaviour === "fail") throw new Error("network down");
        if (logoutBehaviour === "hang") return new Promise(() => {});
        return reply(200, { success: true });
      }
      if (url.endsWith("/api/auth/login")) {
        const body = JSON.parse(String(init?.body)) as { password: string };
        if (body.password === "wrong") {
          return reply(401, { error: { message: "Invalid username or password" } });
        }
        return reply(200, {
          success: true,
          data: { token: "new-token", sessionToken: "s-new", user: { id: 7, username: "rami", role: "staff" } },
        });
      }
      if (url.endsWith("/api/auth/google/sso-exchange")) {
        return reply(200, {
          success: true,
          data: { token: "sso-token", sessionToken: "s-sso", user: { id: 7, username: "rami", role: "staff" } },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function reply(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  }

  it("password sign-in: logs the OLD token out once, then the new token is the one stored", async () => {
    setToken("old-token");
    const res = await login("rami", "Right-Pass1!", false);
    expect(res.success).toBe(true);
    expect(logoutAuth).toEqual(["Bearer old-token"]);
    expect(getToken()).toBe("new-token");
  });

  it("Google hand-off: logs the OLD token out once, then the new token is the one stored", async () => {
    setToken("old-token");
    const res = await ssoExchange({ token: "handoff" });
    expect(res.success).toBe(true);
    expect(logoutAuth).toEqual(["Bearer old-token"]);
    expect(getToken()).toBe("sso-token");
  });

  it("a failing logout never fails the sign-in", async () => {
    setToken("old-token");
    logoutBehaviour = "fail";
    const res = await login("rami", "Right-Pass1!", false);
    expect(res.success).toBe(true);
    expect(getToken()).toBe("new-token");
  });

  it("a logout that never answers holds the sign-in up for about 2 seconds at most", async () => {
    setToken("old-token");
    logoutBehaviour = "hang";
    const started = Date.now();
    const res = await login("rami", "Right-Pass1!", false);
    expect(res.success).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(getToken()).toBe("new-token");
  });

  it("no previous token: no logout call", async () => {
    await login("rami", "Right-Pass1!", false);
    expect(logoutAuth).toEqual([]);
    expect(getToken()).toBe("new-token");
  });

  it("the same token again is never logged out", async () => {
    setToken("new-token");
    await login("rami", "Right-Pass1!", false);
    expect(logoutAuth).toEqual([]);
  });

  it("an impersonation token is never sent to logout", async () => {
    setImpersonationToken("impersonation-token");
    await login("rami", "Right-Pass1!", false);
    expect(logoutAuth).toEqual([]);
  });

  it("a FAILED sign-in ends nothing and keeps the old token", async () => {
    setToken("old-token");
    const res = await login("rami", "wrong", false);
    expect(res.success).toBe(false);
    expect(logoutAuth).toEqual([]);
    expect(getToken()).toBe("old-token");
  });
});
