/**
 * UserRepository — `users.has_password` (v202, LIRA-291).
 *
 * `createUser` writes 1 unless told `has_password: false` (only Join with
 * Google does that). `updatePassword` — the ONE shared password writer — sets
 * it back to 1 in the same statement as the hash, so every password path
 * (reset link, admin Set Password, change password, set-initial) marks it.
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

function rawFlag(id: number): number {
  return (
    db.prepare(`SELECT has_password FROM users WHERE id = ?`).get(id) as {
      has_password: number;
    }
  ).has_password;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', 'h', 'admin', 1);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new UserRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("UserRepository has_password (LIRA-291)", () => {
  it("createUser defaults to has_password = 1", () => {
    const u = repo.createUser({
      username: "pw",
      password_hash: "h",
      role: "staff",
      tenant_id: 2,
    });
    expect(rawFlag(u.id)).toBe(1);
  });

  it("createUser writes has_password = 0 when told false", () => {
    const u = repo.createUser({
      username: "googleonly",
      password_hash: "h",
      role: "staff",
      tenant_id: 2,
      has_password: false,
    });
    expect(rawFlag(u.id)).toBe(0);
  });

  it("updatePassword sets has_password back to 1 with the hash", () => {
    const u = repo.createUser({
      username: "googleonly",
      password_hash: "h",
      role: "staff",
      tenant_id: 2,
      has_password: false,
    });
    runWithTenant(2, () => {
      expect(repo.hasPassword(u.id)).toBe(false);
      expect(repo.updatePassword(u.id, "new-hash")).toBe(true);
      expect(repo.hasPassword(u.id)).toBe(true);
    });
    expect(rawFlag(u.id)).toBe(1);
  });

  it("hasPassword is current-shop only (false for another shop's user)", () => {
    db.exec(`UPDATE users SET has_password = 1 WHERE id = 20`);
    runWithTenant(2, () => expect(repo.hasPassword(20)).toBe(true));
    runWithTenant(1, () => expect(repo.hasPassword(20)).toBe(false));
  });

  it("listEmails selects has_password as a 0/1 flag", () => {
    const u = repo.createUser({
      username: "googleonly",
      password_hash: "h",
      role: "staff",
      tenant_id: 2,
      has_password: false,
    });
    runWithTenant(2, () => {
      const rows = repo.listEmails();
      expect(rows.find((r) => r.id === 20)?.has_password).toBe(1);
      expect(rows.find((r) => r.id === u.id)?.has_password).toBe(0);
    });
  });
});
