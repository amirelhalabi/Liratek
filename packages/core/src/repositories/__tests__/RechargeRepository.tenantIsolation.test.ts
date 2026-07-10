/**
 * RechargeRepository — cross-tenant isolation (multi-tenant retrofit, WP3b,
 * CLAUDE.md rule 17 regression proof).
 *
 * `recharges` and `drawer_balances` are single physical tables shared by
 * every tenant. Two tenants are seeded with MIRRORED rows/balances — same
 * carrier/drawer names, DISTINCT amounts — so any cross-tenant leak in a
 * list, single-value, or grouped read shows up as a wrong number, not just
 * an extra row.
 *
 * This file proves, under `runWithTenant(1, ...)`:
 *   - getHistory() (the main history/list read) returns ONLY tenant 1's
 *     recharge for a carrier both tenants trade in.
 *   - getVirtualStock() (single-value aggregate reads of the MTC/Alfa
 *     drawers) returns ONLY tenant 1's balances.
 *   - getDrawerBalances() (a grouped, multi-drawer read) returns ONLY
 *     tenant 1's drawer rows with the exact seeded balances.
 *
 * Per rule 17: the getHistory() assertion below was verified to FAIL when
 * the `"AND tenant_id = ?"` predicate/param was temporarily removed from
 * `RechargeRepository.getHistory()` (both tenants' MTC recharges leaked
 * back in, inflating the row count from 1 to 2) — the predicate was then
 * restored and the revert verified identical via `git diff` before this
 * file was finalized.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const D = "2026-01-15 10:00:00";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL DEFAULT 0,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT,
      edited_at                TEXT
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
  `);
  return db;
}

/** Seed one tenant's mirrored MTC recharge + MTC/Alfa/General drawer balances. */
function seedTenant(db: Database.Database, tenantId: number, mult: number): void {
  db.prepare(
    `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code, created_at)
     VALUES (?, 'MTC', 'CREDIT_TRANSFER', ?, ?, ?, 'USD', ?)`,
  ).run(tenantId, 50 * mult, 45 * mult, 50 * mult, D);

  const balances: Array<[string, number]> = [
    ["MTC", 200 * mult],
    ["Alfa", 150 * mult],
    ["General", 1000 * mult],
  ];
  for (const [drawer, balance] of balances) {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (?, ?, 'USD', ?)`,
    ).run(tenantId, drawer, balance);
  }
}

describe("RechargeRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: RechargeRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__ = db;
    repo = new RechargeRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getHistory(): tenant 1 sees ONLY its own MTC recharge, not tenant 2's mirrored one", () => {
    seedTenant(db, 1, 1);
    seedTenant(db, 2, 20); // same carrier, wildly different amount

    const rowsT1 = runWithTenant(1, () => repo.getHistory("MTC"));
    expect(rowsT1).toHaveLength(1);
    expect(rowsT1[0].price).toBe(50);

    const rowsT2 = runWithTenant(2, () => repo.getHistory("MTC"));
    expect(rowsT2).toHaveLength(1);
    expect(rowsT2[0].price).toBe(1000);
  });

  it("getVirtualStock(): MTC/Alfa balances reflect ONLY the active tenant", () => {
    seedTenant(db, 1, 1);
    seedTenant(db, 2, 20);

    const stockT1 = runWithTenant(1, () => repo.getVirtualStock());
    expect(stockT1).toEqual({ mtc: 200, alfa: 150 });

    const stockT2 = runWithTenant(2, () => repo.getVirtualStock());
    expect(stockT2).toEqual({ mtc: 4000, alfa: 3000 });
  });

  it("getDrawerBalances(): grouped drawer read returns ONLY the active tenant's exact balances", () => {
    seedTenant(db, 1, 1);
    seedTenant(db, 2, 20);

    const drawersT1 = runWithTenant(1, () => repo.getDrawerBalances());
    expect(drawersT1).toHaveLength(3);
    expect(drawersT1.find((d) => d.name === "General")?.usdBalance).toBe(1000);
    expect(drawersT1.find((d) => d.name === "MTC")?.usdBalance).toBe(200);
    expect(drawersT1.find((d) => d.name === "Alfa")?.usdBalance).toBe(150);

    const drawersT2 = runWithTenant(2, () => repo.getDrawerBalances());
    expect(drawersT2.find((d) => d.name === "General")?.usdBalance).toBe(20000);
  });
});
