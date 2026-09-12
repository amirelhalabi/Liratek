import Database from "better-sqlite3";
import { SessionRepository, type SessionEntity } from "../SessionRepository";
import { runWithTenant } from "../../db/tenantContext";

/**
 * SessionRepository — the "signed-in devices" panel primitives
 * (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2).
 *
 * Two things are load-bearing here and both are security properties, not
 * just correctness:
 *
 *   1. `deleteByIdForUser` scopes its DELETE by id AND user_id AND
 *      tenant_id, all three, in one WHERE clause. Drop any one of the
 *      last two and a revoke-by-id becomes "delete any row whose id I can
 *      guess" — for another user, or another tenant entirely. Both tests
 *      below were written against a version scoped by id alone (the naive
 *      first draft) and FAILED there: the "other user" row and the "other
 *      tenant" row both disappeared. That is the rule-17 failing-first
 *      proof; see the session's report for the exact revert-and-rerun.
 *
 *   2. `toSafeSession` must never let `token` (the bearer credential)
 *      reach the serialised output. Asserted on `Object.keys` AND on
 *      `JSON.stringify` deliberately — a naive `{ ...session, token:
 *      undefined }` would satisfy neither: `token: undefined` is still an
 *      own key (Object.keys still lists it, though JSON.stringify drops
 *      undefined values), so both checks matter and catch different
 *      naive-but-wrong implementations.
 */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      device_type TEXT NOT NULL DEFAULT 'unknown',
      device_info TEXT,
      ip_address TEXT,
      remember_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      tenant_id INTEGER
    );

    INSERT INTO tenants (id, name, slug, status) VALUES
      (1, 'Tenant One', 'tenant-one', 'active'),
      (2, 'Tenant Two', 'tenant-two', 'active');
  `);
  return db;
}

describe("SessionRepository — signed-in devices", () => {
  let db: Database.Database;
  let repo: SessionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: unknown }
    ).__LIRATEK_TEST_DB__ = db;
    repo = new SessionRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: unknown })
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  /** createSession writes tenant_id from the explicit param (login runs
   * before any tenant context exists), so no runWithTenant() is needed here. */
  function create(userId: number, tenantId: number): SessionEntity {
    return repo.createSession({
      user_id: userId,
      device_type: "web",
      tenant_id: tenantId,
    });
  }

  function rowExists(id: number): boolean {
    return (
      db.prepare("SELECT id FROM sessions WHERE id = ?").get(id) !== undefined
    );
  }

  describe("deleteByIdForUser", () => {
    it("refuses an id belonging to ANOTHER user", () => {
      const mine = create(10, 1);
      const theirs = create(20, 1);

      // Acting as user 10, try to revoke user 20's session by its real id.
      const deleted = runWithTenant(1, () =>
        repo.deleteByIdForUser(theirs.id, 10),
      );

      expect(deleted).toBe(false);
      expect(rowExists(theirs.id)).toBe(true);
      // The caller's own session is untouched too — a scoping bug that
      // deletes the wrong row instead of no row would slip past a check
      // that only inspects `theirs`.
      expect(rowExists(mine.id)).toBe(true);
    });

    it("refuses an id belonging to ANOTHER tenant", () => {
      // Same user_id can appear in two tenants' session rows in principle;
      // what must gate the delete is the row's OWN tenant_id against the
      // CURRENT tenant context, not just the user_id match.
      const inTenantOne = create(30, 1);
      const inTenantTwo = create(30, 2);

      // Acting inside tenant 1, try to revoke the row that actually
      // belongs to tenant 2 — same user_id, same numeric id space.
      const deleted = runWithTenant(1, () =>
        repo.deleteByIdForUser(inTenantTwo.id, 30),
      );

      expect(deleted).toBe(false);
      expect(rowExists(inTenantTwo.id)).toBe(true);
      expect(rowExists(inTenantOne.id)).toBe(true);

      // Sanity check the positive case: the SAME id+user, revoked under
      // the RIGHT tenant context, actually deletes the row. This is what
      // stops the test suite from passing on a version of the method that
      // is simply broken (returns false for everything).
      const deletedCorrectly = runWithTenant(2, () =>
        repo.deleteByIdForUser(inTenantTwo.id, 30),
      );
      expect(deletedCorrectly).toBe(true);
      expect(rowExists(inTenantTwo.id)).toBe(false);
    });

    it("succeeds for the owning user inside the owning tenant", () => {
      const mine = create(10, 1);

      const deleted = runWithTenant(1, () =>
        repo.deleteByIdForUser(mine.id, 10),
      );

      expect(deleted).toBe(true);
      expect(rowExists(mine.id)).toBe(false);
    });
  });

  describe("toSafeSession", () => {
    it("output has NO token key — checked on the object AND the serialised JSON", () => {
      const session = create(10, 1);

      const safe = repo.toSafeSession(session, "some-other-caller-token");

      // Object.keys catches `{ ...session, token: undefined }` — that spread
      // still leaves `token` as an own, enumerable key.
      expect(Object.keys(safe)).not.toContain("token");
      expect(Object.keys(safe).sort()).toEqual(
        [
          "id",
          "device_type",
          "device_info",
          "ip_address",
          "created_at",
          "last_activity_at",
          "is_current",
        ].sort(),
      );

      // JSON.stringify catches the shape a reviewer actually sees on the
      // wire — this is the assertion the plan calls out as "the one that
      // matters most".
      const serialised = JSON.stringify(safe);
      expect(serialised).not.toContain('"token"');
      expect(serialised).not.toContain(session.token);
    });

    it("is_current is true for exactly the caller's own session", () => {
      const mine = create(10, 1);
      const someoneElses = create(20, 1);

      const safeMine = repo.toSafeSession(mine, mine.token);
      const safeOther = repo.toSafeSession(someoneElses, mine.token);

      expect(safeMine.is_current).toBe(true);
      expect(safeOther.is_current).toBe(false);

      // And the reverse caller sees the opposite of both.
      const fromOthersPerspective = repo.toSafeSession(
        mine,
        someoneElses.token,
      );
      expect(fromOthersPerspective.is_current).toBe(false);
    });
  });
});
