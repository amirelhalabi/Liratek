/**
 * The real visitor IP behind browser -> Vercel -> Fly (LIRA-278).
 *
 * `trust proxy` stays at 1 (X-Forwarded-Host tenant routing depends on it,
 * docs/OPERATIONS.md), so `req.ip` is a proxy's address in production and
 * every visitor shares one per-IP budget. The fix reads ONE named header
 * (CLIENT_IP_HEADER, default x-vercel-forwarded-for) — and since LIRA-283
 * ONLY when the request carries the Vercel proxy secret. These tests pass the
 * header name and secret explicitly, so they do not depend on the env.
 */

import { jest } from "@jest/globals";
import crypto from "node:crypto";

const routeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../../server.js", () => ({ logger: routeLogger }));

import type { Request } from "express";
import {
  resolveClientIp,
  resolveClientIpDetailed,
  isFromTrustedProxy,
  clientIpRateLimitKey,
  PROXY_AUTH_HEADER,
  describeForwardedHeaders,
  FORWARDED_HEADERS_PROBED,
} from "../clientIp.js";

const PROXY_SECRET = "clientip-unit-test-secret-0123456789abcdef";

/** A request that came through Vercel (carries the proxy secret). */
function fakeReq(
  headers: Record<string, string | string[] | undefined>,
  ip: string | undefined = "66.241.124.103",
): Request {
  return {
    headers: { [PROXY_AUTH_HEADER]: PROXY_SECRET, ...headers },
    ip,
  } as unknown as Request;
}

/** A direct request: no proxy secret. */
function directReq(
  headers: Record<string, string | string[] | undefined>,
  ip: string | undefined = "66.241.124.103",
): Request {
  return { headers, ip } as unknown as Request;
}

const SALT = "test-salt";
const sha12 = (value: string) =>
  crypto
    .createHash("sha256")
    .update(SALT + value, "utf8")
    .digest("hex")
    .slice(0, 12);

describe("resolveClientIp", () => {
  it("no header configured: reads x-vercel-forwarded-for, so another header alone is ignored", () => {
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "203.0.113.9" }),
        undefined,
        PROXY_SECRET,
      ),
    ).toBe("66.241.124.103");
  });

  it("header configured and present: its value", () => {
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "203.0.113.9" }),
        "fly-client-ip",
        PROXY_SECRET,
      ),
    ).toBe("203.0.113.9");
  });

  it("a comma list: the FIRST address, trimmed", () => {
    expect(
      resolveClientIp(
        fakeReq({
          "x-forwarded-for": "  198.51.100.7 , 10.0.0.1, 66.241.124.103",
        }),
        "x-forwarded-for",
        PROXY_SECRET,
      ),
    ).toBe("198.51.100.7");
  });

  it("a repeated header (string[]): the first value's first address", () => {
    expect(
      resolveClientIp(
        fakeReq({ "x-real-ip": ["198.51.100.8, 10.0.0.2", "10.0.0.3"] }),
        "x-real-ip",
        PROXY_SECRET,
      ),
    ).toBe("198.51.100.8");
  });

  it("the configured name is matched case-insensitively (Node lowercases headers)", () => {
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "203.0.113.10" }),
        "Fly-Client-IP",
        PROXY_SECRET,
      ),
    ).toBe("203.0.113.10");
  });

  it("header configured but absent or blank: falls back to req.ip", () => {
    expect(resolveClientIp(fakeReq({}), "fly-client-ip", PROXY_SECRET)).toBe(
      "66.241.124.103",
    );
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "  , " }),
        "fly-client-ip",
        PROXY_SECRET,
      ),
    ).toBe("66.241.124.103");
  });

  it("nothing at all: an empty string, never undefined", () => {
    const noIp = { headers: {}, ip: undefined } as unknown as Request;
    expect(resolveClientIp(noIp, "fly-client-ip")).toBe("");
  });
});

describe("clientIpRateLimitKey", () => {
  it("two visitors behind the same proxy get DIFFERENT keys when the header is set", () => {
    const a = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "203.0.113.1" }),
      "fly-client-ip",
      PROXY_SECRET,
    );
    const b = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "203.0.113.2" }),
      "fly-client-ip",
      PROXY_SECRET,
    );
    expect(a).toBe("203.0.113.1");
    expect(b).toBe("203.0.113.2");
  });

  it("header unset and no x-vercel-forwarded-for: keyed on req.ip", () => {
    expect(
      clientIpRateLimitKey(
        fakeReq({ "fly-client-ip": "203.0.113.1" }),
        undefined,
        PROXY_SECRET,
      ),
    ).toBe("66.241.124.103");
  });

  it("IPv6 addresses are grouped by /56, so one visitor cannot rotate through its own block", () => {
    const a = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "2001:db8:abcd:12::1" }),
      "fly-client-ip",
      PROXY_SECRET,
    );
    const b = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "2001:db8:abcd:12:ffff::9" }),
      "fly-client-ip",
      PROXY_SECRET,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/\/56$/);
  });
});

