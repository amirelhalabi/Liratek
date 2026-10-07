/**
 * UserRepository — account email (v196, LIRA-279).
 *
 * Real in-memory database (create_db.sql + runMigrations) so the per-shop
 * unique index is the real one. Emails are normalised (trimmed, lowercased)
 * inside the repository because provisioning bypasses the zod schemas.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserRepository } from "../UserRepository.js";
import { EMAIL_TAKEN_IN_SHOP } from "../../utils/errors.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";

let db: Database.Database;
let repo: UserRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', '', 'admin', 1),
      (21, 2, 'cashier', '', 'staff', 1),
      (22, 2, 'gone', '', 'staff', 0);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new UserRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

describe("UserRepository account email", () => {
  it("setEmail stores the address normalised, with its verified stamp", () => {
    runWithTenant(2, () => {
      expect(repo.setEmail(20, "  Boss@Example.COM ", T0)).toBe(true);
      expect(repo.getEmail(20)).toEqual({
        email: "boss@example.com",
        email_verified_at: T0,
      });
      // Clearing it clears the stamp too.
      expect(repo.setEmail(20, null, null)).toBe(true);
      expect(repo.getEmail(20)).toEqual({
        email: null,
        email_verified_at: null,
      });
    });
  });

  it("setEmail cannot reach another shop's user", () => {
    runWithTenant(1, () => {
      expect(repo.setEmail(20, "x@example.com", null)).toBe(false);
      expect(repo.getEmail(20)).toBeNull();
    });
  });

  it("refuses an address another user in the same shop holds, with EMAIL_TAKEN_IN_SHOP", () => {
    runWithTenant(2, () => {
      repo.setEmail(20, "same@example.com", null);
      let caught: unknown;
      try {
        repo.setEmail(21, "SAME@example.com", null);
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string }).code).toBe(EMAIL_TAKEN_IN_SHOP);
    });
    // ...but the same address in another shop is fine.
    runWithTenant(1, () => {
      expect(repo.setEmail(1, "same@example.com", null)).toBe(true);
    });
  });

  it("findByEmailInTenant matches case-insensitively, active users only, in the given shop only", () => {
    runWithTenant(2, () => {
      repo.setEmail(20, "boss@example.com", T0);
      repo.setEmail(22, "gone@example.com", T0);
    });
    const found = repo.findByEmailInTenant(" BOSS@example.com", 2);
    expect(found?.id).toBe(20);
    expect(found?.email).toBe("boss@example.com");
    expect(found?.email_verified_at).toBe(T0);
    expect(repo.findByEmailInTenant("boss@example.com", 1)).toBeNull();
    expect(repo.findByEmailInTenant("gone@example.com", 2)).toBeNull();
  });

  it("markEmailVerified only verifies the address the link was sent to", () => {
    runWithTenant(2, () => {
      repo.setEmail(21, "old@example.com", null);
      // The user changed their email after the link went out.
      repo.setEmail(21, "new@example.com", null);
      expect(repo.markEmailVerified(21, "old@example.com", T0)).toBe(false);
      expect(repo.getEmail(21)?.email_verified_at).toBeNull();
      expect(repo.markEmailVerified(21, "NEW@example.com", T0)).toBe(true);
      expect(repo.getEmail(21)?.email_verified_at).toBe(T0);
    });
  });

  it("createUser can set the email and verified stamp at creation", () => {
    const created = repo.createUser({
      username: "fresh",
      password_hash: "",
      role: "admin",
      tenant_id: 2,
      email: " Fresh@Example.com",
      email_verified_at: T0,
    });
    runWithTenant(2, () => {
      expect(repo.getEmail(created.id)).toEqual({
        email: "fresh@example.com",
        email_verified_at: T0,
      });
    });
  });

  it("listEmails returns the current shop's users' emails only", () => {
    runWithTenant(2, () => {
      repo.setEmail(20, "boss@example.com", T0);
    });
    runWithTenant(1, () => {
      repo.setEmail(1, "admin1@example.com", null);
    });
    runWithTenant(2, () => {
      const rows = repo.listEmails();
      expect(rows.map((r) => r.id).sort()).toEqual([20, 21, 22]);
      expect(rows.find((r) => r.id === 20)?.email).toBe("boss@example.com");
    });
  });
});
