import { AuthService } from "../AuthService";
import type { UserRepository } from "../../repositories/UserRepository";
import type {
  SessionRepository,
  SessionEntity,
} from "../../repositories/SessionRepository";
import { DatabaseError } from "../../utils/errors";

/**
 * AuthService.revokeOtherSessions — "sign out everywhere else" must NEVER
 * revoke the session making the call (SESSION_RESILIENCE_AND_DEVICES_PLAN.md
 * Part 2). This had zero test coverage: a regression here (comparing `id`
 * instead of `token`, dropping the `continue`, an off-by-one in the count)
 * would silently sign the caller out of the device they are using right now
 * — the worst possible outcome for a button labelled "sign out everywhere
 * ELSE".
 *
 * Rule 17 (prove failing-first): the "revokes exactly the two other
 * sessions" test below was run against a deliberately broken skip — the
 * `if (session.token === currentToken)` guard in `revokeOtherSessions`
 * changed to `if (session.id === currentToken)`, a type-mismatched
 * comparison (`number === string`) that is always `false`, so the caller's
 * own session is never skipped. The test FAILED there:
 *   - `sessionRepo.deleteByIdForUser` was called 3 times, including with the
 *     caller's own session id (2), not the expected 2 times over [1, 3]
 *   - the returned count was 3, not 2
 * Reverted immediately after observing the failure (the guard is back to
 * comparing `token`); see the session report for the exact edit/run/revert.
 */

function makeSession(overrides: Partial<SessionEntity> = {}): SessionEntity {
  return {
    id: 1,
    user_id: 42,
    token: "tok-1",
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
  findActiveByUserId?: jest.Mock;
  deleteByIdForUser?: jest.Mock;
}) {
  const sessionRepo = {
    findActiveByUserId: overrides.findActiveByUserId ?? jest.fn(),
    deleteByIdForUser: overrides.deleteByIdForUser ?? jest.fn(),
  } as unknown as SessionRepository;

  const userRepo = {} as unknown as UserRepository;

  return {
    service: new AuthService(userRepo, sessionRepo),
    sessionRepo,
  };
}

describe("AuthService.revokeOtherSessions — never revokes the caller's own session", () => {
  it("revokes exactly the two other sessions, never the caller's own", async () => {
    const own = makeSession({ id: 2, token: "tok-current" });
    const other1 = makeSession({ id: 1, token: "tok-other-1" });
    const other2 = makeSession({ id: 3, token: "tok-other-2" });

    const { service, sessionRepo } = makeService({
      findActiveByUserId: jest.fn(() => [other1, own, other2]),
      deleteByIdForUser: jest.fn(() => true),
    });

    const revoked = await service.revokeOtherSessions(42, "tok-current");

    expect(sessionRepo.deleteByIdForUser).toHaveBeenCalledTimes(2);
    expect(sessionRepo.deleteByIdForUser).toHaveBeenCalledWith(1, 42);
    expect(sessionRepo.deleteByIdForUser).toHaveBeenCalledWith(3, 42);
    expect(sessionRepo.deleteByIdForUser).not.toHaveBeenCalledWith(2, 42);
    expect(revoked).toBe(2);
  });

  it("a single session (the caller's own) revokes nothing and returns 0", async () => {
    const own = makeSession({ id: 2, token: "tok-current" });

    const { service, sessionRepo } = makeService({
      findActiveByUserId: jest.fn(() => [own]),
      deleteByIdForUser: jest.fn(() => true),
    });

    const revoked = await service.revokeOtherSessions(42, "tok-current");

    expect(sessionRepo.deleteByIdForUser).not.toHaveBeenCalled();
    expect(revoked).toBe(0);
  });

  it("propagates a repository throw from findActiveByUserId instead of swallowing it into 0", async () => {
    const dbError = new DatabaseError(
      "Failed to find active sessions by user ID",
      {
        cause: new Error("SQLITE_BUSY"),
      },
    );
    const { service, sessionRepo } = makeService({
      findActiveByUserId: jest.fn(() => {
        throw dbError;
      }),
    });

    await expect(
      service.revokeOtherSessions(42, "tok-current"),
    ).rejects.toThrow(DatabaseError);
    expect(sessionRepo.deleteByIdForUser).not.toHaveBeenCalled();
  });

  it("propagates a repository throw from deleteByIdForUser instead of swallowing it into a partial count", async () => {
    const own = makeSession({ id: 2, token: "tok-current" });
    const other1 = makeSession({ id: 1, token: "tok-other-1" });
    const dbError = new DatabaseError(
      "Failed to delete session by id for user",
      {
        cause: new Error("SQLITE_BUSY"),
        entityId: 1,
      },
    );

    const { service } = makeService({
      findActiveByUserId: jest.fn(() => [other1, own]),
      deleteByIdForUser: jest.fn(() => {
        throw dbError;
      }),
    });

    await expect(
      service.revokeOtherSessions(42, "tok-current"),
    ).rejects.toThrow(DatabaseError);
  });
});
