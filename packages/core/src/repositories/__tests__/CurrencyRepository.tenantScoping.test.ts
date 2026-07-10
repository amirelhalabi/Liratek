/**
 * CurrencyRepository — cross-tenant isolation (WP3f, rule 17 regression proof)
 *
 * `currencies.code` is UNIQUE PER TENANT now (was globally UNIQUE before the
 * multi-tenant retrofit — see migrations/index.ts's v123 currencies rebuild).
 * This test seeds two tenants that both define a currency with the SAME
 * `code` ('USD') and proves:
 *   - findAllCurrencies() under tenant 1 sees ONLY tenant 1's row (not
 *     tenant 2's, even though the `code` value collides).
 *   - codeExists() is tenant-scoped: tenant 2 having 'USD' does not make
 *     tenant 1's `codeExists('USD')` report a false positive scoped to the
 *     wrong row, and vice versa.
 *   - updateCurrency()/deleteCurrency() cannot reach another tenant's row by
 *     id.
 *   - The currency_modules / currency_drawers junction tables (their PK is
 *     now (tenant_id, ...), not just the code) are scoped the same way.
 *
 * Per CLAUDE.md rule 17, this test was verified to FAIL when the
 * `tenant_id` predicate was removed from `findAllCurrencies()` before being
 * committed — see the WP3f report for the sabotage-and-revert transcript.
 */

import Database from "better-sqlite3";
import { CurrencyRepository } from "../CurrencyRepository";
import { runWithTenant } from "../../db/tenantContext";

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

    CREATE TABLE currencies (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER REFERENCES tenants(id),
      code           TEXT NOT NULL,
      name           TEXT NOT NULL,
      symbol         TEXT NOT NULL DEFAULT '',
      decimal_places INTEGER NOT NULL DEFAULT 2,
      is_active      BOOLEAN DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE modules (
      tenant_id  INTEGER REFERENCES tenants(id),
      key        TEXT NOT NULL,
      label      TEXT,
      icon       TEXT,
      route      TEXT,
      sort_order INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT 1,
      admin_only BOOLEAN DEFAULT 0,
      is_system  BOOLEAN DEFAULT 0,
      PRIMARY KEY (tenant_id, key)
    );

    CREATE TABLE currency_modules (
      tenant_id     INTEGER REFERENCES tenants(id),
      currency_code TEXT NOT NULL,
      module_key    TEXT NOT NULL,
      PRIMARY KEY (tenant_id, currency_code, module_key)
    );

    CREATE TABLE currency_drawers (
      tenant_id     INTEGER REFERENCES tenants(id),
      currency_code TEXT NOT NULL,
      drawer_name   TEXT NOT NULL,
      PRIMARY KEY (tenant_id, currency_code, drawer_name)
    );
  `);

  // Same `code` ('USD') in both tenants — only legal now that the UNIQUE
  // constraint is (tenant_id, code), not a bare global UNIQUE on code.
  db.prepare(
    `INSERT INTO currencies (id, tenant_id, code, name, symbol, decimal_places, is_active) VALUES (1, 1, 'USD', 'US Dollar (T1)', '$', 2, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO currencies (id, tenant_id, code, name, symbol, decimal_places, is_active) VALUES (2, 2, 'USD', 'US Dollar (T2)', '$', 2, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO currencies (id, tenant_id, code, name, symbol, decimal_places, is_active) VALUES (3, 1, 'LBP', 'Lebanese Pound (T1)', 'LBP', 0, 1)`,
  ).run();

  db.prepare(
    `INSERT INTO modules (tenant_id, key, label) VALUES (1, 'pos', 'POS')`,
  ).run();
  db.prepare(
    `INSERT INTO modules (tenant_id, key, label) VALUES (2, 'pos', 'POS')`,
  ).run();
  db.prepare(
    `INSERT INTO currency_modules (tenant_id, currency_code, module_key) VALUES (1, 'USD', 'pos')`,
  ).run();
  db.prepare(
    `INSERT INTO currency_modules (tenant_id, currency_code, module_key) VALUES (2, 'USD', 'pos')`,
  ).run();
  db.prepare(
    `INSERT INTO currency_drawers (tenant_id, currency_code, drawer_name) VALUES (1, 'USD', 'POS')`,
  ).run();
  db.prepare(
    `INSERT INTO currency_drawers (tenant_id, currency_code, drawer_name) VALUES (2, 'USD', 'Recharge')`,
  ).run();

  return db;
}

describe("CurrencyRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: CurrencyRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new CurrencyRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("findAllCurrencies() under tenant 1 sees only tenant 1's rows, even with a colliding code", () => {
    const rows = runWithTenant(1, () => repo.findAllCurrencies());
    expect(rows.map((r) => r.id).sort()).toEqual([1, 3]);
    expect(rows.find((r) => r.code === "USD")?.name).toBe("US Dollar (T1)");
  });

  it("findAllCurrencies() under tenant 2 sees only tenant 2's rows", () => {
    const rows = runWithTenant(2, () => repo.findAllCurrencies());
    expect(rows.map((r) => r.id)).toEqual([2]);
    expect(rows[0].name).toBe("US Dollar (T2)");
  });

  it("findById() (generic BaseRepository CRUD) cannot cross tenants", () => {
    expect(runWithTenant(1, () => repo.findById(2))).toBeNull();
    expect(runWithTenant(2, () => repo.findById(1))).toBeNull();
    expect(runWithTenant(1, () => repo.findById(1))?.name).toBe(
      "US Dollar (T1)",
    );
  });

  it("codeExists() is scoped per tenant despite the colliding 'USD' code", () => {
    expect(runWithTenant(1, () => repo.codeExists("USD"))).toBe(true);
    expect(runWithTenant(1, () => repo.codeExists("USD", 1))).toBe(false); // excludeId = itself
    expect(runWithTenant(1, () => repo.codeExists("USD", 2))).toBe(true); // id 2 belongs to tenant 2, not excluded from tenant 1's view
    expect(runWithTenant(2, () => repo.codeExists("EUR"))).toBe(false);
  });

  it("updateCurrency() cannot reach another tenant's row by id", () => {
    const updated = runWithTenant(1, () =>
      repo.updateCurrency(2, { name: "Hijacked" }),
    );
    expect(updated).toBe(false);
    const stillT2 = runWithTenant(2, () => repo.findById(2));
    expect(stillT2?.name).toBe("US Dollar (T2)");
  });

  it("deleteCurrency() cannot reach another tenant's row by id", () => {
    runWithTenant(1, () => repo.deleteCurrency(2));
    const stillThere = runWithTenant(2, () => repo.findById(2));
    expect(stillThere).not.toBeNull();
  });

  it("currency_modules / currency_drawers junction reads are scoped per tenant", () => {
    expect(runWithTenant(1, () => repo.getModulesForCurrency("USD"))).toEqual(
      ["pos"],
    );
    expect(
      runWithTenant(1, () => repo.getDrawersForCurrency("USD")),
    ).toEqual(["POS"]);
    expect(
      runWithTenant(2, () => repo.getDrawersForCurrency("USD")),
    ).toEqual(["Recharge"]);
  });

  it("setModulesForCurrency() replace-all only touches the current tenant's junction rows", () => {
    runWithTenant(1, () => repo.setModulesForCurrency("USD", []));
    expect(runWithTenant(1, () => repo.getModulesForCurrency("USD"))).toEqual(
      [],
    );
    // Tenant 2's mapping must survive tenant 1's "replace all".
    expect(runWithTenant(2, () => repo.getModulesForCurrency("USD"))).toEqual(
      ["pos"],
    );
  });
});
