/**
 * Automatic tenant subdomains.
 *
 * The behaviours worth pinning, in order of what they cost if wrong:
 *
 *   1. IT NEVER THROWS. This runs off the back of a signup. A DNS API hiccup
 *      taking down a paying registration would be absurd, so every path —
 *      unconfigured, non-2xx, network error, timeout, garbage JSON — returns
 *      a result object instead of raising.
 *   2. OFF unless FULLY configured. A half-set deployment must do nothing,
 *      not create a DNS record pointing nowhere.
 *   3. IDEMPOTENT. "Already exists" on either side is success, which is what
 *      makes a retry safe and a re-run harmless.
 *   4. The CNAME is DNS-ONLY. A proxied record puts Cloudflare in front of
 *      Vercel and produces a redirect loop.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let cfg: Record<string, string | undefined> = {};

jest.mock("@liratek/core", () => ({
  get APP_BASE_DOMAIN() {
    return cfg.APP_BASE_DOMAIN;
  },
  get CLOUDFLARE_API_TOKEN() {
    return cfg.CLOUDFLARE_API_TOKEN;
  },
  get CLOUDFLARE_ZONE_ID() {
    return cfg.CLOUDFLARE_ZONE_ID;
  },
  get VERCEL_TOKEN() {
    return cfg.VERCEL_TOKEN;
  },
  get VERCEL_PROJECT_ID() {
    return cfg.VERCEL_PROJECT_ID;
  },
  get VERCEL_DNS_TARGET() {
    return cfg.VERCEL_DNS_TARGET ?? "cname.vercel-dns.com";
  },
  get VERCEL_TEAM_ID() {
    return cfg.VERCEL_TEAM_ID;
  },
}));

import {
  provisionTenantDomain,
  domainAutomationEnabled,
} from "../tenantDomains.js";

const FULL_CONFIG = {
  APP_BASE_DOMAIN: "liratek.shop",
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ZONE_ID: "zone-123",
  VERCEL_TOKEN: "vc-token",
  VERCEL_PROJECT_ID: "prj_abc",
};

const fetchMock = jest.fn();

/** Queue responses in call order: [cloudflare, vercel]. */
function respond(...responses: { status: number; body?: unknown }[]) {
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      status: r.status,
      json: async () => r.body ?? {},
    });
  }
}

beforeEach(() => {
  cfg = { ...FULL_CONFIG };
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe("off unless fully configured", () => {
  it.each(Object.keys(FULL_CONFIG))(
    "does nothing when %s is missing",
    async (missing) => {
      delete cfg[missing];

      expect(domainAutomationEnabled()).toBe(false);
      const result = await provisionTenantDomain("newshop");

      expect(result.ok).toBe(false);
      // The decisive assertion: no half-configured deployment reaches out.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.detail).toMatch(/off/i);
    },
  );

  it("is enabled with the full set", () => {
    expect(domainAutomationEnabled()).toBe(true);
  });
});

describe("the happy path", () => {
  it("creates the CNAME then registers the host, and reports it", async () => {
    respond({ status: 200, body: { success: true } }, { status: 200 });

    const result = await provisionTenantDomain("newshop");

    expect(result.ok).toBe(true);
    expect(result.host).toBe("newshop.liratek.shop");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a DNS-ONLY CNAME to the right zone", async () => {
    respond({ status: 200 }, { status: 200 });
    await provisionTenantDomain("newshop");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/zones/zone-123/dns_records");
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("CNAME");
    expect(body.name).toBe("newshop");
    expect(body.content).toBe("cname.vercel-dns.com");
    // Proxied would put Cloudflare in front of Vercel — redirect loop.
    expect(body.proxied).toBe(false);
  });

  it("registers the FULL host with Vercel, not just the slug", async () => {
    respond({ status: 200 }, { status: 200 });
    await provisionTenantDomain("newshop");

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/projects/prj_abc/domains");
    expect(JSON.parse(String(init.body)).name).toBe("newshop.liratek.shop");
  });

  it("includes teamId only when configured", async () => {
    respond({ status: 200 }, { status: 200 });
    await provisionTenantDomain("newshop");
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain("teamId");

    fetchMock.mockReset();
    cfg.VERCEL_TEAM_ID = "team_9";
    respond({ status: 200 }, { status: 200 });
    await provisionTenantDomain("newshop");
    // Without it the API reports the project as missing, not as forbidden.
    expect(String(fetchMock.mock.calls[1]![0])).toContain("teamId=team_9");
  });
});

describe("idempotent", () => {
  it("an existing DNS record is success, and it still registers on Vercel", async () => {
    respond(
      { status: 400, body: { errors: [{ code: 81057, message: "exists" }] } },
      { status: 200 },
    );

    const result = await provisionTenantDomain("newshop");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a domain already on this project is success", async () => {
    respond(
      { status: 200 },
      {
        status: 409,
        body: { error: { code: "domain_already_in_use_by_this_project" } },
      },
    );

    expect((await provisionTenantDomain("newshop")).ok).toBe(true);
  });
});

describe("fails SOFT — never throws into a signup", () => {
  it("a Cloudflare error reports and skips Vercel", async () => {
    respond({
      status: 403,
      body: { errors: [{ code: 10000, message: "Authentication error" }] },
    });

    const result = await provisionTenantDomain("newshop");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Authentication error");
    // No point registering a host that will never resolve.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a Vercel error is reported but the DNS record is LEFT in place", async () => {
    respond({ status: 200 }, { status: 500, body: {} });

    const result = await provisionTenantDomain("newshop");

    expect(result.ok).toBe(false);
    expect(result.host).toBe("newshop.liratek.shop");
    // Not rolled back on purpose: harmless alone, makes the retry a no-op,
    // and deleting could remove a record someone added by hand.
  });

  it("a network failure is caught", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

    const result = await provisionTenantDomain("newshop");

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/could not reach/i);
  });

  it("a timeout is caught", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), {
        name: "TimeoutError",
      }),
    );
    await expect(provisionTenantDomain("newshop")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("an unparseable response body does not crash the parser", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await provisionTenantDomain("newshop");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Cloudflare 500");
  });

  it("NOTHING it can be handed makes it reject", async () => {
    // The single property the signup route depends on.
    for (const outcome of [
      () => fetchMock.mockRejectedValueOnce(new Error("boom")),
      () => fetchMock.mockResolvedValueOnce({ status: 429, json: async () => null }),
      () =>
        fetchMock.mockResolvedValueOnce({
          status: 200,
          json: async () => undefined,
        }),
    ]) {
      fetchMock.mockReset();
      outcome();
      await expect(provisionTenantDomain("newshop")).resolves.toBeDefined();
    }
  });
});
