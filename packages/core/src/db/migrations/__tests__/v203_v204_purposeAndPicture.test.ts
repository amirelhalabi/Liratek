/**
 * Migrations v203 (LIRA-293) and v204 (LIRA-294):
 *   - v203 `email_verification_tokens.purpose TEXT NOT NULL DEFAULT 'verify'`
 *     ('verify' | 'change'): existing links are ordinary verify links.
 *   - v204 `user_identities.picture_url TEXT` (NULL): existing links have no
 *     photo until their next Google sign-in.
 * Both: up adds the column (and is idempotent), down removes it and keeps
 * the rows.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V203 = MIGRATIONS.find((m) => m.version === 203);
const V204 = MIGRATIONS.find((m) => m.version === 204);

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];

/** A database at v202: create_db.sql minus the two new columns, with one
 * existing token and one existing Google link. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`ALTER TABLE email_verification_tokens DROP COLUMN purpose`);
  db.exec(`ALTER TABLE user_identities DROP COLUMN picture_url`);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (10, 2, 'u', 'x', 'staff', 1);
    INSERT INTO email_verification_tokens (tenant_id, user_id, email, token_hash, expires_at)
      VALUES (2, 10, 'u@x.test', 'h1', '2099-01-01T00:00:00.000Z');
    INSERT INTO user_identities (user_id, tenant_id, provider, subject, email)
      VALUES (10, 2, 'google', 'sub-1', 'u@gmail.com');
  `);
  return db;
}

it("are registered in order, right after v202", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  expect(versions.indexOf(203)).toBe(versions.indexOf(202) + 1);
  expect(versions.indexOf(204)).toBe(versions.indexOf(203) + 1);
});

describe("v203 email_verification_tokens.purpose", () => {
  it("up: existing links read 'verify'; only 'verify' or 'change' is accepted", () => {
    const db = makeDb();
    V203!.up(db);
    const col = cols(db, "email_verification_tokens").find(
      (c) => c.name === "purpose",
    );
    expect(col).toMatchObject({ notnull: 1, dflt_value: "'verify'" });
    expect(
      (
        db.prepare(`SELECT purpose FROM email_verification_tokens`).get() as {
          purpose: string;
        }
      ).purpose,
    ).toBe("verify");
    expect(() =>
      db
        .prepare(
          `INSERT INTO email_verification_tokens (tenant_id, user_id, email, token_hash, expires_at, purpose)
           VALUES (2, 10, 'a@x.test', 'h2', '2099-01-01', 'other')`,
        )
        .run(),
    ).toThrow();
    V203!.up(db); // idempotent
    db.close();
  });

  it("down: removes the column and keeps the links", () => {
    const db = makeDb();
    V203!.up(db);
    V203!.down!(db);
    expect(
      cols(db, "email_verification_tokens").some((c) => c.name === "purpose"),
    ).toBe(false);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM email_verification_tokens`).get(),
    ).toEqual({ n: 1 });
    db.close();
  });
});

describe("v204 user_identities.picture_url", () => {
  it("up: a nullable column; existing links have no photo", () => {
    const db = makeDb();
    V204!.up(db);
    const col = cols(db, "user_identities").find(
      (c) => c.name === "picture_url",
    );
    expect(col).toMatchObject({ notnull: 0, dflt_value: null });
    expect(db.prepare(`SELECT picture_url FROM user_identities`).get()).toEqual(
      {
        picture_url: null,
      },
    );
    V204!.up(db); // idempotent
    db.close();
  });

  it("down: removes the column and keeps the links", () => {
    const db = makeDb();
    V204!.up(db);
    db.exec(
      `UPDATE user_identities SET picture_url = 'https://lh3.googleusercontent.com/a'`,
    );
    V204!.down!(db);
    expect(
      cols(db, "user_identities").some((c) => c.name === "picture_url"),
    ).toBe(false);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM user_identities`).get(),
    ).toEqual({ n: 1 });
    db.close();
  });
});
