/**
 * AuthService.login realm scoping (v172 — per-tenant usernames).
 *
 * Once two tenants can both have an 'admin', a bare by-username lookup is
 * ambiguous. These prove login resolves the RIGHT user for the addressed
 * realm, and refuses rather than guessing when it cannot tell.
 *
 * The repository is mocked (same approach as AuthService.test.ts): what matters
 * is which lookup the service chooses and what it does with an ambiguous
 * username, not the SQL — the SQL is covered by the v172 migration test.
 */

import { jest } from "@jest/globals";

const findByUsername = jest.fn();
const findByUsernameInRealm = jest.fn();
const countByUsername = jest.fn();
const getTenantStatus = jest.fn(() => "active");

const userRepo = {
  findByUsername,
  findByUsernameInRealm,
  countByUsername,
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

  it("REFUSES an ambiguous username when no realm is given", async () => {
    // Two tenants own this name and nothing says which was addressed.
    // Guessing would let someone reach an account that is not theirs.
    countByUsername.mockReturnValue(2);
    findByUsername.mockReturnValue(ADMIN_OF_TENANT_7);

    const r = await service.login("admin", PASSWORD);

    expect(r.success).toBe(false);
    // Must not fall through to the global lookup and authenticate whichever
    // row happened to come back first.
    expect(findByUsername).not.toHaveBeenCalled();
  });
});
