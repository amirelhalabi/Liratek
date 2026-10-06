/**
 * LIRA-258 G23 (POSTING_INTEGRITY_PLAN.md item 3.6, POSTING_MAP.md §7.3):
 * the Loto checkpoint settlement (single and batch)
 *   - wrote its SETTLEMENT supplier_ledger row with transaction_id NULL, so
 *     the row was not linked to its own LOTO_SETTLEMENT transaction;
 *   - fell back to supplier id 1 (whatever supplier that is) when the tenant
 *     had no LOTO supplier row;
 *   - booked the payment legs without checking they add up to the net
 *     settlement, and silently skipped OUT / non-drawer legs;
 *   - (batch) posted the caller's raw `drawer_name` instead of the drawer the
 *     payment method maps to;
 *   - stamped a hard-coded 100,000 exchange rate instead of the market-rate
 *     snapshot the ticket and prize flows use.
 *
 * LOTO_SETTLEMENT stays non-reversible (frozen checkpoint) — not changed here.
 *
 * Rule 17: this file was written BEFORE the fix and run against the unfixed
 * code; the failing cases are recorded in the LIRA-258 hand-back.
 */
import Database from "better-sqlite3";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetRateRepository } from "../RateRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

const SALES = 100_000;
const COMMISSION = 4_450;
/** commission − sales: negative = the shop pays LOTO. */
const NET = COMMISSION - SALES; // −95,550
const MARKET_RATE = 89_500;

function createTestDb(opts: { withLotoSupplier: boolean }): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate)
      VALUES (1, 'LBP', ${MARKET_RATE}, 89000, 90000);

    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );
    INSERT INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_system) VALUES
      (1, 'CASH', 'Cash', 'General', 1, 0, 1),
      (1, 'OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      (1, 'CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 4, 1);

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Supplier id 1 is NOT Loto: the pre-fix fallback (supplierId || 1)
    -- would post the settlement against it.
    INSERT INTO suppliers (id, name, provider, is_system) VALUES (1, 'OMT', 'OMT', 1);

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_checkpoints (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkpoint_date TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_tickets INTEGER NOT NULL DEFAULT 0,
      total_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes_count INTEGER NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_cash_prizes (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT,
      prize_amount REAL NOT NULL,
      customer_name TEXT,
      prize_date TEXT NOT NULL,
      is_reimbursed INTEGER NOT NULL DEFAULT 0,
      reimbursed_date TEXT,
      reimbursed_in_settlement_id INTEGER,
      checkpoint_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_settlements (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      checkpoint_ids TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      net_settlement REAL NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 50000000, CURRENT_TIMESTAMP);
  `);
  if (opts.withLotoSupplier) {
    db.exec(
      `INSERT INTO suppliers (name, provider, is_system) VALUES ('Loto Liban', 'LOTO', 1);`,
    );
  }
  return db;
}

function lotoSupplierId(db: Database.Database): number | undefined {
  return (
    db.prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`).get() as
      | { id: number }
      | undefined
  )?.id;
}

function settlementRow(db: Database.Database): {
  supplier_id: number;
  transaction_id: number | null;
} {
  return db
    .prepare(
      `SELECT supplier_id, transaction_id FROM supplier_ledger WHERE entry_type = 'SETTLEMENT'`,
    )
    .get() as { supplier_id: number; transaction_id: number | null };
}

function settlementTxn(db: Database.Database): {
  id: number;
  exchange_rate: number | null;
} {
  return db
    .prepare(
      `SELECT id, exchange_rate FROM transactions WHERE type = 'LOTO_SETTLEMENT'`,
    )
    .get() as { id: number; exchange_rate: number | null };
}

