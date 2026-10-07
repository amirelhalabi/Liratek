/**
 * UserInvitationRepository (v196, LIRA-281) — invite a user into one shop.
 *
 * Real in-memory database: the single-use guarantee IS the conditional
 * UPDATE in `claim()`, so a mock would prove nothing. Every "now" is a UTC
 * ISO string passed in, never SQLite's clock.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  UserInvitationRepository,
  type UserInvitationEntity,
} from "../UserInvitationRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const EXPIRES = "2026-10-10T10:00:00.000Z";
const TEN_MIN_MS = 10 * 60 * 1000;
const plus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();
const minus = (iso: string, ms: number): string => plus(iso, -ms);

let db: Database.Database;
let repo: UserInvitationRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES (2, 'Two', 'two');
    INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES
      (20, 2, 'boss', '', 'admin'), (30, 2, 'joined', '', 'staff');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new UserInvitationRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function createInvite(
  overrides: Partial<{
    email: string;
    role: "admin" | "staff";
    tokenHash: string;
    expiresAt: string;
    now: string;
  }> = {},
  tenantId = 2,
): UserInvitationEntity {
  return runWithTenant(tenantId, () =>
    repo.createInvitation({
      email: overrides.email ?? "staff@example.com",
      role: overrides.role ?? "staff",
      tokenHash: overrides.tokenHash ?? "hash-1",
      invitedByUserId: tenantId === 2 ? 20 : 1,
      expiresAt: overrides.expiresAt ?? EXPIRES,
      now: overrides.now ?? T0,
    }),
  );
}

describe("UserInvitationRepository", () => {
  it("creates an invite in the current shop, email normalised, ISO created_at", () => {
    const invite = createInvite({ email: "  Staff@Example.COM " });
    expect(invite.tenant_id).toBe(2);
    expect(invite.email).toBe("staff@example.com");
    expect(invite.role).toBe("staff");
    expect(invite.created_at).toBe(T0);
    expect(invite.claimed_at).toBeNull();
  });

  it("claim() wins exactly once; a second claim of the same token returns null", () => {
    createInvite();
    const first = repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    expect(first?.tenant_id).toBe(2);
    expect(first?.claimed_at).toBe(T0);
    expect(repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS))).toBeNull();
  });

  it("claim() refuses an expired, revoked or used invite, and an unknown token", () => {
    createInvite({ tokenHash: "h-exp", expiresAt: T0 });
    expect(repo.claim("h-exp", T0, minus(T0, TEN_MIN_MS))).toBeNull();

    const revoked = createInvite({ tokenHash: "h-rev" });
    runWithTenant(2, () => repo.revoke(revoked.id, T0));
    expect(repo.claim("h-rev", T0, minus(T0, TEN_MIN_MS))).toBeNull();

    const used = createInvite({ tokenHash: "h-used" });
    repo.claim("h-used", T0, minus(T0, TEN_MIN_MS));
    expect(repo.finalize(used.id, 30, T0)).toBe(true);
    const later = plus(T0, 2 * TEN_MIN_MS);
    expect(repo.claim("h-used", later, minus(later, TEN_MIN_MS))).toBeNull();

    expect(repo.claim("nope", T0, minus(T0, TEN_MIN_MS))).toBeNull();
  });

  it("a stale claim lapses; release() makes the link work again", () => {
    const invite = createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    const later = plus(T0, TEN_MIN_MS + 1000);
    expect(
      repo.claim("hash-1", later, minus(later, TEN_MIN_MS)),
    ).not.toBeNull();
    expect(repo.release(invite.id, later)).toBe(true);
    expect(
      repo.claim("hash-1", later, minus(later, TEN_MIN_MS)),
    ).not.toBeNull();
  });

  it("finalize() records the user it created and is single-shot", () => {
    const invite = createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    expect(repo.finalize(invite.id, 30, T0)).toBe(true);
    expect(repo.finalize(invite.id, 30, T0)).toBe(false);
    const row = repo.findByTokenHash("hash-1");
    expect(row?.used_by_user_id).toBe(30);
    expect(row?.used_at).toBe(T0);
  });

  it("findByTokenHash is global (the token is the capability) and returns the shop", () => {
    createInvite();
    const row = runWithTenant(1, () => repo.findByTokenHash("hash-1"));
    expect(row?.tenant_id).toBe(2);
  });

  it("revoke(), list and pending lookups are confined to the current shop", () => {
    const mine = createInvite({ tokenHash: "h-mine" });
    createInvite({ tokenHash: "h-other", email: "staff@example.com" }, 1);
    runWithTenant(1, () => {
      expect(repo.revoke(mine.id, T0)).toBe(false);
      expect(repo.listRecent(50).map((r) => r.token_hash)).toEqual(["h-other"]);
    });
    runWithTenant(2, () => {
      expect(repo.listRecent(50).map((r) => r.id)).toEqual([mine.id]);
      expect(
        repo.findPendingByEmail("STAFF@example.com", T0).map((r) => r.id),
      ).toEqual([mine.id]);
      expect(repo.revoke(mine.id, T0)).toBe(true);
      expect(repo.revoke(mine.id, T0)).toBe(false);
      expect(repo.findPendingByEmail("staff@example.com", T0)).toEqual([]);
    });
  });

  it("countCreatedSince counts this shop's invites at or after a cutoff", () => {
    createInvite({ tokenHash: "a", now: minus(T0, 2 * 60 * 60 * 1000) });
    createInvite({ tokenHash: "b", now: T0 });
    createInvite({ tokenHash: "c", now: T0 }, 1);
    runWithTenant(2, () => {
      expect(repo.countCreatedSince(minus(T0, 60 * 60 * 1000))).toBe(1);
    });
  });

  it("linkOutbox points the invite at its email", () => {
    const invite = createInvite();
    runWithTenant(2, () => {
      expect(repo.linkOutbox(invite.id, 99, T0)).toBe(true);
    });
    expect(repo.findByTokenHash("hash-1")?.email_outbox_id).toBe(99);
  });
});
