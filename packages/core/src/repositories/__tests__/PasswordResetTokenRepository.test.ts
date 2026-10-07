/**
 * PasswordResetTokenRepository (v196, LIRA-275/276) — single-use
 * password-reset links. Real in-memory database: single use IS the
 * conditional UPDATE in `consume()`.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { PasswordResetTokenRepository } from "../PasswordResetTokenRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const plus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

let db: Database.Database;
let repo: PasswordResetTokenRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES
      (20, 2, 'boss', '', 'admin'), (21, 2, 'cashier', '', 'staff');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new PasswordResetTokenRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function issue(tokenHash: string, userId = 20, now = T0) {
  return runWithTenant(2, () =>
    repo.createToken({
      userId,
      tokenHash,
      expiresAt: plus(now, HOUR),
      requestedIpHash: "iphash",
      now,
    }),
  );
}

describe("PasswordResetTokenRepository", () => {
  it("creates a token in the current shop with ISO timestamps", () => {
    const token = issue("h1");
    expect(token.tenant_id).toBe(2);
    expect(token.user_id).toBe(20);
    expect(token.created_at).toBe(T0);
    expect(token.requested_ip_hash).toBe("iphash");
  });

  it("consume() succeeds once; the second consume of the same token returns null", () => {
    issue("h1");
    const first = repo.consume("h1", plus(T0, 1000));
    expect(first?.user_id).toBe(20);
    expect(first?.tenant_id).toBe(2);
    expect(repo.consume("h1", plus(T0, 2000))).toBeNull();
  });

  it("an expired token is refused by consume() and findUsableByTokenHash()", () => {
    issue("h1");
    const after = plus(T0, HOUR);
    expect(repo.findUsableByTokenHash("h1", after)).toBeNull();
    expect(repo.consume("h1", after)).toBeNull();
    // Still usable just before expiry.
    expect(repo.findUsableByTokenHash("h1", plus(T0, HOUR - 1))).not.toBeNull();
  });

  it("findUsableByTokenHash is global — the token alone names the shop", () => {
    issue("h1");
    const row = runWithTenant(1, () => repo.findUsableByTokenHash("h1", T0));
    expect(row?.tenant_id).toBe(2);
  });

  it("invalidateForUser() burns every open token of that user only", () => {
    issue("a", 20);
    issue("b", 20);
    issue("c", 21);
    runWithTenant(2, () => {
      expect(repo.invalidateForUser(20, plus(T0, 1000))).toBe(2);
    });
    expect(repo.consume("a", plus(T0, 2000))).toBeNull();
    expect(repo.consume("b", plus(T0, 2000))).toBeNull();
    expect(repo.consume("c", plus(T0, 2000))).not.toBeNull();
  });

  it("invalidateForUser() cannot reach another shop", () => {
    issue("a", 20);
    runWithTenant(1, () => {
      expect(repo.invalidateForUser(20, T0)).toBe(0);
    });
  });

  it("countForUserSince() counts one user's requests since a cutoff (rate limit)", () => {
    issue("a", 20, plus(T0, -2 * HOUR));
    issue("b", 20, T0);
    issue("c", 21, T0);
    runWithTenant(2, () => {
      expect(repo.countForUserSince(20, plus(T0, -HOUR))).toBe(1);
    });
  });

  it("linkOutbox() points the token at its email", () => {
    const token = issue("h1");
    runWithTenant(2, () => {
      expect(repo.linkOutbox(token.id, 42, T0)).toBe(true);
    });
    expect(repo.findUsableByTokenHash("h1", T0)?.email_outbox_id).toBe(42);
  });
});
