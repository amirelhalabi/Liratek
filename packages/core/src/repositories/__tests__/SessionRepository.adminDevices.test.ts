import Database from "better-sqlite3";
import { SessionRepository, type SessionEntity } from "../SessionRepository";
import { runWithTenant } from "../../db/tenantContext";

/**
 * SessionRepository — the admin view of "signed-in devices" (owner decision
 * 2026-10-19: an admin sees and can end every session in their own shop).
 *
 * The security property under test is the TENANT boundary: the admin list
 * and the admin revoke widen "my sessions" to "my shop's sessions", never to
 * another shop's. Each user row carries its username and role so the page can
 * group by user, and the bearer token still never leaves the server.
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
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER,
      username TEXT,
      role TEXT DEFAULT 'staff'
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
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, role) VALUES
      (10, 1, 'amir', 'admin'),
      (20, 1, 'rami', 'staff'),
      (30, 2, 'other-shop', 'admin');
  `);
  return db;
}

describe("SessionRepository — admin signed-in devices", () => {
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

  describe("findActiveWithUsers", () => {
    it("with no user id lists every active session in the CURRENT shop only, with username and role", () => {
      const mine = create(10, 1);
      const staff = create(20, 1);
      const otherShop = create(30, 2);
      const expired = create(20, 1);
      db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
        "2000-01-01T00:00:00.000Z",
        expired.id,
      );

      const rows = runWithTenant(1, () => repo.findActiveWithUsers(null));

      expect(rows.map((r) => r.id).sort()).toEqual([mine.id, staff.id].sort());
      expect(rows.map((r) => r.id)).not.toContain(otherShop.id);
      const staffRow = rows.find((r) => r.id === staff.id);
      expect(staffRow?.username).toBe("rami");
      expect(staffRow?.role).toBe("staff");
    });

    it("with a user id lists only that user's sessions", () => {
      const mine = create(10, 1);
      create(20, 1);

      const rows = runWithTenant(1, () => repo.findActiveWithUsers(10));

      expect(rows.map((r) => r.id)).toEqual([mine.id]);
      expect(rows[0].username).toBe("amir");
    });
  });

  describe("deleteByIdInTenant", () => {
    it("ends another user's session in the same shop", () => {
      const staff = create(20, 1);

      const deleted = runWithTenant(1, () => repo.deleteByIdInTenant(staff.id));

      expect(deleted).toBe(true);
      expect(rowExists(staff.id)).toBe(false);
    });

    it("refuses a session that belongs to ANOTHER shop", () => {
      const otherShop = create(30, 2);

      const deleted = runWithTenant(1, () =>
        repo.deleteByIdInTenant(otherShop.id),
      );

      expect(deleted).toBe(false);
      expect(rowExists(otherShop.id)).toBe(true);
    });
  });

  describe("toSafeSession", () => {
    it("carries user, expiry and remember-me fields but never the token", () => {
      create(20, 1);
      const [row] = runWithTenant(1, () => repo.findActiveWithUsers(20));

      const safe = repo.toSafeSession(row, "caller-token");

      expect(safe).toMatchObject({
        user_id: 20,
        username: "rami",
        role: "staff",
        remember_me: false,
        expires_at: row.expires_at,
        is_current: false,
      });
      expect(Object.keys(safe)).not.toContain("token");
      expect(JSON.stringify(safe)).not.toContain(row.token);
    });
  });
});
