/**
 * D1 cutover (OWNER_NOTES_2026-09-21.md §2b) — the owner's final RECEIVE-fee
 * rule, consolidated proof file. This complements (does not duplicate)
 * two already-updated pre-existing suites:
 *
 *   - `OmtSystemFeeCharacterization.test.ts` CASE 1/CASE 2 already prove:
 *     OMT system RECEIVE x=100 f=5 → drawer moves exactly -100, OMT owes
 *     100, no fee leg exists; and `includingFees: true` is hard-rejected.
 *   - `FinancialServiceRepository.receiveFeeLegs.test.ts` cases (a)-(d)/(h)
 *     already prove the Whish fee-on-top COLLECTION mechanism (legs, split,
 *     CUSTOMER_ACCOUNT) with x=100/f=5, each now asserting the D1 numbers
 *     (owed -100, invariant commission term = the fee).
 *
 * This file covers what neither of those does:
 *   1. OMT RECEIVE cash-to-business with NO fee — accepted (note #6, the
 *      validator relaxation — see also validators/__tests__/
 *      financial.receiveFeeOptional.test.ts for the schema-level proof).
 *   2. Whish fee ON TOP, the task's own exact numbers (x=100 f=2): drawer
 *      -100+2, profit_usd includes 2, Whish owes 100.
 *   3. Whish fee DEDUCTED (includingFees: true): drawer -98, profit_usd 2,
 *      Whish owes 100 — no existing test exercises fee-deducted mode at all.
 *   4. OMT_APP RECEIVE non-zero fee — rejected.
 *   5. A LEGACY-marker (receive_fee_model = 0, seeded directly, bypassing
 *      createTransaction) RECEIVE row still reads -(x-f) — the cutover
 *      proof, no restatement.
 *   6. Void of a Whish fee-on-top RECEIVE nets PROFIT to 0, not just drawers
 *      (receiveFeeLegs.test.ts's (i) block only proves drawers/debt net to
 *      0 — profit is a separate stamp this file checks explicitly).
 *   7. Session-basket trace (matrix case #4): SessionPaymentRepository
 *      .getSessionCashSplitContext must never fold an OMT row's omt_fee into
 *      the basket's charge bucket, even if a stale/mistaken caller still
 *      lists its fsId in feeOnTopReceiveFsIds.
 *   8. Whish system RECEIVE, whishFee left BLANK (no feePayments, no
 *      includingFees) — the exact bug proven by execution 2026-09-23: before
 *      the fix, an absent `whishFee` fell back to `lookupWhishFee(amount)`
 *      (the tier table), inventing a fee nobody collected — a phantom +1
 *      drawer leg AND a phantom $1 of profit, while the supplier-owed figure
 *      was already correct (the receive_fee_model cutover branch ignores the
 *      fee entirely). RULE 17 — proven RED against pre-fix code, see the
 *      report for the transcript; GREEN after gating the tier-table fallback
 *      to SEND only in `storedWhishFee`.
 *   9. Whish SEND, whishFee left BLANK — the SAME tier-table fallback MUST
 *      still apply on SEND (regression guard: the fix must not widen beyond
 *      RECEIVE).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SessionPaymentRepository } from "../SessionPaymentRepository";
import { TransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository, getSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { OMT_RECEIVE_NO_FEE_MESSAGE } from "../../validators/financial";

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
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App', 'USD', 500, CURRENT_TIMESTAMP);
  `);

  return db;
}

function balance(db: Database.Database, drawer: string, currency: string): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function supplierOwedUsd(db: Database.Database, provider: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_usd), 0) as total
         FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = ?`,
    )
    .get(provider) as { total: number };
  return row.total;
}

function txnFor(db: Database.Database, fsId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
    )
    .get(fsId) as { id: number; profit_usd: number; profit_lbp: number };
}

/** Makes WHISH the PRIMARY system for one test — scoped to that test's own
 *  fresh `db` (a new one every `beforeEach`). See
 *  FinancialServiceRepository.receiveFeeLegs.test.ts's identical helper for
 *  the full rationale (this file mirrors it rather than importing it, to
 *  keep each fixture file self-contained). */
