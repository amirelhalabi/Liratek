/**
 * Host → tenant resolution (middleware/tenantHost.ts).
 *
 * `APP_BASE_DOMAIN` and `TENANT_HOST_HEADER_OVERRIDE` are read from
 * `@liratek/core`'s env module at import time, so the module is re-imported
 * per scenario with the env set beforehand. The tenants registry is mocked:
 * these test the resolution POLICY (which host means what), not SQL.
 */

import { jest } from "@jest/globals";

const getBySlug = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getTenantRepository: () => ({ getBySlug }),
    // The real one is fail-closed and there is no tenant context in a test.
    runWithoutTenant: (fn: () => unknown) => fn(),
    get APP_BASE_DOMAIN() {
      return process.env.APP_BASE_DOMAIN;
    },
    get TENANT_HOST_HEADER_OVERRIDE() {
      return process.env.TENANT_HOST_HEADER_OVERRIDE === "true";
    },
  };
});

import type { Request } from "express";
import { resolveTenantHost, isHostTenancyActive } from "../tenantHost.js";

const CORNERTECH = {
  id: 7,
  name: "CornerTech",
  slug: "cornertech",
  status: "active" as const,
  contact_name: null,
  contact_phone: null,
  notes: null,
  created_at: "",
  updated_at: "",
};

/** Minimal Request stand-in: only hostname and headers are read. */
function req(hostname: string, headers: Record<string, string> = {}): Request {
  return {
    hostname,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("resolveTenantHost", () => {
  beforeEach(() => {
    getBySlug.mockReset();
    getBySlug.mockImplementation((slug: string) =>
      slug === "cornertech" ? CORNERTECH : null,
    );
    delete process.env.APP_BASE_DOMAIN;
    delete process.env.TENANT_HOST_HEADER_OVERRIDE;
  });

  describe("with no APP_BASE_DOMAIN (today's deployment)", () => {
    it("is disabled, so login keeps behaving exactly as before", () => {
      const r = resolveTenantHost(req("cornertech.liratek.app"));
      expect(r.kind).toBe("disabled");
      expect(isHostTenancyActive(r)).toBe(false);
      // Must not even look at the registry.
      expect(getBySlug).not.toHaveBeenCalled();
    });
  });

  describe("with APP_BASE_DOMAIN set", () => {
    beforeEach(() => {
      process.env.APP_BASE_DOMAIN = "liratek.app";
    });

    it("resolves a tenant subdomain", () => {
      const r = resolveTenantHost(req("cornertech.liratek.app"));
      expect(r).toMatchObject({ kind: "tenant", slug: "cornertech" });
      expect(isHostTenancyActive(r)).toBe(true);
    });

    it("treats the apex as the platform realm", () => {
      expect(resolveTenantHost(req("liratek.app")).kind).toBe("platform");
    });

    it("treats admin. and www. as the platform realm, not tenants", () => {
      expect(resolveTenantHost(req("admin.liratek.app")).kind).toBe("platform");
      expect(resolveTenantHost(req("www.liratek.app")).kind).toBe("platform");
      expect(getBySlug).not.toHaveBeenCalled();
    });

    it("reports an unresolvable slug as unknown, and enforces it", () => {
      const r = resolveTenantHost(req("nosuchshop.liratek.app"));
      expect(r).toMatchObject({ kind: "unknown", slug: "nosuchshop" });
      // Enforced (not ignored) — an unknown subdomain must refuse logins.
      expect(isHostTenancyActive(r)).toBe(true);
    });

    it("treats a host outside the base domain as foreign, so previews keep working", () => {
      const r = resolveTenantHost(req("liratek.vercel.app"));
      expect(r).toMatchObject({ kind: "foreign" });
      expect(isHostTenancyActive(r)).toBe(false);
    });

    it("does NOT accept a multi-label subdomain as a tenant", () => {
      // "a.cornertech.liratek.app" must not resolve to tenant "a" — nor to
      // cornertech. A typo or a wildcard-cert holder should not land inside a
      // real tenant's realm.
      const r = resolveTenantHost(req("a.cornertech.liratek.app"));
      expect(r.kind).toBe("foreign");
      expect(getBySlug).not.toHaveBeenCalled();
    });

    it("is case-insensitive about the host", () => {
      expect(resolveTenantHost(req("CornerTech.LiraTek.app"))).toMatchObject({
        kind: "tenant",
        slug: "cornertech",
      });
    });

    it("refuses to authenticate anyone if the registry lookup throws", () => {
      getBySlug.mockImplementation(() => {
        throw new Error("db is down");
      });
      const r = resolveTenantHost(req("cornertech.liratek.app"));
      // Fail CLOSED: unknown is enforced, so login is refused.
      expect(r.kind).toBe("unknown");
      expect(isHostTenancyActive(r)).toBe(true);
    });

    it("IGNORES X-Tenant-Slug unless the override is enabled", () => {
      const r = resolveTenantHost(
        req("liratek.app", { "x-tenant-slug": "cornertech" }),
      );
      // Otherwise any client could pick its own realm by sending a header.
      expect(r.kind).toBe("platform");
    });

    it("honours X-Tenant-Slug when the override IS enabled (dev/tests only)", () => {
      process.env.TENANT_HOST_HEADER_OVERRIDE = "true";
      const r = resolveTenantHost(
        req("liratek.app", { "x-tenant-slug": "cornertech" }),
      );
      expect(r).toMatchObject({ kind: "tenant", slug: "cornertech" });
    });
  });
});
