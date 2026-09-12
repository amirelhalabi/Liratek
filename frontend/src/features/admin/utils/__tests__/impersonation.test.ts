import {
  parseImpersonationHandoff,
  bootstrapImpersonationSession,
  getImpersonationInfo,
  isFreshHandoff,
  HANDOFF_MAX_AGE_MS,
} from "../impersonation";
import {
  getImpersonationToken,
  getImpersonationTenantName,
  getImpersonationUsername,
} from "@/api/httpClient";

function base64UrlJson(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A real-shaped JWT (header.payload.sig) with a FRESH `iat` unless the caller
 * overrides it. Every server-minted token carries `iat`, and the bootstrap now
 * refuses a handoff without a recent one — so a bare "jwt123" placeholder is
 * no longer something the code under test would accept, and rightly so.
 */
function makeToken(payload: Record<string, unknown>): string {
  const claims = { iat: Math.floor(Date.now() / 1000), ...payload };
  return `${base64UrlJson({ alg: "HS256" })}.${base64UrlJson(claims)}.sig`;
}

describe("parseImpersonationHandoff (pure)", () => {
  it("extracts token, tenant_name, and username, and strips them from the URL", () => {
    const result = parseImpersonationHandoff(
      "http://localhost:5173/?impersonation_token=jwt123&tenant_name=Acme%20Retail&username=acme-admin",
    );

    expect(result.token).toBe("jwt123");
    expect(result.tenantName).toBe("Acme Retail");
    expect(result.username).toBe("acme-admin");
    expect(result.strippedUrl).toBe("/");
  });

  it("preserves unrelated query params and the hash", () => {
    const result = parseImpersonationHandoff(
      "http://localhost:5173/?impersonation_token=jwt123&keep=me#/some/route",
    );

    expect(result.token).toBe("jwt123");
    expect(result.strippedUrl).toBe("/?keep=me#/some/route");
  });

  it("returns nulls and an unchanged URL when there is no handoff param", () => {
    const result = parseImpersonationHandoff("http://localhost:5173/login");

    expect(result.token).toBeNull();
    expect(result.tenantName).toBeNull();
    expect(result.username).toBeNull();
    expect(result.strippedUrl).toBe("/login");
  });

  it("handles tenant_name/username absent while token is present", () => {
    const result = parseImpersonationHandoff(
      "http://localhost:5173/?impersonation_token=jwt123",
    );

    expect(result.token).toBe("jwt123");
    expect(result.tenantName).toBeNull();
    expect(result.username).toBeNull();
    expect(result.strippedUrl).toBe("/");
  });
});

describe("bootstrapImpersonationSession (imperative)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function makeFakeWindow(href: string) {
    const replaceState = jest.fn();
    return {
      location: { href },
      history: { replaceState },
    } as unknown as Window;
  }

  it("stashes the token/tenant_name/username into sessionStorage and strips the URL", () => {
    const token = makeToken({ userId: 9 });
    const win = makeFakeWindow(
      `http://localhost:5173/?impersonation_token=${token}&tenant_name=Acme&username=acme-admin`,
    );

    const applied = bootstrapImpersonationSession(win);

    expect(applied).toBe(true);
    expect(getImpersonationToken()).toBe(token);
    expect(getImpersonationTenantName()).toBe("Acme");
    expect(getImpersonationUsername()).toBe("acme-admin");
    expect(win.history.replaceState).toHaveBeenCalledWith({}, "", "/");
  });

  it("refuses a STALE handoff token — but still scrubs it from the URL", () => {
    // The bug this guards, seen live: a "Connect as admin" URL replayed hours
    // later out of browser history planted its long-dead token into
    // sessionStorage, where it outranked a perfectly good login and 401'd
    // every request. The handoff is consumed within seconds of minting, so
    // an old iat can only mean a replay.
    const hoursAgo = Math.floor((Date.now() - 8 * 60 * 60 * 1000) / 1000);
    const token = makeToken({ userId: 9, iat: hoursAgo });
    const win = makeFakeWindow(
      `http://localhost:5173/?impersonation_token=${token}#/dashboard`,
    );

    const applied = bootstrapImpersonationSession(win);

    expect(applied).toBe(false);
    expect(getImpersonationToken()).toBeNull();
    // Leaving it in the address bar is how it gets replayed AGAIN.
    expect(win.history.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/#/dashboard",
    );
  });

  it("refuses a token with no readable iat — it is not one of ours", () => {
    const win = makeFakeWindow(
      "http://localhost:5173/?impersonation_token=not-a-jwt",
    );

    expect(bootstrapImpersonationSession(win)).toBe(false);
    expect(getImpersonationToken()).toBeNull();
  });

  it("is a no-op when there's no impersonation_token param", () => {
    const win = makeFakeWindow("http://localhost:5173/login");

    const applied = bootstrapImpersonationSession(win);

    expect(applied).toBe(false);
    expect(getImpersonationToken()).toBeNull();
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });
});

describe("getImpersonationInfo", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("reports inactive when there is no impersonation token", () => {
    expect(getImpersonationInfo()).toEqual({
      active: false,
      tenantId: null,
      impersonatorId: null,
      tenantName: null,
      username: null,
    });
  });

  it("decodes tenantId/impersonatorId from the token and reads tenantName/username from the handoff stash", () => {
    const win = {
      location: {
        href: `http://localhost:5173/?impersonation_token=${makeToken({
          userId: 9,
          role: "admin",
          tenantId: 5,
          impersonatorId: 1,
          sessionToken: "s",
        })}&tenant_name=Acme%20Retail&username=acme-admin`,
      },
      history: { replaceState: jest.fn() },
    } as unknown as Window;

    bootstrapImpersonationSession(win);

    expect(getImpersonationInfo()).toEqual({
      active: true,
      tenantId: 5,
      impersonatorId: 1,
      tenantName: "Acme Retail",
      username: "acme-admin",
    });
  });

  it("falls back to a username JWT claim when the handoff stash has none", () => {
    const win = {
      location: {
        href: `http://localhost:5173/?impersonation_token=${makeToken({
          userId: 9,
          role: "admin",
          tenantId: 5,
          username: "claim-username",
        })}`,
      },
      history: { replaceState: jest.fn() },
    } as unknown as Window;

    bootstrapImpersonationSession(win);

    expect(getImpersonationInfo().username).toBe("claim-username");
  });
});

describe("isFreshHandoff", () => {
  const now = 1_800_000_000_000; // fixed clock, ms

  it("accepts a token minted just now", () => {
    expect(isFreshHandoff(makeToken({ iat: now / 1000 }), now)).toBe(true);
  });

  it("accepts a token inside the tolerance window", () => {
    const iat = (now - HANDOFF_MAX_AGE_MS) / 1000;
    expect(isFreshHandoff(makeToken({ iat }), now)).toBe(true);
  });

  it("refuses a token one second past the window", () => {
    const iat = (now - HANDOFF_MAX_AGE_MS - 1000) / 1000;
    expect(isFreshHandoff(makeToken({ iat }), now)).toBe(false);
  });

  it("tolerates a client clock that runs BEHIND the server (iat in the future)", () => {
    // Skew is why the window is minutes wide, not seconds; a future iat is the
    // benign direction and must never lock a legitimate handoff out.
    expect(isFreshHandoff(makeToken({ iat: (now + 60_000) / 1000 }), now)).toBe(
      true,
    );
  });
});