describe("the proxy-secret gate (LIRA-283)", () => {
  it("no x-liratek-proxy-auth: every forwarded header is ignored", () => {
    const req = directReq({
      "x-vercel-forwarded-for": "198.51.100.1",
      "x-forwarded-for": "198.51.100.1, 66.241.124.103",
      "fly-client-ip": "198.51.100.1",
    });
    expect(resolveClientIp(req, undefined, PROXY_SECRET)).toBe(
      "66.241.124.103",
    );
    expect(resolveClientIp(req, "fly-client-ip", PROXY_SECRET)).toBe(
      "66.241.124.103",
    );
  });

  it("a wrong secret is the same as none", () => {
    const req = directReq({
      [PROXY_AUTH_HEADER]: "not-the-secret",
      "x-vercel-forwarded-for": "198.51.100.1",
    });
    expect(isFromTrustedProxy(req, PROXY_SECRET)).toBe(false);
    expect(resolveClientIpDetailed(req, undefined, PROXY_SECRET)).toEqual({
      ip: "66.241.124.103",
      source: "direct",
      header: null,
      proxyVerified: false,
    });
  });

  it("no secret configured: fail closed, even for an EMPTY presented header", () => {
    const req = directReq({
      [PROXY_AUTH_HEADER]: "",
      "x-vercel-forwarded-for": "198.51.100.1",
    });
    expect(isFromTrustedProxy(req, undefined)).toBe(false);
    expect(isFromTrustedProxy(req, "")).toBe(false);
    expect(resolveClientIp(req, undefined, undefined)).toBe("66.241.124.103");
  });

  it("the right secret: x-vercel-forwarded-for by default, source 'vercel'", () => {
    expect(
      resolveClientIpDetailed(
        fakeReq({ "x-vercel-forwarded-for": "185.187.131.199" }),
        undefined,
        PROXY_SECRET,
      ),
    ).toEqual({
      ip: "185.187.131.199",
      source: "vercel",
      header: "x-vercel-forwarded-for",
      proxyVerified: true,
    });
  });

  it("a header value that is not an IP address falls back to req.ip", () => {
    expect(
      resolveClientIp(
        fakeReq({ "x-vercel-forwarded-for": "evil<script>" }),
        undefined,
        PROXY_SECRET,
      ),
    ).toBe("66.241.124.103");
  });

  it("CLIENT_IP_PROXY_SECRET shorter than 32 characters is ignored (env default)", () => {
    const before = process.env.CLIENT_IP_PROXY_SECRET;
    try {
      process.env.CLIENT_IP_PROXY_SECRET = "short";
      const req = directReq({
        [PROXY_AUTH_HEADER]: "short",
        "x-vercel-forwarded-for": "198.51.100.1",
      });
      expect(isFromTrustedProxy(req)).toBe(false);
      expect(resolveClientIp(req)).toBe("66.241.124.103");
    } finally {
      if (before === undefined) delete process.env.CLIENT_IP_PROXY_SECRET;
      else process.env.CLIENT_IP_PROXY_SECRET = before;
    }
  });
});

describe("describeForwardedHeaders (TEMPORARY diagnostic, LIRA-278)", () => {
  it("probes the five headers the owner must choose between", () => {
    expect([...FORWARDED_HEADERS_PROBED].sort()).toEqual(
      [
        "cf-connecting-ip",
        "fly-client-ip",
        "x-forwarded-for",
        "x-real-ip",
        "x-vercel-forwarded-for",
      ].sort(),
    );
  });

  it("reports presence, part count, a short hash and a masked prefix — never a raw address", () => {
    const req = fakeReq({
      "x-forwarded-for": "198.51.100.77, 66.241.124.103",
      "fly-client-ip": "66.241.124.103",
      "x-vercel-forwarded-for": "198.51.100.77",
    });
    const report = describeForwardedHeaders(req, SALT);

    expect(report["x-forwarded-for"]).toEqual({
      parts: 2,
      firstHash: sha12("198.51.100.77"),
      firstMasked: "198.51.x.x",
    });
    expect(report["fly-client-ip"]).toEqual({
      parts: 1,
      firstHash: sha12("66.241.124.103"),
      firstMasked: "66.241.x.x",
    });
    expect(report["x-real-ip"]).toBeNull();
    expect(report["cf-connecting-ip"]).toBeNull();
    expect(report.reqIp).toEqual({
      parts: 1,
      firstHash: sha12("66.241.124.103"),
      firstMasked: "66.241.x.x",
    });

    const text = JSON.stringify(report);
    expect(text).not.toContain("198.51.100.77");
    expect(text).not.toContain("66.241.124.103");
  });

  it("masks IPv6 to its first two groups", () => {
    const report = describeForwardedHeaders(
      fakeReq({ "x-real-ip": "2001:db8:abcd:12::1" }),
    );
    expect(report["x-real-ip"]?.firstMasked).toBe("2001:db8:x");
    expect(JSON.stringify(report)).not.toContain("abcd");
  });

  it("the default salt is random per process: an unsalted hash of the address is NOT what is logged", () => {
    const report = describeForwardedHeaders(
      fakeReq({ "x-real-ip": "198.51.100.9" }),
    );
    const unsalted = crypto
      .createHash("sha256")
      .update("198.51.100.9", "utf8")
      .digest("hex")
      .slice(0, 12);
    expect(report["x-real-ip"]?.firstHash).not.toBe(unsalted);
    // ...but stable within the process, so requests can be compared.
    expect(
      describeForwardedHeaders(fakeReq({ "x-real-ip": "198.51.100.9" }))[
        "x-real-ip"
      ]?.firstHash,
    ).toBe(report["x-real-ip"]?.firstHash);
  });
});
