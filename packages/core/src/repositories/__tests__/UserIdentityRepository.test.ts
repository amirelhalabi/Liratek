/**
 * UserIdentityRepository (v196, LIRA-280) — Google sign-in links.
 *
 * One Google account (`subject`) = one user in one shop, platform-wide
 * (owner decision 2026-10-07; enforced in `link()`, not by an index — see the
 * repository header). One user has at most one Google link. Links made
 * before that decision (the same account in two shops) keep working.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { UserIdentityRepository } from "../UserIdentityRepository.js";
import {
  GOOGLE_ACCOUNT_IN_OTHER_SHOP,
  IDENTITY_ALREADY_LINKED,
} from "../../utils/errors.js";

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

  it("links made before one-account-one-shop (same account in two shops) still list both shops", () => {
    // Legacy duplicates are seeded raw: link() no longer creates them.
    db.exec(`
      INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES
        (20, 2, 'google', 'sub-1'), (30, 3, 'google', 'sub-1');
    `);
    const matches = repo.findBySubjectAllTenants("google", "sub-1");
    expect(matches.map((m) => [m.tenant_id, m.user_id])).toEqual([
      [2, 20],
      [3, 30],
    ]);
  });

  it("refuses a Google account already linked in ANOTHER shop with GOOGLE_ACCOUNT_IN_OTHER_SHOP, and writes nothing", () => {
    link(2, 20);
    expect(codeOf(() => link(3, 30))).toBe(GOOGLE_ACCOUNT_IN_OTHER_SHOP);
    expect(
      repo.findLiveLinksBySubject("google", "sub-1").map((l) => [l.tenant_id, l.user_id]),
    ).toEqual([[2, 20]]);
  });

  // Owner decision 2026-10-07: a link to a DEACTIVATED user, or in a
  // SUSPENDED/ARCHIVED shop, is a dead link — ignored (not deleted) by the
  // one-shop rule.
  describe("dead links do not count", () => {
    function rawLinks(subject = "sub-1"): number[][] {
      return (
        db
          .prepare(
            `SELECT tenant_id, user_id FROM user_identities WHERE subject = ? ORDER BY tenant_id`,
          )
          .all(subject) as { tenant_id: number; user_id: number }[]
      ).map((r) => [r.tenant_id, r.user_id]);
    }

    it("a link held by a DEACTIVATED user in another shop does not block, and stays in the DB", () => {
      link(3, 31);
      expect(link(2, 20).tenant_id).toBe(2);
      expect(rawLinks()).toEqual([
        [2, 20],
        [3, 31],
      ]);
    });

    it.each(["suspended", "archived"])(
      "a link in a %s shop does not block, and stays in the DB",
      (status) => {
        link(3, 30);
        db.prepare(`UPDATE tenants SET status = ? WHERE id = 3`).run(status);
        expect(link(2, 20).tenant_id).toBe(2);
        expect(rawLinks()).toEqual([
          [2, 20],
          [3, 30],
        ]);
      },
    );

    it("a link in a PROVISIONING shop (being created) still blocks", () => {
      link(3, 30);
      db.exec(`UPDATE tenants SET status = 'provisioning' WHERE id = 3`);
      expect(codeOf(() => link(2, 20))).toBe(GOOGLE_ACCOUNT_IN_OTHER_SHOP);
    });

    it("an active user in an active shop still blocks", () => {
      link(3, 30);
      expect(codeOf(() => link(2, 20))).toBe(GOOGLE_ACCOUNT_IN_OTHER_SHOP);
      expect(rawLinks()).toEqual([[3, 30]]);
    });
  });

  it("re-linking the same account to the same user is idempotent", () => {
    const first = link(2, 20);
    const again = link(2, 20);
    expect(again.id).toBe(first.id);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM user_identities`).get() as { n: number }).n,
    ).toBe(1);
  });

  it("after disconnecting in one shop, the account can be connected in another", () => {
    link(2, 20);
    runWithTenant(2, () => expect(repo.unlink(20, "google")).toBe(true));
    expect(link(3, 30).tenant_id).toBe(3);
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
