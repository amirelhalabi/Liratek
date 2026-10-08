/**
 * EmailVerificationTokenRepository (v196, LIRA-279) — single-use "verify
 * this email" links. Each token remembers the address it was sent to.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { EmailVerificationTokenRepository } from "../EmailVerificationTokenRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const plus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

let db: Database.Database;
let repo: EmailVerificationTokenRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES
      (20, 2, 'boss', '', 'admin');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new EmailVerificationTokenRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function issue(tokenHash: string, email = "Boss@Example.com") {
  return runWithTenant(2, () =>
    repo.createToken({
      userId: 20,
      email,
      tokenHash,
      expiresAt: plus(T0, DAY),
      now: T0,
    }),
  );
}

describe("EmailVerificationTokenRepository", () => {
  it("creates a token for the address it was sent to (normalised)", () => {
    const token = issue("h1");
    expect(token.tenant_id).toBe(2);
    expect(token.email).toBe("boss@example.com");
    expect(token.created_at).toBe(T0);
  });

  it("consume() succeeds once and returns the address; the second consume returns null", () => {
    issue("h1");
    const first = repo.consume("h1", plus(T0, 1000));
    expect(first?.email).toBe("boss@example.com");
    expect(first?.user_id).toBe(20);
    expect(repo.consume("h1", plus(T0, 2000))).toBeNull();
  });

  it("an expired token is refused", () => {
    issue("h1");
    expect(repo.findUsableByTokenHash("h1", plus(T0, DAY))).toBeNull();
    expect(repo.consume("h1", plus(T0, DAY))).toBeNull();
  });

  it("invalidateForUser() burns the user's open links (e.g. after the email changes)", () => {
    issue("a");
    issue("b", "other@example.com");
    runWithTenant(2, () => {
      expect(repo.invalidateForUser(20, T0)).toBe(2);
    });
    expect(repo.consume("a", T0)).toBeNull();
    runWithTenant(1, () => {
      expect(repo.invalidateForUser(20, T0)).toBe(0);
    });
  });

  it("linkOutbox() points the token at its email", () => {
    const token = issue("h1");
    runWithTenant(2, () => {
      expect(repo.linkOutbox(token.id, 7, T0)).toBe(true);
    });
    expect(repo.findUsableByTokenHash("h1", T0)?.email_outbox_id).toBe(7);
  });
});

describe("EmailVerificationTokenRepository.deleteExpiredBefore (auth-row cleanup sweep)", () => {
  function seedAt(tenantId: number, userId: number, tokenHash: string, expiresAt: string) {
    db.prepare(
      `INSERT INTO email_verification_tokens (tenant_id, user_id, email, token_hash, expires_at, used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tenantId, userId, 'x@example.com', tokenHash, expiresAt, null, T0, T0);
  }
  const remaining = (): string[] =>
    (db.prepare(`SELECT token_hash FROM email_verification_tokens ORDER BY token_hash`).all() as { token_hash: string }[]).map(
      (r) => r.token_hash,
    );

  it("deletes only rows that expired strictly before the cutoff — every shop, used or not", () => {
    db.exec(`INSERT INTO tenants (id, name, slug) VALUES (3, 'Three', 'three');
             INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES (30, 3, 'other', '', 'admin');`);
    const cutoff = T0;
    seedAt(2, 20, "old-shop2", plus(cutoff, -1));
    seedAt(3, 30, "old-shop3", plus(cutoff, -5 * HOUR));
    seedAt(2, 20, "at-cutoff", cutoff);
    seedAt(2, 20, "after-cutoff", plus(cutoff, 1));
    seedAt(2, 20, "active", plus(cutoff, 10 * HOUR));
    db.prepare(`UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = 'old-shop2'`).run(T0);

    // Called from inside one shop's context, it still sweeps every shop:
    // the sweep is a global background job, like the session sweep.
    const deleted = runWithTenant(2, () => repo.deleteExpiredBefore(cutoff));

    expect(deleted).toBe(2);
    expect(remaining()).toEqual(["active", "after-cutoff", "at-cutoff"]);
  });

  it("returns 0 and deletes nothing when nothing is past the cutoff", () => {
    seedAt(2, 20, "fresh", plus(T0, HOUR));
    expect(repo.deleteExpiredBefore(T0)).toBe(0);
    expect(remaining()).toEqual(["fresh"]);
  });
});