function rowCount(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

function mkCheckpoint(repo: LotoCheckpointRepository) {
  return repo.createCheckpoint({
    checkpoint_date: "2026-10-06",
    period_start: "2026-10-01",
    period_end: "2026-10-06",
    total_sales: SALES,
    total_commission: COMMISSION,
    total_tickets: 1,
    total_prizes: 0,
    total_cash_prizes: 0,
    total_cash_prizes_count: 0,
  });
}

describe("LotoCheckpointRepository — G23 settlement integrity", () => {
  let db: Database.Database;
  let repo: LotoCheckpointRepository;

  function setup(withLotoSupplier = true) {
    db = createTestDb({ withLotoSupplier });
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetRateRepository();
    repo = new LotoCheckpointRepository(db);
  }

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetRateRepository();
  });

  // ── link + supplier + rate ─────────────────────────────────────────────

  it("single settle: SETTLEMENT row is linked to its LOTO_SETTLEMENT transaction; rate is the market snapshot", () => {
    setup();
    const cp = mkCheckpoint(repo);
    const before = snapshotLedgers(db);
    repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1, [
      { method: "CASH", currency_code: "LBP", amount: NET },
    ]);

    const txn = settlementTxn(db);
    expect(settlementRow(db).transaction_id).toBe(txn.id);
    expect(txn.exchange_rate).toBe(MARKET_RATE);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": NET },
      supplier: { [`${lotoSupplierId(db)}|LBP`]: NET },
    });
  });

  it("batch settle: SETTLEMENT row is linked to its LOTO_SETTLEMENT transaction; rate is the market snapshot", () => {
    setup();
    const cp1 = mkCheckpoint(repo);
    const cp2 = mkCheckpoint(repo);
    repo.settleCheckpoints([cp1.id, cp2.id], 2 * SALES, 2 * COMMISSION, undefined, 1, {
      method: "CASH",
      drawer_name: "General",
      currency_code: "LBP",
      amount: 2 * NET,
    });

    const txn = settlementTxn(db);
    expect(settlementRow(db).transaction_id).toBe(txn.id);
    expect(txn.exchange_rate).toBe(MARKET_RATE);
  });

  it("with no LOTO supplier row, the settlement posts to a LOTO supplier — never supplier id 1", () => {
    setup(false);
    const cp = mkCheckpoint(repo);
    repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1);

    const lotoId = lotoSupplierId(db);
    expect(lotoId).toBeDefined();
    expect(settlementRow(db).supplier_id).toBe(lotoId);
    expect(settlementRow(db).supplier_id).not.toBe(1);
  });

  it("batch: with no LOTO supplier row, posts to a LOTO supplier — never supplier id 1", () => {
    setup(false);
    const cp = mkCheckpoint(repo);
    repo.settleCheckpoints([cp.id], SALES, COMMISSION, undefined, 1);
    expect(settlementRow(db).supplier_id).toBe(lotoSupplierId(db));
    expect(settlementRow(db).supplier_id).not.toBe(1);
  });

  // ── leg reconciliation ─────────────────────────────────────────────────

  it("refuses legs that do not add up to the net settlement, and writes nothing", () => {
    setup();
    const cp = mkCheckpoint(repo);
    const before = snapshotLedgers(db);
    expect(() =>
      repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1, [
        { method: "CASH", currency_code: "LBP", amount: -50_000 },
      ]),
    ).toThrow(/do not reconcile/);
    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCount(db, "loto_settlements")).toBe(0);
    expect(repo.getCheckpointById(cp.id)!.is_settled).toBe(0);
  });

  it("refuses a leg whose direction contradicts the settlement (shop owes, leg pays in)", () => {
    setup();
    const cp = mkCheckpoint(repo);
    expect(() =>
      repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1, [
        { method: "CASH", currency_code: "LBP", amount: -NET },
      ]),
    ).toThrow(/direction|sign|pays/i);
    expect(rowCount(db, "loto_settlements")).toBe(0);
  });

  it("refuses an OUT leg instead of silently skipping it", () => {
    setup();
    const cp = mkCheckpoint(repo);
    expect(() =>
      repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1, [
        { method: "CASH", currency_code: "LBP", amount: NET },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 10_000,
          direction: "OUT",
        },
      ]),
    ).toThrow(/change|OUT/i);
    expect(rowCount(db, "loto_settlements")).toBe(0);
  });

  it("refuses a non-drawer leg instead of silently skipping it", () => {
    setup();
    const cp = mkCheckpoint(repo);
    expect(() =>
      repo.settleCheckpoint(cp.id, SALES, COMMISSION, 0, 0, undefined, 1, [
        { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: NET },
      ]),
    ).toThrow(/CUSTOMER_ACCOUNT/);
    expect(rowCount(db, "loto_settlements")).toBe(0);
  });

  it("batch: refuses a payment that does not add up to the net settlement", () => {
    setup();
    const cp = mkCheckpoint(repo);
    expect(() =>
      repo.settleCheckpoints([cp.id], SALES, COMMISSION, undefined, 1, {
        method: "CASH",
        drawer_name: "General",
        currency_code: "LBP",
        amount: -10_000,
      }),
    ).toThrow(/do not reconcile/);
    expect(rowCount(db, "loto_settlements")).toBe(0);
  });

  it("batch: posts to the drawer the payment method maps to, not the caller's raw drawer_name", () => {
    setup();
    const cp = mkCheckpoint(repo);
    const before = snapshotLedgers(db);
    repo.settleCheckpoints([cp.id], SALES, COMMISSION, undefined, 1, {
      method: "CASH",
      drawer_name: "Nonexistent_Drawer",
      currency_code: "LBP",
      amount: NET,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": NET },
      supplier: { [`${lotoSupplierId(db)}|LBP`]: NET },
    });
  });
  // ── LIRA-258 rollout: the Settle dialog's split legs on ONE batch ──────

  it("batch: split legs (USD + LBP at the till's tender rate) reconcile to the COMBINED net and each post to its own drawer", () => {
    setup();
    const cp1 = mkCheckpoint(repo);
    const cp2 = mkCheckpoint(repo);
    const before = snapshotLedgers(db);
    // Combined net = 2 × −95,550 = −191,100. $2 at 89,000 = 178,000; the
    // remaining 13,100 in LBP.
    repo.settleCheckpoints(
      [cp1.id, cp2.id],
      2 * SALES,
      2 * COMMISSION,
      undefined,
      1,
      [
        { method: "CASH", currency_code: "USD", amount: -2 },
        { method: "CASH", currency_code: "LBP", amount: -13_100 },
      ],
      89_000,
    );
    expect(rowCount(db, "loto_settlements")).toBe(1);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -2, "General|LBP": -13_100 },
      supplier: { [`${lotoSupplierId(db)}|LBP`]: 2 * NET },
    });
  });

  it("batch: split legs that only cover ONE checkpoint's net are refused, and nothing is written", () => {
    setup();
    const cp1 = mkCheckpoint(repo);
    const cp2 = mkCheckpoint(repo);
    expect(() =>
      repo.settleCheckpoints([cp1.id, cp2.id], 2 * SALES, 2 * COMMISSION, undefined, 1, [
        { method: "CASH", currency_code: "LBP", amount: NET },
      ]),
    ).toThrow(/do not reconcile/);
    expect(rowCount(db, "loto_settlements")).toBe(0);
  });
});
