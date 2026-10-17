/**
 * LIRA-331 T007: `users.language` — a user's own UI language. NULL means
 * "use the shop default"; only 'en' / 'ar' are allowed.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function findLanguageMigration() {
  const migration = MIGRATIONS.find((m) => m.name === "users_language");
  if (!migration) throw new Error("Migration users_language not found");
  if (!migration.down) throw new Error("Migration users_language has no down()");
  return migration as Required<typeof migration>;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY);
    INSERT INTO tenants (id) VALUES (1);
    -- Pre-migration shape (the v202 users table).
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      username TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1, email TEXT DEFAULT NULL, email_verified_at TEXT DEFAULT NULL,
      has_password INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO users (id, tenant_id, username, role) VALUES (1, 1, 'admin', 'admin');
  `);
  return db;
}

function columns(db: Database.Database): string[] {
  return (db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

describe("users_language migration", () => {
  it("comes after v219, the last migration when it was written", () => {
    expect(findLanguageMigration().version).toBeGreaterThan(219);
  });

  it("adds a nullable users.language; existing users read NULL", () => {
    const db = createTestDb();
    findLanguageMigration().up(db);
    expect(columns(db)).toContain("language");
    const row = db.prepare(`SELECT language FROM users WHERE id = 1`).get() as {
      language: string | null;
    };
    expect(row.language).toBeNull();
  });

  it("accepts NULL, 'en' and 'ar', and rejects anything else", () => {
    const db = createTestDb();
    findLanguageMigration().up(db);
    const set = db.prepare(`UPDATE users SET language = ? WHERE id = 1`);
    expect(() => set.run("ar")).not.toThrow();
    expect(() => set.run("en")).not.toThrow();
    expect(() => set.run(null)).not.toThrow();
    expect(() => set.run("fr")).toThrow(/CHECK/);
  });

  it("down() removes the column", () => {
    const db = createTestDb();
    const migration = findLanguageMigration();
    migration.up(db);
    migration.down(db);
    expect(columns(db)).not.toContain("language");
  });
});
