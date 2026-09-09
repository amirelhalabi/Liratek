/**
 * v174 (username_case_insensitive) — driven through the REAL migration runner,
 * matching PerTenantUsernamesMigrationViaRunner.test.ts.
 *
 * The bug this closes was found in the live database: tenant 1 held both
 * 'admin' and 'Admin' as separate accounts with separate passwords. To anyone
 * reading a user list or an audit trail they are one name.
 *
 * Two properties matter and the tests below pin both:
 *
 *   1. Uniqueness folds case AFTER the migration, and demonstrably did NOT
 *      before it (rule 17 — the guard has to fail against the old schema, and
 *      here the "old behaviour" is asserted directly rather than by reverting
 *      code).
 *
 *   2. The existing duplicate is RENAMED, never deleted. `users` is the FK
 *      target of 22 tables, mostly NO ACTION and including financial ones, so
 *      a DELETE would either fail or strand history. The loser must keep its
 *      id and every inbound row.
 */

import Database from "better-sqlite3";
import {
  runMigrations,
  rollbackTo,
  getCurrentVersion,
  MIGRATIONS,
} from "../index";

/**
 * Post-v172, pre-v174 schema: the two tenant-scoped unique indexes in their
 * case-SENSITIVE form, plus two inbound FK holders so the rename has
 * references that must survive it.
 */
function createSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_users_tenant_username ON users(tenant_id, username);
    CREATE UNIQUE INDEX idx_users_platform_username
      ON users(username) WHERE tenant_id IS NULL;

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      token TEXT NOT NULL,
      last_activity_at TEXT
    );
    -- The REAL audit_log column set, not a stub: v174 writes a row per rename,
    -- and a fixture with fewer columns would pass while the production insert
    -- silently failed.
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'CornerTech', 'cornertech', 'active');
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'OtherShop', 'othershop', 'active');

    -- The real-world pair. id 2 is the account actually in use: more sessions,
    -- and the one whose password the owner still had. The survivor rule must
    -- pick it, NOT the lower id.
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (1, 1, 'admin', 'hash-lower', 'admin', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (2, 1, 'Admin', 'hash-upper', 'admin', 1);
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (3, 2, 'admin', 'hash-other', 'admin', 1);

    INSERT INTO sessions (user_id, token, last_activity_at) VALUES (1, 'tok-a', '2026-01-01T00:00:00Z');
    INSERT INTO sessions (user_id, token, last_activity_at) VALUES (2, 'tok-b', '2026-09-01T00:00:00Z');
    INSERT INTO sessions (user_id, token, last_activity_at) VALUES (2, 'tok-c', '2026-09-02T00:00:00Z');
    INSERT INTO sessions (user_id, token, last_activity_at) VALUES (2, 'tok-d', '2026-09-03T00:00:00Z');

    -- Inbound rows on the LOSER, standing in for the financial FKs.
    INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary)
      VALUES (1, 1, 'admin', 'admin', 'login', 'session', 'signed in');
    INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary)
      VALUES (1, 1, 'admin', 'admin', 'create', 'sale', 'sold something');
  `);
}

function markAppliedExcept(
  db: Database.Database,
  ...exceptVersions: number[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const m of MIGRATIONS) {
    if (!exceptVersions.includes(m.version)) {
      insert.run(m.version, m.name);
    }
  }
}

function insertUser(
  db: Database.Database,
  tenantId: number | null,
  username: string,
): void {
  db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (?, ?, 'h', 'admin', 1)`,
  ).run(tenantId, username);
}

function nameOf(db: Database.Database, id: number): string | undefined {
  return (
    db.prepare(`SELECT username FROM users WHERE id = ?`).get(id) as
      | { username: string }
      | undefined
  )?.username;
}

function activeOf(db: Database.Database, id: number): number | undefined {
  return (
    db.prepare(`SELECT is_active FROM users WHERE id = ?`).get(id) as
      | { is_active: number }
      | undefined
  )?.is_active;
}

