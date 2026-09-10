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
  SESSION_CHANGED_EVENT,
  type ApiError,
} from "../httpClient";

type Reply = { status: number; body?: unknown };

/**
 * Answer one response per call, in order (the last one repeats). Also records
 * the Authorization header of every call, so a test can prove WHICH token a
 * request — or its retry — actually went out with.
 */
function mockFetchSequence(...replies: Reply[]) {
  const sent: Array<string | null> = [];
  const fn = jest.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    sent.push(init?.headers?.Authorization ?? null);
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(r.body ?? {}),
    };
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
  return { fn, sent };
}

function mockFetch(status: number, body: unknown = {}) {
  return mockFetchSequence({ status, body }).fn;
}

describe("requestJson — 401 handling", () => {
  let fired: number;
  let changed: number;
  let onUnauthorized: () => void;
  let onChanged: () => void;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fired = 0;
    changed = 0;
    onUnauthorized = () => {
      fired += 1;
    };
    onChanged = () => {
      changed += 1;
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
  });

  afterEach(() => {
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
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

  it("a dead IMPERSONATION token falls through to the login beneath it — silently", async () => {
    // The owner's exact report: a "Connect as admin" URL replayed out of
    // browser history planted a long-dead impersonation token. getToken()
    // prefers it, so every request went out with the dead credential, 401'd,
    // and the user was thrown to the login screen — while holding a login the
    // server would have accepted the whole time.
    //
    // Now: clear the dead layer, retry THIS request with the real login, and
    // tell AuthContext the identity may have changed. No logout, no bounce.
    setToken("real-login");
    setImpersonationToken("dead-impersonation");
    expect(getToken()).toBe("dead-impersonation");

    const { sent } = mockFetchSequence(
      { status: 401, body: { error: "Invalid token" } },
      { status: 200, body: { ok: true } },
    );

    await expect(requestJson("/api/settings")).resolves.toEqual({ ok: true });

    // Exactly two attempts: the dead one, then the real one.
    expect(sent).toEqual(["Bearer dead-impersonation", "Bearer real-login"]);
    expect(getImpersonationToken()).toBeNull();
    expect(getToken()).toBe("real-login");
    // The session did NOT end — that would have bounced the user for nothing.
    expect(fired).toBe(0);
    // But whoever we are now may differ from whoever we were impersonating.
    expect(changed).toBe(1);
  });

  it("a dead IMPERSONATION token with NO login beneath it ends the session", async () => {
    // The super admin's own tab never signed in on this origin: sessionStorage
    // is all there was. Nothing to fall back to, so this IS a logout.
    setImpersonationToken("dead-impersonation");

    const { sent } = mockFetchSequence({ status: 401, body: { error: "Session expired" } });

    await expect(requestJson("/api/settings")).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual(["Bearer dead-impersonation"]); // no retry with nothing
    expect(getImpersonationToken()).toBeNull();
    expect(fired).toBe(1);
    expect(changed).toBe(0);
  });

  it("retries at most ONCE — a login that is also dead is not retried forever", async () => {
    setToken("also-dead-login");
    setImpersonationToken("dead-impersonation");

    const { sent } = mockFetchSequence({ status: 401, body: { error: "Session expired" } });

    await expect(requestJson("/api/settings")).rejects.toMatchObject({ status: 401 });

    // Dead impersonation -> retry with login -> login dead too -> stop.
    expect(sent).toEqual(["Bearer dead-impersonation", "Bearer also-dead-login"]);
    expect(getImpersonationToken()).toBeNull();
    expect(getToken()).toBeNull();
    expect(changed).toBe(1);
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
