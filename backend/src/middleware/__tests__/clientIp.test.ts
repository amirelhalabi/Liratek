/**
 * The real visitor IP behind browser -> Vercel -> Fly (LIRA-278).
 *
 * `trust proxy` stays at 1 (X-Forwarded-Host tenant routing depends on it,
 * docs/OPERATIONS.md), so `req.ip` is a proxy's address in production and
 * every visitor shares one per-IP sign-up budget. The fix reads ONE named
 * header (CLIENT_IP_HEADER) for the sign-up limiters only. These tests pass
 * the header name explicitly, so they do not depend on the env at import.
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
  clientIpRateLimitKey,
  describeForwardedHeaders,
  FORWARDED_HEADERS_PROBED,
} from "../clientIp.js";

function fakeReq(
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
  it("no header configured: req.ip, as today", () => {
    expect(
      resolveClientIp(fakeReq({ "fly-client-ip": "203.0.113.9" }), undefined),
    ).toBe("66.241.124.103");
  });

  it("header configured and present: its value", () => {
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "203.0.113.9" }),
        "fly-client-ip",
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
      ),
    ).toBe("198.51.100.7");
  });

  it("a repeated header (string[]): the first value's first address", () => {
    expect(
      resolveClientIp(
        fakeReq({ "x-real-ip": ["198.51.100.8, 10.0.0.2", "10.0.0.3"] }),
        "x-real-ip",
      ),
    ).toBe("198.51.100.8");
  });

  it("the configured name is matched case-insensitively (Node lowercases headers)", () => {
    expect(
      resolveClientIp(
        fakeReq({ "fly-client-ip": "203.0.113.10" }),
        "Fly-Client-IP",
      ),
    ).toBe("203.0.113.10");
  });

  it("header configured but absent or blank: falls back to req.ip", () => {
    expect(resolveClientIp(fakeReq({}), "fly-client-ip")).toBe(
      "66.241.124.103",
    );
    expect(
      resolveClientIp(fakeReq({ "fly-client-ip": "  , " }), "fly-client-ip"),
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
    );
    const b = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "203.0.113.2" }),
      "fly-client-ip",
    );
    expect(a).toBe("203.0.113.1");
    expect(b).toBe("203.0.113.2");
  });

  it("header unset: keyed on req.ip, as today", () => {
    expect(
      clientIpRateLimitKey(
        fakeReq({ "fly-client-ip": "203.0.113.1" }),
        undefined,
      ),
    ).toBe("66.241.124.103");
  });

  it("IPv6 addresses are grouped by /56, so one visitor cannot rotate through its own block", () => {
    const a = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "2001:db8:abcd:12::1" }),
      "fly-client-ip",
    );
    const b = clientIpRateLimitKey(
      fakeReq({ "fly-client-ip": "2001:db8:abcd:12:ffff::9" }),
      "fly-client-ip",
    );
    expect(a).toBe(b);
    expect(a).toMatch(/\/56$/);
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
