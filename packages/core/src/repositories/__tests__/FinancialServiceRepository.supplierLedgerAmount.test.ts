/**
 * FinancialServiceRepository — primary-cash-drawer model (2026-07-30): supplier
 * ledger books the GROSS amount owed the provider, one formula both
 * directions (see PRIMARY_CASH_DRAWER_PLAN.md §8.3, FEATURE_GUIDE.md §8, and
 * FinancialServiceRepository.ts's `grossOwedDelta` doc comment, the single
 * source of truth this file pins):
 *
 *   SEND    → TOP_UP of +(principal + fee − commission)
 *             = +(x + f − c). Was (float model, superseded): TOP_UP of
 *             (fee − commission) only — the principal moved through the
 *             OMT_System/Whish_System FLOAT directly, so booking it again
 *             here would have double-counted it. There is no float anymore:
 *             OMT_System/Whish_System is the shop's own physical cash drawer
 *             (the PCD), a different fact from "what the shop owes the
 *             provider" — so the ledger is back to tracking the whole
 *             transfer, gross.
 *   RECEIVE → TOP_UP of −(principal − fee + commission) = −(x − f + c), the
 *             SAME signed-TOP_UP entry type as SEND (never a force-negated
 *             PAYMENT row — `SupplierRepository.addLedgerEntry` only
 *             force-negates `entry_type: "PAYMENT"`, so RECEIVE's already-
 *             negative gross number books correctly as a signed TOP_UP).
 *
 * Both directions still use the SAME entry_type (TOP_UP) — only the AMOUNT
 * changed shape (gross instead of fee-only); the sign convention decision
 * from the float model survives (§8.3, "Verified 2026-07-30" note in the
 * plan).
 *
 * Cost/price-flow sales are unchanged: they book the sale `cost`.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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

// ─── Mock DebtService (unused here, but imported by the repo) ────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema (mirrors the systemLedger test) ────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

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
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

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
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General',    'USD', 1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',    'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500,       CURRENT_TIMESTAMP);
  `);

  return db;
}

function omtLedgerEntries(db: Database.Database) {
  return db
    .prepare(
      `SELECT sl.entry_type, sl.amount_usd, sl.amount_lbp
         FROM supplier_ledger sl
         JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = 'OMT'
        ORDER BY sl.id ASC`,
    )
    .all() as Array<{
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

describe("FinancialServiceRepository — primary-cash-drawer model: supplier ledger books the GROSS amount", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    // Sub-repositories are singletons bound to getDatabase() at first use —
    // reset them so they attach to THIS test's in-memory DB, not a closed one.
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  it("SEND: books the GROSS owed = principal + fee − commission", () => {
    // Customer pays 100 + 5 fee = 105 total, in cash, straight into the PCD
    // (OMT_System) — there is no float to draw down. The supplier ledger
    // books the WHOLE transfer, gross: principal(100) + fee(5) −
    // commission(0.5). omtFee=5 (explicit) → calculatedCommission =
    // calculateCommission("INTRA", 5) = 5 × 0.1 = 0.5 (INTRA's
    // OMT_COMMISSION_RATES = 0.1, packages/core/src/utils/omtFees.ts:27).
    // grossOwedDelta = principal + fee − commission = 100 + 5 − 0.5 = 104.5.
    // (Was, float model, superseded: feeOwedDelta = |fee| − |commission| =
    // 4.5 — the principal used to be tracked by the float leg instead.)
    // rule 17: this file's PRE-existing assertion (4.5) was run against the
    // implemented gross-ledger production code and observed to fail with
    // `Received: 104.5` — i.e. the old fee-only expectation is red under the
    // current implementation, and 104.5 is what the implemented
    // `grossOwedDelta` actually returns for these inputs (verified by
    // running this suite, not re-derived by hand alone).
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 5,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    // 104.5 = principal(100) + fee(5) - commission(0.5); float model read 4.5 (fee-only)
    expect(entries[0].amount_usd).toBeCloseTo(104.5, 2);
    expect(entries[0].amount_lbp).toBe(0);
  });

  it("RECEIVE: books the GROSS owed as a SIGNED NEGATIVE TOP_UP = −(principal − fee + commission)", () => {
    // The shop pays out 100 − 1 (fee withheld) = 99 in cash from the PCD —
    // that principal is real cash movement, not a float credit, so the
    // ledger must reflect the FULL amount the provider now owes the shop
    // back, net of its own commission cut.
    //
    // We add an explicit `omtFee: 1` here (equal to what
    // lookupOmtFee("INTRA", 100) would auto-resolve to anyway — see
    // omtFees.ts's INTRA_FEE_TIERS, maxAmount:100 → fee:1) rather than
    // leaving omtFee unset. Leaving it unset would exercise a suspected
    // production bug (Bug A, flagged for Integrate/Surface, NOT fixed here —
    // out of this file's test-only scope): `resolvedProviderFee` (the value
    // this booking's `fee` param reads) resolves ONLY from `data.omtFee ?? 0`
    // — it never consults the `lookupOmtFee` auto-resolution that
    // `calculatedCommission` (the `commission` param here) uses. Omitting
    // omtFee on a RECEIVE with omtServiceType set would silently produce
    // fee=0 while commission auto-calculates to a nonzero value, skewing
    // grossOwedDelta by exactly that missing fee — a real asymmetry bug, not
    // the model this test exists to pin. Making omtFee explicit keeps this a
    // clean guard for the intended gross-ledger symmetry; the `commission: 1`
    // param passed below is itself superseded by the auto-calc
    // (calculateCommission("INTRA", 1) = 0.1) the instant omtServiceType is
    // set and the resolved fee is > 0 (see FinancialServiceRepository.ts's
    // AUTO-CALCULATE COMMISSION block) — kept here only to document that the
    // literal is NOT what drives the number.
    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1, // superseded by the auto-calc below (see comment above)
      omtServiceType: "INTRA",
      omtFee: 1, // f — explicit, sidesteps suspected Bug A (see comment above)
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    // f=1 (explicit), commission auto-calculates to
    // calculateCommission("INTRA", 1) = 1 × 0.1 = 0.1.
    // grossOwedDelta = −(principal − fee + commission) = −(100 − 1 + 0.1) =
    // −99.1. Still a signed TOP_UP entry (never the force-negated PAYMENT
    // type — see FinancialServiceRepository.ts's grossOwedDelta doc comment
    // on the entry_type decision, carried over unchanged from the float
    // model's own sign-convention fix).
    // (Was, float model, superseded: feeOwedDelta = |fee| − |commission| =
    // 0.9 — the bare 100 principal never touched the ledger, it filled the
    // float instead.)
    // rule 17: this file's PRE-existing assertion (0.9) was run against the
    // implemented gross-ledger production code and observed to fail with
    // `Received: -99.1` — the old fee-only expectation is red under the
    // current implementation, and -99.1 is what the implemented
    // `grossOwedDelta` actually returns for these inputs (verified by
    // running this suite, not re-derived by hand alone).
    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    // -99.1 = -(principal(100) - fee(1) + commission(0.1)); float model read 0.9 (fee-only)
    expect(entries[0].amount_usd).toBeCloseTo(-99.1, 2);
    expect(entries[0].amount_lbp).toBeCloseTo(0, 2);
  });

  it("SEND split-pay: ledger books the GROSS amount in the SERVICE currency, never the tender legs", () => {
    // $50 transfer + $2 fee; customer split-pays $30 cash + 1,980,000 LBP —
    // legs that reconcile exactly against the customer-owed total
    // ($52 = $30 + 1,980,000/90,000; S2 hard-reject, Payment-Legs Integrity
    // plan). Both legs land in the PCD (OMT_System) as real cash — no float
    // to draw down, so leg composition is irrelevant to the ledger booking
    // (that's exactly what "kills" the old leg-composition branching bug).
    // omtFee=2 (explicit) → calculatedCommission =
    // calculateCommission("INTRA", 2) = 2 × 0.1 = 0.2. grossOwedDelta =
    // principal + fee − commission = 50 + 2 − 0.2 = 51.8. The ledger books
    // the WHOLE transfer, gross, in the service currency — never $30 (one
    // leg), never a tender-converted mixture, and no longer just the fee
    // split (1.8) the float model booked.
    // rule 17: this file's PRE-existing assertion (1.8) was run against the
    // implemented gross-ledger production code and observed to fail with
    // `Received: 51.8` — the old fee-only expectation is red under the
    // current implementation, and 51.8 is what the implemented
    // `grossOwedDelta` actually returns for these inputs (verified by
    // running this suite, not re-derived by hand alone).
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 2,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 30 },
        { method: "CASH", currencyCode: "LBP", amount: 1_980_000 },
      ],
      exchangeRate: 90000,
    });

    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    // 51.8 = principal(50) + fee(2) - commission(0.2); float model read 1.8 (fee-only)
    expect(entries[0].amount_usd).toBeCloseTo(51.8, 2);
    expect(entries[0].amount_lbp).toBe(0);
  });
});
