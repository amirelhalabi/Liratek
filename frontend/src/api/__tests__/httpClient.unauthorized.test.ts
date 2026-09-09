/**
 * A rejected session must END the session.
 *
 * The bug: after the server stopped accepting a token, the app kept its `user`
 * state, rendered a full dashboard, and 401'd on every request forever. The
 * login screen was never shown. Reproduced for real when the Reset Data feature
 * wiped `sessions` — the token's row was gone and the UI carried on regardless.
 *
 * `requestJson` now discards the token and fires UNAUTHORIZED_EVENT so
 * AuthContext can sign out locally. The three guards below are what stop that
 * from misfiring, and each is a separate test because each has its own way of
 * going wrong.
 */

import {
  requestJson,
  setToken,
  getToken,
  setImpersonationToken,
  getImpersonationToken,
  UNAUTHORIZED_EVENT,
  type ApiError,
} from "../httpClient";

function mockFetch(status: number, body: unknown = {}) {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }));
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

describe("requestJson — 401 handling", () => {
  let fired: number;
  let onUnauthorized: () => void;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fired = 0;
    onUnauthorized = () => {
      fired += 1;
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  });

  afterEach(() => {
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  });

  it("discards the token and announces the end of the session", async () => {
    setToken("dead-token");
    mockFetch(401, { error: "Invalid or expired session" });

    await expect(requestJson("/api/settings")).rejects.toMatchObject({
      status: 401,
    });

    // Both halves matter: leaving the token would keep re-sending a credential
    // the server has refused, and not announcing it would leave the UI
    // believing it is signed in — which is exactly what happened.
    expect(getToken()).toBeNull();
    expect(fired).toBe(1);
  });

  it("does NOT fire for the login request — a 401 there is a wrong password", async () => {
    mockFetch(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } });

    await expect(
      requestJson("/api/auth/login", { method: "POST", auth: false }),
    ).rejects.toMatchObject({ status: 401 });

    // Signing the user out of a session they never had would turn "wrong
    // password" into an unexplained bounce to the login screen.
    expect(fired).toBe(0);
  });

  it("does NOT fire when no credential was sent", async () => {
    // No token stored: this 401 says nothing about OUR session, and reacting to
    // it would loop — every anonymous request would re-announce a logout.
    mockFetch(401, { error: "No token provided" });

    await expect(requestJson("/api/settings")).rejects.toMatchObject({
      status: 401,
    });

    expect(fired).toBe(0);
  });

  it("a LATE 401 from an old session must not kill a newer login", async () => {
    // The regression this guards, seen live: a page holding a dead token fires
    // a dozen dashboard requests, the user signs in while they are in flight,
    // and then those 401s land. Without the identity check they wiped the
    // brand-new token — log in, reach the dashboard, bounced straight back out
    // with "Session expired".
    setToken("stale-token");

    let resolveFetch: (v: unknown) => void = () => {};
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const inFlight = requestJson("/api/settings").catch(() => "rejected");

    // The user logs in again while that request is still open.
    setToken("fresh-token");

    // Only now does the old request come back 401.
    resolveFetch({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: "Session expired" }),
    });
    await inFlight;

    expect(getToken()).toBe("fresh-token");
    expect(fired).toBe(0);
  });

  it("clears a dead IMPERSONATION token, which used to be unclearable", async () => {
    // getToken() prefers the impersonation token in sessionStorage over the
    // normal one in localStorage, but setToken(null) only cleared localStorage.
    // So a dead impersonation token kept winning the lookup forever: logging in
    // seemed to work (login sends no token) and then every authenticated call
    // 401'd — and because sessionStorage survives a reload, a hard refresh did
    // not clear it either. The tab had to be closed.
    setToken("normal-token");
    setImpersonationToken("dead-impersonation-token");
    expect(getToken()).toBe("dead-impersonation-token");

    mockFetch(401, { error: "Session expired" });
    await expect(requestJson("/api/settings")).rejects.toMatchObject({
      status: 401,
    });

    // The impersonation session is gone, so the NORMAL login underneath it can
    // finally be used again instead of being permanently shadowed.
    expect(getImpersonationToken()).toBeNull();
    expect(getToken()).toBe("normal-token");
    expect(fired).toBe(1);
  });

  it("leaves other failures alone — a 403 or 500 is not a dead session", async () => {
    setToken("good-token");
    mockFetch(403, { error: "Forbidden" });

    await expect(requestJson("/api/admin/tenants")).rejects.toMatchObject({
      status: 403,
    });

    // A staff user hitting an admin-only route must not be logged out.
    expect(getToken()).toBe("good-token");
    expect(fired).toBe(0);
  });

  it("still surfaces the server's reason to the caller", async () => {
    setToken("dead-token");
    mockFetch(401, { error: "Invalid or expired session" });

    let captured: ApiError | undefined;
    try {
      await requestJson("/api/settings");
    } catch (e) {
      captured = e as ApiError;
    }
    // Logging out must not swallow the diagnosis.
    expect(captured?.message).toBe("Invalid or expired session");
  });
});
