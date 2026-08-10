/**
 * Migration v155 — partners_system_association_to_fk
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4b).
 *
 * Proves:
 *  - `partners.system_association`'s previously unconstrained TEXT column is
 *    replaced by a composite FOREIGN KEY (tenant_id, system_association) ->
 *    service_providers(tenant_id, code) — NOT a bare `REFERENCES
 *    service_providers(code)`, which would throw "foreign key mismatch" on
 *    every statement against this table (service_providers only carries
 *    UNIQUE(tenant_id, code), no unique index on `code` alone — the same
 *    reason v154 discovered for financial_services.provider).
 *  - Every pre-existing row survives the rebuild byte-for-byte (id, all
 *    other columns), including a NULL system_association row, a NULL
 *    tenant_id legacy row (with a system_association value that would NOT
 *    match any tenant-1 provider), AND the owner's real 'SYRIA' provider/
 *    partner pair.
 *  - The pre-existing UNIQUE(tenant_id, name) constraint survives the
 *    rebuild untouched.
 *  - The new FK is genuinely enforced: a system_association with no matching
 *    service_providers row (for that tenant) is rejected; a configured one
 *    is accepted.
 *  - A NULL system_association bypasses the FK (a partner legitimately has
 *    no system — "None" in the dropdown) — SQLite's standard composite-FK
 *    NULL semantics.
 *  - A NULL tenant_id row (pre-multi-tenant legacy data) ALSO bypasses the
 *    FK regardless of what system_association says — the same "leave
 *    history alone" precedent v154 established for financial_services.
 *  - down() restores unconstrained TEXT — data-LOSSLESS (unlike v154's own
 *    down(), which had to drop rows the restored CHECK couldn't represent):
 *    a plain TEXT column can represent every value already stored, so
 *    nothing needs deleting on rollback. The full up() -> down() -> up()
 *    round trip is clean.
 *  - Defensive no-ops: partners/service_providers missing, or the FK
 *    already present (idempotent re-run).
 *
 * Constructed directly against the migration's up()/down()
 * (MIGRATIONS.find(...) pattern, mirrors FinancialServicesProviderFkMigration
 * .test.ts / ServiceProvidersTableMigration.test.ts).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 155);

// A representative (not exhaustive) subset of the real `partners` columns —
// enough to prove column/row preservation without hand-retyping every real
// column. Matches the live create_db.sql text this migration was written
// against (no CHECK on system_association to remove — it was ALWAYS plain
// unconstrained TEXT, unlike financial_services.provider's closed CHECK).
const PARTNERS_SCHEMA = `
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
  // new connection, so `partners.tenant_id REFERENCES tenants(id)` needs a
  // real parent table to exist or even PREPARING an unrelated INSERT throws
  // "no such table: main.tenants". Mirrors FinancialServicesProviderFkMigration
  // .test.ts's identical fixture for the identical reason.
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Second', 'second', 'active');
  `);
  db.exec(PARTNERS_SCHEMA);
  db.exec(SERVICE_PROVIDERS_SCHEMA);
  seedServiceProviders(db, 1);
  return db;
}

type PartnerRow = {
  id: number;
  tenant_id: number | null;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: number;
  system_association: string | null;
};

function allRows(db: Database.Database): PartnerRow[] {
  return db
    .prepare(
      `SELECT id, tenant_id, name, phone, notes, is_active, system_association FROM partners ORDER BY id`,
    )
    .all() as PartnerRow[];
}

describe("Migration v155 — partners_system_association_to_fk", () => {
  it("is registered at version 155", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("partners_system_association_to_fk");
  });

  it("rebuilds partners: unconstrained TEXT -> composite FK, preserving every row/column/UNIQUE constraint", () => {
    const db = createTestDb();

    db.prepare(
      `INSERT INTO partners (tenant_id, name, phone, is_active, system_association) VALUES (1, 'hwelet souria', '71000000', 1, 'WHISH')`,
    ).run();
    // No association at all — the "None" dropdown option — must survive AND
    // must bypass the new FK untouched.
    db.prepare(
      `INSERT INTO partners (tenant_id, name, is_active, system_association) VALUES (1, 'Unaffiliated Partner', 1, NULL)`,
    ).run();
    // Legacy pre-multi-tenant row: NULL tenant_id, with a system_association
    // that would NOT match any tenant-1 service_providers row verbatim by
    // coincidence — proves the NULL-tenant bypass, not a lucky match.
    db.prepare(
      `INSERT INTO partners (tenant_id, name, is_active, system_association) VALUES (NULL, 'Legacy Partner', 1, 'WHISH')`,
    ).run();

    const before = allRows(db);
    expect(before).toHaveLength(3);

    migration!.up(db);

    const after = allRows(db);
    expect(after).toEqual(before);

    // UNIQUE(tenant_id, name) survives the rebuild.
    expect(() =>
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'hwelet souria')`)
        .run(),
    ).toThrow(/UNIQUE constraint failed/);

    expect(db.pragma("foreign_key_check")).toEqual([]);

    db.close();
  });

  it("enforces the new FK: rejects an unconfigured system_association, accepts a real one, and lets NULL bypass", () => {
    const db = createTestDb();
    migration!.up(db);

    // Bogus association for tenant 1 — no matching service_providers row —
    // must now be rejected by the FK (previously this silently stored fine,
    // the exact "dangling reference" bug the plan calls out).
    expect(() =>
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Bad Partner', 'NOT_A_REAL_PROVIDER')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // A real, seeded provider for tenant 1 is accepted.
    const ok = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Whish Partner', 'WHISH')`,
      )
      .run();
    expect(ok.changes).toBe(1);

    // NULL system_association ("None") always bypasses the FK.
    const nullAssoc = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'No System Partner', NULL)`,
      )
      .run();
    expect(nullAssoc.changes).toBe(1);

    // The owner's real 'SYRIA' provider/partner pair (added AFTER this
    // migration shipped, mirroring phase 5's write path) — proves the FK
    // generalizes to any tenant-scoped provider, not just the original 9.
    db.prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'SYRIA', 'Syria', 'General')`,
    ).run();
    const syriaPartner = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'hwelet souria', 'SYRIA')`,
      )
      .run();
    expect(syriaPartner.changes).toBe(1);

    // A DIFFERENT tenant's partner cannot reference tenant 1's provider —
    // proves the FK is genuinely composite, not a bare `code` match.
    expect(() =>
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (2, 'Tenant 2 Partner', 'WHISH')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);

    // A NULL tenant_id (legacy) row bypasses the FK regardless of the
    // system_association value — the composite key has a NULL member.
    const legacyRow = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, system_association) VALUES (NULL, 'Legacy No-Tenant Partner', 'TOTALLY_UNSEEDED')`,
      )
      .run();
    expect(legacyRow.changes).toBe(1);

    expect(db.pragma("foreign_key_check")).toEqual([]);

    db.close();
  });

  it("down() restores unconstrained TEXT losslessly (no rows deleted, unlike v154) and the full round trip is clean", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'hwelet souria', 'WHISH')`,
    ).run();
    const before = allRows(db);

    migration!.up(db);

    // Add a provider + partner AFTER up() — simulating phase 5's live write
    // path — to prove down() does NOT delete it (data-lossless, the whole
    // point of the doc comment's contrast with v154's down()).
    db.prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'SYRIA', 'Syria', 'General')`,
    ).run();
    db.prepare(
      `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Syria Partner', 'SYRIA')`,
    ).run();

    migration!.down!(db);

    const afterDown = allRows(db);
    expect(afterDown).toHaveLength(2);
    expect(afterDown.find((r) => r.name === "hwelet souria")).toEqual(
      before[0],
    );
    // The post-migration 'SYRIA' association survives rollback untouched —
    // unconstrained TEXT can represent it, nothing to delete.
    expect(
      afterDown.find((r) => r.name === "Syria Partner")?.system_association,
    ).toBe("SYRIA");

    // The FK is gone: a bogus association is now accepted again (reverted
    // to the original unconstrained-TEXT behavior) — proves down() genuinely
    // removed the constraint, not just renamed it.
    const bogus = db
      .prepare(
        `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Anything Goes', 'NOT_A_REAL_PROVIDER')`,
      )
      .run();
    expect(bogus.changes).toBe(1);

    // UNIQUE(tenant_id, name) still survives after rollback.
    expect(() =>
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'hwelet souria')`)
        .run(),
    ).toThrow(/UNIQUE constraint failed/);

    // Remove the bogus row before round-tripping up() again — re-applying
    // the FK on top of data that genuinely violates it SHOULD fail (proved
    // by the next test below); this test's own point is that a CLEAN
    // rolled-back schema round-trips, matching v154's round-trip test shape.
    db.prepare(`DELETE FROM partners WHERE name = 'Anything Goes'`).run();

    migration!.up(db);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(allRows(db)).toHaveLength(2); // hwelet souria, Syria Partner

    db.close();
  });

  it("re-applying up() on genuinely drifted data (a stray bad association left over from the down()-unconstrained window) fails loudly instead of silently dropping it", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);

    // While the FK is absent (post-down), nothing stops a bad value from
    // being written — exactly the "pre-flight" scenario this migration's
    // own description warns about ("existing data must satisfy the FK or
    // the rebuild fails"). Re-applying up() on top of it must NOT silently
    // drop the row (rule 20 — no silent data loss); it must fail loudly.
    db.prepare(
      `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Drifted Partner', 'NOT_A_REAL_PROVIDER')`,
    ).run();

    expect(() => migration!.up(db)).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it("up() no-ops when partners or service_providers is missing", () => {
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

  it("down() no-ops when partners is missing, or the FK was never applied", () => {
    const dbMissing = new Database(":memory:");
    expect(() => migration!.down!(dbMissing)).not.toThrow();
    dbMissing.close();

    const dbNoFk = createTestDb();
    expect(() => migration!.down!(dbNoFk)).not.toThrow();
    dbNoFk.close();
  });
});
