/**
 * SsoHandoffTokenRepository (v196, LIRA-280) — the one-time www -> shop
 * subdomain sign-in hand-off. Platform-level (no tenant_id).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithoutTenant } from "../../db/tenantContext.js";
import { SsoHandoffTokenRepository } from "../SsoHandoffTokenRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const plus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

let db: Database.Database;
let repo: SsoHandoffTokenRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new SsoHandoffTokenRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function mint(tokenHash = "h1") {
  return runWithoutTenant(() =>
    repo.createToken({
      tokenHash,
      userId: 20,
      targetTenantId: 2,
      expiresAt: plus(T0, 60_000),
      now: T0,
    }),
  );
}

describe("SsoHandoffTokenRepository", () => {
  it("mints a hand-off for one user of one shop", () => {
    const row = mint();
    expect(row.target_tenant_id).toBe(2);
    expect(row.user_id).toBe(20);
    expect(row.created_at).toBe(T0);
  });

  it("consume() succeeds once; the second consume returns null", () => {
    mint();
    const first = runWithoutTenant(() => repo.consume("h1", plus(T0, 1000)));
    expect(first?.target_tenant_id).toBe(2);
    expect(
      runWithoutTenant(() => repo.consume("h1", plus(T0, 2000))),
    ).toBeNull();
  });

  it("an expired hand-off is refused", () => {
    mint();
    expect(
      runWithoutTenant(() => repo.consume("h1", plus(T0, 60_000))),
    ).toBeNull();
  });

  it("deleteExpiredBefore() housekeeps old rows only", () => {
    mint("old");
    runWithoutTenant(() =>
      repo.createToken({
        tokenHash: "new",
        userId: 20,
        targetTenantId: 2,
        expiresAt: plus(T0, 3_600_000),
        now: T0,
      }),
    );
    expect(
      runWithoutTenant(() => repo.deleteExpiredBefore(plus(T0, 120_000))),
    ).toBe(1);
    expect(
      runWithoutTenant(() => repo.consume("new", plus(T0, 1000))),
    ).not.toBeNull();
  });
});
