/**
 * ExchangeLotRepository — the FIFO cost-basis engine
 * (EXCHANGE_LOT_SETTLEMENT.md Phase 2).
 *
 * This repository is a standalone engine over the three tables migration
 * v156 created (`exchange_lots`, `exchange_lot_settlements`,
 * `exchange_position_adjustments`) — it never touches payments/drawers/the
 * unified `transactions` ledger (Phase 3 wires it into
 * `ExchangeRepository.createTransaction` and the void/refund reversal
 * paths; nothing here depends on that wiring existing yet).
 *
 * Covers: FIFO order + same-timestamp id tiebreak, partial/multi-lot/
 * oversell consumption with both gain and loss profit signs,
 * previewConsume's zero-write parity with consumeFifo, restoreSettlements'
 * idempotent restore (including MARKET rows), the open-lot predicate
 * skipping voided/depleted lots, tenant isolation, getPositions' weighted
 * average, the getSummaryForSettlers/getSummaryForSources batched reads, and
 * adjust()'s add/write-off/guard paths.
 */

import Database from "better-sqlite3";
import {
  ExchangeLotRepository,
  type ExchangeLotEntity,
  type ExchangeLotSettlementEntity,
} from "../ExchangeLotRepository";
import { runWithTenant } from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one'), (2, 'Two', 'two');

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
    INSERT INTO currencies (tenant_id, code, name) VALUES
      (1, 'EUR', 'Euro'), (1, 'USD', 'US Dollar'), (1, 'LBP', 'Lebanese Pound'),
      (1, 'GBP', 'British Pound'), (1, 'AED', 'UAE Dirham'), (1, 'CHF', 'Swiss Franc'),
      (2, 'EUR', 'Euro');

    CREATE TABLE exchange_lots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER REFERENCES tenants(id),
      currency_code  TEXT NOT NULL,
      drawer_name    TEXT NOT NULL DEFAULT 'General',
      source_type    TEXT NOT NULL CHECK(source_type IN ('EXCHANGE_BUY', 'DRAWER_TOPUP', 'ADJUSTMENT')),
      source_table   TEXT,
      source_id      INTEGER,
      original_qty   REAL NOT NULL,
      remaining_qty  REAL NOT NULL,
      unit_cost_usd  REAL NOT NULL,
      acquired_at    DATETIME NOT NULL,
      is_voided      INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
    );
    CREATE INDEX idx_exchange_lots_tenant_id ON exchange_lots(tenant_id);
    CREATE INDEX idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);

    CREATE TABLE exchange_lot_settlements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      lot_id             INTEGER REFERENCES exchange_lots(id) ON DELETE SET NULL,
      basis_source       TEXT NOT NULL CHECK(basis_source IN ('LOT', 'MARKET')),
      settled_by_table   TEXT NOT NULL,
      settled_by_id      INTEGER NOT NULL,
      qty                REAL NOT NULL,
      unit_cost_usd      REAL NOT NULL,
      unit_proceeds_usd  REAL NOT NULL,
      profit_usd         REAL NOT NULL,
      is_refunded        INTEGER NOT NULL DEFAULT 0,
      refunded_at        TEXT,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_exchange_lot_settlements_tenant_id ON exchange_lot_settlements(tenant_id);
    CREATE INDEX idx_exchange_lot_settlements_lot ON exchange_lot_settlements(tenant_id, lot_id);
    CREATE INDEX idx_exchange_lot_settlements_settled_by ON exchange_lot_settlements(tenant_id, settled_by_table, settled_by_id);

    CREATE TABLE exchange_position_adjustments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER REFERENCES tenants(id),
      currency_code  TEXT NOT NULL,
      qty            REAL NOT NULL,
      unit_cost_usd  REAL,
      note           TEXT,
      created_by     TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
    );
    CREATE INDEX idx_exchange_position_adjustments_tenant_id ON exchange_position_adjustments(tenant_id);
    CREATE INDEX idx_exchange_position_adjustments_currency ON exchange_position_adjustments(tenant_id, currency_code);
  `);
  return db;
}

function lotRow(
  db: Database.Database,
  id: number,
): ExchangeLotEntity | undefined {
  return db.prepare(`SELECT * FROM exchange_lots WHERE id = ?`).get(id) as
    | ExchangeLotEntity
    | undefined;
}

function settlementRows(db: Database.Database): ExchangeLotSettlementEntity[] {
  return db
    .prepare(`SELECT * FROM exchange_lot_settlements ORDER BY id ASC`)
    .all() as ExchangeLotSettlementEntity[];
}

function countRows(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

describe("ExchangeLotRepository", () => {
  let db: Database.Database;
  let repo: ExchangeLotRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new ExchangeLotRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ---------------------------------------------------------------------------
  // createLot
  // ---------------------------------------------------------------------------

  describe("createLot", () => {
    it("inserts a lot with original_qty = remaining_qty = qty", () => {
      const lot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 1,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      expect(lot.currency_code).toBe("EUR");
      expect(lot.drawer_name).toBe("General");
      expect(lot.original_qty).toBe(2000);
      expect(lot.remaining_qty).toBe(2000);
      expect(lot.unit_cost_usd).toBe(1.09);
      expect(lot.is_voided).toBe(0);
      expect(lot.source_type).toBe("EXCHANGE_BUY");
    });
  });

  // ---------------------------------------------------------------------------
  // FIFO order + same-timestamp id tiebreak
  // ---------------------------------------------------------------------------

  describe("consumeFifo — ordering", () => {
    it("orders strictly by acquired_at, and by id ASC when two lots share one timestamp", () => {
      // Lot A: created FIRST (lowest id) but the LATEST acquired_at — must
      // be consumed LAST if ordering is genuinely by acquired_at, not
      // insertion/id order.
      const lotA = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 1,
        qty: 100,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-21 09:00:00",
      });
      // Lot B and Lot C share the SAME (earlier) acquired_at — the id
      // tiebreak must order B (lower id) before C.
      const lotB = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 2,
        qty: 100,
        unitCostUsd: 2.0,
        acquiredAt: "2026-08-19 09:00:00",
      });
      const lotC = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 3,
        qty: 100,
        unitCostUsd: 3.0,
        acquiredAt: "2026-08-19 09:00:00",
      });
      // B and C share one acquired_at — the id tiebreak must order the
      // lower id (B) first, regardless of overall creation order.
      expect(lotB.id).toBeLessThan(lotC.id);

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 250,
        unitProceedsUsd: 5.0,
        marketUnitCostUsd: 5.0,
        settledByTable: "exchange_transactions",
        settledById: 999,
      });

      expect(result.settlements).toHaveLength(3);
      expect(result.settlements[0].lot_id).toBe(lotB.id);
      expect(result.settlements[0].qty).toBe(100);
      expect(result.settlements[1].lot_id).toBe(lotC.id);
      expect(result.settlements[1].qty).toBe(100);
      expect(result.settlements[2].lot_id).toBe(lotA.id);
      expect(result.settlements[2].qty).toBe(50);
      expect(result.marketQty).toBe(0);
      expect(result.coveredQty).toBe(250);
    });
  });

  // ---------------------------------------------------------------------------
  // Partial / multi-lot / oversell consumption + profit sign
  // ---------------------------------------------------------------------------

  describe("consumeFifo — partial consumption", () => {
    it("realizes a GAIN when proceeds exceed cost", () => {
      const lot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 10,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 1000,
        unitProceedsUsd: 1.15,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 20,
      });

      expect(result.settlements).toHaveLength(1);
      expect(result.settlements[0].basis_source).toBe("LOT");
      expect(result.settlements[0].qty).toBe(1000);
      expect(result.realizedProfitUsd).toBeCloseTo(60, 6);
      expect(result.coveredQty).toBe(1000);
      expect(result.marketQty).toBe(0);

      const after = lotRow(db, lot.id)!;
      expect(after.remaining_qty).toBe(1000);
    });

    it("realizes a LOSS when proceeds are below cost — negative profit is first-class (Q10)", () => {
      const lot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 11,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 1000,
        unitProceedsUsd: 1.05,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 21,
      });

      expect(result.settlements[0].profit_usd).toBeCloseTo(-40, 6);
      expect(result.realizedProfitUsd).toBeCloseTo(-40, 6);

      const after = lotRow(db, lot.id)!;
      expect(after.remaining_qty).toBe(1000);
    });
  });

  describe("consumeFifo — multi-lot consumption", () => {
    it("spans lot A's remainder + lot B, one settlement row per lot, exact profit sum", () => {
      const lotA = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 30,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-18 10:00:00",
      });
      const lotB = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 31,
        qty: 1000,
        unitCostUsd: 1.12,
        acquiredAt: "2026-08-19 10:00:00",
      });

      // Pre-drain lot A down to a 500 remainder.
      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 1500,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 40,
      });
      expect(lotRow(db, lotA.id)!.remaining_qty).toBe(500);

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 800,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 41,
      });

      expect(result.settlements).toHaveLength(2);
      expect(result.settlements[0].lot_id).toBe(lotA.id);
      expect(result.settlements[0].qty).toBe(500);
      expect(result.settlements[0].profit_usd).toBeCloseTo(
        500 * (1.2 - 1.09),
        6,
      );
      expect(result.settlements[1].lot_id).toBe(lotB.id);
      expect(result.settlements[1].qty).toBe(300);
      expect(result.settlements[1].profit_usd).toBeCloseTo(
        300 * (1.2 - 1.12),
        6,
      );

      const expectedSum =
        Math.round(500 * (1.2 - 1.09) * 100) / 100 +
        Math.round(300 * (1.2 - 1.12) * 100) / 100;
      expect(result.realizedProfitUsd).toBeCloseTo(expectedSum, 6);
      expect(result.coveredQty).toBe(800);
      expect(result.marketQty).toBe(0);

      expect(lotRow(db, lotA.id)!.remaining_qty).toBe(0);
      expect(lotRow(db, lotB.id)!.remaining_qty).toBe(700);
    });
  });

  describe("consumeFifo — oversell (Q6)", () => {
    it("covers what it can from lots and settles the uncovered slice at MARKET basis — never blocks", () => {
      const lot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 50,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 3000,
        unitProceedsUsd: 1.15,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 51,
      });

      expect(result.settlements).toHaveLength(2);
      expect(result.settlements[0].basis_source).toBe("LOT");
      expect(result.settlements[0].lot_id).toBe(lot.id);
      expect(result.settlements[0].qty).toBe(2000);
      expect(result.settlements[1].basis_source).toBe("MARKET");
      expect(result.settlements[1].lot_id).toBeNull();
      expect(result.settlements[1].qty).toBe(1000);
      expect(result.settlements[1].unit_cost_usd).toBe(1.2);

      expect(result.coveredQty).toBe(2000);
      expect(result.marketQty).toBe(1000);

      const expectedProfit =
        Math.round(2000 * (1.15 - 1.09) * 100) / 100 +
        Math.round(1000 * (1.15 - 1.2) * 100) / 100;
      expect(result.realizedProfitUsd).toBeCloseTo(expectedProfit, 6);

      expect(lotRow(db, lot.id)!.remaining_qty).toBe(0);

      // Exactly one MARKET row was written.
      const rows = settlementRows(db);
      expect(rows.filter((r) => r.basis_source === "MARKET")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // previewConsume
  // ---------------------------------------------------------------------------

  describe("previewConsume", () => {
    it("returns identical numbers to consumeFifo and writes NOTHING", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 60,
        qty: 2000,
        unitCostUsd: 1.09,
        acquiredAt: "2026-08-20 10:00:00",
      });

      const beforeLotCount = countRows(db, "exchange_lots");
      const beforeSettlementCount = countRows(db, "exchange_lot_settlements");

      const preview = repo.previewConsume({
        currencyCode: "EUR",
        qty: 1200,
        unitProceedsUsd: 1.18,
        marketUnitCostUsd: 1.1,
      });

      expect(countRows(db, "exchange_lots")).toBe(beforeLotCount);
      expect(countRows(db, "exchange_lot_settlements")).toBe(
        beforeSettlementCount,
      );
      expect(preview.settlements.every((s) => s.id === null)).toBe(true);

      const real = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 1200,
        unitProceedsUsd: 1.18,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 61,
      });

      expect(real.realizedProfitUsd).toBe(preview.realizedProfitUsd);
      expect(real.coveredQty).toBe(preview.coveredQty);
      expect(real.marketQty).toBe(preview.marketQty);
      expect(real.settlements.map((s) => s.qty)).toEqual(
        preview.settlements.map((s) => s.qty),
      );
      expect(real.settlements.map((s) => s.profit_usd)).toEqual(
        preview.settlements.map((s) => s.profit_usd),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // restoreSettlements
  // ---------------------------------------------------------------------------

  describe("restoreSettlements", () => {
    it("restores exact quantities, flags rows, and is idempotent (second call restores nothing)", () => {
      const lotA = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 70,
        qty: 1000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });
      const lotB = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 71,
        qty: 1000,
        unitCostUsd: 1.1,
        acquiredAt: "2026-08-19 10:00:00",
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 1500,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.15,
        settledByTable: "exchange_transactions",
        settledById: 42,
      });
      expect(lotRow(db, lotA.id)!.remaining_qty).toBe(0);
      expect(lotRow(db, lotB.id)!.remaining_qty).toBe(500);

      const restoredCount = repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 42,
      });
      expect(restoredCount).toBe(2);

      expect(lotRow(db, lotA.id)!.remaining_qty).toBe(1000);
      expect(lotRow(db, lotB.id)!.remaining_qty).toBe(1000);

      const rows = settlementRows(db);
      expect(rows.every((r) => r.is_refunded === 1)).toBe(true);
      expect(rows.every((r) => r.refunded_at !== null)).toBe(true);

      // Idempotent: nothing left to restore.
      const secondCall = repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 42,
      });
      expect(secondCall).toBe(0);
      expect(lotRow(db, lotA.id)!.remaining_qty).toBe(1000);
      expect(lotRow(db, lotB.id)!.remaining_qty).toBe(1000);
    });

    it("flags a MARKET settlement as refunded without touching any lot (it has none)", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 80,
        qty: 500,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 800,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.05,
        settledByTable: "exchange_transactions",
        settledById: 77,
      });

      const restoredCount = repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 77,
      });
      expect(restoredCount).toBe(2); // one LOT row + one MARKET row

      const rows = settlementRows(db);
      const marketRow = rows.find((r) => r.basis_source === "MARKET")!;
      expect(marketRow.is_refunded).toBe(1);
      expect(marketRow.lot_id).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Open-lot predicate: voided + depleted lots are skipped
  // ---------------------------------------------------------------------------

  describe("open-lot predicate", () => {
    it("skips a voided lot and a depleted (near-zero remainder) lot, consuming only from the real open lot", () => {
      const voidedLot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 90,
        qty: 500,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-15 10:00:00",
      });
      repo.voidLotsBySource({
        sourceTable: "exchange_transactions",
        sourceId: 90,
      });

      const depletedLot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 91,
        qty: 500,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-16 10:00:00",
      });
      // Simulate float dust left after full consumption elsewhere — below
      // LOT_QTY_EPSILON (0.005), must still be treated as depleted.
      db.prepare(
        `UPDATE exchange_lots SET remaining_qty = 0.001 WHERE id = ?`,
      ).run(depletedLot.id);

      const openLot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 92,
        qty: 300,
        unitCostUsd: 1.5,
        acquiredAt: "2026-08-17 10:00:00",
      });

      const result = repo.consumeFifo({
        currencyCode: "EUR",
        qty: 200,
        unitProceedsUsd: 1.6,
        marketUnitCostUsd: 1.6,
        settledByTable: "exchange_transactions",
        settledById: 93,
      });

      expect(result.settlements).toHaveLength(1);
      expect(result.settlements[0].lot_id).toBe(openLot.id);
      expect(result.marketQty).toBe(0);

      expect(lotRow(db, voidedLot.id)!.remaining_qty).toBe(500); // untouched
      expect(lotRow(db, depletedLot.id)!.remaining_qty).toBe(0.001); // untouched
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe("tenant isolation", () => {
    it("tenant 2's lots are invisible to tenant 1's consume/positions, and vice versa", () => {
      runWithTenant(1, () => {
        repo.createLot({
          currencyCode: "EUR",
          sourceType: "EXCHANGE_BUY",
          sourceTable: "exchange_transactions",
          sourceId: 100,
          qty: 1000,
          unitCostUsd: 1.0,
          acquiredAt: "2026-08-20 10:00:00",
        });
      });

      runWithTenant(2, () => {
        repo.createLot({
          currencyCode: "EUR",
          sourceType: "EXCHANGE_BUY",
          sourceTable: "exchange_transactions",
          sourceId: 101,
          qty: 5000,
          unitCostUsd: 2.0,
          acquiredAt: "2026-08-20 10:00:00",
        });
      });

      const positions1 = runWithTenant(1, () => repo.getPositions());
      expect(positions1).toHaveLength(1);
      expect(positions1[0].open_qty).toBe(1000);

      const positions2 = runWithTenant(2, () => repo.getPositions());
      expect(positions2).toHaveLength(1);
      expect(positions2[0].open_qty).toBe(5000);

      // Tenant 1 consumes MORE than its own 1000 open — deliberately more
      // than tenant 1 has, so tenant 2's 5000 (same currency, same
      // acquired_at) is sitting right there as an easy leak: if the FIFO
      // scan is not tenant-scoped, the shortfall silently gets covered by
      // tenant 2's lot (coveredQty 1500, marketQty 0) instead of falling
      // through to the Q6 MARKET slice. Consuming exactly tenant 1's own
      // open amount (1000) would NOT catch this — it would coincidentally
      // pass even with the tenant filter missing, since FIFO's own id
      // tiebreak already puts tenant 1's (earlier-created) lot first.
      const result = runWithTenant(1, () =>
        repo.consumeFifo({
          currencyCode: "EUR",
          qty: 1500,
          unitProceedsUsd: 1.1,
          marketUnitCostUsd: 1.1,
          settledByTable: "exchange_transactions",
          settledById: 200,
        }),
      );
      expect(result.coveredQty).toBe(1000);
      expect(result.marketQty).toBe(500);
      expect(
        result.settlements.filter((s) => s.basis_source === "LOT"),
      ).toHaveLength(1);

      // Tenant 2's lot must be untouched by tenant 1's consumption.
      const positions2After = runWithTenant(2, () => repo.getPositions());
      expect(positions2After[0].open_qty).toBe(5000);
    });
  });

  // ---------------------------------------------------------------------------
  // getPositions
  // ---------------------------------------------------------------------------

  describe("getPositions", () => {
    it("computes open qty and the weighted-average unit cost across open lots", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 110,
        qty: 1000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 111,
        qty: 1000,
        unitCostUsd: 1.2,
        acquiredAt: "2026-08-19 10:00:00",
      });
      // Partially consume ONLY the first (oldest) lot down to a 500
      // remainder, leaving the second lot untouched — both stay open with
      // DIFFERENT remaining_qty, so the weighted average genuinely has to
      // weight by remaining_qty (500 and 1000) rather than original_qty
      // (which would wrongly weight 1000/1000 evenly).
      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 500,
        unitProceedsUsd: 1.3,
        marketUnitCostUsd: 1.3,
        settledByTable: "exchange_transactions",
        settledById: 120,
      });

      const positions = repo.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].currency_code).toBe("EUR");
      expect(positions[0].open_qty).toBe(1500);
      expect(positions[0].lot_count).toBe(2);
      const expectedAvg = (500 * 1.0 + 1000 * 1.2) / 1500;
      expect(positions[0].avg_unit_cost_usd).toBeCloseTo(expectedAvg, 10);
    });

    it("returns an empty array when nothing is open", () => {
      expect(repo.getPositions()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getSummaryForSettlers / getSummaryForSources
  // ---------------------------------------------------------------------------

  describe("getSummaryForSettlers / getSummaryForSources", () => {
    it("getSummaryForSettlers aggregates ACTIVE-only qty/profit per settler, ids.length===0 -> {}", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 130,
        qty: 2000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 800,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 200,
      });
      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 200,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 201,
      });
      // Refund settler 201 entirely — its qty/profit must drop OUT of the summary.
      repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 201,
      });

      const summary = repo.getSummaryForSettlers(
        "exchange_transactions",
        [200, 201, 999],
      );
      expect(summary[200].settled_qty).toBe(800);
      expect(summary[200].realized_profit_usd).toBeCloseTo(80, 6);
      expect(summary[201]).toBeUndefined();
      expect(summary[999]).toBeUndefined();

      expect(repo.getSummaryForSettlers("exchange_transactions", [])).toEqual(
        {},
      );
    });

    it("getSummaryForSources derives Open/Partial/Settled/Voided status data", () => {
      // Each status case gets its OWN currency — FIFO always drains the
      // oldest open lot first WITHIN a currency, so producing an
      // independently "Partial" lot and a separately "Settled" lot in the
      // SAME currency queue is impossible by construction (consuming enough
      // to finish an older partial lot would necessarily start eating into
      // whatever comes after it). Isolating by currency removes that
      // ordering coupling and lets each case assert its own status cleanly.

      // Settled: fully consumed.
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 301,
        qty: 2000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      // Partial: consumed 800 of 2000.
      repo.createLot({
        currencyCode: "GBP",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 302,
        qty: 2000,
        unitCostUsd: 1.27,
        acquiredAt: "2026-08-19 10:00:00",
      });

      // Settled (a second case): fully consumed.
      repo.createLot({
        currencyCode: "AED",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 303,
        qty: 500,
        unitCostUsd: 0.27,
        acquiredAt: "2026-08-20 10:00:00",
      });

      // Voided: never settled.
      repo.createLot({
        currencyCode: "CHF",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 304,
        qty: 700,
        unitCostUsd: 1.1,
        acquiredAt: "2026-08-21 10:00:00",
      });
      repo.voidLotsBySource({
        sourceTable: "exchange_transactions",
        sourceId: 304,
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 2000,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 400,
      });
      repo.consumeFifo({
        currencyCode: "GBP",
        qty: 800,
        unitProceedsUsd: 1.3,
        marketUnitCostUsd: 1.3,
        settledByTable: "exchange_transactions",
        settledById: 401,
      });
      repo.consumeFifo({
        currencyCode: "AED",
        qty: 500,
        unitProceedsUsd: 0.3,
        marketUnitCostUsd: 0.3,
        settledByTable: "exchange_transactions",
        settledById: 402,
      });

      const summary = repo.getSummaryForSources(
        "exchange_transactions",
        [301, 302, 303, 304, 999],
      );

      expect(summary[301].original_qty).toBe(2000);
      expect(summary[301].remaining_qty).toBe(0);
      expect(summary[301].settled_qty).toBe(2000);
      expect(summary[301].is_voided).toBe(0);

      expect(summary[302].original_qty).toBe(2000);
      expect(summary[302].remaining_qty).toBe(1200);
      expect(summary[302].settled_qty).toBe(800);
      expect(summary[302].is_voided).toBe(0);

      expect(summary[303].original_qty).toBe(500);
      expect(summary[303].settled_qty).toBe(500);
      expect(summary[303].remaining_qty).toBe(0);

      expect(summary[304].is_voided).toBe(1);
      expect(summary[304].settled_qty).toBe(0);
      expect(summary[304].remaining_qty).toBe(700);

      expect(summary[999]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // adjust (Q15)
  // ---------------------------------------------------------------------------

  describe("adjust", () => {
    it("add (qty > 0) creates an adjustment row AND a new lot at the stated basis", () => {
      const { adjustment, lot } = repo.adjust({
        currencyCode: "EUR",
        qty: 1000,
        unitCostUsd: 1.05,
        note: "opening position",
        createdBy: "admin",
      });

      expect(adjustment.currency_code).toBe("EUR");
      expect(adjustment.qty).toBe(1000);
      expect(adjustment.unit_cost_usd).toBe(1.05);
      expect(adjustment.note).toBe("opening position");

      expect(lot).toBeDefined();
      expect(lot!.source_type).toBe("ADJUSTMENT");
      expect(lot!.source_table).toBe("exchange_position_adjustments");
      expect(lot!.source_id).toBe(adjustment.id);
      expect(lot!.original_qty).toBe(1000);
      expect(lot!.remaining_qty).toBe(1000);
      expect(lot!.unit_cost_usd).toBe(1.05);
    });

    it("write-off (qty < 0) nets exactly 0 profit and reduces the open position", () => {
      repo.adjust({
        currencyCode: "EUR",
        qty: 1000,
        unitCostUsd: 1.05,
        createdBy: "admin",
      });

      const { adjustment, consume } = repo.adjust({
        currencyCode: "EUR",
        qty: -400,
        note: "shrinkage",
        createdBy: "admin",
      });

      expect(adjustment.qty).toBe(-400);
      expect(adjustment.unit_cost_usd).toBeNull();
      expect(consume).toBeDefined();
      expect(consume!.coveredQty).toBe(400);
      expect(consume!.marketQty).toBe(0);
      expect(consume!.realizedProfitUsd).toBe(0);
      expect(consume!.settlements.every((s) => s.profit_usd === 0)).toBe(true);

      expect(repo.getPositions()[0].open_qty).toBe(600);
    });

    it("write-off throws when it exceeds the currency's total open quantity — writes nothing", () => {
      repo.adjust({
        currencyCode: "EUR",
        qty: 500,
        unitCostUsd: 1.0,
        createdBy: "admin",
      });

      const beforeAdjustments = countRows(db, "exchange_position_adjustments");
      const beforeSettlements = countRows(db, "exchange_lot_settlements");

      expect(() =>
        repo.adjust({
          currencyCode: "EUR",
          qty: -600,
          createdBy: "admin",
        }),
      ).toThrow(/only 500 is open/);

      // The whole write-off transaction rolled back — no stray adjustment row.
      expect(countRows(db, "exchange_position_adjustments")).toBe(
        beforeAdjustments,
      );
      expect(countRows(db, "exchange_lot_settlements")).toBe(beforeSettlements);
      expect(repo.getPositions()[0].open_qty).toBe(500);
    });

    it("rejects USD and LBP — lot tracking only applies to exotic currencies", () => {
      expect(() =>
        repo.adjust({
          currencyCode: "USD",
          qty: 100,
          unitCostUsd: 1,
          createdBy: "admin",
        }),
      ).toThrow(/exotic currencies/);

      expect(() =>
        repo.adjust({
          currencyCode: "LBP",
          qty: 100,
          unitCostUsd: 1,
          createdBy: "admin",
        }),
      ).toThrow(/exotic currencies/);
    });

    it("rejects qty === 0", () => {
      expect(() =>
        repo.adjust({
          currencyCode: "EUR",
          qty: 0,
          createdBy: "admin",
        }),
      ).toThrow(/qty must not be 0/);
    });

    it("rejects an add with no positive unitCostUsd", () => {
      expect(() =>
        repo.adjust({
          currencyCode: "EUR",
          qty: 100,
          createdBy: "admin",
        }),
      ).toThrow(/unitCostUsd must be greater than 0/);

      expect(() =>
        repo.adjust({
          currencyCode: "EUR",
          qty: 100,
          unitCostUsd: 0,
          createdBy: "admin",
        }),
      ).toThrow(/unitCostUsd must be greater than 0/);
    });
  });

  // ---------------------------------------------------------------------------
  // hasActiveSettlementsAgainstSource / voidLotsBySource
  // ---------------------------------------------------------------------------

  describe("hasActiveSettlementsAgainstSource / voidLotsBySource", () => {
    it("is true only while an active settlement references the source's lot, and false again once restored", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 555,
        qty: 1000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      expect(
        repo.hasActiveSettlementsAgainstSource({
          sourceTable: "exchange_transactions",
          sourceId: 555,
        }),
      ).toBe(false);

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 400,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 556,
      });

      expect(
        repo.hasActiveSettlementsAgainstSource({
          sourceTable: "exchange_transactions",
          sourceId: 555,
        }),
      ).toBe(true);

      repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 556,
      });

      expect(
        repo.hasActiveSettlementsAgainstSource({
          sourceTable: "exchange_transactions",
          sourceId: 555,
        }),
      ).toBe(false);
    });

    it("voidLotsBySource sets is_voided=1 on every lot the source created and returns the count", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 600,
        qty: 1000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      const count = repo.voidLotsBySource({
        sourceTable: "exchange_transactions",
        sourceId: 600,
      });
      expect(count).toBe(1);

      const rows = db
        .prepare(
          `SELECT is_voided FROM exchange_lots WHERE source_table = ? AND source_id = ?`,
        )
        .all("exchange_transactions", 600) as { is_voided: number }[];
      expect(rows.every((r) => r.is_voided === 1)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getSettlementsBySettler / getSettlementsAgainstSource
  // ---------------------------------------------------------------------------

  describe("getSettlementsBySettler / getSettlementsAgainstSource", () => {
    it("getSettlementsBySettler LEFT JOINs lot provenance, null for MARKET rows", () => {
      const lot = repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 700,
        qty: 500,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 800,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.05,
        settledByTable: "exchange_transactions",
        settledById: 701,
      });

      const rows = repo.getSettlementsBySettler("exchange_transactions", 701);
      expect(rows).toHaveLength(2);
      const lotRowResult = rows.find((r) => r.basis_source === "LOT")!;
      expect(lotRowResult.lot_source_table).toBe("exchange_transactions");
      expect(lotRowResult.lot_source_id).toBe(700);
      expect(lotRowResult.lot_acquired_at).toBe("2026-08-18 10:00:00");

      const marketRowResult = rows.find((r) => r.basis_source === "MARKET")!;
      expect(marketRowResult.lot_source_table).toBeNull();
      expect(marketRowResult.lot_source_id).toBeNull();
      expect(marketRowResult.lot_acquired_at).toBeNull();
      expect(lot.id).toBe(lotRowResult.lot_id);
    });

    it("getSettlementsAgainstSource returns every settlement (active + refunded) consuming that source's lot", () => {
      repo.createLot({
        currencyCode: "EUR",
        sourceType: "EXCHANGE_BUY",
        sourceTable: "exchange_transactions",
        sourceId: 800,
        qty: 1000,
        unitCostUsd: 1.0,
        acquiredAt: "2026-08-18 10:00:00",
      });

      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 300,
        unitProceedsUsd: 1.1,
        marketUnitCostUsd: 1.1,
        settledByTable: "exchange_transactions",
        settledById: 801,
      });
      repo.consumeFifo({
        currencyCode: "EUR",
        qty: 200,
        unitProceedsUsd: 1.2,
        marketUnitCostUsd: 1.2,
        settledByTable: "exchange_transactions",
        settledById: 802,
      });
      repo.restoreSettlements({
        settledByTable: "exchange_transactions",
        settledById: 802,
      });

      const rows = repo.getSettlementsAgainstSource(
        "exchange_transactions",
        800,
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.is_refunded === 0)).toHaveLength(1);
      expect(rows.filter((r) => r.is_refunded === 1)).toHaveLength(1);
    });
  });
});