function makeWhishBaseSystem(db: Database.Database): void {
  db.prepare(
    `UPDATE system_settings SET value = 'WHISH' WHERE key_name = 'shop_base_system'`,
  ).run();
}

describe("D1 cutover — consolidated proof (OWNER_NOTES_2026-09-21.md §2b)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;

  beforeEach(() => {
    db = createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setDb } = require("../../db/connection");
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    fsRepo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    resetTransactionRepository();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. OMT RECEIVE cash-to-business, NO fee — accepted (note #6)
  // ═══════════════════════════════════════════════════════════════════════
  it("OMT RECEIVE cash-to-business with no fee is accepted and books the full principal", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      commission: 0,
      omtServiceType: "CASH_TO_BUSINESS",
      // No omtFee at all — the exact repro from note #6.
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(supplierOwedUsd(db, "OMT")).toBeCloseTo(-40, 5);
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(500 - 40, 5);
    const row = db
      .prepare(`SELECT omt_fee FROM financial_services WHERE id = ?`)
      .get(fsId) as { omt_fee: number | null };
    expect(row.omt_fee ?? 0).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Whish fee ON TOP, exact task numbers (x=100 f=2)
  // ═══════════════════════════════════════════════════════════════════════
  it("Whish system RECEIVE fee on top (x=100 f=2): drawer -100+2, profit includes 2, Whish owes 100", () => {
    makeWhishBaseSystem(db);

    const { id: fsId } = fsRepo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 2,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      exchangeRate: 90000,
    });

    // Whish_System: +2 (fee) - 100 (payout) = -98.
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(500 - 98, 5);
    // Owed: the FULL principal, undiminished by the fee.
    expect(supplierOwedUsd(db, "WHISH")).toBeCloseTo(-100, 5);
    // The fee is the shop's own profit, stamped immediately.
    const txn = txnFor(db, fsId);
    expect(txn.profit_usd).toBeCloseTo(2, 5);
    expect(txn.profit_lbp).toBeCloseTo(0, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Whish fee DEDUCTED (includingFees: true) — no existing test covers
  //    fee-deducted mode at all.
  // ═══════════════════════════════════════════════════════════════════════
  it("Whish system RECEIVE fee deducted (x=100 f=2, includingFees:true): drawer -98, profit 2, Whish owes 100", () => {
    makeWhishBaseSystem(db);

    const { id: fsId } = fsRepo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 2,
      includingFees: true,
      cashoutMethod: "CASH",
      // Customer collects the NET: x - f = 98.
      payments: [{ method: "CASH", currencyCode: "USD", amount: 98 }],
      exchangeRate: 90000,
    });

    // No separate fee leg — the fee is netted out of the ONE payout leg.
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(500 - 98, 5);
    // Owed: still the FULL principal — deducted mode changes only WHERE the
    // fee physically sits (folded into a smaller payout), never what Whish
    // owes.
    expect(supplierOwedUsd(db, "WHISH")).toBeCloseTo(-100, 5);
    // The fee is still the shop's profit even though it never crossed as its
    // own leg — the shop simply paid out $2 less than the gross principal.
    const txn = txnFor(db, fsId);
    expect(txn.profit_usd).toBeCloseTo(2, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. OMT_APP RECEIVE non-zero fee — rejected, SAME message as OMT system
  //    (owner decision 2026-09-25: "OMT App RECEIVE: refuse a fee with the
  //    SAME D1 message as OMT system — one constant").
  // ═══════════════════════════════════════════════════════════════════════
  it("OMT_APP RECEIVE with a non-zero fee is rejected outright, with the shared OMT_RECEIVE_NO_FEE_MESSAGE", () => {
    expect(() =>
      fsRepo.createTransaction({
        provider: "OMT_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 5, // OMT_APP's fee travels in `commission`, not omtFee.
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        exchangeRate: 90000,
      }),
    ).toThrow(OMT_RECEIVE_NO_FEE_MESSAGE);
  });

  it("OMT_APP RECEIVE with includingFees: true and zero commission is ALSO rejected, with the shared message", () => {
    expect(() =>
      fsRepo.createTransaction({
        provider: "OMT_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        includingFees: true,
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        exchangeRate: 90000,
      }),
    ).toThrow(OMT_RECEIVE_NO_FEE_MESSAGE);
  });

  it("WHISH_APP RECEIVE control — a fee is still accepted (D1 does not apply to WHISH_APP)", () => {
    expect(() =>
      fsRepo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 5,
        cashoutMethod: "CASH",
        exchangeRate: 90000,
      }),
    ).not.toThrow();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. LEGACY-marker row (receive_fee_model = 0) still reads -(x-f) —
  //    cutover, no restatement.
  // ═══════════════════════════════════════════════════════════════════════
  it("a LEGACY-marker (receive_fee_model=0) OMT RECEIVE row still reads -(x-f), exactly as it was written", () => {
    // Seeded directly, bypassing createTransaction, so receive_fee_model can
    // be pinned to 0 (the column's own DEFAULT, matching every pre-cutover
    // row after migration v180 applies).
    const info = db
      .prepare(
        `INSERT INTO financial_services
           (tenant_id, provider, service_type, amount, currency, commission,
            cost, price, paid_by, omt_fee, commission_model, receive_fee_model,
            is_settled, supplier_debt_booked, created_by)
         VALUES (1, 'OMT', 'RECEIVE', 100, 'USD', 0, 0, 0, 'CASH', 5, 1, 0, 0, 0, 1)`,
      )
      .run();
    const id = Number(info.lastInsertRowid);

    const row = fsRepo.findById(id)!;
    // -(x - f) = -(100 - 5) = -95 — the pre-cutover formula, untouched.
    expect(row.supplier_owed).toBeCloseTo(-95, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Void of a Whish fee-on-top RECEIVE nets PROFIT to 0 (rule 20) — not
  //    just drawers (receiveFeeLegs.test.ts's (i) block already proves the
  //    drawer/debt half; this proves the profit half explicitly).
  // ═══════════════════════════════════════════════════════════════════════
  it("void of a Whish fee-on-top RECEIVE excludes the profit stamp from ACTIVE totals (rule 20)", () => {
    makeWhishBaseSystem(db);
    const txnRepo = new TransactionRepository();

    const { id: fsId } = fsRepo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 2,
      cashoutMethod: "CASH",
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      exchangeRate: 90000,
    });

    const parentTxn = txnFor(db, fsId);
    expect(parentTxn.profit_usd).toBeCloseTo(2, 5);

    txnRepo.voidTransaction(parentTxn.id, 1);

    // Void (unlike refund) flips the ORIGINAL row to status='VOIDED' rather
    // than keeping it ACTIVE and adding a negative compensating row — the
    // reversal row it inserts carries no profit of its own (schema default
    // 0), because there is nothing left to "add back": profit-reporting
    // queries scope to status='ACTIVE', so the $2 stops counting the moment
    // the original leaves that set. Summed over every row this parent
    // touches AND filtered to the set profit queries actually read
    // (ACTIVE), the net is 0 — proving the fee's profit does not survive the
    // void, without asserting the (wrong, refund-shaped) mechanism.
    const netActiveProfit = db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) as total FROM transactions
         WHERE (id = ? OR reverses_id = ?) AND status = 'ACTIVE'`,
      )
      .get(parentTxn.id, parentTxn.id) as { total: number };
    expect(netActiveProfit.total).toBeCloseTo(0, 5);

    const originalStatus = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(parentTxn.id) as { status: string };
    expect(originalStatus.status).toBe("VOIDED");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Session-basket trace (matrix case #4): OMT's omt_fee must never fold
  //    into the basket's charge bucket, even if a caller mistakenly lists
  //    its fsId in feeOnTopReceiveFsIds.
  //
  // RULE 17 — PROVEN FAILING-FIRST 2026-09-23: ran this test with the
  // `if (feeRow.provider === "OMT") continue;` line removed from
  // `SessionPaymentRepository.getSessionCashSplitContext` — it failed with
  // `primarySystemChargeUsd`/`chargeTotalUsd` both 5 instead of 0 (the OMT
  // fee folded in exactly as it did before the fix). Restored after
  // confirming red.
  // ═══════════════════════════════════════════════════════════════════════
  it("session basket: an OMT row's omt_fee is never folded into the charge bucket, even if listed in feeOnTopReceiveFsIds", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      includingFees: false,
      deferPayment: true,
      exchangeRate: 90000,
    });

    // Link the item into a session basket the way SessionCheckoutService does.
    const txn = txnFor(db, fsId);
    db.prepare(
      `INSERT INTO customer_session_transactions
         (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd)
       VALUES (?, 'financial_services', ?, ?, ?)`,
    ).run(601, fsId, txn.id, -100);

    const sessionRepo = new SessionPaymentRepository();
    // Mistakenly (or by a stale client) lists the OMT fsId as fee-on-top —
    // this must have NO effect on the charge bucket.
    const ctx = sessionRepo.getSessionCashSplitContext(601, [fsId]);

    expect(ctx.chargeTotalUsd).toBeCloseTo(0, 5);
    expect(ctx.primarySystemChargeUsd).toBeCloseTo(0, 5);
    // The payout side (fed by the linked item itself, not the fee gate) is
    // unaffected and still finds its own share.
    expect(ctx.payoutTotalUsd).toBeCloseTo(100, 5);
    expect(ctx.primarySystemPayoutUsd).toBeCloseTo(100, 5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Whish system RECEIVE, whishFee BLANK — the proven bug. A blank fee
  //    must mean NO fee, never an auto-filled tier-table lookup.
  // ═══════════════════════════════════════════════════════════════════════
  it("Whish system RECEIVE with NO whishFee books NO fee: whish_fee 0/null, drawer -100, Whish owes -100, profit 0, no fee payment row", () => {
    makeWhishBaseSystem(db);

    const { id: fsId } = fsRepo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      // whishFee deliberately omitted — the operator left it blank.
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const row = db
      .prepare(`SELECT whish_fee FROM financial_services WHERE id = ?`)
      .get(fsId) as { whish_fee: number | null };
    expect(row.whish_fee ?? 0).toBe(0);

    // Payout only — no phantom fee leg landing in the drawer.
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(500 - 100, 5);
    expect(supplierOwedUsd(db, "WHISH")).toBeCloseTo(-100, 5);

    const txn = txnFor(db, fsId);
    expect(txn.profit_usd).toBeCloseTo(0, 5);
    expect(txn.profit_lbp).toBeCloseTo(0, 5);

    const feePaymentRows = db
      .prepare(
        `SELECT COUNT(*) as c FROM payments WHERE transaction_id = ? AND note LIKE '%fee%'`,
      )
      .get(txn.id) as { c: number };
    expect(feePaymentRows.c).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Whish SEND, whishFee BLANK — the tier-table fallback MUST still apply
  //    on SEND (regression guard: the RECEIVE fix must not widen to SEND).
  // ═══════════════════════════════════════════════════════════════════════
  it("Whish SEND with NO whishFee still gets the tier-table fee (SEND fallback unchanged)", () => {
    makeWhishBaseSystem(db);

    const { id: fsId } = fsRepo.createTransaction({
      provider: "WHISH",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      // whishFee omitted — lookupWhishFee(100) === 1 (tier table).
      payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
      exchangeRate: 90000,
    });

    const row = db
      .prepare(`SELECT whish_fee FROM financial_services WHERE id = ?`)
      .get(fsId) as { whish_fee: number | null };
    expect(row.whish_fee).toBe(1);

    // Customer handed over principal + the looked-up fee.
    expect(balance(db, "Whish_System", "USD")).toBeCloseTo(500 + 101, 5);
    // Owed: gross principal + fee (SEND is unaffected by the D1 RECEIVE fix).
    expect(supplierOwedUsd(db, "WHISH")).toBeCloseTo(101, 5);
  });
});
