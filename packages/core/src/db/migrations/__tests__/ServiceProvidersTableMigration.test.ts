/**
 * Migration v153 — add_service_providers_table
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 1).
 *
 * Proves:
 *  - `service_providers` is created with the columns the plan specifies
 *    (code, label, drawer_name, is_system_provider, is_active, is_system,
 *    sort_order) plus id/tenant_id/created_at/updated_at (rule 5).
 *  - Seeded with exactly the 9 existing `financial_services.provider` CHECK
 *    values, once PER EXISTING TENANT (mirrors migration v125's
 *    `SELECT id, ... FROM tenants` pattern), with drawer names matching
 *    `FinancialServiceRepository.mapDrawerName`'s hardcoded switch
 *    byte-for-byte.
 *  - Re-running `up()` is idempotent (INSERT OR IGNORE + UNIQUE(tenant_id, code)).
 *  - `down()` drops the table.
 *
 * Constructed directly against the migration's up()/down() — mirrors
 * `CommissionAtSettlementFoundationMigration.test.ts`'s
 * `MIGRATIONS.find(...)` pattern.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES
      (1, 'Default', 'default', 'active'),
      (2, 'Second Shop', 'second-shop', 'active');
  `);
  return db;
}

const migration = MIGRATIONS.find((m) => m.version === 153);

const EXPECTED_ROWS: Record<
  string,
  { drawer_name: string; is_system_provider: number; sort_order: number }
> = {
  OMT: { drawer_name: "OMT_System", is_system_provider: 1, sort_order: 0 },
  WHISH: { drawer_name: "Whish_System", is_system_provider: 1, sort_order: 1 },
  BOB: { drawer_name: "General", is_system_provider: 0, sort_order: 2 },
  OTHER: { drawer_name: "General", is_system_provider: 0, sort_order: 3 },
  iPick: { drawer_name: "iPick", is_system_provider: 0, sort_order: 4 },
  Katsh: { drawer_name: "Katsh", is_system_provider: 0, sort_order: 5 },
  WHISH_APP: { drawer_name: "Whish_App", is_system_provider: 0, sort_order: 6 },
  OMT_APP: { drawer_name: "OMT_App", is_system_provider: 0, sort_order: 7 },
  BINANCE: { drawer_name: "Binance", is_system_provider: 0, sort_order: 8 },
};

describe("Migration v153 — add_service_providers_table", () => {
  it("is registered at version 153", () => {
    expect(migration).toBeDefined();
    expect(migration!.name).toBe("add_service_providers_table");
  });

  it("creates the table and seeds all 9 provider codes for every existing tenant", () => {
    const db = createTestDb();
    migration!.up(db);

    const cols = db.prepare("PRAGMA table_info(service_providers)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);
    for (const expectedCol of [
      "id",
      "tenant_id",
      "code",
      "label",
      "drawer_name",
      "is_system_provider",
      "is_active",
      "is_system",
      "sort_order",
      "created_at",
      "updated_at",
    ]) {
      expect(colNames).toContain(expectedCol);
    }

    for (const tenantId of [1, 2]) {
      const rows = db
        .prepare(
          `SELECT code, drawer_name, is_system_provider, is_active, is_system, sort_order
           FROM service_providers WHERE tenant_id = ? ORDER BY sort_order`,
        )
        .all(tenantId) as {
        code: string;
        drawer_name: string;
        is_system_provider: number;
        is_active: number;
        is_system: number;
        sort_order: number;
      }[];

      expect(rows).toHaveLength(9);
      for (const row of rows) {
        const expected = EXPECTED_ROWS[row.code];
        expect(expected).toBeDefined();
        expect(row.drawer_name).toBe(expected.drawer_name);
        expect(row.is_system_provider).toBe(expected.is_system_provider);
        expect(row.sort_order).toBe(expected.sort_order);
        expect(row.is_active).toBe(1);
        expect(row.is_system).toBe(1);
      }
    }

    db.close();
  });

  it("is idempotent — running up() twice does not duplicate rows", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.up(db);

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM service_providers WHERE tenant_id = 1`)
      .get() as { n: number };
    expect(count.n).toBe(9);

    db.close();
  });

  it("down() drops the table", () => {
    const db = createTestDb();
    migration!.up(db);
    migration!.down!(db);

    const exists = db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'service_providers'`,
      )
      .get();
    expect(exists).toBeUndefined();

    db.close();
  });
});
