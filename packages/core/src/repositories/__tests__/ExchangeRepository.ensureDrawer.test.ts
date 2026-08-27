/**
 * ExchangeRepository — item 9 (docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md):
 * `createTransaction` used to auto-register a `currency_drawers` row
 * (`INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
 * VALUES (?, 'General', ?)`) for both `fromCurrency` and `toCurrency` on
 * every exchange. That was a SECOND, redundant owner of a policy
 * `constants/drawerCurrencyPolicy.ts` already owns exclusively (rule 14):
 * General's currency set is DERIVED (every active currency, plus anything
 * it still physically holds — see `isUnrestrictedDrawer` /
 * `CurrencyRepository.getCountableCurrenciesForDrawer`), never read from
 * `currency_drawers` for General. The `ensureDrawer` call was deleted;
 * `ensureCurrency` (which registers the `currencies` row `currency_drawers`
 * FKs to) was kept untouched.
 *
 * This file proves the ONLY thing that could make that deletion unsafe is
 * false: that a brand-new currency (GBP — never seen by this shop before)
 * exchanged into General still ends up countable and visible afterwards,
 * with ZERO `currency_drawers` rows written for it. The chain:
 *
 *   createTransaction -> applyDrawerDelta writes a `drawer_balances` row
 *   (General, GBP, <non-zero>) -> CurrencyRepository.getNonZeroBalancesForDrawer
 *   picks it up -> getCountableCurrenciesForDrawer unions it into General's
 *   base (USD, LBP) -> GBP is countable.
 *
 * None of that chain reads `currency_drawers` at any point for General, so
 * removing the redundant write is provably a no-op for visibility.
 *
 * Rule 17: this exact scenario was run against the pre-fix code (the
 * `ensureDrawer` call reinstated) and observed to ALSO pass — proving the
 * regression this file guards against is not "GBP fails to become
 * countable" (it never did, before or after) but "a second write to
 * `currency_drawers` exists at all", which is why assertion (2) below (zero
 * rows in the table) is the one that actually distinguishes the two
 * versions. See this session's report for the literal watched-fail output
 * of that assertion under the reintroduced `ensureDrawer` call.
 */

import Database from "better-sqlite3";

import { ExchangeRepository } from "../ExchangeRepository";
import { CurrencyRepository } from "../CurrencyRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

// ─── In-memory schema (mirrors ExchangeRepository.splitPayout.test.ts, plus
// the `tenants`/currencies shape CurrencyRepository.countable.test.ts uses,
// since this file drives BOTH repositories against the same connection). ──

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT
    );
    INSERT INTO users (id, username, role) VALUES (1, 'Admin', 'admin');

    CREATE TABLE exchange_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL,
      base_rate REAL,
      profit_usd REAL,
      leg1_rate REAL,
      leg1_market_rate REAL,
      leg1_profit_usd REAL,
      leg2_rate REAL,
      leg2_market_rate REAL,
      leg2_profit_usd REAL,
      via_currency TEXT,
      client_name TEXT,
      note TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1
    );

    -- Starts EMPTY on purpose: assertion (2) below requires this to STAY
    -- empty after an exchange auto-registers a brand-new currency.
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    -- Present but never populated/queried on this file's direct (non-cross)
    -- GBP<->USD path — kept only because _applyExchangeLotEffects's acquire
    -- branch runs unconditionally for any exotic fromCurrency (mirrors
    -- ExchangeRepository.splitPayout.test.ts's "these three tables must
    -- exist even though this file never asserts anything about lots").
    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      to_code     TEXT    NOT NULL,
      market_rate REAL    NOT NULL,
      buy_rate    REAL    NOT NULL,
      sell_rate   REAL    NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
      updated_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
    );

    CREATE TABLE exchange_lots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
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
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);

    CREATE TABLE exchange_lot_settlements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
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

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose: _cancelDebt (run by every void/refund) queries this
    -- table unconditionally with no existence check.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);

    -- General starts with its two native currencies only — GBP is
    -- deliberately absent from BOTH drawer_balances and currency_drawers,
    -- mirroring a shop that has never traded GBP before.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function currencyDrawerRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM currency_drawers").get() as {
      n: number;
    }
  ).n;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number | undefined {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance;
}

function currencyRow(
  db: Database.Database,
  code: string,
): { code: string; is_active: number } | undefined {
  return db
    .prepare("SELECT code, is_active FROM currencies WHERE code = ?")
    .get(code) as { code: string; is_active: number } | undefined;
}

/** A direct (non-cross) acquire: shop buys GBP from the customer for USD. */
const GBP_ACQUIRE_TX = {
  fromCurrency: "GBP",
  toCurrency: "USD",
  amountIn: 100, // GBP handed over by the customer
  amountOut: 129, // USD paid out to the customer
  leg1Rate: 1.29,
  leg1MarketRate: 1.3,
  leg1ProfitUsd: 1, // stale on purpose — the lot-acquire branch zeroes this (Q8)
  totalProfitUsd: 1,
};

describe("ExchangeRepository — item 9: no second currency_drawers owner", () => {
  let db: Database.Database;
  let exchangeRepo: ExchangeRepository;
  let currencyRepo: CurrencyRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    exchangeRepo = new ExchangeRepository();
    currencyRepo = new CurrencyRepository();
  });

  afterEach(() => {
    resetTenantContext();
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("(1) still auto-registers the currencies row for a brand-new currency (ensureCurrency kept)", () => {
    expect(currencyRow(db, "GBP")).toBeUndefined();

    exchangeRepo.createTransaction({ ...GBP_ACQUIRE_TX });

    expect(currencyRow(db, "GBP")).toEqual({ code: "GBP", is_active: 1 });
  });

  it("(2) writes ZERO currency_drawers rows for the new currency (the deleted ensureDrawer)", () => {
    expect(currencyDrawerRowCount(db)).toBe(0);

    exchangeRepo.createTransaction({ ...GBP_ACQUIRE_TX });

    // Not just "no GBP row" — no row AT ALL. Nothing in this file's flow
    // should ever write to currency_drawers for General any more.
    expect(currencyDrawerRowCount(db)).toBe(0);
  });

  it("(3) still moves the drawer_balances rows exchanges have always moved", () => {
    exchangeRepo.createTransaction({ ...GBP_ACQUIRE_TX });

    // Inflow: customer hands over 100 GBP -> General's GBP balance +100,
    // via applyDrawerDelta — the mechanism that makes GBP countable, not
    // the deleted currency_drawers insert.
    expect(drawerBalance(db, "General", "GBP")).toBeCloseTo(100, 6);
    // Outflow: shop pays out 129 USD (single-lump fallback, no split legs).
    expect(drawerBalance(db, "General", "USD")).toBeCloseTo(-129, 6);
  });

  it("(4) end-to-end: GBP becomes countable for General via CurrencyRepository, with zero currency_drawers rows", () => {
    exchangeRepo.createTransaction({ ...GBP_ACQUIRE_TX });

    // The chain under test: getCountableCurrenciesForDrawer never reads
    // currency_drawers for an unrestricted drawer (isUnrestrictedDrawer) —
    // it unions UNRESTRICTED_DRAWER_BASE_CURRENCIES with
    // getNonZeroBalancesForDrawer's drawer_balances read. GBP's balance row
    // (+100 from assertion (3)) is what makes it show up here, NOT a
    // currency_drawers row (there are zero of them, proven again below).
    const countable = currencyRepo.getCountableCurrenciesForDrawer("General");

    expect(countable).toEqual(["USD", "LBP", "GBP"]);
    expect(currencyDrawerRowCount(db)).toBe(0);
  });
});
