/**
 * LIRA-331 T008: UserRepository — `users.language` (v220), tenant-scoped,
 * on the real schema (create_db.sql + every migration).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserRepository } from "../UserRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

let db: Database.Database;
let repo: UserRepository;

function rawLanguage(id: number): string | null {
  return (
    db.prepare(`SELECT language FROM users WHERE id = ?`).get(id) as {
      language: string | null;
    }
  ).language;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO tenants (id, name, slug) VALUES (3, 'Three', 'three');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', 'h', 'admin', 1),
      (30, 3, 'other', 'h', 'admin', 1);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new UserRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("UserRepository language (LIRA-331)", () => {
  it("a user who never chose reads null", () => {
    runWithTenant(2, () => expect(repo.getLanguage(20)).toBeNull());
  });

  it("setLanguage stores the choice and getLanguage reads it back", () => {
    runWithTenant(2, () => {
      expect(repo.setLanguage(20, "ar")).toBe(true);
      expect(repo.getLanguage(20)).toBe("ar");
      expect(repo.setLanguage(20, "en")).toBe(true);
      expect(repo.getLanguage(20)).toBe("en");
    });
  });

  it("is current-shop only: another shop's user is untouched and unreadable", () => {
    runWithTenant(2, () => {
      expect(repo.setLanguage(30, "ar")).toBe(false);
      expect(repo.getLanguage(30)).toBeNull();
    });
    expect(rawLanguage(30)).toBeNull();
  });
});
