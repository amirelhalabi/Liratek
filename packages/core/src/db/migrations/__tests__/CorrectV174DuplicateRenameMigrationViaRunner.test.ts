/**
 * v177 (correct_v174_duplicate_rename) — driven through the REAL migration
 * runner, matching UsernameCaseInsensitiveMigrationViaRunner.test.ts.
 *
 * v174 picked which duplicate username survives using `sessions`, which
 * desktop prunes to empty at every boot (deleteExpiredSessions in
 * electron-app/main.ts). On the owner's real database that blindness cost a
 * total lockout: 'admin' (id 1, the never-used auto-seed) and 'Admin' (id 2,
 * the only account with a password) tied at zero sessions, fell through to
 * lowest-id, and v174 renamed the ONE account anyone could log into.
 *
 * `audit_log` had the answer the whole time — 13 login rows, all for id 2 —
 * and it is never pruned. v177 re-decides v174's renames using that
 * evidence, conservatively: it only ever acts when the swap is either free
 * (no current holder) or backed by strictly better login evidence, and it
 * never touches a claimant with zero login evidence at all.
 */

import Database from "better-sqlite3";
import {
  runMigrations,
  rollbackTo,
  getCurrentVersion,
  MIGRATIONS,
} from "../index";

/**
 * Post-v176 schema: users + audit_log with the real column set v174/v177
 * both read and write, already carrying whatever renames v174 produced.
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
    CREATE UNIQUE INDEX idx_users_tenant_username
      ON users(tenant_id, username COLLATE NOCASE);
    CREATE UNIQUE INDEX idx_users_platform_username
      ON users(username COLLATE NOCASE) WHERE tenant_id IS NULL;

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      token TEXT NOT NULL,
      last_activity_at TEXT
    );

    -- The REAL audit_log column set — v177 both reads login evidence from it
    -- and writes a row per swap, so a stub with fewer columns would pass
    -- while the production insert silently failed.
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
  id: number,
  tenantId: number | null,
  username: string,
  isActive = 1,
): void {
  db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
       VALUES (?, ?, ?, 'h', 'admin', ?)`,
  ).run(id, tenantId, username, isActive);
}

function login(
  db: Database.Database,
  userId: number,
  tenantId: number | null,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO audit_log (tenant_id, user_id, username, role, action, entity_type, summary, created_at)
       VALUES (?, ?, 'x', 'admin', 'login', 'session', 'signed in', ?)`,
  ).run(tenantId, userId, createdAt);
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

describe("v177 correct_v174_duplicate_rename — via the real migration runner", () => {
  it("applies and reaches version 177", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin");
    insertUser(db, 2, 1, "Admin.dup-2");
    login(db, 2, 1, "2026-09-01T00:00:00Z");
    markAppliedExcept(db, 177);

    runMigrations(db);
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(177);
    db.close();
  });

  // ── 1. The owner's exact shape ─────────────────────────────────────────
  describe("the owner's exact shape (rule 17)", () => {
    function buildOwnerShape(): Database.Database {
      const db = new Database(":memory:");
      createSchema(db);
      // v174 already ran and got it wrong: kept the never-used auto-seed
      // (id 1) and renamed the only account with a password (id 2).
      insertUser(db, 1, 1, "admin");
      insertUser(db, 2, 1, "Admin.dup-2");
      // sessions empty — the exact condition that made v174 blind.
      // 13 real logins, all for id 2, none for id 1.
      for (let i = 0; i < 13; i++) {
        login(db, 2, 1, `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`);
      }
      return db;
    }

    it("rule 17: the target assertion genuinely fails on the pre-fix code", () => {
      // This guard only counts once shown to fail against the pre-fix
      // world. There is no "run migrations up to N-1" knob in this runner,
      // so the pre-fix world is replayed by neutering v177's up() at
      // RUNTIME (source untouched) and restoring it in `finally` — verified
      // by hand to produce exactly:
      //   expect(received).toBe(expected)
      //   Expected: "Admin"
      //   Received: "Admin.dup-2"
      // which is why the real assertion below is the fix's target, not its
      // negation — this test documents that the failure was observed, it
      // does not re-fail on every run.
      const v177 = MIGRATIONS.find((m) => m.version === 177);
      expect(v177).toBeDefined();
      const originalUp = v177!.up;
      v177!.up = () => {};

      const db = buildOwnerShape();
      markAppliedExcept(db, 177);
      runMigrations(db);

      try {
        expect(nameOf(db, 2)).toBe("Admin.dup-2"); // the pre-fix bug, confirmed live
      } finally {
        v177!.up = originalUp;
        db.close();
      }
    });

    it("restores the real account and demotes the never-used seed", () => {
      const db = buildOwnerShape();
      markAppliedExcept(db, 177);

      runMigrations(db);

      // id 2 gets its real name back...
      expect(nameOf(db, 2)).toBe("Admin");
      // ...and id 1 (zero logins) is demoted under ITS OWN prior spelling.
      expect(nameOf(db, 1)).toBe("admin.dup-1");
      // Neither account is disabled — v174's current form never disables,
      // and v177 must not start doing it either.
      expect(activeOf(db, 1)).toBe(1);
      expect(activeOf(db, 2)).toBe(1);
      db.close();
    });
  });

  // ── 2. No evidence → no action ─────────────────────────────────────────
  it("does nothing when audit_log has no login rows at all", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin");
    insertUser(db, 2, 1, "Admin.dup-2");
    // No logins for anyone.
    markAppliedExcept(db, 177);

    runMigrations(db);

    expect(nameOf(db, 1)).toBe("admin");
    expect(nameOf(db, 2)).toBe("Admin.dup-2");
    db.close();
  });

  // ── 3. v174 chose RIGHT → no action ────────────────────────────────────
  it("does nothing when the current holder has the newer login", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin"); // holder — v174 correctly kept this one
    insertUser(db, 2, 1, "Admin.dup-2"); // claimant — weaker evidence
    login(db, 1, 1, "2026-09-10T00:00:00Z"); // holder: newer
    login(db, 2, 1, "2026-09-01T00:00:00Z"); // claimant: older
    markAppliedExcept(db, 177);

    runMigrations(db);

    expect(nameOf(db, 1)).toBe("admin");
    expect(nameOf(db, 2)).toBe("Admin.dup-2");
    db.close();
  });

  // ── 4. Free name ────────────────────────────────────────────────────────
  it("restores a claimant when the original name is free (no current holder)", () => {
    const db = new Database(":memory:");
    createSchema(db);
    // No row named 'root' exists any more — maybe the holder was deleted, or
    // never existed under this schema's fixture. Restoring is a pure win.
    insertUser(db, 5, 1, "root.dup-5");
    markAppliedExcept(db, 177);

    runMigrations(db);

    expect(nameOf(db, 5)).toBe("root");
    db.close();
  });

  // ── 5. Two real people — must not churn ────────────────────────────────
  it("leaves two real people alone when the holder's evidence is still better", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 10, 1, "Ali"); // holder
    insertUser(db, 11, 1, "ali.dup-11"); // claimant
    login(db, 10, 1, "2026-09-12T00:00:00Z"); // holder: more recent
    login(db, 11, 1, "2026-09-05T00:00:00Z"); // claimant: older
    markAppliedExcept(db, 177);

    runMigrations(db);

    expect(nameOf(db, 10)).toBe("Ali");
    expect(nameOf(db, 11)).toBe("ali.dup-11");
    db.close();
  });

  // ── 6. Realm isolation ──────────────────────────────────────────────────
  it("resolves each tenant's admin/Admin pair independently", () => {
    const db = new Database(":memory:");
    createSchema(db);
    // Tenant 1: same shape as the owner's — claimant should win.
    insertUser(db, 1, 1, "admin");
    insertUser(db, 2, 1, "Admin.dup-2");
    login(db, 2, 1, "2026-09-01T00:00:00Z");
    // Tenant 2: mirror shape, but the HOLDER has the evidence — must not win.
    insertUser(db, 3, 2, "admin");
    insertUser(db, 4, 2, "Admin.dup-4");
    login(db, 3, 2, "2026-09-01T00:00:00Z");
    markAppliedExcept(db, 177);

    runMigrations(db);

    // Tenant 1: swapped.
    expect(nameOf(db, 2)).toBe("Admin");
    expect(nameOf(db, 1)).toBe("admin.dup-1");
    // Tenant 2: untouched — the two tenants never cross.
    expect(nameOf(db, 3)).toBe("admin");
    expect(nameOf(db, 4)).toBe("Admin.dup-4");
    db.close();
  });

  // ── coordinator finding 1 — inactive claimant must never be restored ──────
  //
  // findByUsername/findByUsernameInRealm (UserRepository) both filter
  // `AND is_active = 1`. If a disabled claimant won its name back, the
  // holder's spelling would be freed onto a row nobody can log into —
  // locking out BOTH spellings, which is strictly worse than v174's blind
  // (but at least reachable) guess.
  it("never restores a claimant that would come back INACTIVE", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin", 1); // holder — active, no logins
    insertUser(db, 2, 1, "Admin.dup-2", 0); // claimant — INACTIVE, strong evidence
    for (let i = 0; i < 5; i++) {
      login(db, 2, 1, `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`);
    }
    markAppliedExcept(db, 177);

    runMigrations(db);

    // Untouched on both sides — the gate skips the group before it ever
    // looks at login evidence.
    expect(nameOf(db, 1)).toBe("admin");
    expect(nameOf(db, 2)).toBe("Admin.dup-2");
    expect(activeOf(db, 1)).toBe(1);
    expect(activeOf(db, 2)).toBe(0);
    db.close();
  });

  it("still restores AND reactivates an inactive '.retired-' claimant (the gate's declared exception)", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin", 1); // holder — active, no logins
    // The early form: v174's first shipped version renamed to '.retired-'
    // AND disabled the row. Its CURRENT is_active is v174's own artifact,
    // not a signal an admin chose — so it must NOT be caught by the
    // inactive-claimant gate above.
    insertUser(db, 2, 1, "Admin.retired-2", 0);
    for (let i = 0; i < 5; i++) {
      login(db, 2, 1, `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`);
    }
    markAppliedExcept(db, 177);

    runMigrations(db);

    expect(nameOf(db, 2)).toBe("Admin");
    expect(activeOf(db, 2)).toBe(1); // reactivated
    expect(nameOf(db, 1)).toBe("admin.dup-1");
    expect(activeOf(db, 1)).toBe(1); // holder was already active — untouched
    db.close();
  });

  // ── coordinator finding 2 — a group must never be able to throw ───────────
  //
  // runMigrations wraps migration.up() in a transaction whose catch
  // RETHROWS with no outer recovery — an uncaught error here aborts the
  // ENTIRE migration batch, not just one group, i.e. every till fails to
  // boot. A NOCASE collision on the holder's final '<name>.dup-<id>' spot
  // is rare but not impossible; this proves it degrades to "skip this
  // group" instead.
  it("survives a collision on the holder's target name without throwing, and still processes the next group", () => {
    const db = new Database(":memory:");
    createSchema(db);

    // Group A (tenant 1): the owner's shape, PLUS a bystander row already
    // sitting on the exact name the holder would be demoted to.
    insertUser(db, 1, 1, "admin"); // holder
    insertUser(db, 2, 1, "Admin.dup-2"); // claimant — strong evidence
    insertUser(db, 99, 1, "admin.dup-1"); // occupies the holder's landing spot
    for (let i = 0; i < 5; i++) {
      login(db, 2, 1, `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`);
    }

    // Group B (tenant 2): unrelated free-name restore that must still
    // succeed even though group A blew up first.
    insertUser(db, 20, 2, "root.dup-20");

    markAppliedExcept(db, 177);

    expect(() => runMigrations(db)).not.toThrow();

    // Group A left EXACTLY as v174 left it — both renames unwound, and the
    // bystander untouched.
    expect(nameOf(db, 1)).toBe("admin");
    expect(nameOf(db, 2)).toBe("Admin.dup-2");
    expect(nameOf(db, 99)).toBe("admin.dup-1");
    // The holder must not be stranded under the throwaway name.
    const allTenant1Names = new Set(
      (
        db
          .prepare(`SELECT username FROM users WHERE tenant_id = 1`)
          .all() as { username: string }[]
      ).map((r) => r.username),
    );
    expect([...allTenant1Names].some((n) => n.endsWith(".v177tmp"))).toBe(
      false,
    );

    // Group B: unaffected by group A's failure.
    expect(nameOf(db, 20)).toBe("root");

    db.close();
  });

  // ── 7. No audit_log table → clean no-op ────────────────────────────────
  it("is a clean no-op when there is no audit_log table at all", () => {
    const db = new Database(":memory:");
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
      CREATE UNIQUE INDEX idx_users_tenant_username
        ON users(tenant_id, username COLLATE NOCASE);
      CREATE UNIQUE INDEX idx_users_platform_username
        ON users(username COLLATE NOCASE) WHERE tenant_id IS NULL;
      INSERT INTO tenants (id, name, slug, status) VALUES (1, 'CornerTech', 'cornertech', 'active');
    `);
    insertUser(db, 1, 1, "admin");
    insertUser(db, 2, 1, "Admin.dup-2");
    markAppliedExcept(db, 177);

    expect(() => runMigrations(db)).not.toThrow();
    expect(getCurrentVersion(db)).toBeGreaterThanOrEqual(177);
    // No evidence source at all — v174's rename is left exactly as found.
    expect(nameOf(db, 1)).toBe("admin");
    expect(nameOf(db, 2)).toBe("Admin.dup-2");
    db.close();
  });

  // ── rollback ────────────────────────────────────────────────────────────
  it("rolls back as a logged no-op — v174's own down() already undoes it", () => {
    const db = new Database(":memory:");
    createSchema(db);
    insertUser(db, 1, 1, "admin");
    insertUser(db, 2, 1, "Admin.dup-2");
    login(db, 2, 1, "2026-09-01T00:00:00Z");
    markAppliedExcept(db, 177);

    runMigrations(db);
    expect(nameOf(db, 2)).toBe("Admin");
    expect(nameOf(db, 1)).toBe("admin.dup-1");

    // Rolling back v177 alone must not change anything by itself...
    rollbackTo(db, 176);
    expect(nameOf(db, 2)).toBe("Admin");
    expect(nameOf(db, 1)).toBe("admin.dup-1");

    // ...but rolling back v174 too (its own down() strips '.dup-<id>')
    // restores the pre-v174 state, exactly as the pair before it did.
    rollbackTo(db, 173);
    expect(nameOf(db, 1)).toBe("admin");
    expect(activeOf(db, 1)).toBe(1);
    db.close();
  });
});
