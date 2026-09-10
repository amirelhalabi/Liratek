import { AuthService } from "../AuthService";
import type { UserRepository } from "../../repositories/UserRepository";
import type { SessionRepository, SessionEntity } from "../../repositories/SessionRepository";
import { DatabaseError } from "../../utils/errors";

/**
 * AuthService.validateSession — a database error must not read as
 * "session expired" (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 1).
 *
 * `null` from this method means exactly one thing to `authenticateJWT`:
 * sign the user out. Before this fix, a blanket `catch (error) { return
 * null; }` collapsed a THROWN infrastructure error (SQLITE_BUSY, disk I/O)
 * into the SAME `null` as a genuinely invalid session, so a transient DB
 * blip signed out whoever was mid-sale with a message that told them
 * something untrue.
 *
 * Both tests below matter together, per the plan: the first proves the fix
 * (a throw propagates), the second proves the fix did NOT overcorrect into
 * failing open (a genuinely missing session still returns null, not a
 * pass-through / thrown-away rejection that some caller might swallow into
 * "let them in").
 *
 * Rule 17 (prove failing-first): the "propagates a repository throw" test
 * was run against the pre-fix code (the `try { ... } catch (error) {
 * return null; }` wrapper re-introduced around the method body) and FAILED
 * there — `validateSession` resolved to `null` instead of rejecting, and
 * the assertion on `userRepo.findByIdGlobal` not having been called also
 * failed once the catch swallowed the throw and let nothing distinguish
 * "invalid" from "unknown". Reverted immediately after observing the
 * failure; see the session report for the exact command.
 */

function makeSession(overrides: Partial<SessionEntity> = {}): SessionEntity {
  return {
    id: 1,
    user_id: 42,
    token: "tok-abc",
    device_type: "web",
    device_info: null,
    ip_address: null,
    remember_me: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    last_activity_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    tenant_id: 1,
    ...overrides,
  };
}

function makeService(overrides: {
  validateSession?: jest.Mock;
  touchActivity?: jest.Mock;
  findByIdGlobal?: jest.Mock;
  deleteByToken?: jest.Mock;
}) {
  const sessionRepo = {
    validateSession: overrides.validateSession ?? jest.fn(),
    touchActivity: overrides.touchActivity ?? jest.fn(),
    deleteByToken: overrides.deleteByToken ?? jest.fn(),
  } as unknown as SessionRepository;

  const userRepo = {
    findByIdGlobal: overrides.findByIdGlobal ?? jest.fn(),
  } as unknown as UserRepository;

  return {
    service: new AuthService(userRepo, sessionRepo),
    sessionRepo,
    userRepo,
  };
}

describe("AuthService.validateSession — infrastructure errors propagate, invalidity still returns null", () => {
  it("propagates a repository throw instead of swallowing it into null (503, not 401)", async () => {
    const dbError = new DatabaseError("Failed to validate session", {
      cause: new Error("SQLITE_BUSY"),
    });
    const { service, userRepo } = makeService({
      validateSession: jest.fn(() => {
        throw dbError;
      }),
    });

    await expect(service.validateSession("tok-abc")).rejects.toThrow(
      DatabaseError,
    );

    // The failure happened at the FIRST repository call — nothing downstream
    // ran, so this is unambiguously "could not check", not "checked, and the
    // user happens to not exist".
    expect(userRepo.findByIdGlobal).not.toHaveBeenCalled();
  });

  it("still returns null for a missing session row — the guard against failing open", async () => {
    const { service, userRepo } = makeService({
      validateSession: jest.fn(() => null),
    });

    await expect(service.validateSession("no-such-token")).resolves.toBeNull();

    // A missing row is genuine invalidity, not an infra failure — the user
    // lookup must never run for a session that was never found.
    expect(userRepo.findByIdGlobal).not.toHaveBeenCalled();
  });

  it("also returns null (not throw) when the user behind a valid session is gone/deactivated", async () => {
    const session = makeSession();
    const { service, sessionRepo } = makeService({
      validateSession: jest.fn(() => session),
      findByIdGlobal: jest.fn(() => null),
    });

    await expect(service.validateSession(session.token)).resolves.toBeNull();
    expect(sessionRepo.touchActivity).toHaveBeenCalledWith(session);
    expect(sessionRepo.deleteByToken).toHaveBeenCalledWith(session.token);
  });

  it("a throw from touchActivity (a write on every authenticated request) also propagates", async () => {
    const session = makeSession();
    const dbError = new DatabaseError("Failed to touch session activity", {
      cause: new Error("SQLITE_BUSY"),
    });
    const { service, userRepo } = makeService({
      validateSession: jest.fn(() => session),
      touchActivity: jest.fn(() => {
        throw dbError;
      }),
    });

    await expect(service.validateSession(session.token)).rejects.toThrow(
      DatabaseError,
    );
    expect(userRepo.findByIdGlobal).not.toHaveBeenCalled();
  });

  it("returns the safe user (no password_hash) for a genuinely valid session", async () => {
    const session = makeSession();
    const { service } = makeService({
      validateSession: jest.fn(() => session),
      findByIdGlobal: jest.fn(() => ({
        id: 42,
        username: "cashier1",
        password_hash: "SCRYPT:should-never-leak",
        role: "staff",
        is_active: 1,
        tenant_id: 1,
      })),
    });

    const user = await service.validateSession(session.token);
    expect(user).toEqual({
      id: 42,
      username: "cashier1",
      role: "staff",
      is_active: 1,
      tenant_id: 1,
    });
    expect(user).not.toHaveProperty("password_hash");
  });
});
