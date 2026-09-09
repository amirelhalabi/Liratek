import { login } from "../backendApi";
import {
  getToken,
  setImpersonationToken,
  getImpersonationToken,
  setImpersonationTenantName,
  getImpersonationTenantName,
} from "../httpClient";

/**
 * Signing in deliberately must SUPERSEDE an impersonation session in this tab.
 *
 * The bug, reproduced live on test.liratek.shop: a tab that had once been used
 * for the super admin's "Connect as admin" handoff still held an impersonation
 * token in sessionStorage — 7.5 hours old by the time it was found. Because
 * `getToken()` prefers sessionStorage over localStorage, that dead token kept
 * winning the lookup after a perfectly good normal login. The login itself
 * returned 200 (it sends no token), the dashboard's first requests raced
 * through, and then everything 401'd. sessionStorage survives a reload, so a
 * hard refresh did not help; only closing the tab did, which is not something
 * anyone would think to try.
 */
describe("backendApi.login() supersedes an impersonation session", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { api?: unknown }).api;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function mockLoginFetch(token: string) {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          success: true,
          data: { token, user: { id: 7, username: "Admin", role: "admin" } },
        }),
    })) as unknown as typeof fetch;
  }

  it("clears a stale impersonation token so the new login is the one that is sent", async () => {
    setImpersonationToken("stale-impersonation-token-from-hours-ago");
    setImpersonationTenantName("Test");
    mockLoginFetch("fresh-login-token");

    const res = await login("Admin", "Admin@123", false);
    expect(res.success).toBe(true);

    // The whole point: the token the app will actually SEND is the one the
    // user just logged in with, not the corpse that was shadowing it.
    expect(getToken()).toBe("fresh-login-token");
    expect(getImpersonationToken()).toBeNull();
    // The companion stash goes too, or the UI keeps claiming to be
    // impersonating a tenant it no longer has a token for.
    expect(getImpersonationTenantName()).toBeNull();
  });

  it("leaves a failed login alone — nothing is superseded by an attempt that did not work", async () => {
    setImpersonationToken("live-impersonation-token");
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ error: { message: "Invalid username or password" } }),
    })) as unknown as typeof fetch;

    const res = await login("Admin", "wrong", false);
    expect(res.success).toBe(false);

    // A typo in the password must not destroy an active impersonation session.
    expect(getImpersonationToken()).toBe("live-impersonation-token");
  });
});
