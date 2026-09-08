/**
 * AuthService.login realm scoping (v172 — per-tenant usernames).
 *
 * Once two tenants can both have an 'admin', a bare by-username lookup is
 * ambiguous. These prove login resolves the RIGHT user for the addressed
 * realm, and — when no realm was addressed at all — resolves to the operator
 * or the incumbent shop rather than to whichever row the database happens to
 * return first.
 *
 * The repository is mocked (same approach as AuthService.test.ts): what matters
 * is which lookup the service chooses and what it does with an ambiguous
 * username, not the SQL — the SQL is covered by the v172 migration test.
 */

import { jest } from "@jest/globals";

const findByUsername = jest.fn();
const findByUsernameInRealm = jest.fn();
const countByUsername = jest.fn();
const getAnchorTenantId = jest.fn();
const getTenantStatus = jest.fn(() => "active");

const userRepo = {
  findByUsername,
  findByUsernameInRealm,
  countByUsername,
  getAnchorTenantId,
  getTenantStatus,
  needsPasswordMigration: () => false,
  updatePasswordHash: jest.fn(),
};

const sessionRepo = {
  createSession: () => ({ token: "session-token" }),
  findValidSession: () => null,
  deleteSession: () => ({ success: true }),
  updateActivity: jest.fn(),
  delete: jest.fn(),
};

import { AuthService } from "@liratek/core";
import { hashPassword } from "../../../../packages/core/src/utils/crypto";

// A REAL hash of the real password, so the genuine verifyPassword succeeds.
// Mocking crypto here only introduced a second thing that could fail; what
// is under test is which LOOKUP login chooses, not password hashing.
const PASSWORD = "Str0ng-Password!";
const HASH = hashPassword(PASSWORD);

/** The same username in two different tenants — impossible before v172. */
const ADMIN_OF_TENANT_7 = {
  id: 70,
  username: "admin",
  password_hash: HASH,
  role: "admin",
  is_active: 1,
  tenant_id: 7,
};
const ADMIN_OF_TENANT_9 = {
  id: 90,
  username: "admin",
  password_hash: HASH,
  role: "admin",
  is_active: 1,
  tenant_id: 9,
};

describe("AuthService.login — realm scoping", () => {
  let service: AuthService;

  beforeEach(() => {
    findByUsername.mockReset();
    findByUsernameInRealm.mockReset();
    countByUsername.mockReset();
    getAnchorTenantId.mockReset();
    getTenantStatus.mockReturnValue("active");
    service = new AuthService(
      userRepo as unknown as ConstructorParameters<typeof AuthService>[0],
      sessionRepo as unknown as ConstructorParameters<typeof AuthService>[1],
    );
  });

  it("resolves the addressed tenant's user, not the other tenant's", async () => {
    findByUsernameInRealm.mockImplementation(
      (_u: string, realm: number | null) =>
        realm === 7
          ? ADMIN_OF_TENANT_7
          : realm === 9
            ? ADMIN_OF_TENANT_9
            : null,
    );

    const a = await service.login("admin", PASSWORD, { realm: 7 });
    const b = await service.login("admin", PASSWORD, { realm: 9 });

    expect(a.success).toBe(true);
    expect(a.user?.id).toBe(70);
    expect(b.success).toBe(true);
    expect(b.user?.id).toBe(90);
    // The global lookup must never be consulted when a realm is known.
    expect(findByUsername).not.toHaveBeenCalled();
  });

  it("uses the platform realm for realm: null", async () => {
    findByUsernameInRealm.mockReturnValue({
      id: 1,
      username: "root",
      password_hash: HASH,
      role: "super_admin",
      is_active: 1,
      tenant_id: null,
    });

    const r = await service.login("root", PASSWORD, { realm: null });

    expect(r.success).toBe(true);
    expect(findByUsernameInRealm).toHaveBeenCalledWith("root", null);
  });

  it("fails when the username does not exist in the addressed realm", async () => {
    findByUsernameInRealm.mockReturnValue(null);
    const r = await service.login("admin", PASSWORD, { realm: 9 });
    expect(r.success).toBe(false);
  });

  it("falls back to the global lookup when no realm is given and the name is unique", async () => {
    countByUsername.mockReturnValue(1);
    findByUsername.mockReturnValue(ADMIN_OF_TENANT_7);

    const r = await service.login("admin", PASSWORD);

    expect(r.success).toBe(true);
    expect(r.user?.id).toBe(70);
  });

  describe("ambiguous username, no realm given", () => {
    /**
     * This block replaced a "REFUSES an ambiguous username" test. Refusing
     * read as the safe choice and was not: `/api/auth/signup` is public, so
     * anyone with the invite code could register a shop whose admin is named
     * 'admin' and lock the INCUMBENT out of their own login. The rule is now
     * "prefer the operator, then the incumbent" — nothing leaks, because the
     * password check still runs on whichever row is returned.
     */

    beforeEach(() => {
      // Two shops own the name and the request says nothing about which.
      countByUsername.mockReturnValue(2);
      getAnchorTenantId.mockReturnValue(7);
    });

    it("prefers the PLATFORM realm — the operator is never locked out", async () => {
      const superAdmin = {
        id: 1,
        username: "admin",
        password_hash: HASH,
        role: "super_admin",
        is_active: 1,
        tenant_id: null,
      };
      findByUsernameInRealm.mockImplementation(
        (_u: string, realm: number | null) =>
          realm === null ? superAdmin : ADMIN_OF_TENANT_7,
      );

      const r = await service.login("admin", PASSWORD);

      expect(r.success).toBe(true);
      expect(r.user?.id).toBe(1);
      // Asked the platform realm first, and never needed the anchor.
      expect(findByUsernameInRealm).toHaveBeenCalledWith("admin", null);
      expect(getAnchorTenantId).not.toHaveBeenCalled();
    });

    it("falls back to the deployment's FIRST tenant — the incumbent shop", async () => {
      findByUsernameInRealm.mockImplementation(
        (_u: string, realm: number | null) =>
          realm === null ? null : realm === 7 ? ADMIN_OF_TENANT_7 : null,
      );

      const r = await service.login("admin", PASSWORD);

      expect(r.success).toBe(true);
      expect(r.user?.id).toBe(70);
      expect(findByUsernameInRealm).toHaveBeenCalledWith("admin", 7);
    });

    it("never authenticates a NEWER tenant's user on the shared host", async () => {
      // Tenant 9 signed up later and picked a taken username. Its own
      // password must not get it in: the row that comes back is the
      // incumbent's, so verifyPassword runs against the incumbent's hash.
      findByUsernameInRealm.mockImplementation(
        (_u: string, realm: number | null) =>
          realm === null ? null : realm === 7 ? ADMIN_OF_TENANT_7 : null,
      );

      const r = await service.login("admin", "the-newcomers-own-password");

      expect(r.success).toBe(false);
      expect(r.user).toBeUndefined();
    });

    it("does NOT use the ordering-dependent global lookup", async () => {
      findByUsernameInRealm.mockReturnValue(ADMIN_OF_TENANT_7);
      findByUsername.mockReturnValue(ADMIN_OF_TENANT_9);

      await service.login("admin", PASSWORD);

      // With duplicates, findByUsername returns whichever row SQLite happens
      // to hand back first — a coin flip between two shops' accounts.
      expect(findByUsername).not.toHaveBeenCalled();
    });

    it("fails closed on an empty tenant registry", async () => {
      findByUsernameInRealm.mockReturnValue(null);
      getAnchorTenantId.mockReturnValue(null);

      const r = await service.login("admin", PASSWORD);

      expect(r.success).toBe(false);
    });
  });
});
