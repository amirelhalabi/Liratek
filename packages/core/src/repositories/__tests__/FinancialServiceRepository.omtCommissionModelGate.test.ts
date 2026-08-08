/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 — CRITICAL regression guard
 * (2-reviewer FIX_FIRST): the `commission_model` stamp at creation
 * (`FinancialServiceRepository.createTransaction`) must be gated to BILL
 * rows ONLY. Phase 2 (the OMT/WHISH gross-payable flip, D1) has NOT
 * shipped — `grossOwedDelta`/`SUPPLIER_OWED_EXPR` still NET the auto-
 * calculated commission out of `supplier_owed` for OMT/WHISH SEND/RECEIVE
 * (`calculateCommission` fires for real OMT service types with a real fee).
 * If those rows were ALSO born `commission_model = 1` (as an earlier draft
 * of this file did — hardcoded, no service_type gate), `settleTransactions`
 * would route them into the NEW-MODEL settlement path
 * (`_resolveSettlementBatchModel` / `_bookCommissionAtSettlement`), which
 * books the operator's entered commission as a SECOND `SUPPLIER_PAYS_US`
 * ledger credit — on top of the commission ALREADY netted out of
 * `supplier_owed` at creation. Net effect: the provider is paid twice as
 * little of their cut re-collected as the shop's "profit" for the exact
 * same commission dollar.
 *
 * Every pre-existing suite that exercises `createTransaction` for OMT/WHISH
 * hand-picks `commission: 0` (or lets WHISH's own force-to-0 branch fire),
 * which never observably diverges under the double-subtraction bug (0 - 0
 * is still 0) — exactly why none of them caught this. This file is
 * deliberately a REALISTIC OMT SEND: a real `omtServiceType` ("INTRA") with
 * a real `omtFee` (10), so `calculateCommission` fires and stores a
 * genuinely nonzero `commission` (1.0 = 10% of the $10 fee).
 *
 * Rule 17 — observed FAILING pre-fix (commission_model hardcoded to 1 for
 * every row, the exact pre-fix code at
 * FinancialServiceRepository.ts:1028 `const commissionModel: number = 1;`):
 *
 *   FAIL src/repositories/__tests__/FinancialServiceRepository.omtCommissionModelGate.test.ts
 *     ● COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 double-subtraction guard ›
 *       a realistic OMT SEND (real omtServiceType+omtFee, nonzero commission)
 *       is born commission_model = 0 (legacy) — NOT routed into the new-model
 *       settlement path — settling it nets to 0 exactly like before Phase 0
 *
 *       expect(received).toBe(expected) // Object.is equality
 *       Expected: 0
 *       Received: 1
 *
 *         at Object.<anonymous> (.../FinancialServiceRepository.omtCommissionModelGate.test.ts:NN:NN)
 *
 *   (a second assertion in the same test, had the first one been skipped,
 *   would also have failed on the ledger net-zero check: the pre-fix code
 *   books an EXTRA -1 USD `SUPPLIER_PAYS_US` credit on top of the $109
 *   TOP_UP/-$109 SETTLEMENT pair, leaving the supplier_ledger sum at -1
 *   instead of 0 — the double-subtraction made real.)
 *
 * Reproduced by temporarily reverting FinancialServiceRepository.ts's
 * `commissionModel` stamp to the pre-fix `const commissionModel: number = 1;`
 * (removing the `data.serviceType === "BILL" ? 1 : 0` gate) — re-ran this
 * file, watched it FAIL with exactly that output, then restored the gate and
 * re-ran green.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

function createTestDb(): Database.Database {
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

    -- Full column set — mirrors FinancialServiceRepository.pendingSettlementPredicate
    -- .test.ts's fixture (already proven to exercise a full OMT SEND
    -- createTransaction round trip), plus the v150 columns.
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

    -- Migration v150 (COMMISSION_AT_SETTLEMENT_PLAN.md §3) real schema —
    -- needed so SupplierRepository._hasCommissionAtSettlementSchema() sees a
    -- FULLY v150-upgraded connection (a partially-upgraded one would silently
    -- fall back to legacy behavior regardless of commission_model, masking
    -- exactly the bug this file guards).
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
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500, CURRENT_TIMESTAMP);
  `);

  return db;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
    .get(provider) as { id: number };
  return row.id;
}

function ledgerSum(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM supplier_ledger
       WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierId) as { usd: number };
  return row.usd;
}

describe("COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 double-subtraction guard", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    fsRepo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    db.close();
  });

  it(
    "a realistic OMT SEND (real omtServiceType+omtFee, nonzero commission) is born " +
      "commission_model = 0 (legacy) — NOT routed into the new-model settlement " +
      "path — settling it nets to 0 exactly like before Phase 0",
    () => {
      const omtId = supplierIdByProvider(db, "OMT");

      // Realistic OMT SEND: INTRA service, $10 OMT fee (explicit, skips the
      // lookup table) → calculateCommission("INTRA", 10) = 1.0 (10% of the
      // fee) — a genuinely nonzero commission, unlike every pre-existing
      // suite's hand-picked commission: 0 inputs.
      const { id: fsId } = fsRepo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0, // ignored — calculatedCommission overrides via the auto-calc branch
        omtServiceType: "INTRA",
        omtFee: 10,
        paidByMethod: "CASH",
      });

      const row = db
        .prepare(
          `SELECT commission, commission_model, is_settled FROM financial_services WHERE id = ?`,
        )
        .get(fsId) as {
        commission: number;
        commission_model: number;
        is_settled: number;
      };

      // The auto-calc branch genuinely fired.
      expect(row.commission).toBeCloseTo(1, 4);

      // THE FIX: born commission_model = 0 (legacy EMBEDDED), not 1
      // (AT_SETTLEMENT) — Phase 2's gross flip hasn't shipped, so this row's
      // supplier_owed is STILL commission-netted at creation time (see the
      // ledger assertion below); flagging it 1 would double-net it at
      // settlement.
      expect(row.commission_model).toBe(0);
      // Still pending settlement via the preserved LEGACY marker
      // (commission_model=0 AND OMT/WHISH AND commission>0) — unaffected by
      // this fix, exactly the pre-Phase-0 behavior.
      expect(row.is_settled).toBe(0);

      // Gross TOP_UP booked at creation (grossOwedDelta): principal(100) +
      // fee(10) - commission(1) = 109 — the commission is ALREADY netted out
      // here. supplier_owed (SUPPLIER_OWED_EXPR) reads the same 109.
      const fs = fsRepo.findById(fsId)!;
      expect(fs.supplier_owed).toBeCloseTo(109, 4);
      expect(ledgerSum(db, omtId)).toBeCloseTo(109, 4);

      // Settle exactly like the pre-Phase-0 UI would: net pay = the full
      // supplier_owed (no further deduction — the shop's cut is already
      // embedded), commission_usd carried along informationally.
      supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 109,
        amount_lbp: 0,
        commission_usd: 1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 109 }],
      });

      // THE ASSERTION THAT CATCHES THE DOUBLE-SUBTRACTION BUG: with
      // commission_model correctly 0, `_resolveSettlementBatchModel` reads
      // this batch as LEGACY and never calls `_bookCommissionAtSettlement` —
      // no second SUPPLIER_PAYS_US credit is booked on top of the commission
      // already netted into the 109 TOP_UP. TOP_UP(109) + SETTLEMENT(-109)
      // nets to EXACTLY 0.
      //
      // Pre-fix (commission_model hardcoded to 1 on every row), this same
      // call would have booked an EXTRA -1 USD SUPPLIER_PAYS_US credit —
      // leaving this sum at -1, not 0 — because the settlement path treated
      // an already-commission-netted legacy row as a new-model one and
      // subtracted the same dollar of commission a second time.
      expect(ledgerSum(db, omtId)).toBeCloseTo(0, 4);

      // No new-model audit records exist for this settlement — confirms the
      // batch was never routed into `_bookCommissionAtSettlement` at all.
      const settlementLedgerRow = db
        .prepare(
          `SELECT id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SETTLEMENT'`,
        )
        .get(omtId) as { id: number };
      const settlementRecord = db
        .prepare(`SELECT * FROM supplier_settlements WHERE ledger_entry_id = ?`)
        .get(settlementLedgerRow.id);
      expect(settlementRecord).toBeUndefined();
      const allocations = db
        .prepare(
          `SELECT * FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`,
        )
        .all(settlementLedgerRow.id);
      expect(allocations).toHaveLength(0);
      const commissionCredit = db
        .prepare(
          `SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
        )
        .get(omtId);
      expect(commissionCredit).toBeUndefined();
    },
  );

  it("a NEW-model BILL (iPick/Katsh) is unaffected — still born commission_model = 1", () => {
    // Sanity companion: the gate must not be so narrow it stops BILLs from
    // getting the AT_SETTLEMENT flag Phase 1 actually shipped for them.
    db.exec(
      `INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 0)`,
    );
    const { id } = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 20,
      cost: 20,
      price: 20,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      userId: 1,
    });
    const row = db
      .prepare(`SELECT commission_model FROM financial_services WHERE id = ?`)
      .get(id) as { commission_model: number };
    expect(row.commission_model).toBe(1);
  });
});
