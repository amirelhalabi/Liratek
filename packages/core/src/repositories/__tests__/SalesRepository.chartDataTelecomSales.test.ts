/**
 * SalesRepository.getChartData("Sales") — DC-1..DC-4
 * (OWNER_NOTES_2026-09-21.md §7.1, 2026-09-24 owner decisions).
 *
 * The dashboard's "Sales" trend series is supposed to be PRODUCT AND
 * TELECOM SALES ONLY (owner decision 2), but the pre-fix query:
 *   - never checked `is_refunded` on `recharges` / `financial_services`
 *     (DC-1) — a voided recharge or a voided iPick item still counted;
 *   - summed EVERY `recharges` row regardless of `recharge_type` (DC-2) —
 *     a `CREDIT_BUYBACK` (cash paid OUT to the customer) and a client
 *     `TOP_UP` (the credits face value, not a sale) both inflated "Sales";
 *   - never adjusted `sales.final_amount_usd` for an item-level refund
 *     (DC-3) — a partially-refunded-but-still-'completed' sale kept its
 *     FULL pre-refund amount forever;
 *   - summed EVERY `financial_services` row regardless of provider/
 *     service_type (DC-4) — OMT/WHISH transfers, app-wallet (OMT_APP)
 *     loads and Katsh/iPick BILL payments all counted as "telecom sales",
 *     even though none of them are a telecom item sale.
 *
 * This fixture exercises one of each (plus a same-day "real sale" control
 * for both `recharges` and `financial_services`, so the test also proves
 * the fix does not over-exclude) and asserts the EXACT per-day USD/LBP
 * total for "today" — the only day with any fixture data.
 *
 * Rule 17 (OBSERVED, chart-lane round-1 fix verification): each of the 7
 * exclusion predicates this fixture exercises was mutated OUT one at a
 * time (`getChartData`'s live SQL, reverted immediately after each
 * capture) and re-run — every one FAILED, all against the same
 * `expect(today.usd).toBeCloseTo(75, 5)` assertion:
 *   1. DC-3 refund-adjustment CASE  → removed → Received: 120 (the $45
 *      refunded share of sale B leaks back in)
 *   2. DC-1a recharges `is_refunded = 0`        → removed → Received: 95
 *      (the voided $20 recharge leaks in)
 *   3. DC-2 `t.type = 'RECHARGE'` join condition → removed → Received: 93
 *      (the $18 TOP_UP leaks in)
 *   4. DC1-STATUS `t.status = 'ACTIVE'`          → removed → Received: 87
 *      (the $12 VOIDED-transaction recharge leaks in — the one condition
 *      this fixture exists specifically to isolate)
 *   5. DC-1b financial_services `is_refunded = 0` → removed → Received: 90
 *      (the voided $15 iPick item leaks in)
 *   6. DC-4a `fs.provider IN (...)` whitelist     → removed → Received: 225
 *      (the $100 OMT SEND + $50 OMT_APP both leak in)
 *   7. DC-4b `fs.service_type != 'BILL'`          → removed → Received: 100
 *      (the $25 Katsh BILL leaks in)
 * Each mutant was reverted immediately after capture and the suite
 * re-confirmed GREEN before moving to the next. Do not delete this
 * comment when editing.
 */

import Database from "better-sqlite3";
import { SalesRepository } from "../SalesRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { localDay } from "../../utils/localDate.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const OPENING_USD = 500;
const OPENING_LBP = 20_000_000;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
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

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- SUPPLIER_STOCK_INTAKE_PLAN.md v164 — production code now unconditionally
    -- touches these two tables from SalesRepository.processSale/refundSaleItem
    -- and TransactionRepository._restoreStock, even for a product with no
    -- batch history: a missing table here makes the whole file die in setup
    -- looking like an assertion failure (CLAUDE.md's "Test schemas silently
    -- void whole files" note).
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
    );

    -- Minimal shapes: only the columns SalesRepository.getChartData actually
    -- reads. Real-schema column NAMES ('recharge_type', 'currency_code',
    -- 'provider', 'service_type', 'currency', 'price', 'is_refunded') per
    -- electron-app/create_db.sql.
    CREATE TABLE recharges (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier       TEXT,
      recharge_type TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      price         REAL NOT NULL DEFAULT 0,
      paid_by       TEXT,
      is_refunded   INTEGER NOT NULL DEFAULT 0,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT NOT NULL,
      service_type  TEXT NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      price         REAL NOT NULL DEFAULT 0,
      is_refunded   INTEGER NOT NULL DEFAULT 0,
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  db.prepare(
    `INSERT INTO products (id, name, cost_price_usd, stock_quantity)
     VALUES (1, 'Screen protector', 4, 50)`,
  ).run();
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, 'General', 'USD', ?), (1, 'General', 'LBP', ?)`,
  ).run(OPENING_USD, OPENING_LBP);
  return db;
}

/** Insert a `recharges` row + its unified `transactions` sibling, exactly
 *  the shape `RechargeRepository` writes for each real flow this fixture
 *  models (types/columns per that repository's own INSERT statements). */
function insertRecharge(
  db: Database.Database,
  row: {
    rechargeType: string;
    currency: "USD" | "LBP";
    price: number;
    isRefunded?: boolean;
    txnType: string;
    txnStatus?: string;
  },
): void {
  const r = db
    .prepare(
      `INSERT INTO recharges (carrier, recharge_type, currency_code, price, is_refunded, tenant_id)
       VALUES ('MTC', ?, ?, ?, ?, 1)`,
    )
    .run(row.rechargeType, row.currency, row.price, row.isRefunded ? 1 : 0);
  db.prepare(
    `INSERT INTO transactions (type, status, source_table, source_id, tenant_id)
     VALUES (?, ?, 'recharges', ?, 1)`,
  ).run(row.txnType, row.txnStatus ?? "ACTIVE", Number(r.lastInsertRowid));
}

/** Insert a `financial_services` row + its unified `transactions` sibling
 *  (every real row is stamped `type: 'FINANCIAL_SERVICE'` regardless of
 *  provider/service_type — `FinancialServiceRepository.createFinancialService`). */
function insertFinancialService(
  db: Database.Database,
  row: {
    provider: string;
    serviceType: string;
    currency: "USD" | "LBP";
    price: number;
    isRefunded?: boolean;
  },
): void {
  const r = db
    .prepare(
      `INSERT INTO financial_services (provider, service_type, currency, price, is_refunded, tenant_id)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      row.provider,
      row.serviceType,
      row.currency,
      row.price,
      row.isRefunded ? 1 : 0,
    );
  db.prepare(
    `INSERT INTO transactions (type, status, source_table, source_id, tenant_id)
     VALUES ('FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1)`,
  ).run(Number(r.lastInsertRowid));
}

