import {
  parseImpersonationHandoff,
  bootstrapImpersonationSession,
  getImpersonationInfo,
} from "../impersonation";
import {
  getImpersonationToken,
  getImpersonationTenantName,
  getImpersonationUsername,
} from "@/api/httpClient";

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
    const win = makeFakeWindow(
      "http://localhost:5173/?impersonation_token=jwt123&tenant_name=Acme&username=acme-admin",
    );

    const applied = bootstrapImpersonationSession(win);

    expect(applied).toBe(true);
    expect(getImpersonationToken()).toBe("jwt123");
    expect(getImpersonationTenantName()).toBe("Acme");
    expect(getImpersonationUsername()).toBe("acme-admin");
    expect(win.history.replaceState).toHaveBeenCalledWith({}, "", "/");
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

  function base64UrlJson(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function makeToken(payload: Record<string, unknown>): string {
    return `${base64UrlJson({ alg: "HS256" })}.${base64UrlJson(payload)}.sig`;
  }

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
