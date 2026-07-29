/**
 * FinancialServiceRepository — float model (2026-07-29): supplier ledger
 * books the FEE SPLIT ONLY, `|fee| − |commission|`, identically for SEND and
 * RECEIVE — never the principal, which now moves through the
 * OMT_System/Whish_System float drawer directly (see
 * OmtSystemFeeCharacterization.test.ts and FinancialServiceRepository.ts's
 * `feeOwedDelta` doc comment, the single source of truth this file pins).
 *
 *   SEND    → TOP_UP of (fee − commission). Was: TOP_UP of (amount + fee)
 *             (the gross the shop used to owe when the principal itself sat
 *             in the ledger).
 *   RECEIVE → TOP_UP of (fee − commission), the SAME shape as SEND — was:
 *             PAYMENT of the bare transfer amount (force-negated by
 *             `SupplierRepository.addLedgerEntry`'s PAYMENT sign
 *             convention). Under the float model RECEIVE's fee obligation
 *             increases what the shop owes exactly like SEND's does, so it
 *             can no longer use the force-negated PAYMENT entry type.
 *
 * Both directions now book the SAME shape because the principal is no
 * longer the ledger's job — it already moved through the float at
 * SEND/RECEIVE time.
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

describe("FinancialServiceRepository — float model: supplier ledger books the fee split only", () => {
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

  it("SEND: books the FEE-ONLY owed (provider fee minus the shop's commission cut)", () => {
    // Customer pays 100 + 5 fee = 105 total, but the $100 principal now
    // moves through the OMT_System float directly (SEND draws it down) —
    // the supplier ledger only tracks the fee split. omtFee=5 (explicit) →
    // calculatedCommission = calculateCommission("INTRA", 5) = 5 × 0.1 = 0.5
    // (INTRA's OMT_COMMISSION_RATES = 0.1, packages/core/src/utils/
    // omtFees.ts:27). feeOwedDelta = |fee| − |commission| = |5| − |0.5| = 4.5.
    // float model: supplier_ledger is now fee-only, not gross(amount+fee).
    // TODO(rule-17): prove failing-first — revert feeOwedDelta's OMT/WHISH
    // branch to the old `amount + fee` shape (or change this assertion back
    // to 105) to make this red again.
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
    expect(entries[0].amount_usd).toBeCloseTo(4.5, 2); // fee(5) - commission(0.5); was 105 (amount+fee)
    expect(entries[0].amount_lbp).toBe(0);
  });

  it("RECEIVE: books the SAME fee-only shape as SEND (fee minus commission), NOT the bare transfer amount", () => {
    // The original fixture set `commission: 1` with no `omtFee` and asserted
    // the bare $100 principal. Under the float model the $100 principal no
    // longer touches the ledger at all (RECEIVE fills OMT_System directly) —
    // only the fee split does, via the SAME feeOwedDelta shape SEND uses.
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
    // fee=0 while commission auto-calculates to a nonzero value, making
    // feeOwedDelta NEGATIVE (the provider appearing to owe the shop for a
    // transfer where the customer was never charged a fee at all) — a real
    // asymmetry bug, not the model this test exists to pin. Making omtFee
    // explicit keeps this a clean guard for the intended fee-only symmetry;
    // the `commission: 1` param passed below is itself superseded by the
    // auto-calc (calculateCommission("INTRA", 1) = 0.1) the instant
    // omtServiceType is set and the resolved fee is > 0 (see
    // FinancialServiceRepository.ts's AUTO-CALCULATE COMMISSION block) — kept
    // here only to document that the literal is NOT what drives the number.
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
    // feeOwedDelta = |fee| − |commission| = |1| − |0.1| = 0.9.
    // float model: supplier_ledger is now fee-only, and RECEIVE uses the
    // SAME entry_type (TOP_UP, unsigned) as SEND — no more force-negated
    // PAYMENT entry (see FinancialServiceRepository.ts's "Float model (rule
    // 14, feeOwedDelta doc)" comment on the entry_type decision).
    // TODO(rule-17): prove failing-first — revert the RECEIVE ledger booking
    // to `entry_type: "PAYMENT"` / `amount_usd: -(receiveAmount + commission)`
    // to make this red again.
    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    expect(entries[0].amount_usd).toBeCloseTo(0.9, 2); // fee(1) - commission(0.1); was -100 (bare amount, PAYMENT)
    expect(entries[0].amount_lbp).toBeCloseTo(0, 2);
  });

  it("SEND split-pay: ledger books the fee-only split in the SERVICE currency, never the tender legs", () => {
    // $50 transfer + $2 fee; customer split-pays $30 cash + 1,980,000 LBP —
    // legs that reconcile exactly against the customer-owed total
    // ($52 = $30 + 1,980,000/90,000; S2 hard-reject, Payment-Legs Integrity
    // plan). The $50 principal now moves through the OMT_System float
    // directly (SEND draws it down by the bare principal, unaffected by leg
    // composition — that's exactly what "kills" the old leg-composition
    // branching bug). omtFee=2 (explicit) → calculatedCommission =
    // calculateCommission("INTRA", 2) = 2 × 0.1 = 0.2. feeOwedDelta =
    // |fee| − |commission| = |2| − |0.2| = 1.8. The ledger books ONLY this
    // fee-net split, in the service currency — never $30 (one leg), never a
    // tender-converted mixture, never the bare $50, and no longer the gross
    // $52 (amount + fee) the pre-fix model booked.
    // float model: supplier_ledger is now fee-only.
    // TODO(rule-17): prove failing-first — revert feeOwedDelta's OMT/WHISH
    // branch to the old `amount + fee` shape (or change this assertion back
    // to 52) to make this red again.
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
    expect(entries[0].amount_usd).toBeCloseTo(1.8, 2); // fee(2) - commission(0.2); was 52 (amount+fee)
    expect(entries[0].amount_lbp).toBe(0);
  });
});
