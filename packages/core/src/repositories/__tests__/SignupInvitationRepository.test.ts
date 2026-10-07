/**
 * SignupInvitationRepository (LIRA-267) — single-use sign-up links.
 *
 * Real in-memory database (create_db.sql + runMigrations) through
 * `__LIRATEK_TEST_DB__`: the single-use guarantee IS the conditional UPDATE
 * in `claim()` (research R4), so a mock would prove nothing.
 *
 * Every "now" is a UTC ISO string passed in, never SQLite's clock.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import {
  SignupInvitationRepository,
  deriveStatus,
  type SignupInvitationEntity,
} from "../SignupInvitationRepository.js";
import { EmailOutboxRepository } from "../EmailOutboxRepository.js";

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

function minus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) - ms).toISOString();
}
function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

let db: Database.Database;
let repo: SignupInvitationRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new SignupInvitationRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function createInvite(
  overrides: Partial<{
    email: string;
    tokenHash: string;
    source: "admin" | "self";
    invitedByUserId: number | null;
    expiresAt: string;
    now: string;
    shopNameHint: string | null;
  }> = {},
): SignupInvitationEntity {
  return repo.createInvitation({
    email: overrides.email ?? "owner@example.com",
    shopNameHint: overrides.shopNameHint ?? "Corner Shop",
    tokenHash: overrides.tokenHash ?? "hash-1",
    source: overrides.source ?? "admin",
    invitedByUserId:
      overrides.invitedByUserId === undefined ? 7 : overrides.invitedByUserId,
    expiresAt: overrides.expiresAt ?? EXPIRES,
    now: overrides.now ?? T0,
  });
}

describe("create / findByTokenHash", () => {
  it("stores the row with ISO created_at and finds it by hash", () => {
    const invite = createInvite();
    expect(invite.email).toBe("owner@example.com");
    expect(invite.source).toBe("admin");
    expect(invite.invited_by_user_id).toBe(7);
    expect(invite.created_at).toBe(T0);
    expect(repo.findByTokenHash("hash-1")?.id).toBe(invite.id);
    expect(repo.findByTokenHash("nope")).toBeNull();
  });

  it("allows a NULL inviter for self-serve requests", () => {
    const invite = createInvite({ source: "self", invitedByUserId: null });
    expect(invite.invited_by_user_id).toBeNull();
  });
});

describe("claim — single use (research R4)", () => {
  it("claims a pending invite once; a second claim on the same hash returns null", () => {
    createInvite();
    const staleBefore = minus(T0, TEN_MIN_MS);
    const first = repo.claim("hash-1", T0, staleBefore);
    expect(first).not.toBeNull();
    expect(first!.claimed_at).toBe(T0);
    expect(repo.claim("hash-1", T0, staleBefore)).toBeNull();
  });

  it("lets a STALE claim (older than 10 minutes) be claimed again", () => {
    createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));

    const nineMinLater = plus(T0, 9 * 60 * 1000);
    expect(repo.claim("hash-1", nineMinLater, minus(nineMinLater, TEN_MIN_MS))).toBeNull();

    const elevenMinLater = plus(T0, 11 * 60 * 1000);
    const reclaimed = repo.claim(
      "hash-1",
      elevenMinLater,
      minus(elevenMinLater, TEN_MIN_MS),
    );
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.claimed_at).toBe(elevenMinLater);
  });

  it("cannot claim an expired invite (expires_at <= now)", () => {
    createInvite({ expiresAt: T0 });
    expect(repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS))).toBeNull();
  });

  it("cannot claim a used invite", () => {
    const invite = createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    repo.finalize(invite.id, 1, T0);
    const later = plus(T0, 60 * 60 * 1000);
    expect(repo.claim("hash-1", later, minus(later, TEN_MIN_MS))).toBeNull();
  });

  it("cannot claim a revoked invite", () => {
    const invite = createInvite();
    expect(repo.revoke(invite.id, T0)).toBe(true);
    expect(repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS))).toBeNull();
  });

  it("release() makes a claimed invite claimable again at once", () => {
    const invite = createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    repo.release(invite.id, T0);
    expect(repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS))).not.toBeNull();
  });
});

describe("finalize / revoke", () => {
  it("finalize records the tenant that was created", () => {
    const invite = createInvite();
    repo.claim("hash-1", T0, minus(T0, TEN_MIN_MS));
    expect(repo.finalize(invite.id, 1, T0)).toBe(true);
    const row = repo.findByTokenHash("hash-1")!;
    expect(row.used_at).toBe(T0);
    expect(row.used_by_tenant_id).toBe(1);
    expect(repo.finalize(invite.id, 1, T0)).toBe(false);
  });

  it("revoke does not touch a used invite", () => {
    const invite = createInvite();
    repo.finalize(invite.id, 1, T0);
    expect(repo.revoke(invite.id, T0)).toBe(false);
    expect(repo.findByTokenHash("hash-1")!.revoked_at).toBeNull();
  });
});

describe("rate-limit counts (self-serve only)", () => {
  it("counts self requests per email and overall since a same-day ISO cutoff", () => {
    // All on 2026-10-07: catches a created_at written as SQLite's
    // 'YYYY-MM-DD HH:MM:SS', which sorts BELOW a same-day ISO cutoff and
    // would make every count 0.
    createInvite({ tokenHash: "s1", source: "self", invitedByUserId: null, now: "2026-10-07T09:10:00.000Z" });
    createInvite({ tokenHash: "s2", source: "self", invitedByUserId: null, now: "2026-10-07T09:40:00.000Z" });
    createInvite({ tokenHash: "s3", source: "self", invitedByUserId: null, now: "2026-10-07T09:50:00.000Z", email: "other@example.com" });
    createInvite({ tokenHash: "a1", source: "admin", now: "2026-10-07T09:55:00.000Z" });

    const since = "2026-10-07T09:30:00.000Z";
    expect(repo.countSelfRequestsByEmailSince("owner@example.com", since)).toBe(1);
    expect(repo.countSelfRequestsByEmailSince("other@example.com", since)).toBe(1);
    expect(repo.countPublicSignupsSince(since)).toBe(2);
    expect(repo.countPublicSignupsSince("2026-10-07T00:00:00.000Z")).toBe(3);
  });
});

describe("listRecent", () => {
  it("returns newest first with the email status joined, and never the token hash", () => {
    const outbox = new EmailOutboxRepository();
    const first = createInvite({ tokenHash: "h-a", now: "2026-10-07T09:00:00.000Z" });
    const second = createInvite({ tokenHash: "h-b", now: "2026-10-07T09:30:00.000Z", email: "b@example.com" });
    const mail = outbox.enqueue({
      idempotencyKey: `signup-invite:${second.id}`,
      template: "signup-invite",
      toEmail: "b@example.com",
      data: {},
      now: T0,
      giveUpAt: EXPIRES,
    });
    repo.linkOutbox(second.id, mail.id, T0);

    const rows = repo.listRecent(10);
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(rows[0].email_status).toBe("pending");
    expect(rows[1].email_status).toBeNull();
    expect(rows[0]).not.toHaveProperty("token_hash");
    expect(repo.listRecent(1)).toHaveLength(1);
  });
});

describe("findTenantByContactEmail", () => {
  it("finds the shop holding an email, case-insensitively", () => {
    db.prepare(
      `INSERT INTO tenants (name, slug, contact_email) VALUES ('Mail Shop', 'mailshop', 'owner@example.com')`,
    ).run();
    expect(repo.findTenantByContactEmail("Owner@Example.com")?.slug).toBe("mailshop");
    expect(repo.findTenantByContactEmail("nobody@example.com")).toBeNull();
  });
});

describe("deriveStatus (pure)", () => {
  const base: SignupInvitationEntity = {
    id: 1,
    email: "a@b.co",
    shop_name_hint: null,
    token_hash: "h",
    source: "admin",
    invited_by_user_id: 1,
    expires_at: EXPIRES,
    claimed_at: null,
    used_at: null,
    used_by_tenant_id: null,
    revoked_at: null,
    email_outbox_id: null,
    created_at: T0,
    updated_at: T0,
  };

  it("checks revoked, then used, then expired, then pending", () => {
    expect(deriveStatus(base, T0)).toBe("pending");
    expect(deriveStatus({ ...base, claimed_at: T0 }, T0)).toBe("pending");
    expect(deriveStatus(base, EXPIRES)).toBe("expired");
    expect(deriveStatus({ ...base, used_at: T0 }, EXPIRES)).toBe("used");
    expect(deriveStatus({ ...base, used_at: T0, revoked_at: T0 }, EXPIRES)).toBe("revoked");
  });
});
