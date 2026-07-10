import { logout } from "../backendApi";
import { setToken, setImpersonationToken, getImpersonationToken } from "../httpClient";

// This is the exact isolation guarantee the multi-tenant plan (§5) depends
// on: logging out FROM an impersonation tab must never clobber the super
// admin's own session in localStorage (shared across every tab of this
// origin). See CLAUDE.md-style rule for this feature — advisor-flagged bug
// class, guarded here.
describe("backendApi.logout() impersonation isolation", () => {
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

  function mockOkFetch() {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    })) as unknown as typeof fetch;
  }

  it("clears only the impersonation session, leaving the super admin's own JWT intact", async () => {
    setToken("super-admins-own-token");
    setImpersonationToken("impersonation-token");
    mockOkFetch();

    await logout();

    expect(localStorage.getItem("liratek.jwt")).toBe(
      "super-admins-own-token",
    );
    expect(getImpersonationToken()).toBeNull();

    // The bearer actually sent was the impersonation token (not the super
    // admin's own) — confirms getToken()'s precedence drove the request.
    const fetchMock = globalThis.fetch as jest.Mock;
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer impersonation-token");
  });

  it("clears the normal JWT when there is no impersonation session active", async () => {
    setToken("normal-login-token");
    mockOkFetch();

    await logout();

    expect(localStorage.getItem("liratek.jwt")).toBeNull();
  });
});
