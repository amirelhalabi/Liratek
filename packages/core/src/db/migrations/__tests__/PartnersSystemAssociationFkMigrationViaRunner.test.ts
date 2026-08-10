/**
 * v155 (partners_system_association_to_fk) — driven through the REAL
 * migration runner (`runMigrations` / `rollbackTo`), not by hand-calling
 * `migration.up(db)` / `migration.down(db)` directly (that direct-call proof
 * lives in PartnersSystemAssociationFkMigration.test.ts, alongside this
 * file, mirroring telecomDaysCostMigrationsViaRunner.test.ts's split).
 *
 * Why this file exists: `partners` is the FK TARGET of other real tables —
 * `financial_services.partner_id` and `partner_ledger.partner_id` both
 * `REFERENCES partners(id)`. v155's up()/down() rebuild `partners` via
 * DROP + RENAME (SQLite has no ALTER-add-FK), and with `PRAGMA
 * foreign_keys = ON`, SQLite refuses to `DROP TABLE partners` while ANY row
 * in another table still references it — verified against a copy of the
 * real accumulated production database (financial_services/partner_ledger
 * rows referencing partner id 3, the owner's live 'Syria' partner).
 * `runMigrations()` already brackets its whole batch with
 * `foreign_keys = OFF` (pre-existing, line ~8899), so up() was always safe.
 * `rollbackTo()` did NOT have that bracket — a pre-existing gap this
 * migration's own down() is the first to expose, because no earlier
 * down()-rebuild target (e.g. v154's financial_services) is itself the FK
 * target of another table. Fixed in the SAME change (this file's own
 * describe block "rollbackTo() foreign_keys bracket" proves it, and rule 17
 * was satisfied by temporarily reverting the `rollbackTo` fix while writing
 * this file — the round-trip test below failed with "FOREIGN KEY constraint
 * failed" on the DROP TABLE step, exactly as reproduced manually against
 * the real database copy, before the fix was restored).
 */

import Database from "better-sqlite3";
import { runMigrations, rollbackTo, getCurrentVersion, MIGRATIONS } from "../index";

function createSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE service_providers (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
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
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );
    -- Minimal shape — real columns are far wider, but partner_id's FK to
    -- partners(id) is the ONLY thing this file needs to exercise (the exact
    -- real-world relationship that blocks a naive DROP TABLE partners).
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      provider TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      partner_id INTEGER REFERENCES partners(id)
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      amount REAL NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'DEBIT'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
    INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'WHISH', 'Whish', 'Whish_System');
    INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'SYRIA', 'Syria', 'General');
  `);
}

/** Mirrors telecomDaysCostMigrationsViaRunner.test.ts's identical helper. */
function markAppliedExcept(
  db: Database.Database,
  ...exceptVersions: number[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const m of MIGRATIONS) {
    if (!exceptVersions.includes(m.version)) {
      insert.run(m.version, m.name);
    }
  }
}

function isApplied(db: Database.Database, version: number): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM schema_migrations WHERE version = ?`)
      .get(version) !== undefined
  );
}

describe("v155 — via the real migration runner (runMigrations / rollbackTo)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    // A partner with real REFERENCING rows in BOTH financial_services and
    // partner_ledger — the exact shape found on the real database (the
    // owner's 'Syria' partner has financial_services rows against it).
    db.prepare(
      `INSERT INTO partners (id, tenant_id, name, system_association) VALUES (3, 1, 'Syria', 'SYRIA')`,
    ).run();
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, amount, partner_id) VALUES (1, 'SYRIA', 100, 3)`,
    ).run();
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, amount, direction) VALUES (1, 3, 100, 'DEBIT')`,
    ).run();

    markAppliedExcept(db, 155);
  });

  afterEach(() => {
    db.close();
  });

  it("runMigrations() applies v155 even with real financial_services/partner_ledger rows referencing the partner being rebuilt", () => {
    expect(() => runMigrations(db)).not.toThrow();
    expect(isApplied(db, 155)).toBe(true);

    const partner = db
      .prepare(`SELECT system_association FROM partners WHERE id = 3`)
      .get() as { system_association: string };
    expect(partner.system_association).toBe("SYRIA");

    // The referencing rows survive untouched (same ids, same partner_id).
    expect(
      db.prepare(`SELECT partner_id FROM financial_services WHERE id = 1`).get(),
    ).toEqual({ partner_id: 3 });
    expect(
      db.prepare(`SELECT partner_id FROM partner_ledger WHERE id = 1`).get(),
    ).toEqual({ partner_id: 3 });

    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rollbackTo(154) succeeds despite financial_services/partner_ledger rows referencing the partner — the exact case that needed the foreign_keys=OFF bracket fix in rollbackTo()", () => {
    runMigrations(db);
    expect(isApplied(db, 155)).toBe(true);

    // Before the fix, this threw "FOREIGN KEY constraint failed" on v155's
    // down() DROP TABLE partners step, because rollbackTo() (unlike
    // runMigrations()) never disabled foreign_keys before running down().
    expect(() => rollbackTo(db, 154)).not.toThrow();

    expect(isApplied(db, 155)).toBe(false);
    expect(getCurrentVersion(db)).toBe(154);

    // Data survives the rollback losslessly (v155's down() is lossless —
    // see the sibling direct-call test file).
    const partner = db
      .prepare(`SELECT system_association FROM partners WHERE id = 3`)
      .get() as { system_association: string };
    expect(partner.system_association).toBe("SYRIA");
    expect(
      db.prepare(`SELECT partner_id FROM financial_services WHERE id = 1`).get(),
    ).toEqual({ partner_id: 3 });
    expect(
      db.prepare(`SELECT partner_id FROM partner_ledger WHERE id = 1`).get(),
    ).toEqual({ partner_id: 3 });
  });

  it("full round trip: runMigrations() -> rollbackTo(154) -> runMigrations() again is stable", () => {
    runMigrations(db);
    rollbackTo(db, 154);
    expect(() => runMigrations(db)).not.toThrow();

    expect(isApplied(db, 155)).toBe(true);
    const partner = db
      .prepare(`SELECT system_association FROM partners WHERE id = 3`)
      .get() as { system_association: string };
    expect(partner.system_association).toBe("SYRIA");
    expect(db.pragma("foreign_key_check")).toEqual([]);

    // The FK genuinely re-applies and enforces: a bogus association is
    // rejected post-round-trip.
    expect(() =>
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Bad', 'NOT_A_PROVIDER')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
