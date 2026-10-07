/**
 * Migrations v198 + v199 (LIRA-287, owner-approved sign-in redesign
 * 2026-10-07).
 *
 * v198 — one-time backfill: a user who connected Google before Google's
 * email became the account email, and has NO email, gets the linked Google
 * address (lowercased), verified at the instant the link was made
 * (`user_identities.created_at`, written as ISO by `link()`). Never
 * overwrites an email, never takes an address another user of the SAME shop
 * already holds (unique per shop), and skips a link with no email.
 *
 * v199 — `signin_codes`, the PLATFORM-level table behind "email me a code"
 * on www: no `tenant_id` column, so the per-tenant split and the reset guard
 * treat it like `sso_handoff_tokens`.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V198 = MIGRATIONS.find((m) => m.version === 198);
const V199 = MIGRATIONS.find((m) => m.version === 199);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const LINKED_AT = "2026-09-01T08:00:00.000Z";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Corner Tech', 'cornertech', 'active'),
      (3, 'Other', 'other', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active, email, email_verified_at) VALUES
      (20, 2, 'boss', 'x', 'admin', 1, NULL, NULL),
      (21, 2, 'cashier', 'x', 'staff', 1, 'kept@shop.com', NULL),
      (22, 2, 'clash', 'x', 'staff', 1, NULL, NULL),
      (23, 2, 'holder', 'x', 'staff', 0, 'taken@gmail.com', NULL),
      (24, 2, 'nomail', 'x', 'staff', 1, NULL, NULL),
      (30, 3, 'boss3', 'x', 'admin', 1, NULL, NULL);
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email, created_at, updated_at) VALUES
      (20, 2, 'google', 'sub-owner', ' Owner@Gmail.com ', '${LINKED_AT}', '${LINKED_AT}'),
      (21, 2, 'google', 'sub-cashier', 'cashier@gmail.com', '${LINKED_AT}', '${LINKED_AT}'),
      (22, 2, 'google', 'sub-clash', 'taken@gmail.com', '${LINKED_AT}', '${LINKED_AT}'),
      (24, 2, 'google', 'sub-nomail', NULL, '${LINKED_AT}', '${LINKED_AT}'),
      (30, 3, 'google', 'sub-owner', 'owner@gmail.com', '${LINKED_AT}', '${LINKED_AT}');
  `);
  return db;
}

function emailOf(db: Database.Database, id: number) {
  return db
    .prepare(`SELECT email, email_verified_at FROM users WHERE id = ?`)
    .get(id) as { email: string | null; email_verified_at: string | null };
}

describe("v198 — Google email backfill", () => {
  it("is registered", () => {
    expect(V198?.name).toBe("google_link_email_backfill");
  });

  it("gives a Google-linked user with no email the Google address, verified at link time", () => {
    const db = makeDb();
    V198!.up!(db);
    expect(emailOf(db, 20)).toEqual({
      email: "owner@gmail.com",
      email_verified_at: LINKED_AT,
    });
    // Unique PER SHOP: the same address in another shop is fine.
    expect(emailOf(db, 30)).toEqual({
      email: "owner@gmail.com",
      email_verified_at: LINKED_AT,
    });
  });

  it("never overwrites an email, never takes one another user of the shop holds, skips a link with no email", () => {
    const db = makeDb();
    V198!.up!(db);
    expect(emailOf(db, 21)).toEqual({
      email: "kept@shop.com",
      email_verified_at: null,
    });
    expect(emailOf(db, 22)).toEqual({ email: null, email_verified_at: null });
    expect(emailOf(db, 24)).toEqual({ email: null, email_verified_at: null });
  });

  it("is idempotent", () => {
    const db = makeDb();
    V198!.up!(db);
    V198!.up!(db);
    expect(emailOf(db, 20).email).toBe("owner@gmail.com");
  });

  it("down() clears only what the backfill set", () => {
    const db = makeDb();
    V198!.up!(db);
    V198!.down!(db);
    expect(emailOf(db, 20)).toEqual({ email: null, email_verified_at: null });
    expect(emailOf(db, 30)).toEqual({ email: null, email_verified_at: null });
    expect(emailOf(db, 21)).toEqual({
      email: "kept@shop.com",
      email_verified_at: null,
    });
    expect(emailOf(db, 23).email).toBe("taken@gmail.com");
  });
});

describe("v199 — signin_codes (platform level)", () => {
  function columns(db: Database.Database): string[] {
    return (
      db.prepare(`SELECT name FROM pragma_table_info('signin_codes')`).all() as {
        name: string;
      }[]
    ).map((c) => c.name);
  }

  it("creates the table with no tenant_id, and down() drops it", () => {
    const db = new Database(":memory:");
    V199!.up!(db);
    expect(columns(db)).toEqual([
      "id",
      "email",
      "code_hash",
      "expires_at",
      "attempts",
      "used_at",
      "requested_ip_hash",
      "email_outbox_id",
      "created_at",
      "updated_at",
    ]);
    V199!.down!(db);
    expect(columns(db)).toEqual([]);
  });

  it("create_db.sql already declares it and seeds both versions", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(columns(db)).toContain("code_hash");
    const versions = (
      db
        .prepare(
          `SELECT version FROM schema_migrations WHERE version IN (198, 199) ORDER BY version`,
        )
        .all() as { version: number }[]
    ).map((r) => r.version);
    expect(versions).toEqual([198, 199]);
  });
});
