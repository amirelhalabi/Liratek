/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (D1) — DRIFT GUARD.
 *
 * The single highest-value test in this change: `grossOwedDelta` (JS,
 * `FinancialServiceRepository.ts`, the value actually booked into
 * `supplier_ledger` at creation time) and `SUPPLIER_OWED_EXPR` (SQL, the
 * same file, read via `supplier_owed` on every settle/pending/profit query)
 * are TWO INDEPENDENT DEFINITIONS of "what does the shop owe the provider
 * for this row" — rule 14 names exactly this hazard, and Phase 0's own
 * pre-commit review already caught a real double-subtraction bug from these
 * two definitions drifting apart (see
 * `FinancialServiceRepository.omtCommissionModelGate.test.ts`'s header).
 * There is no compiler or type system that keeps a hand-written SQL CASE
 * expression in lockstep with a hand-written JS function — only a test that
 * evaluates BOTH against the SAME row and compares the numbers can.
 *
 * Method: rather than importing `grossOwedDelta` directly (it is not
 * exported, and should not be for this — exporting an internal booking
 * helper just to unit-test it in isolation would prove only that the
 * function agrees with itself), this test drives the REAL
 * `createTransaction()` public API for a matrix of (provider, serviceType,
 * currency, amount, fee, commission) tuples, then reads back TWO
 * independently-sourced numbers for the SAME row:
 *
 *   - `jsValue`  — the amount actually written to `supplier_ledger` by the
 *     auto TOP_UP booking (this IS `grossOwedDelta`'s return value, the
 *     real production code path, not a re-implementation)
 *   - `sqlValue` — `supplier_owed` off `findById()`, which embeds
 *     `SUPPLIER_OWED_EXPR` verbatim (`FinancialServiceRepository.getColumns()`)
 *
 * If a future change edits one formula's commission handling without the
 * other, this test fails immediately — no need to reach settlement or a
 * specific settle-batch shape to observe it, unlike
 * `omtCommissionModelGate.test.ts` (which guards the STAMP/formula pairing,
 * not the two formulas' arithmetic agreement with each other).
 *
 * The matrix deliberately varies `commission` independently of `fee` per
 * case (including fee=0/commission>0 and fee>0/commission=0 combinations) —
 * post-Phase-2, NEITHER formula should read the `commission` column at all,
 * so varying it and asserting the two numbers still agree with each other
 * proves commission has been fully decoupled from both definitions, not
 * just that today's specific inputs happen to cancel out. `omtServiceType`
 * is deliberately omitted on every case so the auto-commission block never
 * overrides the caller's `commission` (see
 * `FinancialServiceRepository.ts`'s "AUTO-CALCULATE COMMISSION" block: it
 * only fires when `data.provider === "OMT" && data.omtServiceType`), giving
 * this test free control over `c` independent of `f`. WHISH still forces
 * `calculatedCommission = 0` unconditionally (its own branch, right after
 * the OMT auto-calc block) — cases below pass a nonzero `commission` for
 * WHISH anyway specifically to prove that force-to-0 doesn't leak into
 * either owed formula either (both should agree on the SAME number
 * regardless).
 *
 * Each case sets `system_settings.shop_base_system` to its OWN provider —
 * sidesteps the unrelated "walk-in on the secondary system requires a
 * partnerId" guard (`FinancialServiceRepository.ts:1212-1219`) entirely,
 * rather than adding partner rows this test has no need for.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(baseSystem: "OMT" | "WHISH"): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL, phone_number TEXT, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Full column set — mirrors
    -- FinancialServiceRepository.omtCommissionModelGate.test.ts's fixture
    -- (already proven to exercise a full OMT SEND createTransaction round
    -- trip), plus the v150 columns.
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
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT
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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Whish', 'WHISH', 0);

    -- v136 schema: source_ref_table/source_ref_id.
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

    -- Migration v150 real schema — needed so
    -- SupplierRepository._hasCommissionAtSettlementSchema() sees a FULLY
    -- v150-upgraded connection (unused by this file's own assertions, but
    -- createTransaction's stamp logic doesn't care either way; kept for
    -- schema-completeness parity with the sibling gate test).
    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL UNIQUE,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP' CHECK(entry_mode IN ('LUMP', 'RATE')),
      rate REAL,
      unit_count INTEGER,
      model INTEGER NOT NULL CHECK(model IN (0, 1)),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', '${baseSystem}');

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', 50000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'LBP', 50000000, CURRENT_TIMESTAMP);
  `);

  return db;
}

type Case = {
  label: string;
  provider: "OMT" | "WHISH";
  serviceType: "SEND" | "RECEIVE";
  currency: "USD" | "LBP";
  amount: number;
  fee: number;
  commission: number;
};

// Matrix deliberately independent of any single "realistic" combo — see the
// file header for why `commission` is varied freely against `fee`.
const CASES: Case[] = [
  {
    label: "OMT SEND USD — fee and commission both nonzero",
    provider: "OMT",
    serviceType: "SEND",
    currency: "USD",
    amount: 100,
    fee: 5,
    commission: 0.5,
  },
  {
    label:
      "OMT SEND USD — zero fee, nonzero commission (commission must not leak in on its own)",
    provider: "OMT",
    serviceType: "SEND",
    currency: "USD",
    amount: 80,
    fee: 0,
    commission: 7,
  },
  {
    label: "OMT SEND USD — nonzero fee, zero commission",
    provider: "OMT",
    serviceType: "SEND",
    currency: "USD",
    amount: 60,
    fee: 3,
    commission: 0,
  },
  {
    label: "OMT RECEIVE USD — fee and commission both nonzero",
    provider: "OMT",
    serviceType: "RECEIVE",
    currency: "USD",
    amount: 100,
    fee: 5,
    commission: 0.5,
  },
  {
    label: "OMT RECEIVE USD — zero fee, nonzero commission",
    provider: "OMT",
    serviceType: "RECEIVE",
    currency: "USD",
    amount: 40,
    fee: 0,
    commission: 9,
  },
  {
    label: "OMT SEND LBP — fee and commission both nonzero",
    provider: "OMT",
    serviceType: "SEND",
    currency: "LBP",
    amount: 1_000_000,
    fee: 50_000,
    commission: 5_000,
  },
  {
    label: "OMT RECEIVE LBP — fee and commission both nonzero",
    provider: "OMT",
    serviceType: "RECEIVE",
    currency: "LBP",
    amount: 1_000_000,
    fee: 50_000,
    commission: 5_000,
  },
  {
    label:
      "WHISH SEND USD — commission forced to 0 by WHISH's own branch; must still agree",
    provider: "WHISH",
    serviceType: "SEND",
    currency: "USD",
    amount: 100,
    fee: 5,
    commission: 99,
  },
  {
    label:
      "WHISH RECEIVE USD — commission forced to 0 by WHISH's own branch; must still agree",
    provider: "WHISH",
    serviceType: "RECEIVE",
    currency: "USD",
    amount: 60,
    fee: 3,
    commission: 99,
  },
  {
    label: "WHISH SEND LBP — commission forced to 0, zero fee too",
    provider: "WHISH",
    serviceType: "SEND",
    currency: "LBP",
    amount: 2_000_000,
    fee: 0,
    commission: 250_000,
  },
];

describe("COMMISSION_AT_SETTLEMENT_PLAN.md Phase 2 (D1) — grossOwedDelta (JS) vs SUPPLIER_OWED_EXPR (SQL) parity guard", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    resetTransactionRepository();
    db.close();
  });

  it.each(CASES)("$label", (c) => {
    db = createTestDb(c.provider);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setDb } = require("../../db/connection");
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    fsRepo = new FinancialServiceRepository();

    const feeField =
      c.provider === "OMT" ? { omtFee: c.fee } : { whishFee: c.fee };
    const directionField =
      c.serviceType === "SEND"
        ? { paidByMethod: "CASH" as const }
        : { cashoutMethod: "CASH" as const };

    const { id } = fsRepo.createTransaction({
      provider: c.provider,
      serviceType: c.serviceType,
      amount: c.amount,
      currency: c.currency,
      commission: c.commission,
      // omtServiceType deliberately OMITted — see file header: this keeps
      // the auto-commission block from overriding `commission` above, so
      // this test controls `c` independently of `f`.
      ...feeField,
      ...directionField,
      exchangeRate: 90000,
    });

    const supplierId = (
      db
        .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
        .get(c.provider) as {
        id: number;
      }
    ).id;
    const ledgerRow = db
      .prepare(
        `SELECT amount_usd, amount_lbp FROM supplier_ledger
         WHERE supplier_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(supplierId) as { amount_usd: number; amount_lbp: number };
    // jsValue: the number grossOwedDelta() actually returned and had booked
    // into supplier_ledger at creation time — real production code, not a
    // re-implementation.
    const jsValue =
      c.currency === "LBP" ? ledgerRow.amount_lbp : ledgerRow.amount_usd;

    // sqlValue: SUPPLIER_OWED_EXPR evaluated against the SAME row by the
    // SAME query every settle/pending/profit consumer uses (getColumns()).
    const fs = fsRepo.findById(id)!;
    const sqlValue = fs.supplier_owed;

    expect(jsValue).toBeCloseTo(sqlValue, 6);
  });
});

