import Database from "better-sqlite3";
import {
  SessionRepository,
  SESSION_DURATION,
} from "../SessionRepository.js";

/**
 * How long a login lasts, and what keeps it alive.
 *
 * Two defects lived here, both reported as "it logs me out for no reason":
 *
 *   1. A session without remember-me died after 30 MINUTES of inactivity. On a
 *      point-of-sale terminal a quiet hour is normal trade, not an abandoned
 *      till, so cashiers were signed out mid-shift.
 *
 *   2. A remember-me session was a HARD 24-hour cap that did not slide at all
 *      -- `touchActivity` only ever extended the short kind. A till in active
 *      use was signed out at the 24-hour mark regardless of what its operator
 *      was doing.
 *
 * Both windows are now sliding idle timeouts. These tests pin that down; they
 * fail against the previous behaviour.
 */
describe("SessionRepository — how long a login lasts", () => {
  let db: Database.Database;
  let repo: SessionRepository;

  const SECOND = 1000;

  beforeEach(() => {
    db = new Database(":memory:");
    (globalThis as unknown as { __LIRATEK_TEST_DB__?: unknown })
      .__LIRATEK_TEST_DB__ = db;

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

      INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Test', 'test', 'active');
    `);

    repo = new SessionRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: unknown })
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  /** Milliseconds from now until the stored expiry of `token`. */
  function msUntilExpiry(token: string): number {
    const row = db
      .prepare("SELECT expires_at FROM sessions WHERE token = ?")
      .get(token) as { expires_at: string } | undefined;
    if (!row) throw new Error("session row is gone");
    return new Date(row.expires_at).getTime() - Date.now();
  }

  function create(rememberMe: boolean) {
    return repo.createSession({
      user_id: 7,
      device_type: "web",
      remember_me: rememberMe,
      tenant_id: 5,
    });
  }

  it("gives a session without remember-me a full working day of idle, not half an hour", () => {
    const session = create(false);

    // The number that mattered: 30 minutes was short enough that a slow
    // afternoon logged the cashier out.
    expect(SESSION_DURATION.SHORT).toBe(8 * 60 * 60 * 1000);
    expect(msUntilExpiry(session.token)).toBeGreaterThan(
      SESSION_DURATION.SHORT - 10 * SECOND,
    );
  });

  it("keeps a remember-me session alive while it is being used", () => {
    const session = create(true);

    // Wind the clock forward the hard way: pretend nearly the whole window has
    // already elapsed, leaving an hour. Under the old code `touchActivity`
    // left `expires_at` exactly where it was for a remember-me session, so
    // this hour would simply run out under an actively used till.
    const nearlyGone = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      nearlyGone,
      session.id,
    );

    repo.touchActivity({ ...session, expires_at: nearlyGone });

    // Using it pushed the deadline back out to a full window.
    expect(msUntilExpiry(session.token)).toBeGreaterThan(
      SESSION_DURATION.LONG - 10 * SECOND,
    );
  });

  it("does not sign out a short session that has merely been quiet for a while", () => {
    const session = create(false);

    // 45 minutes since the last request — over the OLD 30-minute inactivity
    // limit, which deleted the row outright, but nothing at all under an
    // 8-hour window. This is the exact complaint: step away from the till,
    // come back, and you have been logged out.
    const quietSince = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    db.prepare("UPDATE sessions SET last_activity_at = ? WHERE id = ?").run(
      quietSince,
      session.id,
    );

    expect(repo.validateSession(session.token)).not.toBeNull();
  });

  it("still ends a session that has genuinely gone past its window", () => {
    const session = create(false);

    const longGone = new Date(Date.now() - 60 * SECOND).toISOString();
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      longGone,
      session.id,
    );

    // Longer windows must not mean immortal sessions.
    expect(repo.validateSession(session.token)).toBeNull();
    expect(
      db.prepare("SELECT id FROM sessions WHERE token = ?").get(session.token),
    ).toBeUndefined();
  });

  it("refuses a session whose tenant is no longer active, whatever its expiry", () => {
    const session = create(true);
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = 5").run();

    // Revocation must not depend on the lifetime numbers above.
    expect(repo.validateSession(session.token)).toBeNull();
    // Rejected, but NOT deleted — re-activating the tenant restores it.
    expect(
      db.prepare("SELECT id FROM sessions WHERE token = ?").get(session.token),
    ).toBeDefined();
  });
});
