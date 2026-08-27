/**
 * Migration v154 — financial_services_provider_check_to_fk
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 3).
 *
 * Proves:
 *  - `financial_services.provider`'s closed 9-value CHECK is replaced by a
 *    composite FOREIGN KEY (tenant_id, provider) -> service_providers
 *    (tenant_id, code) — NOT a bare `REFERENCES service_providers(code)`,
 *    which would throw "foreign key mismatch" on every statement against
 *    this table (service_providers only carries UNIQUE(tenant_id, code),
 *    no unique index on `code` alone).
 *  - Every pre-existing row survives the rebuild byte-for-byte (id, all
 *    other columns, including a mixed-case provider like 'iPick' and a
 *    NULL tenant_id legacy row).
 *  - Pre-existing, non-provider CHECK constraints (service_type) and
 *    indexes are preserved untouched.
 *  - The new FK is genuinely enforced: a provider with no matching
 *    service_providers row is rejected; a configured one is accepted.
 *  - A row with a NULL tenant_id bypasses the FK (SQLite's standard
 *    composite-FK NULL semantics) — the correct "leave legacy data alone"
 *    behavior (rule 20 / D3 precedent), not a loophole.
 *  - down() restores the original CHECK, removing (with a warning) any row
 *    whose provider can no longer be represented by it, and the full
 *    up() -> down() -> up() round trip is clean.
 *  - Defensive no-ops: financial_services/service_providers missing, or the
 *    FK already present (idempotent re-run).
 *
 * Constructed directly against the migration's up()/down()
 * (MIGRATIONS.find(...) pattern, mirrors ServiceProvidersTableMigration.
 * test.ts / CommissionAtSettlementFoundationMigration.test.ts).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 154);

// A representative (not exhaustive) subset of the real financial_services
// columns — enough to prove column/row preservation without hand-retyping
// all 39 real columns. Crucially includes the EXACT live CHECK clause text
// (electron-app/create_db.sql) the migration's up() matches verbatim, a
// second CHECK column (service_type) that must survive UNTOUCHED, and a
// column both before and after `provider`.
const FINANCIAL_SERVICES_SCHEMA = `
  CREATE TABLE financial_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
    service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL')) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'USD' NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_financial_services_provider_settled ON financial_services(provider);
`;

const SERVICE_PROVIDERS_SCHEMA = `
  CREATE TABLE service_providers (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id          INTEGER,
    code               TEXT NOT NULL,
    label              TEXT NOT NULL,
    drawer_name        TEXT NOT NULL,
    is_system_provider INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    is_system          INTEGER NOT NULL DEFAULT 0,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code)
  );
`;

const SEED_CODES = [
  "OMT",
  "WHISH",
  "BOB",
  "OTHER",
  "iPick",
  "Katsh",
  "WHISH_APP",
  "OMT_APP",
  "BINANCE",
];

function seedServiceProviders(db: Database.Database, tenantId: number): void {
  const stmt = db.prepare(
    `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (?, ?, ?, 'General')`,
  );
  for (const code of SEED_CODES) stmt.run(tenantId, code, code);
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // better-sqlite3 in this codebase defaults `foreign_keys` to ON for every
  // new connection (verified — NOT the vanilla SQLite default of OFF), so
  // `financial_services.tenant_id REFERENCES tenants(id)` needs a real
  // parent table to exist or even PREPARING an unrelated INSERT throws
  // "no such table: main.tenants". Mirrors ServiceProvidersTableMigration.
  // test.ts's identical fixture for the identical reason.
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
  `);
  db.exec(FINANCIAL_SERVICES_SCHEMA);
  db.exec(SERVICE_PROVIDERS_SCHEMA);
  seedServiceProviders(db, 1);
  return db;
}

type FsRow = {
  id: number;
  tenant_id: number | null;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  note: string | null;
};

function allRows(db: Database.Database): FsRow[] {
  return db
    .prepare(
      `SELECT id, tenant_id, provider, service_type, amount, currency, note FROM financial_services ORDER BY id`,
    )
    .all() as FsRow[];
}

describe("Migration v154 — financial_services_provider_check_to_fk", () => {
  it("is registered at version 154", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("financial_services_provider_check_to_fk");
  });

  it("rebuilds financial_services: CHECK -> composite FK, preserving every row/column/index", () => {
    const db = createTestDb();

    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, note) VALUES (1, 'OMT', 'SEND', 100, 'USD', 'row A')`,
    ).run();
    // Mixed-case code — proves the rebuild does not normalize/uppercase.
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, note) VALUES (1, 'iPick', 'BILL', 250000, 'LBP', 'row B')`,
    ).run();
    // Legacy pre-multi-tenant row: NULL tenant_id must survive AND must
    // bypass the new composite FK (SQLite NULL-in-composite-FK semantics).
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, note) VALUES (NULL, 'WHISH', 'RECEIVE', 50, 'USD', 'row C legacy')`,
    ).run();

    const before = allRows(db);
    expect(before).toHaveLength(3);

    migration!.up(db);

    const after = allRows(db);
    expect(after).toEqual(before);

    // service_type CHECK (a DIFFERENT column) must be untouched.
    expect(() =>
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'OMT', 'BOGUS_TYPE', 1)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    // Index survives the rebuild.
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='financial_services'`,
      )
      .all() as { name: string }[];
    expect(idx.map((r) => r.name)).toContain(
      "idx_financial_services_provider_settled",
    );

    // The provider CHECK is gone — 'BOGUS_TYPE' as a provider would have
    // been rejected by the OLD CHECK; now it's rejected by the FK instead
    // (no matching service_providers row), same net effect via a different
    // mechanism.
    expect(() =>
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'NOT_A_REAL_PROVIDER', 'SEND', 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // A configured provider still works for a real tenant.
    const ins = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'Katsh', 'SEND', 1)`,
      )
      .run();
    expect(ins.changes).toBe(1);

    // The NULL-tenant legacy row's bogus-looking provider ('WHISH' is
    // actually valid, so prove the NULL-bypass with a genuinely unseeded
    // code under a NULL tenant instead).
    const nullTenantIns = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (NULL, 'TOTALLY_UNSEEDED', 'SEND', 1)`,
      )
      .run();
    expect(nullTenantIns.changes).toBe(1);

    expect(db.pragma("foreign_key_check")).toEqual([]);

    db.close();
  });

  it("down() restores the original CHECK and the full round trip is clean", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, note) VALUES (1, 'OMT', 'SEND', 100, 'USD', 'row A')`,
    ).run();
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, note) VALUES (1, 'iPick', 'BILL', 250000, 'LBP', 'row B')`,
    ).run();
    const before = allRows(db);

    migration!.up(db);
    migration!.down!(db);

    const after = allRows(db);
    expect(after).toEqual(before);

    expect(() =>
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'NOT_A_REAL_PROVIDER', 'SEND', 1)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    const ins = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'BINANCE', 'SEND', 1)`,
      )
      .run();
    expect(ins.changes).toBe(1);

    // Round-trip again: up() must re-apply cleanly on top of a rolled-back schema.
    migration!.up(db);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(allRows(db)).toHaveLength(3); // row A, row B, the BINANCE insert above

    db.close();
  });

  it("down() removes a row whose provider can no longer satisfy the restored CHECK", () => {
    const db = createTestDb();
    migration!.up(db);

    // A provider added AFTER phase 3 shipped (simulating phase 4/5) — valid
    // under the FK (its own service_providers row exists) but NOT
    // representable by the original 9-value CHECK.
    db.prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'SYRIA', 'Syria', 'General')`,
    ).run();
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'OMT', 'SEND', 10)`,
    ).run();
    const syriaRow = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'SYRIA', 'SEND', 20)`,
      )
      .run();

    migration!.down!(db);

    const remaining = allRows(db);
    expect(
      remaining.some((r) => r.id === Number(syriaRow.lastInsertRowid)),
    ).toBe(false);
    expect(remaining.some((r) => r.provider === "OMT")).toBe(true);

    db.close();
  });

  it("up() no-ops when financial_services or service_providers is missing", () => {
    const db = new Database(":memory:");
    expect(() => migration!.up(db)).not.toThrow();
    db.close();
  });

  it("up() no-ops (idempotent) when the FK is already present", () => {
    const db = createTestDb();
    migration!.up(db);
    const before = allRows(db);
    expect(() => migration!.up(db)).not.toThrow();
    expect(allRows(db)).toEqual(before);
    db.close();
  });
});
