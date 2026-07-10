/**
 * BaseRepository — central tenant scoping (WP1b, rule 17 regression proof)
 *
 * Multi-tenant retrofit: BaseRepository's generic CRUD methods
 * (findById/findAll/create/update/delete/count/...) now inject a
 * `tenant_id` predicate whenever `tenantScoped` (default true) is active and
 * the current async scope isn't an explicit `runWithoutTenant()` bypass.
 *
 * This is the money-leak-proof test CLAUDE.md rule 17 requires: it seeds two
 * tenants' rows in a table managed by a REAL BaseRepository subclass
 * (PartnerRepository — its `findById`/`findAll`/`count`/`exists` are the
 * inherited, unmodified BaseRepository implementations; only `create`/
 * `update` are overridden by the subclass with bespoke SQL, untouched here)
 * and proves:
 *   - findAll() under tenant 1's context returns ONLY tenant 1's rows.
 *   - findById() of tenant 2's row under tenant 1's context returns null.
 *   - count()/exists() agree with the same scoping.
 *   - The same calls under runWithoutTenant() (control-plane bypass) see
 *     BOTH tenants' rows — proving the predicate is skipped, not silently
 *     always-true.
 *
 * Per rule 17, this test was verified to FAIL against the pre-fix
 * BaseRepository (tenant scoping removed) before being committed — see the
 * PR/commit description for the sabotage-and-revert transcript.
 */

import Database from "better-sqlite3";
import { PartnerRepository } from "../PartnerRepository";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES
      (1, 'Tenant One', 'tenant-one'),
      (2, 'Tenant Two', 'tenant-two');

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id          INTEGER REFERENCES tenants(id),
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Tables PartnerRepository's own hand-written methods reference, kept
    -- empty here — this test only exercises the inherited generic methods.
    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(
    `INSERT INTO partners (id, name, tenant_id) VALUES (1, 'Alpha Partner (tenant 1)', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO partners (id, name, tenant_id) VALUES (2, 'Beta Partner (tenant 2)', 2)`,
  ).run();

  return db;
}

describe("BaseRepository — central tenant scoping (cross-tenant isolation)", () => {
  let db: Database.Database;
  let repo: PartnerRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new PartnerRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("findAll() under tenant 1 returns ONLY tenant 1's row", () => {
    const rows = runWithTenant(1, () => repo.findAll());
    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(rows[0].name).toBe("Alpha Partner (tenant 1)");
  });

  it("findAll() under tenant 2 returns ONLY tenant 2's row", () => {
    const rows = runWithTenant(2, () => repo.findAll());
    expect(rows.map((r) => r.id)).toEqual([2]);
    expect(rows[0].name).toBe("Beta Partner (tenant 2)");
  });

  it("findById() of tenant 2's row under tenant 1's context returns null", () => {
    const found = runWithTenant(1, () => repo.findById(2));
    expect(found).toBeNull();
  });

  it("findById() of tenant 1's own row under tenant 1's context succeeds", () => {
    const found = runWithTenant(1, () => repo.findById(1));
    expect(found?.name).toBe("Alpha Partner (tenant 1)");
  });

  it("count() and exists() agree with the same per-tenant scoping", () => {
    runWithTenant(1, () => {
      expect(repo.count()).toBe(1);
      expect(repo.exists(1)).toBe(true);
      expect(repo.exists(2)).toBe(false);
    });
    runWithTenant(2, () => {
      expect(repo.count()).toBe(1);
      expect(repo.exists(2)).toBe(true);
      expect(repo.exists(1)).toBe(false);
    });
  });

  it("runWithoutTenant() (control-plane bypass) sees BOTH tenants' rows", () => {
    const rows = runWithoutTenant(() => repo.findAll());
    expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);

    const crossTenantFind = runWithoutTenant(() => repo.findById(2));
    expect(crossTenantFind?.name).toBe("Beta Partner (tenant 2)");

    expect(runWithoutTenant(() => repo.count())).toBe(2);
  });
});
