/**
 * UserIdentityRepository (v196, LIRA-280) — Google sign-in links.
 *
 * One Google account (`subject`) may be linked in several shops but to one
 * user per shop; one user has at most one Google link.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserIdentityRepository } from "../UserIdentityRepository.js";
import { IDENTITY_ALREADY_LINKED } from "../../utils/errors.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";

let db: Database.Database;
let repo: UserIdentityRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two'), (3, 'Three', 'three');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', '', 'admin', 1),
      (21, 2, 'cashier', '', 'staff', 1),
      (30, 3, 'boss3', '', 'admin', 1),
      (31, 3, 'old', '', 'admin', 0);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new UserIdentityRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function link(tenantId: number, userId: number, subject = "sub-1") {
  return runWithTenant(tenantId, () =>
    repo.link({
      userId,
      provider: "google",
      subject,
      email: "Owner@Gmail.com",
      now: T0,
    }),
  );
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("UserIdentityRepository", () => {
  it("links a Google account to a user of the current shop", () => {
    const row = link(2, 20);
    expect(row.tenant_id).toBe(2);
    expect(row.email).toBe("owner@gmail.com");
    expect(row.created_at).toBe(T0);
    runWithTenant(2, () => {
      expect(repo.findByUser(20, "google")?.subject).toBe("sub-1");
    });
  });

  it("one Google account may be linked in several shops", () => {
    link(2, 20);
    link(3, 30);
    const matches = repo.findBySubjectAllTenants("google", "sub-1");
    expect(matches.map((m) => [m.tenant_id, m.user_id])).toEqual([
      [2, 20],
      [3, 30],
    ]);
  });

  it("refuses a second user in the SAME shop, and a second Google link on one user, with IDENTITY_ALREADY_LINKED", () => {
    link(2, 20);
    expect(codeOf(() => link(2, 21))).toBe(IDENTITY_ALREADY_LINKED);
    expect(codeOf(() => link(2, 20, "sub-2"))).toBe(IDENTITY_ALREADY_LINKED);
  });

  it("refuses to link a user of another shop", () => {
    expect(codeOf(() => link(2, 30))).toBeDefined();
  });

  it("by-subject lookups skip deactivated users", () => {
    db.exec(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES (31, 3, 'google', 'sub-x')`,
    );
    expect(repo.findBySubjectAllTenants("google", "sub-x")).toEqual([]);
    expect(repo.findBySubjectInTenant("google", "sub-x", 3)).toBeNull();
  });

  it("findBySubjectInTenant looks in the given shop only", () => {
    link(2, 20);
    expect(repo.findBySubjectInTenant("google", "sub-1", 2)?.user_id).toBe(20);
    expect(repo.findBySubjectInTenant("google", "sub-1", 3)).toBeNull();
  });

  it("unlink() removes the current shop's link only", () => {
    link(2, 20);
    runWithTenant(3, () => {
      expect(repo.unlink(20, "google")).toBe(false);
    });
    runWithTenant(2, () => {
      expect(repo.unlink(20, "google")).toBe(true);
      expect(repo.findByUser(20, "google")).toBeNull();
    });
  });

  it("deleting the user removes the link (ON DELETE CASCADE)", () => {
    link(2, 21);
    db.exec(`DELETE FROM users WHERE id = 21`);
    expect(repo.findBySubjectAllTenants("google", "sub-1")).toEqual([]);
  });
});
