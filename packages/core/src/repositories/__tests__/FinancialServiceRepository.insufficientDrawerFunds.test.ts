/**
 * FinancialServiceRepository — RECEIVE insufficient-funds guard (PCD).
 *
 * Guards owner decision #11 (`docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md`
 * §8.5 / §1 "Negative balance policy") — the owner-requested feature that was,
 * per the task brief, "currently untested at every layer":
 *
 *   "RECEIVE payout, insufficient drawer funds — Block, and show an inline
 *    button 'move remaining from General' with a USD/LBP currency toggle;
 *    after the transfer the transaction proceeds."
 *
 * A RECEIVE whose CASH payout would take more out of the primary cash drawer
 * (PCD — `OMT_System`/`Whish_System`) than it currently holds, per currency,
 * must throw `InsufficientDrawerFundsError` (`code: "INSUFFICIENT_DRAWER_FUNDS"`)
 * BEFORE any leg of the transaction posts. The repository's own RECEIVE branch
 * inserts the customer-paid FEE leg (fee-on-top mode) *textually before* the
 * guard check (`FinancialServiceRepository.ts` — the FEE leg around the
 * `receiveFeeIncluded` block, the guard further down in the CASH-cashout
 * branch) — so this file's CASE 1 deliberately uses a fee-on-top RECEIVE to
 * prove the WHOLE `createTransaction` call is one `db.transaction(...)`: even
 * a leg that executes ahead of the guard in source order is rolled back, so
 * "blocked" never means "partially written" (a partial write here would be
 * far worse than the rejection — CLAUDE.md rule 20 / task brief §A).
 *
 * CASE group B proves the guard's scope is exactly decision #11's — "only
 * applies when the payout actually takes cash out of [the PCD]" — by
 * confirming it does NOT fire for CUSTOMER_ACCOUNT (store credit, no drawer
 * moves), a wallet cashout (its own drawer, OMT_App), or SEND (which only
 * ever CREDITS the PCD, never debits it) — each run against a PCD seeded at
 * literally $0 to make the non-firing unambiguous.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  InsufficientDrawerFundsError,
  type InsufficientDrawerFundsDetails,
} from "../../utils/errors";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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

// ─── Mock DebtService (CUSTOMER_ACCOUNT cashout only) ────────────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — mirrors OmtSystemFeeCharacterization.test.ts ─────────

interface DrawerSeed {
  pcdUsd: number;
  pcdLbp?: number;
  omtAppUsd?: number;
  generalUsd?: number;
  generalLbp?: number;
}

function createTestDb(seed: DrawerSeed): Database.Database {
  const db = new Database(":memory:");

  const {
    pcdUsd,
    pcdLbp = 100000000,
    omtAppUsd = 1000,
    generalUsd = 1000,
    generalLbp = 100000000,
  } = seed;

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
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

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Included for schema completeness only (short-circuited by explicit
    -- exchangeRate on every call below, same as OmtSystemFeeCharacterization).
    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  db.prepare(
    `INSERT INTO drawer_balances VALUES (1, 'General', 'USD', ?, CURRENT_TIMESTAMP)`,
  ).run(generalUsd);
  db.prepare(
    `INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', ?, CURRENT_TIMESTAMP)`,
  ).run(generalLbp);
  db.prepare(
    `INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', ?, CURRENT_TIMESTAMP)`,
  ).run(pcdUsd);
  db.prepare(
    `INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', ?, CURRENT_TIMESTAMP)`,
  ).run(pcdLbp);
  db.prepare(
    `INSERT INTO drawer_balances VALUES (1, 'OMT_App', 'USD', ?, CURRENT_TIMESTAMP)`,
  ).run(omtAppUsd);

  return db;
}

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function rowCount(db: Database.Database, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM ${table}`)
    .get() as { c: number };
  return row.c;
}

interface WriteCounts {
  financialServices: number;
  transactions: number;
  payments: number;
  supplierLedger: number;
}

function writeCounts(db: Database.Database): WriteCounts {
  return {
    financialServices: rowCount(db, "financial_services"),
    transactions: rowCount(db, "transactions"),
    payments: rowCount(db, "payments"),
    supplierLedger: rowCount(db, "supplier_ledger"),
  };
}

describe("FinancialServiceRepository — RECEIVE insufficient-funds guard (PCD, decision #11)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  function useDb(seed: DrawerSeed): void {
    db = createTestDb(seed);
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  }

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TASK A — the guard fires, throws the structured payload, and writes
  // NOTHING (not even the FEE leg that executes textually before the guard
  // check in FinancialServiceRepository.ts's RECEIVE branch).
  // ═══════════════════════════════════════════════════════════════════════

  it("CASE 1 — blocks a fee-on-top CASH payout the PCD can't cover, and rolls back the FEE leg that posts before the guard runs", () => {
    // x=100, f=5, c=1 (fee ON TOP: payoutAmount = x = 100, the shop's full
    // CASH obligation). PCD seeded at $60. The FEE leg (+5) is posted by the
    // repository BEFORE the guard check runs (see the file header) — and
    // because it runs on the SAME SQLite connection inside the SAME
    // uncommitted `db.transaction(...)`, the guard's own balance SELECT
    // reads it back (read-your-own-writes within one transaction): available
    // = 60 + 5 = 65, still short of the $100 payout. required=100,
    // available=65, shortfall=100-65=35. Confirmed by an actual `npx jest`
    // run against the landed production code (rule 17) — the naive
    // "available=60" expectation (fee credit not yet visible) is WRONG and
    // fails against the real repository; this is the correct, re-derived
    // number, not a weakened assertion.
    useDb({ pcdUsd: 60 });
    const before = {
      pcd: balance(db, "OMT_System", "USD"),
      general: balance(db, "General", "USD"),
      counts: writeCounts(db),
    };
    expect(before.pcd).toBe(60);

    let caught: unknown;
    try {
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        includingFees: false,
        cashoutMethod: "CASH",
        exchangeRate: 90000,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientDrawerFundsError);
    const err = caught as InstanceType<typeof InsufficientDrawerFundsError>;
    expect(err.code).toBe("INSUFFICIENT_DRAWER_FUNDS");
    const details = err.details as InsufficientDrawerFundsDetails;
    expect(details.drawer).toBe("OMT_System");
    // required = payoutAmount (100, fee-on-top leaves the payout at the bare
    // principal); available = the PCD balance BEFORE this transaction (60,
    // the fee leg's own +5 credit never persists — see the balance
    // assertion below); shortfall = required - available = 40.
    expect(details.required).toEqual({ USD: 100 });
    expect(details.available).toEqual({ USD: 65 });
    expect(details.shortfall).toEqual({ USD: 35 });
    // No LBP key at all — this case never touched LBP.
    expect(details.required.LBP).toBeUndefined();

    // Nothing PERSISTS: the whole createTransaction body is ONE
    // db.transaction(...), so even though the FEE leg's INSERT/upsert runs
    // textually BEFORE the guard's throw (and is visible to the guard's OWN
    // read, per the comment above), it is rolled back along with everything
    // else once the exception propagates out of the transaction. A partial
    // write here (fee credited, payout blocked) would be strictly worse than
    // the rejection itself.
    expect(balance(db, "OMT_System", "USD")).toBe(60); // NOT 65 (60 + fee 5) — rolled back
    expect(balance(db, "General", "USD")).toBe(before.general);
    expect(writeCounts(db)).toEqual(before.counts);
  });

  it("CASE 2 — blocks a multi-currency split payout, reporting shortfall/available/required per currency independently", () => {
    // x=196 (fee=0, commission=0 to isolate the guard from ledger math),
    // paid out as 190 USD + 540,000 LBP (540,000/90,000 = 6 -> 190+6=196,
    // matching the split-payout shape FinancialServiceRepository.
    // receiveSplitPayout.test.ts already exercises). PCD seeded short on
    // BOTH currencies: USD 50 (<190), LBP 100,000 (<540,000).
    useDb({ pcdUsd: 50, pcdLbp: 100000 });
    const before = {
      pcdUsd: balance(db, "OMT_System", "USD"),
      pcdLbp: balance(db, "OMT_System", "LBP"),
      generalUsd: balance(db, "General", "USD"),
      generalLbp: balance(db, "General", "LBP"),
      counts: writeCounts(db),
    };

    let caught: unknown;
    try {
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 196,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 190 },
          { method: "CASH", currencyCode: "LBP", amount: 540000 },
        ],
        exchangeRate: 90000,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientDrawerFundsError);
    const details = (caught as InstanceType<typeof InsufficientDrawerFundsError>)
      .details as InsufficientDrawerFundsDetails;
    expect(details.drawer).toBe("OMT_System");
    expect(details.required).toEqual({ USD: 190, LBP: 540000 });
    expect(details.available).toEqual({ USD: 50, LBP: 100000 });
    // shortfall = required - available, independently per currency:
    // USD 190-50=140, LBP 540000-100000=440000.
    expect(details.shortfall).toEqual({ USD: 140, LBP: 440000 });

    // Nothing written in either currency or any table.
    expect(balance(db, "OMT_System", "USD")).toBe(before.pcdUsd);
    expect(balance(db, "OMT_System", "LBP")).toBe(before.pcdLbp);
    expect(balance(db, "General", "USD")).toBe(before.generalUsd);
    expect(balance(db, "General", "LBP")).toBe(before.generalLbp);
    expect(writeCounts(db)).toEqual(before.counts);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TASK B — the guard must NOT fire outside its exact scope (decision #11:
  // "only applies when the payout actually takes cash out of [the PCD]").
  // Every case below seeds the PCD at literally $0 so a false-negative
  // (guard silently not firing when it should) can't be confused with a
  // false-positive test setup.
  // ═══════════════════════════════════════════════════════════════════════

  it("does NOT fire for a CUSTOMER_ACCOUNT cashout — store credit, no drawer moves at all", () => {
    useDb({ pcdUsd: 0 });
    const fsCountBefore = rowCount(db, "financial_services");

    let result: { id: number; drawer: string } | undefined;
    expect(() => {
      result = repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        cashoutMethod: "CUSTOMER_ACCOUNT",
        clientName: "Test Client",
        phoneNumber: "70000000",
        exchangeRate: 90000,
      });
    }).not.toThrow();

    expect(result?.id).toBeGreaterThan(0);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore + 1);
    // No drawer moved for a store-credit cashout — least of all the PCD,
    // which stays at its seeded $0.
    expect(balance(db, "OMT_System", "USD")).toBe(0);
  });

  it("does NOT fire for a wallet cashout — debits its OWN drawer (OMT_App), never the PCD", () => {
    useDb({ pcdUsd: 0, omtAppUsd: 1000 });

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        cashoutMethod: "OMT", // wallet cashout, not CASH
        exchangeRate: 90000,
      }),
    ).not.toThrow();

    // The PCD is untouched (still $0) — the wallet drawer absorbs the payout.
    expect(balance(db, "OMT_System", "USD")).toBe(0);
    expect(balance(db, "OMT_App", "USD")).toBe(1000 - 100);
  });

  it("does NOT fire for SEND — SEND only ever CREDITS the PCD, it can never drive it negative", () => {
    useDb({ pcdUsd: 0 });

    expect(() =>
      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        paidByMethod: "CASH",
        includingFees: false,
        exchangeRate: 90000,
      }),
    ).not.toThrow();

    // PCD: +(x+f) = +105, starting from the seeded $0.
    expect(balance(db, "OMT_System", "USD")).toBe(105);
  });
});
