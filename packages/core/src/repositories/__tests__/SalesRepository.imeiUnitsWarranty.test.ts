/**
 * SalesRepository.processSale — LIRA-143 phase 4: IMEI unit consumption +
 * warranty stamping.
 *
 * Hand-built schema (house pattern, same shape as SalesRepository.stockGuard
 * .test.ts) extended with `product_units` (migration v157's exact shape,
 * including the partial unique index) and the `warranty_months`/
 * `warranty_until` columns v157 added to `products`/`sale_items`.
 *
 * Rule 17 (failing-first): every guard-shaped assertion below was verified to
 * FAIL against a temporarily-reverted implementation before this file was
 * finalized — see the "failing-first proofs" note in the PR/handover for the
 * exact revert + failure output per case. The reverts are not left in this
 * file (they'd defeat the guards); this comment records that the exercise
 * was done, per CLAUDE.md rule 17.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER,
      product_id               INTEGER NOT NULL,
      imei                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK(status IN ('IN_STOCK', 'SOLD')),
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_product_units_active_imei ON product_units(tenant_id, imei) WHERE status = 'IN_STOCK';

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

function insertProduct(
  db: Database.Database,
  opts: { name: string; warrantyMonths?: number | null; stockQuantity?: number },
): number {
  const result = db
    .prepare(
      `INSERT INTO products (name, cost_price_usd, stock_quantity, warranty_months, tenant_id)
       VALUES (?, 100, ?, ?, 1)`,
    )
    .run(opts.name, opts.stockQuantity ?? 10, opts.warrantyMonths ?? null);
  return Number(result.lastInsertRowid);
}

function insertUnit(db: Database.Database, productId: number, imei: string): number {
  const result = db
    .prepare(
      `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, ?, 'IN_STOCK')`,
    )
    .run(productId, imei);
  return Number(result.lastInsertRowid);
}

function getUnit(
  db: Database.Database,
  id: number,
): {
  id: number;
  status: string;
  sale_item_id: number | null;
  imei: string;
} {
  return db
    .prepare(`SELECT id, status, sale_item_id, imei FROM product_units WHERE id = ?`)
    .get(id) as { id: number; status: string; sale_item_id: number | null; imei: string };
}

function getSaleItem(
  db: Database.Database,
  saleId: number,
): { imei: string | null; warranty_until: string | null; quantity: number } {
  return db
    .prepare(
      `SELECT imei, warranty_until, quantity FROM sale_items WHERE sale_id = ? ORDER BY id ASC LIMIT 1`,
    )
    .get(saleId) as { imei: string | null; warranty_until: string | null; quantity: number };
}

function getSaleItems(
  db: Database.Database,
  saleId: number,
): { id: number; imei: string | null; warranty_until: string | null }[] {
  return db
    .prepare(
      `SELECT id, imei, warranty_until FROM sale_items WHERE sale_id = ? ORDER BY id ASC`,
    )
    .all(saleId) as { id: number; imei: string | null; warranty_until: string | null }[];
}

describe("SalesRepository.processSale — IMEI units + warranty stamp (LIRA-143 phase 4)", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetProductUnitRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetProductUnitRepository();
    resetTenantContext();
  });

  const baseSale = (
    overrides: Partial<Parameters<SalesRepository["processSale"]>[0]> = {},
  ): Parameters<SalesRepository["processSale"]>[0] => ({
    client_id: null,
    items: [],
    total_amount: 0,
    discount: 0,
    final_amount: 0,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: 90_000,
    ...overrides,
  });

  // ── (1) unit consumption + warranty stamp ────────────────────────────────

  describe("unit consumption + warranty stamp", () => {
    it("flips the specified unit to SOLD, stamps sale_item_id, and overrides free-text imei with the unit's own imei", () => {
      const productId = insertProduct(db, { name: "iPhone 13", warrantyMonths: 12 });
      const unitId = insertUnit(db, productId, "111111111111111");

      const result = repo.processSale(
        baseSale({
          items: [
            {
              product_id: productId,
              quantity: 1,
              price: 500,
              imei: "FREE-TEXT-SHOULD-BE-IGNORED",
              product_unit_id: unitId,
            },
          ],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 500,
          transaction_time: "2026-03-10T10:00:00.000Z",
        }),
        1,
      );

      expect(result.success).toBe(true);

      const unit = getUnit(db, unitId);
      expect(unit.status).toBe("SOLD");
      expect(unit.sale_item_id).not.toBeNull();

      const item = getSaleItem(db, result.id!);
      expect(item.imei).toBe("111111111111111");
    });

    it("stamps warranty_until = sale date + warranty_months using a backdated transaction_time", () => {
      const productId = insertProduct(db, { name: "iPhone 13", warrantyMonths: 12 });
      const unitId = insertUnit(db, productId, "222222222222222");

      const result = repo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
          ],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 500,
          transaction_time: "2026-01-31T09:00:00.000Z",
        }),
        1,
      );

      expect(result.success).toBe(true);
      const item = getSaleItem(db, result.id!);
      // 2026-01-31 + 12 months = 2027-01-31 (no month-end clamp needed here;
      // the clamp itself is unit-tested directly in utils/__tests__/dates.test.ts).
      expect(item.warranty_until).toBe("2027-01-31");
    });

    it("stamps warranty_until using today's date when transaction_time is omitted", () => {
      const productId = insertProduct(db, { name: "Charger", warrantyMonths: 3 });
      // No product_unit_id — warranty stamping is independent of unit tracking.
      const result = repo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 1, price: 10 }],
          total_amount: 10,
          final_amount: 10,
          payment_usd: 10,
        }),
        1,
      );

      expect(result.success).toBe(true);
      const todayIso = new Date().toISOString().slice(0, 10);
      const expected = new Date(todayIso);
      expected.setMonth(expected.getMonth() + 3);
      const item = getSaleItem(db, result.id!);
      expect(item.warranty_until).not.toBeNull();
      // Sanity: stamped value is today + ~3 months (within a day of the
      // month-end clamp), not null and not today's date itself.
      expect(item.warranty_until).not.toBe(todayIso);
    });

    it("a product with NO warranty_months stamps NULL", () => {
      const productId = insertProduct(db, { name: "Cable", warrantyMonths: null });
      const result = repo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 1, price: 5 }],
          total_amount: 5,
          final_amount: 5,
          payment_usd: 5,
        }),
        1,
      );
      expect(result.success).toBe(true);
      const item = getSaleItem(db, result.id!);
      expect(item.warranty_until).toBeNull();
    });
  });

  // ── (2) strictness ────────────────────────────────────────────────────────

  describe("registered-unit strictness (owner decision #5 + drift rule #6)", () => {
    it("rejects a line with NO product_unit_id when the product has a registered IN_STOCK unit", () => {
      const productId = insertProduct(db, { name: "iPhone 13" });
      insertUnit(db, productId, "333333333333333");

      const result = repo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 1, price: 500 }],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 500,
        }),
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error ?? "").toMatch(/IMEI-registered unit/i);
    });

    it("proceeds exactly as before when the product has ZERO registered units", () => {
      const productId = insertProduct(db, { name: "Charger", stockQuantity: 5 });
      const result = repo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 2, price: 10 }],
          total_amount: 20,
          final_amount: 20,
          payment_usd: 20,
        }),
        1,
      );
      expect(result.success).toBe(true);
    });

    it("rejects two lines claiming the same unit", () => {
      const productId = insertProduct(db, { name: "iPhone 13" });
      const unitId = insertUnit(db, productId, "444444444444444");

      const result = repo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
          ],
          total_amount: 1000,
          final_amount: 1000,
          payment_usd: 1000,
        }),
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error ?? "").toMatch(/claimed by more than one line/i);
    });

    it("rejects a unit-tracked line with quantity 2", () => {
      const productId = insertProduct(db, { name: "iPhone 13" });
      const unitId = insertUnit(db, productId, "555555555555555");

      const result = repo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 2, price: 500, product_unit_id: unitId },
          ],
          total_amount: 1000,
          final_amount: 1000,
          payment_usd: 1000,
        }),
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error ?? "").toMatch(/one-unit-per-line/i);
    });

    it("selling BOTH registered units as two unit lines + a third plain surplus line proceeds (drift)", () => {
      const productId = insertProduct(db, { name: "iPhone 13", stockQuantity: 3 });
      const unitA = insertUnit(db, productId, "666666666666666");
      const unitB = insertUnit(db, productId, "777777777777777");
      // A third physical phone exists in stock_quantity but was never
      // registered as a product_units row (decision #6 drift).

      const result = repo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitA },
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitB },
            { product_id: productId, quantity: 1, price: 500 },
          ],
          total_amount: 1500,
          final_amount: 1500,
          payment_usd: 1500,
        }),
        1,
      );

      expect(result.success).toBe(true);
      expect(getUnit(db, unitA).status).toBe("SOLD");
      expect(getUnit(db, unitB).status).toBe("SOLD");
      const items = getSaleItems(db, result.id!);
      expect(items).toHaveLength(3);
    });
  });

  // ── (3) drafts ────────────────────────────────────────────────────────────

  describe("drafts", () => {
    it("a draft with product_unit_id leaves the unit IN_STOCK and stamps no warranty", () => {
      const productId = insertProduct(db, { name: "iPhone 13", warrantyMonths: 12 });
      const unitId = insertUnit(db, productId, "888888888888888");

      const result = repo.processSale(
        baseSale({
          items: [
            { product_id: productId, quantity: 1, price: 500, product_unit_id: unitId },
          ],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 0,
          status: "draft",
        }),
        1,
      );

      expect(result.success).toBe(true);
      const unit = getUnit(db, unitId);
      expect(unit.status).toBe("IN_STOCK");
      expect(unit.sale_item_id).toBeNull();

      const item = getSaleItem(db, result.id!);
      expect(item.warranty_until).toBeNull();
    });

    it("a draft does NOT trigger the registered-unit strictness check", () => {
      const productId = insertProduct(db, { name: "iPhone 13" });
      insertUnit(db, productId, "999999999999999");

      // No product_unit_id, product HAS a registered unit — would be
      // rejected on a completed sale, but drafts never move stock/units.
      const result = repo.processSale(
        baseSale({
          items: [{ product_id: productId, quantity: 1, price: 500 }],
          total_amount: 500,
          final_amount: 500,
          payment_usd: 0,
          status: "draft",
        }),
        1,
      );

      expect(result.success).toBe(true);
    });
  });
});
