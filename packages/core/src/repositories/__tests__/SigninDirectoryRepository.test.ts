/**
 * SigninDirectoryRepository (v200, LIRA-288) — the platform-level www
 * sign-in index. Every method runs in the platform scope.
 *
 * Guards: replace-per-user / per-shop / whole, idempotence, a value moving
 * to another user of the same shop, the one read predicate
 * (`DIRECTORY_USABLE`: shop 'active' only — never 'provisioning',
 * 'suspended' or 'archived'), the ordering www relies on, and the shop
 * delete.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithoutTenant } from "../../db/tenantContext.js";
import {
  SigninDirectoryRepository,
  type SigninDirectoryRowInput,
} from "../SigninDirectoryRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-08T10:00:00.000Z";
const T1 = "2026-10-08T11:00:00.000Z";

let db: Database.Database;
let repo: SigninDirectoryRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'corner Tech', 'cornertech', 'active'),
      (3, 'Alpha Phones', 'alpha', 'active'),
      (4, 'Being Made', 'making', 'provisioning'),
      (5, 'Closed', 'closed', 'suspended'),
      (6, 'Old', 'old', 'archived');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new SigninDirectoryRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

const email = (userId: number, value: string, username: string): SigninDirectoryRowInput => ({
  kind: "email",
  value,
  target_user_id: userId,
  username,
  display_email: null,
});

const google = (
  userId: number,
  sub: string,
  username: string,
  displayEmail: string | null = null,
): SigninDirectoryRowInput => ({
  kind: "google",
  value: sub,
  target_user_id: userId,
  username,
  display_email: displayEmail,
});

const platform = <T>(fn: () => T): T => runWithoutTenant(fn);

function all() {
  return db
    .prepare(
      `SELECT kind, value, target_tenant_id AS t, target_user_id AS u, username, display_email, created_at, updated_at
         FROM signin_directory ORDER BY t, u, kind`,
    )
    .all();
}

describe("SigninDirectoryRepository", () => {
  it("replaceForUser writes exactly the given rows, and running it twice changes nothing", () => {
    const rows = [email(21, "rami@gmail.com", "rami"), google(21, "sub-rami", "rami", "rami@gmail.com")];
    platform(() => repo.replaceForUser(2, 21, rows, T0));
    const first = all();
    expect(first).toEqual([
      { kind: "email", value: "rami@gmail.com", t: 2, u: 21, username: "rami", display_email: null, created_at: T0, updated_at: T0 },
      { kind: "google", value: "sub-rami", t: 2, u: 21, username: "rami", display_email: "rami@gmail.com", created_at: T0, updated_at: T0 },
    ]);
    platform(() => repo.replaceForUser(2, 21, rows, T0));
    expect(all()).toEqual(first);
  });

  it("replaceForUser touches only that user in that shop; an empty list removes them", () => {
    platform(() => {
      repo.replaceForUser(2, 21, [email(21, "rami@gmail.com", "rami")], T0);
      repo.replaceForUser(2, 22, [email(22, "sara@gmail.com", "sara")], T0);
      repo.replaceForUser(3, 21, [email(21, "rami@gmail.com", "rami3")], T0);
      repo.replaceForUser(2, 21, [], T1);
    });
    expect(all().map((r) => [(r as { t: number }).t, (r as { u: number }).u])).toEqual([
      [2, 22],
      [3, 21],
    ]);
  });

  it("a value that moved to another user of the same shop is taken over, never a constraint error", () => {
    platform(() => {
      repo.replaceForUser(2, 21, [email(21, "shared@gmail.com", "rami")], T0);
      // The shop's records now give the address to user 22 (user 21's
      // stale row has not been re-synced yet).
      repo.replaceForUser(2, 22, [email(22, "shared@gmail.com", "sara")], T1);
    });
    expect(platform(() => repo.findByEmail("shared@gmail.com"))).toEqual([
      { tenant_id: 2, slug: "cornertech", shop_name: "corner Tech", user_id: 22, username: "sara" },
    ]);
  });

  it("findByEmail lists every ACTIVE shop, ordered by shop name (case-insensitive), case-insensitive on the email", () => {
    platform(() => {
      for (const tenantId of [2, 3, 4, 5, 6]) {
        repo.replaceForUser(tenantId, 10 + tenantId, [email(10 + tenantId, "rami@gmail.com", `rami${tenantId}`)], T0);
      }
    });
    expect(platform(() => repo.findByEmail("  Rami@Gmail.COM "))).toEqual([
      { tenant_id: 3, slug: "alpha", shop_name: "Alpha Phones", user_id: 13, username: "rami3" },
      { tenant_id: 2, slug: "cornertech", shop_name: "corner Tech", user_id: 12, username: "rami2" },
    ]);
    expect(platform(() => repo.findByEmail("nobody@gmail.com"))).toEqual([]);
  });

  it("findByGoogleSubject lists every ACTIVE shop the account is linked in, never an email row with the same text", () => {
    platform(() => {
      repo.replaceForUser(2, 21, [google(21, "sub-rami", "rami")], T0);
      repo.replaceForUser(3, 30, [google(30, "sub-rami", "owner")], T0);
      repo.replaceForUser(5, 50, [google(50, "sub-rami", "closed")], T0);
      repo.replaceForUser(2, 22, [email(22, "sub-rami", "trap")], T0);
    });
    expect(platform(() => repo.findByGoogleSubject("sub-rami"))).toEqual([
      { tenant_id: 3, slug: "alpha", shop_name: "Alpha Phones", user_id: 30, username: "owner" },
      { tenant_id: 2, slug: "cornertech", shop_name: "corner Tech", user_id: 21, username: "rami" },
    ]);
  });

  it("a reactivated shop is listed again with no write to the directory", () => {
    platform(() => repo.replaceForUser(5, 50, [email(50, "x@gmail.com", "x")], T0));
    expect(platform(() => repo.findByEmail("x@gmail.com"))).toEqual([]);
    db.prepare(`UPDATE tenants SET status = 'active' WHERE id = 5`).run();
    expect(platform(() => repo.findByEmail("x@gmail.com"))).toHaveLength(1);
  });

  it("replaceForTenant replaces one shop's rows only; deleteForTenant removes them", () => {
    platform(() => {
      repo.replaceForUser(2, 21, [email(21, "a@gmail.com", "a")], T0);
      repo.replaceForUser(3, 30, [email(30, "b@gmail.com", "b")], T0);
      repo.replaceForTenant(2, [email(22, "c@gmail.com", "c"), google(22, "sub-c", "c")], T1);
    });
    expect(platform(() => repo.listAll()).map((r) => [r.target_tenant_id, r.target_user_id, r.kind])).toEqual([
      [2, 22, "email"],
      [2, 22, "google"],
      [3, 30, "email"],
    ]);
    expect(platform(() => repo.deleteForTenant(2))).toBe(2);
    expect(platform(() => repo.listAll()).map((r) => r.target_tenant_id)).toEqual([3]);
  });

  it("replaceAll rebuilds the whole directory", () => {
    platform(() => {
      repo.replaceForUser(2, 21, [email(21, "stale@gmail.com", "a")], T0);
      repo.replaceAll(
        [
          { ...email(30, "b@gmail.com", "b"), target_tenant_id: 3 },
          { ...google(21, "sub-a", "a"), target_tenant_id: 2 },
        ],
        T1,
      );
    });
    expect(platform(() => repo.listAll()).map((r) => [r.target_tenant_id, r.kind, r.value])).toEqual([
      [2, "google", "sub-a"],
      [3, "email", "b@gmail.com"],
    ]);
  });
});