describe("SalesRepository.getChartData('Sales') — DC-1..DC-4 telecom/product-only fixture", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("counts only real product + telecom-item sales, exactly, for today", () => {
    // ── Product sales ──────────────────────────────────────────────────
    // Baseline: 2 x $15 = $30, no discount, no refund → counts in full.
    const saleA = repo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 2, price: 15 }],
        total_amount: 30,
        discount: 0,
        final_amount: 30,
        payment_usd: 30,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(saleA.success).toBe(true);

    // DC-3: two $50 lines, $10 discount → $90 final. One line (refunded in
    // full) must give back its PRE-discount share ($50 / $100 = 50%) of the
    // POST-discount final: $90 - ($90 * 0.5) = $45 counts, not $90 and not $50.
    const saleB = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: 1, quantity: 1, price: 50 },
          { product_id: 1, quantity: 1, price: 50 },
        ],
        total_amount: 100,
        discount: 10,
        final_amount: 90,
        payment_usd: 90,
        payment_lbp: 0,
        exchange_rate: 30_000,
      },
      1,
    );
    expect(saleB.success).toBe(true);
    const refundedLineId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1`)
        .all(saleB.id) as { id: number }[]
    )[0].id;
    const refundRes = repo.refundSaleItem({
      saleId: saleB.id!,
      saleItemId: refundedLineId,
      refundQuantity: 1,
      userId: 1,
    });
    expect(refundRes).toBeGreaterThan(0);

    // ── Recharges ──────────────────────────────────────────────────────
    // DC-1: a voided real sale — must not count despite type = 'RECHARGE'.
    insertRecharge(db, {
      rechargeType: "CREDIT_TRANSFER",
      currency: "USD",
      price: 20,
      isRefunded: true,
      txnType: "RECHARGE",
    });
    // Control: a real, non-refunded recharge sale — MUST count (proves the
    // fix doesn't over-exclude). 900,000 LBP.
    insertRecharge(db, {
      rechargeType: "CREDIT_TRANSFER",
      currency: "LBP",
      price: 900_000,
      txnType: "RECHARGE",
    });
    // DC-2: CREDIT_BUYBACK — price is cash paid OUT, stamped
    // TELECOM_CREDIT_BUYBACK, never 'RECHARGE'. Must not count.
    insertRecharge(db, {
      rechargeType: "CREDIT_BUYBACK",
      currency: "LBP",
      price: 675_000,
      txnType: "TELECOM_CREDIT_BUYBACK",
    });
    // DC-2: a client Whish App TOP_UP — price is the credits face value,
    // stamped RECHARGE_TOPUP, never 'RECHARGE'. Must not count.
    insertRecharge(db, {
      rechargeType: "TOP_UP",
      currency: "USD",
      price: 18,
      txnType: "RECHARGE_TOPUP",
    });
    // DC1-STATUS-UNTESTED (round-1 review, OWNER_NOTES_2026-09-21.md §7.1):
    // stamped `type: 'RECHARGE'` (so it passes the join) AND
    // `is_refunded = 0` (so it passes the refund check) — the ONLY thing
    // excluding it is `t.status = 'ACTIVE'` on its transaction sibling.
    // Without a fixture row isolating that exact condition, removing
    // `t.status = 'ACTIVE'` from the query would go unnoticed (every other
    // exclusion in this fixture is covered by a DIFFERENT condition).
    insertRecharge(db, {
      rechargeType: "CREDIT_TRANSFER",
      currency: "USD",
      price: 12,
      txnType: "RECHARGE",
      txnStatus: "VOIDED",
    });

    // ── Financial services ─────────────────────────────────────────────
    // DC-4: a Katsh BILL payment — not a telecom item sale. Must not count.
    insertFinancialService(db, {
      provider: "Katsh",
      serviceType: "BILL",
      currency: "USD",
      price: 25,
    });
    // DC-4: a plain OMT transfer — not telecom. Must not count.
    insertFinancialService(db, {
      provider: "OMT",
      serviceType: "SEND",
      currency: "USD",
      price: 100,
    });
    // DC-4: an OMT_APP wallet load — not telecom (app wallet). Must not count.
    insertFinancialService(db, {
      provider: "OMT_APP",
      serviceType: "SEND",
      currency: "USD",
      price: 50,
    });
    // DC-1: a VOIDED iPick telecom item — must not count despite provider
    // being in the telecom whitelist.
    insertFinancialService(db, {
      provider: "iPick",
      serviceType: "SEND",
      currency: "USD",
      price: 15,
      isRefunded: true,
    });
    // DC-4 control: a real iPick telecom item sale — MUST count.
    // 270,000 LBP.
    insertFinancialService(db, {
      provider: "iPick",
      serviceType: "SEND",
      currency: "LBP",
      price: 270_000,
    });

    // DAY-1 (rule 27): `endDay` is now required — the fixture rows use
    // `CURRENT_TIMESTAMP` (real machine "now"), so binding `localDay()`
    // reproduces the exact pre-fix `date('now','localtime')` window this
    // fixture was written against.
    const chart = repo.getChartData("Sales", localDay());
    expect(chart).toHaveLength(30);

    const today = chart[chart.length - 1];
    // USD: $30 (sale A) + $45 (sale B post-refund) = $75. Every excluded USD
    // row above ($20 voided recharge, $18 TOP_UP, $12 VOIDED-transaction
    // recharge, $25 bill, $100 OMT SEND, $50 OMT_APP, $15 voided iPick) is
    // NOT in this total.
    expect(today.usd).toBeCloseTo(75, 5);
    // LBP: 900,000 (real recharge) + 270,000 (real iPick item) = 1,170,000.
    // The 675,000 CREDIT_BUYBACK payout is NOT in this total.
    expect(today.lbp).toBeCloseTo(1_170_000, 5);

    // Every OTHER day in the 30-day window has no fixture data at all.
    for (const point of chart.slice(0, -1)) {
      expect(point.usd).toBe(0);
      expect(point.lbp).toBe(0);
    }
  });
});

/**
 * DAY-1 (CLAUDE.md rule 27) — the Sales series' 30-day window must be
 * anchored on the `endDay` PARAMETER, never on SQLite's own
 * `date('now','localtime')`. Pre-fix, `getChartData("Sales")` took no
 * `endDay` at all and always asked SQLite for the machine's real "now"; a
 * fixture row backdated far from whatever day this suite actually runs on
 * would fall OUTSIDE that real-"now"-anchored window and never appear in
 * the chart at all — which is exactly what this test failed with before
 * the fix (observed red, rule 17): `chart[chart.length - 1].date` was the
 * real machine day, not `BACKDATED_DAY`, and `backdated` was `undefined`
 * (the row fell off the front of a window ending on real "now" instead of
 * on the day requested).
 */
describe("SalesRepository.getChartData('Sales') — DAY-1: windows on the passed endDay, never the machine's real 'now'", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SalesRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("returns the 30-day window ending on endDay, and counts a fixture row backdated to that exact day — regardless of the real machine date", () => {
    // A day nowhere near whenever this suite actually executes, inserted
    // directly with an explicit `created_at` (bypassing the
    // `CURRENT_TIMESTAMP` default every OTHER fixture in this file relies
    // on, which is exactly what makes this row a probe for "did the query
    // use MY day, or its own idea of 'now'").
    const BACKDATED_DAY = "2024-03-10";
    const r = db
      .prepare(
        `INSERT INTO recharges (carrier, recharge_type, currency_code, price, is_refunded, tenant_id, created_at)
         VALUES ('MTC', 'CREDIT_TRANSFER', 'USD', 42, 0, 1, ?)`,
      )
      .run(`${BACKDATED_DAY} 10:00:00`);
    db.prepare(
      `INSERT INTO transactions (type, status, source_table, source_id, tenant_id)
       VALUES ('RECHARGE', 'ACTIVE', 'recharges', ?, 1)`,
    ).run(Number(r.lastInsertRowid));

    const chart = repo.getChartData("Sales", BACKDATED_DAY);

    expect(chart).toHaveLength(30);
    expect(chart[0].date).toBe("2024-02-10"); // 29 days before BACKDATED_DAY
    expect(chart[chart.length - 1].date).toBe(BACKDATED_DAY);

    const backdated = chart.find((p) => p.date === BACKDATED_DAY);
    expect(backdated?.usd).toBeCloseTo(42, 5);
  });
});
