import Database from "better-sqlite3";
import { TenantRepository } from "../TenantRepository.js";

/**
 * The control-plane tenant list, and what "last activity" means on it.
 *
 * It used to mean the newest `transactions.created_at` and nothing else, so a
 * shop whose staff signed in daily but had not yet rung up a sale showed a
 * bare dash — indistinguishable, to a super admin, from a shop nobody had ever
 * opened. Reported exactly that way: "I logged into both tenants, both
 * working, but last activity is not updated for test".
 *
 * It now takes the latest of transactions, live sessions and the durable audit
 * log. The trap that makes this worth testing is that those three columns do
 * NOT share a timestamp format, and `MAX()` over raw text compares strings.
 */
describe("TenantRepository.listAll — last activity", () => {
  let db: Database.Database;
  let repo: TenantRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        contact_name TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        username TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        last_activity_at TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO tenants (id, name, slug) VALUES (1, 'CornerTech', 'cornertech');
      INSERT INTO tenants (id, name, slug) VALUES (5, 'Test', 'test');
    `);
    repo = new TenantRepository(db);
  });

  afterEach(() => db.close());

  /** The row for a tenant id, from a fresh listAll(). */
  function row(tenantId: number) {
    const found = repo.listAll().find((t) => t.id === tenantId);
    if (!found) throw new Error(`no row for tenant ${tenantId}`);
    return found;
  }

  // Production formats, verified against the live database. They differ, and
  // that is the whole point of the normalisation being tested here.
  const SQLITE_FORM = "2026-09-09 18:51:45"; // transactions, audit_log
  const JS_ISO_FORM = "2026-09-10T00:45:43.133Z"; // sessions

  it("reports a tenant that has only ever signed in — the reported bug", () => {
    // No transactions at all, just a login. This is the Test tenant, and it
    // showed a dash.
    db.prepare(
      "INSERT INTO audit_log (tenant_id, action, created_at) VALUES (5, 'login', ?)",
    ).run("2026-09-10 00:45:30");

    expect(row(5).last_activity).toBe("2026-09-10 00:45:30");
  });

  it("counts a live session as activity", () => {
    db.prepare(
      "INSERT INTO sessions (tenant_id, last_activity_at) VALUES (5, ?)",
    ).run(JS_ISO_FORM);

    // Normalised out of the JS ISO form into the canonical SQLite one.
    expect(row(5).last_activity).toBe("2026-09-10 00:45:43");
  });

  it("compares the three sources as TIMES, not as strings", () => {
    // The trap, isolated. Raw MAX() would pick the session value because 'T'
    // sorts above ' ' — even though the transaction is 22 hours later on the
    // same day. Only datetime() normalisation gets this right.
    db.prepare(
      "INSERT INTO sessions (tenant_id, last_activity_at) VALUES (1, ?)",
    ).run("2026-09-10T00:45:43.133Z");
    db.prepare(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, ?)",
    ).run("2026-09-10 23:00:00");

    expect(row(1).last_activity).toBe("2026-09-10 23:00:00");
  });

  it("still reports trade when that is the most recent thing", () => {
    db.prepare(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, ?)",
    ).run(SQLITE_FORM);
    db.prepare(
      "INSERT INTO audit_log (tenant_id, action, created_at) VALUES (1, 'login', ?)",
    ).run("2026-09-01 08:00:00");

    expect(row(1).last_activity).toBe(SQLITE_FORM);
  });

  it("reports nothing for a tenant with no activity anywhere", () => {
    // A genuinely untouched tenant must still be distinguishable — this is the
    // NULLIF half: MAX() over three COALESCEd empties is '', not NULL.
    expect(row(5).last_activity).toBeNull();
  });

  it("never leaks one tenant's activity into another's row", () => {
    db.prepare(
      "INSERT INTO transactions (tenant_id, created_at) VALUES (1, ?)",
    ).run("2026-09-10 23:00:00");

    expect(row(1).last_activity).toBe("2026-09-10 23:00:00");
    expect(row(5).last_activity).toBeNull();
  });

  it("ignores an unparseable timestamp rather than letting it win", () => {
    // datetime() yields NULL for junk; COALESCE turns that into '', which
    // loses to every real value. A bad row must not become "the latest".
    db.prepare(
      "INSERT INTO sessions (tenant_id, last_activity_at) VALUES (5, 'not-a-date')",
    ).run();
    db.prepare(
      "INSERT INTO audit_log (tenant_id, action, created_at) VALUES (5, 'login', ?)",
    ).run("2026-09-10 00:45:30");

    expect(row(5).last_activity).toBe("2026-09-10 00:45:30");
  });

  it("still counts only ACTIVE users, unchanged by any of this", () => {
    db.prepare(
      "INSERT INTO users (tenant_id, username, is_active) VALUES (1, 'a', 1), (1, 'b', 0), (5, 'c', 1)",
    ).run();

    expect(row(1).user_count).toBe(1);
    expect(row(5).user_count).toBe(1);
  });
});