describe("v174 username_case_insensitive — via the real migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    markAppliedExcept(db, 174);
  });

  afterEach(() => db.close());

  it("applies and reaches version 174", () => {
    runMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(174);
  });

  it("the OLD schema really did allow 'admin' and 'Admin' side by side", () => {
    // Rule 17, stated as data rather than by reverting code: the fixture
    // inserted both without error, and a third casing is still accepted.
    // If this ever fails, the migration is guarding something already fixed.
    expect(() => insertUser(db, 1, "ADMIN")).not.toThrow();
  });

  it("folds case for uniqueness after the migration", () => {
    runMigrations(db);
    expect(() => insertUser(db, 1, "ADMIN")).toThrow(/UNIQUE/i);
    expect(() => insertUser(db, 1, "aDmIn")).toThrow(/UNIQUE/i);
  });

  it("still lets two DIFFERENT tenants each have an 'admin' (v172 preserved)", () => {
    runMigrations(db);
    // Tenant 2 already has one; a third tenant must still be able to.
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status) VALUES (3, 'Third', 'third', 'active')`,
    ).run();
    expect(() => insertUser(db, 3, "Admin")).not.toThrow();
  });

  it("keeps the account people actually use, not the lowest id", () => {
    runMigrations(db);
    // id 2 ('Admin') has 3 sessions to id 1's 1, so it survives untouched.
    expect(nameOf(db, 2)).toBe("Admin");
    expect(activeOf(db, 2)).toBe(1);
  });

  it("renames the loser WITHOUT disabling it, instead of deleting it", () => {
    runMigrations(db);

    // Still there, same id — deleting would have hit 22 NO ACTION foreign
    // keys, including financial ones.
    expect(nameOf(db, 1)).toBe("admin.dup-1");

    // And still ENABLED. An earlier version set is_active = 0 here; on desktop
    // a case-duplicate is often two real PEOPLE, and disabling one stops
    // someone working. Renaming alone already frees the folded name.
    expect(activeOf(db, 1)).toBe(1);

    // Its inbound rows still resolve to a real user row.
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log a
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)`,
      )
      .get() as { c: number };
    expect(orphans.c).toBe(0);
  });

  it("the renamed account can still be found under its NEW name", () => {
    runMigrations(db);
    // The practical consequence of not disabling it: the owner can still reach
    // the account and rename it back if the migration guessed wrong.
    const row = db
      .prepare(
        `SELECT id, is_active FROM users WHERE username = 'admin.dup-1' AND is_active = 1`,
      )
      .get() as { id: number } | undefined;
    expect(row?.id).toBe(1);
  });

  it("records each rename in audit_log, not just the console", () => {
    runMigrations(db);
    const row = db
      .prepare(
        `SELECT username, summary FROM audit_log
          WHERE entity_type = 'user' AND summary LIKE 'Migration v174%'`,
      )
      .get() as { username: string; summary: string } | undefined;

    // Without this a staff member whose name changed has no way to find out
    // why — the previous only trace was a log line nobody reads.
    expect(row).toBeDefined();
    expect(row!.username).toBe("admin.dup-1");
    expect(row!.summary).toContain("same name ignoring case");
  });

  it("leaves a tenant with no duplicates completely untouched", () => {
    runMigrations(db);
    expect(nameOf(db, 3)).toBe("admin");
  });

  it("folds case in the PLATFORM realm too", () => {
    insertUser(db, null, "root");
    insertUser(db, null, "ROOT"); // allowed by the old case-sensitive index
    runMigrations(db);

    // One survives under its own name, the other is retired — and no third
    // casing can be added afterwards.
    expect(() => insertUser(db, null, "Root")).toThrow(/UNIQUE/i);
  });

  // ── the shape found on the owner's REAL desktop database ──────────────────
  //
  // Desktop prunes sessions at boot (deleteExpiredSessions in
  // electron-app/main.ts), so two long-standing accounts can BOTH report zero.
  // Ranking on session count alone is blind here and silently falls through to
  // "lowest id", i.e. oldest — which on the web database would have retired the
  // one account whose password the owner still had.
  describe("no session evidence at all (the desktop case)", () => {
    let d: Database.Database;

    beforeEach(() => {
      d = new Database(":memory:");
      createSchema(d);
      // Exactly what the real desktop file looks like: both active, no sessions.
      d.exec(`DELETE FROM sessions`);
      markAppliedExcept(d, 174);
    });

    afterEach(() => d.close());

    it("still renames exactly one of them, and disables NEITHER", () => {
      runMigrations(d);

      const names = [nameOf(d, 1), nameOf(d, 2)];
      const renamed = names.filter((n) => n && n.includes(".dup-"));
      expect(renamed).toHaveLength(1);

      // The point of the change: with no evidence to choose on, a wrong guess
      // must stay recoverable. Both accounts remain usable.
      expect(activeOf(d, 1)).toBe(1);
      expect(activeOf(d, 2)).toBe(1);
    });

    it("prefers an ENABLED account over a disabled one", () => {
      // Give the migration one piece of evidence: id 2 is already disabled, so
      // the enabled id 1 must survive even though it is the lower id and both
      // have no sessions.
      d.prepare(`UPDATE users SET is_active = 0 WHERE id = 2`).run();
      runMigrations(d);

      expect(nameOf(d, 1)).toBe("admin");
      expect(nameOf(d, 2)).toBe("Admin.dup-2");
    });
  });

  it("rolls back: names restored and case-sensitivity returns", () => {
    runMigrations(db);
    expect(nameOf(db, 1)).toBe("admin.dup-1");

    rollbackTo(db, 173);

    expect(nameOf(db, 1)).toBe("admin");
    expect(activeOf(db, 1)).toBe(1);
    // Case-sensitive again, so a differing casing is accepted once more.
    expect(() => insertUser(db, 1, "ADMIN")).not.toThrow();
  });

  it("rollback also undoes the EARLIER '.retired-' form, reactivating it", () => {
    // One database in the wild applied the first version of this migration,
    // which renamed to '.retired-<id>' AND set is_active = 0. Rollback has to
    // handle that shape too, or a "successful" rollback silently leaves that
    // account renamed and disabled.
    runMigrations(db);
    db.prepare(
      `UPDATE users SET username = 'admin.retired-1', is_active = 0 WHERE id = 1`,
    ).run();

    rollbackTo(db, 173);

    expect(nameOf(db, 1)).toBe("admin");
    expect(activeOf(db, 1)).toBe(1);
  });
});
