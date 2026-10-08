/**
 * Where emailed links point (v196 foundation). Two bases, one rule each:
 *   - platform (www) links: sign-up invites, the Google flow;
 *   - shop links: /#/join, /#/reset-password, /#/verify-email and the
 *     Google hand-off, on `https://<slug>.<APP_BASE_DOMAIN>`.
 * Both take their inputs as parameters, so no env re-import is needed.
 */

jest.mock("../createTransport.js", () => ({ isEmailConfigured: () => true }));

// Hermetic: every resolver here DEFAULTS its parameters from core's parsed env,
// and passing `undefined` explicitly selects that default. A developer's
// backend/.env (APP_BASE_DOMAIN, SIGNUP_INVITE_BASE_URL) would otherwise leak
// into the "neither is configured" cases. Pinned to unset here.
jest.mock("@liratek/core", () => ({
  ...jest.requireActual<typeof import("@liratek/core")>("@liratek/core"),
  APP_BASE_DOMAIN: undefined,
  SIGNUP_INVITE_BASE_URL: undefined,
}));

import {
  resolveInviteBaseUrl,
  resolveShopLinkBaseUrl,
  resolveTenantBaseUrl,
} from "../emailConfig.js";

describe("resolveTenantBaseUrl", () => {
  it("is the shop's own subdomain when APP_BASE_DOMAIN is set", () => {
    expect(resolveTenantBaseUrl("corner-shop", "liratek.shop")).toBe(
      "https://corner-shop.liratek.shop",
    );
  });

  it("is null when host tenancy is off — the feature must refuse to send rather than invent a link", () => {
    expect(resolveTenantBaseUrl("corner-shop", undefined)).toBeNull();
  });
});

describe("resolveInviteBaseUrl (platform links)", () => {
  it("prefers SIGNUP_INVITE_BASE_URL, else www.<APP_BASE_DOMAIN>, else null", () => {
    expect(resolveInviteBaseUrl("https://example.test/", "liratek.shop")).toBe(
      "https://example.test",
    );
    expect(resolveInviteBaseUrl(undefined, "liratek.shop")).toBe(
      "https://www.liratek.shop",
    );
    expect(resolveInviteBaseUrl(undefined, undefined)).toBeNull();
  });
});

describe("resolveShopLinkBaseUrl (where a shop-scoped emailed link points)", () => {
  it("is the shop subdomain when host tenancy is on", () => {
    expect(
      resolveShopLinkBaseUrl(
        "corner-shop",
        "https://www.liratek.shop",
        "liratek.shop",
      ),
    ).toBe("https://corner-shop.liratek.shop");
  });

  it("falls back to the ONE platform origin when host tenancy is off (every shop is served there)", () => {
    expect(
      resolveShopLinkBaseUrl(
        "corner-shop",
        "http://localhost:5173/",
        undefined,
      ),
    ).toBe("http://localhost:5173");
  });

  it("is null when neither is configured — the feature refuses to send", () => {
    expect(
      resolveShopLinkBaseUrl("corner-shop", undefined, undefined),
    ).toBeNull();
  });
});
