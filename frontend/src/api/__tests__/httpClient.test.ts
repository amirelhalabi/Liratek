import {
  getToken,
  setToken,
  clearToken,
  getImpersonationToken,
  setImpersonationToken,
  clearImpersonationToken,
  isImpersonationActive,
  getImpersonationTenantName,
  setImpersonationTenantName,
  getImpersonationUsername,
  setImpersonationUsername,
  clearImpersonationSession,
} from "../httpClient";

describe("httpClient token precedence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("getToken() returns the localStorage JWT when there is no impersonation session", () => {
    setToken("normal-login-token");
    expect(getToken()).toBe("normal-login-token");
  });

  it("getToken() returns null when neither storage has a token", () => {
    expect(getToken()).toBeNull();
  });

  it("getToken() prefers the impersonation sessionStorage token over the localStorage JWT", () => {
    setToken("super-admins-own-token");
    setImpersonationToken("impersonation-token");

    expect(getToken()).toBe("impersonation-token");
    // The super admin's own (localStorage) token must be untouched.
    expect(localStorage.getItem("liratek.jwt")).toBe("super-admins-own-token");
  });

  it("clearToken() removes only the localStorage JWT, not an active impersonation token", () => {
    setToken("normal-login-token");
    setImpersonationToken("impersonation-token");

    clearToken();

    expect(localStorage.getItem("liratek.jwt")).toBeNull();
    expect(getImpersonationToken()).toBe("impersonation-token");
    // Precedence still holds: with the JWT cleared, getToken() now falls
    // through to... the (still active) impersonation token.
    expect(getToken()).toBe("impersonation-token");
  });

  it("clearImpersonationToken() removes only the impersonation token, restoring the localStorage JWT via getToken()", () => {
    setToken("normal-login-token");
    setImpersonationToken("impersonation-token");

    clearImpersonationToken();

    expect(getImpersonationToken()).toBeNull();
    expect(getToken()).toBe("normal-login-token");
  });

  it("isImpersonationActive() reflects whether the impersonation token is set", () => {
    expect(isImpersonationActive()).toBe(false);
    setImpersonationToken("tok");
    expect(isImpersonationActive()).toBe(true);
    clearImpersonationToken();
    expect(isImpersonationActive()).toBe(false);
  });

  it("clearImpersonationSession() clears the token, tenant name, and username together", () => {
    setImpersonationToken("tok");
    setImpersonationTenantName("Acme Retail");
    setImpersonationUsername("acme-admin");

    clearImpersonationSession();

    expect(getImpersonationToken()).toBeNull();
    expect(getImpersonationTenantName()).toBeNull();
    expect(getImpersonationUsername()).toBeNull();
  });

  it("clearImpersonationSession() does not touch the localStorage JWT", () => {
    setToken("super-admins-own-token");
    setImpersonationToken("impersonation-token");

    clearImpersonationSession();

    expect(localStorage.getItem("liratek.jwt")).toBe("super-admins-own-token");
  });
});
