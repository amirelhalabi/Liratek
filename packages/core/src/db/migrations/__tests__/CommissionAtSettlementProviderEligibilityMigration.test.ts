/**
 * Migration v151 — commission_at_settlement_provider_eligibility
 * (COMMISSION_AT_SETTLEMENT_PLAN.md §6 D12 / LIRA-112).
 *
 * Owner: "i said ipick bills gives us no comission, but katsh does... at
 * settlement in suppliers page we should showcase an estimated commission
 * amount for the customer 20,000 LBP per bill sold. Whereas in ipick its not
 * the case."
 *
 * Proves:
 *  - `suppliers.commission_eligible` is added, default 1 (eligible) for
 *    every PRE-EXISTING row — the CLAUDE.md rule-10 guarantee, precedent
 *    `CommissionAtSettlementFoundationMigration.test.ts` (v150).
 *  - `suppliers.commission_rate_currency` is added, default 'USD'.
 *  - The data backfill: every existing iPick row -> commission_eligible = 0;
 *    every existing Katsh row -> commission_eligible = 1,
 *    commission_entry_mode = 'RATE', commission_rate = 20000,
 *    commission_rate_currency = 'LBP'. Matched by `provider` across ALL
 *    tenants (forward-only — owner: "Historical ipick leave them i dont
 *    care" — this migration only touches the CONFIG that gates future bills,
 *    never a posted commission row).
 *  - Every OTHER supplier (OMT, WHISH, ...) is unaffected — still eligible,
 *    still whatever entry_mode/rate it already had.
 *  - The CHECK constraints (commission_eligible IN (0,1),
 *    commission_rate_currency IN ('USD','LBP')).
 *  - down() reverses all of it (including Katsh's v150-column data, which
 *    v151's up() is what wrote), and is defensive against a suppliers-less
 *    DB (mirrors v150's guard).
 *
 * Constructed directly against the migration's up()/down() (mirrors
 * `CommissionAtSettlementFoundationMigration.test.ts`'s
 * `MIGRATIONS.find(...)` pattern).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      provider TEXT,
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL
    );
  `);
  return db;
}

function insertSupplier(
  db: Database.Database,
  opts: { name: string; provider: string | null; tenantId?: number },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO suppliers (name, provider, tenant_id) VALUES (?, ?, ?)`,
      )
      .run(opts.name, opts.provider, opts.tenantId ?? 1).lastInsertRowid,
  );
}

describe("migration v151 — commission_at_settlement_provider_eligibility", () => {
  const v151 = MIGRATIONS.find((m) => m.version === 151)!;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists and has a down()", () => {
    expect(v151).toBeDefined();
    expect(
      Math.max(...MIGRATIONS.map((m) => m.version)),
    ).toBeGreaterThanOrEqual(151);
    expect(typeof v151.down).toBe("function");
  });

  it("rejects commission_eligible/commission_rate_currency BEFORE the migration runs", () => {
    insertSupplier(db, { name: "iPick", provider: "iPick" });
    expect(() =>
      db.prepare(`SELECT commission_eligible FROM suppliers`).get(),
    ).toThrow(/no such column/);
    expect(() =>
      db.prepare(`SELECT commission_rate_currency FROM suppliers`).get(),
    ).toThrow(/no such column/);
  });

  it("every PRE-EXISTING supplier (that is NOT iPick/Katsh) reads commission_eligible = 1, commission_rate_currency = 'USD' after the ALTER (rule 10)", () => {
    const omtId = insertSupplier(db, { name: "OMT", provider: "OMT" });

    v151.up(db);

    const row = db
      .prepare(
        `SELECT commission_eligible, commission_rate_currency FROM suppliers WHERE id = ?`,
      )
      .get(omtId) as {
      commission_eligible: number;
      commission_rate_currency: string;
    };
    expect(row.commission_eligible).toBe(1);
    expect(row.commission_rate_currency).toBe("USD");
  });

  it("backfills EVERY existing iPick row to commission_eligible = 0 (LIRA-112 — no commission, ever)", () => {
    const ipickTenant1 = insertSupplier(db, {
      name: "iPick",
      provider: "iPick",
      tenantId: 1,
    });
    const ipickTenant2 = insertSupplier(db, {
      name: "iPick",
      provider: "iPick",
      tenantId: 2,
    });

    v151.up(db);

    for (const id of [ipickTenant1, ipickTenant2]) {
      const row = db
        .prepare(`SELECT commission_eligible FROM suppliers WHERE id = ?`)
        .get(id) as { commission_eligible: number };
      expect(row.commission_eligible).toBe(0);
    }
  });

  it("backfills EVERY existing Katsh row to commission_eligible = 1, entry_mode = 'RATE', rate = 20000, currency = 'LBP'", () => {
    const katshTenant1 = insertSupplier(db, {
      name: "Katsh",
      provider: "Katsh",
      tenantId: 1,
    });
    const katshTenant2 = insertSupplier(db, {
      name: "Katsh",
      provider: "Katsh",
      tenantId: 2,
    });

    v151.up(db);

    for (const id of [katshTenant1, katshTenant2]) {
      const row = db
        .prepare(
          `SELECT commission_eligible, commission_entry_mode, commission_rate, commission_rate_currency
             FROM suppliers WHERE id = ?`,
        )
        .get(id) as {
        commission_eligible: number;
        commission_entry_mode: string;
        commission_rate: number;
        commission_rate_currency: string;
      };
      expect(row.commission_eligible).toBe(1);
      expect(row.commission_entry_mode).toBe("RATE");
      expect(row.commission_rate).toBe(20000);
      expect(row.commission_rate_currency).toBe("LBP");
    }
  });

  it("leaves a supplier's PRE-EXISTING commission_entry_mode/commission_rate untouched if it isn't iPick/Katsh", () => {
    const whishId = insertSupplier(db, { name: "Whish", provider: "WHISH" });
    db.prepare(
      `UPDATE suppliers SET commission_entry_mode = 'RATE', commission_rate = 5 WHERE id = ?`,
    ).run(whishId);

    v151.up(db);

    const row = db
      .prepare(
        `SELECT commission_entry_mode, commission_rate, commission_eligible FROM suppliers WHERE id = ?`,
      )
      .get(whishId) as {
      commission_entry_mode: string;
      commission_rate: number;
      commission_eligible: number;
    };
    expect(row.commission_entry_mode).toBe("RATE");
    expect(row.commission_rate).toBe(5);
    expect(row.commission_eligible).toBe(1);
  });

  it("enforces the commission_eligible CHECK (0 or 1 only)", () => {
    const id = insertSupplier(db, { name: "OMT", provider: "OMT" });
    v151.up(db);
    expect(() =>
      db
        .prepare(`UPDATE suppliers SET commission_eligible = 2 WHERE id = ?`)
        .run(id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("enforces the commission_rate_currency CHECK ('USD'/'LBP' only)", () => {
    const id = insertSupplier(db, { name: "OMT", provider: "OMT" });
    v151.up(db);
    expect(() =>
      db
        .prepare(
          `UPDATE suppliers SET commission_rate_currency = 'EUR' WHERE id = ?`,
        )
        .run(id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("down() drops both new columns and reverts Katsh's v150-column data, preserving rows", () => {
    const katshId = insertSupplier(db, { name: "Katsh", provider: "Katsh" });
    const ipickId = insertSupplier(db, { name: "iPick", provider: "iPick" });

    v151.up(db);
    v151.down!(db);

    expect(() =>
      db.prepare(`SELECT commission_eligible FROM suppliers`).get(),
    ).toThrow(/no such column/);
    expect(() =>
      db.prepare(`SELECT commission_rate_currency FROM suppliers`).get(),
    ).toThrow(/no such column/);

    const katshRow = db
      .prepare(
        `SELECT name, commission_entry_mode, commission_rate FROM suppliers WHERE id = ?`,
      )
      .get(katshId) as {
      name: string;
      commission_entry_mode: string;
      commission_rate: number | null;
    };
    expect(katshRow.name).toBe("Katsh");
    expect(katshRow.commission_entry_mode).toBe("LUMP");
    expect(katshRow.commission_rate).toBeNull();

    const ipickRow = db
      .prepare(`SELECT name FROM suppliers WHERE id = ?`)
      .get(ipickId) as { name: string };
    expect(ipickRow.name).toBe("iPick");
  });

  it("up() is a no-op (skips cleanly) when 'suppliers' doesn't exist — the migration-runner synthetic-harness scenario", () => {
    const bareDb = new Database(":memory:");
    bareDb.pragma("foreign_keys = OFF");
    expect(() => v151.up(bareDb)).not.toThrow();
    const tables = bareDb
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all();
    expect(tables).toHaveLength(0);
    bareDb.close();
  });

  it("down() is defensive against the same suppliers-less DB", () => {
    const bareDb = new Database(":memory:");
    bareDb.pragma("foreign_keys = OFF");
    expect(() => v151.down!(bareDb)).not.toThrow();
    bareDb.close();
  });
});
