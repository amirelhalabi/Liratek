/**
 * ProfitRepository — `notPartnerPending` correlation regression (adversarial
 * review of the Exchange Lot Settlement feature).
 *
 * `notPartnerPending(refTable, idExpr)` builds a correlated NOT EXISTS:
 *
 *   NOT EXISTS (
 *     SELECT 1 FROM partner_ledger plp
 *     WHERE plp.reference_table = '<refTable>'
 *       AND plp.reference_id = <idExpr>
 *       ...
 *   )
 *
 * `getExchangeTotals` and the `daily_exchange` CTE inside `getByDate` called
 * this with the BARE column name `"id"` instead of a qualified
 * `"exchange_transactions.id"`. Because the subquery's own FROM clause
 * (`partner_ledger plp`) has a column literally named `id`, SQL scoping binds
 * the unqualified `id` to `plp.id` (innermost scope) — NOT to the outer
 * `exchange_transactions.id` the predicate was meant to correlate against.
 * The subquery silently degenerates into a global, row-independent check:
 * "does an uncovered FOR_% partner_ledger row exist whose own id equals its
 * own reference_id" — completely disconnected from the exchange row the
 * outer query is currently filtering.
 *
 * Two proven failure modes result:
 *   (a) an uncovered FOR_EXCHANGE row defers NOTHING — pending for-partner
 *       profit counts as realized immediately (whenever no partner_ledger row
 *       happens to have id == reference_id, the broken NOT EXISTS is
 *       vacuously true for every exchange row);
 *   (b) an UNRELATED uncovered FOR_% ledger row whose own id happens to equal
 *       its own reference_id hides ALL exchange profit (the broken NOT EXISTS
 *       becomes false for every exchange row, regardless of which row it
 *       actually references).
 *
 * Rule 17 (failing-first): every `it` below was run against the pre-fix
 * query (bare `"id"`) and OBSERVED to fail/misbehave exactly as described
 * (see the inline "PRE-FIX (observed)" comments), then passed once the two
 * call sites were qualified to `"exchange_transactions.id"`.
 *
 * Schema copied from ProfitRepository.tenantIsolation.test.ts (the fullest
 * existing fixture, since getByDate's CTE chain joins across every module
 * table) — trimmed to what these tests actually seed.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-08-01 10:00:00";
const FROM = "2026-08-01 00:00:00";
const TO = "2026-08-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      transaction_id INTEGER,
      method TEXT,
      drawer_name TEXT,
      currency_code TEXT,
      amount REAL DEFAULT 0,
      created_at TEXT
    );

    -- Referenced by notPartnerPending (PFT-6). An uncovered FOR_% row makes
    -- its source partner-pending.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by notDebtPending (DBT-1, v129). Left empty on purpose: the
    -- NOT EXISTS gate then passes every row, keeping this suite's assertions
    -- about the (unrelated) debt axis a no-op.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

/** Insert an exchange_transactions row with a stamped leg1 profit. */
function seedExchange(
  db: Database.Database,
  profitUsd: number,
  amountIn = 100,
): number {
  const res = db
    .prepare(
      `INSERT INTO exchange_transactions
         (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, ?, ?, 0, 0, ?)`,
    )
    .run(amountIn, profitUsd, D);
  return Number(res.lastInsertRowid);
}

function seedPartnerRow(
  db: Database.Database,
  refTable: string,
  referenceId: number,
  amount: number,
  coveredAmount: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
       VALUES (1, 1, 'FOR_EXCHANGE', ?, ?, ?, 'USD', 'DEBIT', ?, ?)`,
    )
    .run(refTable, referenceId, amount, coveredAmount, D);
  return Number(res.lastInsertRowid);
}

describe("ProfitRepository — notPartnerPending correlation on exchange (adversarial review)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("(a) uncovered for-partner exchange profit is EXCLUDED from getExchangeTotals and the daily summary", () => {
    // Seed a dummy, unrelated partner_ledger row FIRST so partner_ledger's
    // own id sequence (2, 3, ...) diverges from exchange_transactions.id (1)
    // — otherwise the FOR_EXCHANGE row created below would coincidentally
    // get plp.id === reference_id and mask the correlation bug (exactly what
    // happened in ExchangeRepository.forPartner.test.ts before this review).
    seedPartnerRow(db, "sales", 999, 1, 1); // fully covered, harmless

    const exId = seedExchange(db, 5);
    seedPartnerRow(db, "exchange_transactions", exId, 100, 0); // uncovered

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
    // PRE-FIX (observed): profit_usd was 5 / count 1 — the broken bare `id`
    // subquery degenerated into a global, row-independent check that
    // happened to be vacuously true (no partner_ledger row has
    // id === reference_id here), so the uncovered for-partner row was never
    // deferred.
    expect(totals.profit_usd).toBe(0);
    expect(totals.count).toBe(0);

    const daily = runWithTenant(1, () =>
      repo.getByDate("2026-08-01", "2026-08-01", FROM, TO),
    );
    const day = daily.find((r) => r.date === "2026-08-01");
    // PRE-FIX (observed): profit_usd was 5 for the same reason as above.
    expect(day?.profit_usd ?? 0).toBe(0);
  });

  it("(b) covering the for-partner row brings the profit back", () => {
    seedPartnerRow(db, "sales", 999, 1, 1);

    const exId = seedExchange(db, 5);
    seedPartnerRow(db, "exchange_transactions", exId, 100, 100); // fully covered

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
    expect(totals.profit_usd).toBeCloseTo(5, 2);
    expect(totals.count).toBe(1);

    const daily = runWithTenant(1, () =>
      repo.getByDate("2026-08-01", "2026-08-01", FROM, TO),
    );
    const day = daily.find((r) => r.date === "2026-08-01");
    expect(day?.profit_usd ?? 0).toBeCloseTo(5, 2);
  });

  it("(c) an unrelated uncovered FOR_% ledger row whose id === its own reference_id does NOT hide a walk-in exchange's profit", () => {
    // Exchange P: genuinely for-partner and uncovered. It is created FIRST so
    // both it and its partner_ledger row are their table's first insert —
    // plp.id (1) === reference_id (1) by pure coincidence, the exact
    // situation that made the pre-fix bug invisible in
    // ExchangeRepository.forPartner.test.ts.
    const pId = seedExchange(db, 3, 50);
    seedPartnerRow(db, "exchange_transactions", pId, 50, 0); // uncovered

    // Exchange W: a completely separate walk-in exchange with NO
    // partner_ledger row at all — "unrelated" to the coincidence above.
    seedExchange(db, 7, 100);

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
    // PRE-FIX (observed): profit_usd was null/0 and count was 0 — the broken
    // bare `id` subquery matched exchange P's OWN uncovered partner row as a
    // global, row-independent "hide everything" signal (plp.id ===
    // plp.reference_id), wiping out exchange W's real, uncontested $7 profit
    // right along with exchange P's (correctly deferred) $3.
    expect(totals.profit_usd).toBeCloseTo(7, 2);
    expect(totals.count).toBe(1);
  });
});