// ===========================================================================
// D3 per-row cutover — the case the parity guard above structurally CANNOT
// reach, and the one that shipped a real overpayment.
// ===========================================================================
//
// Every row the parity guard builds goes through createTransaction, so it is
// born commission_model = 1. The defect was on the READ side, for rows written
// BEFORE the Phase 2 flip: SUPPLIER_OWED_EXPR had no commission_model branch,
// so it reported a legacy row's payable as GROSS when that row had actually
// been booked NET of commission.
//
// Measured consequence (OMT SEND, x=100, f=5, c=0.5, legacy row):
//   booked at creation          104.50
//   read back post-flip         105.00     <- wrong, +c
//   legacy settlement pays      105.00     (no subtraction: correct FOR legacy)
//   supplier_ledger left at      -0.50     and the cash is really gone,
//   while profit_usd already claimed the same +0.50 at creation.
//
// The only way to exercise it is to write a legacy row directly, which is what
// this block does.
//
// RULE 17: revert the two `AND commission_model = 1` guarded branches in
// SUPPLIER_OWED_EXPR (leaving the unconditional gross ones) and the SEND case
// below fails with 105 instead of 104.5.
describe("D3 cutover — a pre-Phase-2 row is READ with the formula that WROTE it", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    resetTransactionRepository();
    db.close();
  });

  /** Insert a financial_services row directly, bypassing createTransaction, so
   *  commission_model can be set to the legacy value. */
  function seedRow(opts: {
    serviceType: "SEND" | "RECEIVE";
    amount: number;
    fee: number;
    commission: number;
    commissionModel: number;
  }): number {
    const info = db
      .prepare(
        `INSERT INTO financial_services
           (tenant_id, provider, service_type, amount, currency, commission,
            cost, price, paid_by, omt_fee, commission_model, is_settled,
            supplier_debt_booked, created_by)
         VALUES (1, 'OMT', ?, ?, 'USD', ?, 0, 0, 'CASH', ?, ?, 0, 0, 1)`,
      )
      .run(
        opts.serviceType,
        opts.amount,
        opts.commission,
        opts.fee,
        opts.commissionModel,
      );
    return Number(info.lastInsertRowid);
  }

  function ownedFor(id: number): number {
    return fsRepo.findById(id)!.supplier_owed;
  }

  function boot(): void {
    db = createTestDb("OMT");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setDb } = require("../../db/connection");
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    fsRepo = new FinancialServiceRepository();
  }

  it("LEGACY SEND (commission_model = 0) reads NET, exactly as it was booked", () => {
    boot();
    const id = seedRow({
      serviceType: "SEND",
      amount: 100,
      fee: 5,
      commission: 0.5,
      commissionModel: 0,
    });
    // x + f - c. NOT 105 — that is the overpayment this guards.
    expect(ownedFor(id)).toBeCloseTo(104.5, 6);
  });

  it("LEGACY RECEIVE (commission_model = 0) reads NET too", () => {
    boot();
    const id = seedRow({
      serviceType: "RECEIVE",
      amount: 100,
      fee: 5,
      commission: 0.5,
      commissionModel: 0,
    });
    // -(x - f + c). NOT -95 — that would understate the receivable by c.
    expect(ownedFor(id)).toBeCloseTo(-95.5, 6);
  });

  it("NEW SEND (commission_model = 1) reads GROSS — the Phase 2 behaviour", () => {
    boot();
    const id = seedRow({
      serviceType: "SEND",
      amount: 100,
      fee: 5,
      commission: 0.5,
      commissionModel: 1,
    });
    expect(ownedFor(id)).toBeCloseTo(105, 6);
  });

  it("NEW RECEIVE (commission_model = 1) reads GROSS", () => {
    boot();
    const id = seedRow({
      serviceType: "RECEIVE",
      amount: 100,
      fee: 5,
      commission: 0.5,
      commissionModel: 1,
    });
    expect(ownedFor(id)).toBeCloseTo(-95, 6);
  });

  it("the two models differ by EXACTLY the commission, both directions", () => {
    boot();
    const legacySend = ownedFor(
      seedRow({
        serviceType: "SEND",
        amount: 100,
        fee: 5,
        commission: 0.5,
        commissionModel: 0,
      }),
    );
    const newSend = ownedFor(
      seedRow({
        serviceType: "SEND",
        amount: 100,
        fee: 5,
        commission: 0.5,
        commissionModel: 1,
      }),
    );
    expect(newSend - legacySend).toBeCloseTo(0.5, 6);

    const legacyRecv = ownedFor(
      seedRow({
        serviceType: "RECEIVE",
        amount: 100,
        fee: 5,
        commission: 0.5,
        commissionModel: 0,
      }),
    );
    const newRecv = ownedFor(
      seedRow({
        serviceType: "RECEIVE",
        amount: 100,
        fee: 5,
        commission: 0.5,
        commissionModel: 1,
      }),
    );
    expect(newRecv - legacyRecv).toBeCloseTo(0.5, 6);
  });
});
