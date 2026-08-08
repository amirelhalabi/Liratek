/**
 * LIRA-091 — Void cascade for auto supplier-ledger siblings.
 *
 * The bug (FEATURE_GUIDE §9 / LEFT_TO_DO.md standing gap): voiding a
 * FINANCIAL_SERVICE row (e.g. an OMT SEND, or a Katsh BILL) reverses cash +
 * wallet legs via the generic void/refund path, but the AUTO supplier
 * sibling it created at the same time (FinancialServiceRepository's
 * `is_auto:true` supplier_ledger row — TOP_UP/PAYMENT on SEND/RECEIVE,
 * SUPPLIER_PAYS_US on a BILL commission — plus its own separate hidden
 * SUPPLIER_PAYMENT transaction) stays standing. There was no schema link
 * from the parent row back to the sibling, so the generic reversal had no
 * way to find it. The supplier balance then overstates the debt by the
 * voided amount forever (conservative direction — never understated).
 *
 * Fix (migration v136): supplier_ledger gains source_ref_table/source_ref_id
 * — a back-link to the PARENT transaction's own source row, stamped at
 * create time by BOTH FinancialServiceRepository is_auto:true call sites
 * (BILL commission, SEND/RECEIVE TOP_UP/PAYMENT). TransactionRepository's
 * void/refund now cascades: it finds any unrefunded is_auto:1 sibling via
 * the link and calls its OWN `_voidTransactionInternal` (the exact same
 * per-transaction reversal the Transactions page uses for a manual supplier
 * payment void) — soft-voiding the ledger row via the pre-existing
 * `_markSourceRefunded` step, not a second reversal path (rule 14/20).
 *
 * FACTS-FIRST note on "both creation paths" (RechargeRepository): a full
 * sweep of every supplier_ledger writer found NO live is_auto:true
 * separate-hidden-transaction site in RechargeRepository — its only
 * supplier_ledger touch (`topUpFromSupplier`) is LINK-MODE (the ledger row
 * shares the SAME transaction id as the parent RECHARGE_TOPUP row, which is
 * already NON_REVERSIBLE for its own, unrelated reason — see
 * transactionTypes.ts) and deliberately left unstamped (stamping source_ref
 * on a link-mode row would make the cascade call _voidTransactionInternal on
 * its own in-flight parent — a self-void). Customer-facing RECHARGE sales
 * (processRecharge) never book supplier debt at all (prepaid-units model,
 * FEATURE_GUIDE §8). Case (b) below therefore proves the cascade mechanism
 * is generic to ANY source table — not hardcoded to financial_services — by
 * constructing a `recharges`-sourced auto sibling directly at the repository
 * level (the same shape a future RECHARGE-side auto-booking site would
 * produce), rather than asserting a live production path that does not
 * exist today.
 *
 * Legacy rows: pre-v136 supplier_ledger rows carry no source_ref link and
 * can never be found by the cascade — undetectable by design, the same
 * limitation LIRA-094 documented for its split_group marker. No heuristic
 * backfill.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

// ─── Mock DebtService (unused by these cases, but imported by the repo) ──────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

const CLIENT_ID = 9;

// ─── In-memory schema (union of supplierLedgerAmount.test.ts's fixture +
//      splitGroupVoid.test.ts's Katsh BILL drawers + the new v136 columns +
//      a minimal `recharges` table for the synthetic RECHARGE-path proof) ────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number) VALUES (${CLIENT_ID}, 'LIRA-091 Client', '76000000');

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
      edited_by TEXT,
      edited_at TEXT,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT
    );

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT DEFAULT 'CASH',
      created_by INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      transaction_time DATETIME,
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

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Recharge Test Supplier', 'RECHARGE_TEST', 1);

    -- v136 schema: is_refunded/refunded_at (v120) + source_ref_table/id (v136).
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
    INSERT INTO drawer_balances VALUES (1, 'Katsh',      'USD', 500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',      'LBP', 0,         CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
    .get(provider) as { id: number };
  return row.id;
}

function ledgerRowsForSupplier(
  db: Database.Database,
  supplierId: number,
): Array<{
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  transaction_id: number | null;
  is_refunded: number;
  source_ref_table: string | null;
  source_ref_id: number | null;
}> {
  return db
    .prepare(
      `SELECT id, entry_type, amount_usd, amount_lbp, transaction_id, is_refunded, source_ref_table, source_ref_id
         FROM supplier_ledger WHERE supplier_id = ? ORDER BY id ASC`,
    )
    .all(supplierId) as Array<{
    id: number;
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
    is_refunded: number;
    source_ref_table: string | null;
    source_ref_id: number | null;
  }>;
}

function txnStatus(db: Database.Database, id: number): string {
  const row = db
    .prepare(`SELECT status FROM transactions WHERE id = ?`)
    .get(id) as { status: string };
  return row.status;
}

describe("LIRA-091 — supplier-ledger sibling void cascade", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ── (a) FS SEND with auto sibling ──────────────────────────────────────────

  it("(a) voiding an OMT SEND cascades to its auto TOP_UP sibling — ledger nets to 0, hidden SUPPLIER_PAYMENT txn voided", () => {
    const omtId = supplierIdByProvider(db, "OMT");

    fsRepo.createTransaction({
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

    // Auto TOP_UP sibling books the GROSS amount owed (primary-cash-drawer
    // model, 2026-07-30, grossOwedDelta): principal + fee − commission.
    // omtServiceType "INTRA" auto-computes commission from the $5 fee (10%
    // tier → $0.50), overriding the explicit `commission: 0` param — so
    // owed = 100 + 5 − 0.5 = 104.5. (Was, float model, superseded: fee-only
    // = |fee| − |commission| = 4.5 — the $100 principal used to move through
    // the OMT_System FLOAT instead of the ledger; there is no float anymore,
    // so the ledger carries the whole transfer again.)
    const before = ledgerRowsForSupplier(db, omtId);
    expect(before).toHaveLength(1);
    expect(before[0].entry_type).toBe("TOP_UP");
    // 104.5 = principal(100) + fee(5) - commission(0.5); float model read 4.5
    expect(before[0].amount_usd).toBeCloseTo(104.5, 2);
    expect(before[0].is_refunded).toBe(0);
    expect(before[0].source_ref_table).toBe("financial_services");
    const siblingTxnId = before[0].transaction_id!;
    expect(siblingTxnId).toBeTruthy();
    expect(txnStatus(db, siblingTxnId)).toBe("ACTIVE");

    const balanceBefore = getSupplierRepository().getSupplierBalance(omtId);
    expect(balanceBefore.balance_usd).toBeCloseTo(104.5, 2);

    // Void the PARENT financial_services transaction.
    const parentTxn = txnRepo.getBySourceId("financial_services", 1)!;
    txnRepo.voidTransaction(parentTxn.id, 1);

    // The auto sibling's OWN hidden SUPPLIER_PAYMENT transaction is voided.
    expect(txnStatus(db, siblingTxnId)).toBe("VOIDED");

    // Soft-void flag set (existing _markSourceRefunded mechanism, reused).
    const after = ledgerRowsForSupplier(db, omtId);
    const siblingRow = after.find((r) => r.id === before[0].id)!;
    expect(siblingRow.is_refunded).toBe(1);

    // Balance (exclusion aggregate — the raw SUM is NOT 0, the row stays and
    // is flagged; getSupplierBalance is the correct "nets to 0" proof).
    const balanceAfter = getSupplierRepository().getSupplierBalance(omtId);
    expect(balanceAfter.balance_usd).toBe(0);
    expect(balanceAfter.balance_lbp).toBe(0);
  });

  it("(a) FAILING-FIRST capture: without the cascade, the sibling stands and the balance stays overstated", () => {
    const omtId = supplierIdByProvider(db, "OMT");
    fsRepo.createTransaction({
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

    // Simulate the pre-fix repository by voiding the PARENT through the
    // generic path only — i.e. assert the documented pre-fix symptom would
    // have been "balance overstated" by manually confirming the parent void
    // alone (source_table='financial_services') never touches supplier_ledger
    // rows keyed by a DIFFERENT source_table ('supplier_ledger' itself). This
    // pins the bug shape: _markSourceRefunded('financial_services', fsId)
    // cannot reach a row whose OWN source_table is 'supplier_ledger'.
    const ledgerBefore = ledgerRowsForSupplier(db, omtId);
    expect(ledgerBefore[0].is_refunded).toBe(0);

    const parentTxn = txnRepo.getBySourceId("financial_services", 1)!;
    // Directly exercise the pre-fix code path in isolation: _markSourceRefunded
    // only ever updates rows in `original.source_table` ('financial_services'),
    // never 'supplier_ledger' — this is exactly why the sibling stood before
    // the v136 link + cascade existed.
    db.prepare(
      `UPDATE financial_services SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(parentTxn.source_id);

    const ledgerAfterMarkOnly = ledgerRowsForSupplier(db, omtId);
    expect(ledgerAfterMarkOnly[0].is_refunded).toBe(0); // sibling untouched
    const balanceStillOverstated =
      getSupplierRepository().getSupplierBalance(omtId);
    // 104.5 = principal(100) + fee(5) - commission(0.5), same gross TOP_UP as
    // the main (a) test above — un-cascaded, so it still stands (bug shape).
    expect(balanceStillOverstated.balance_usd).toBeCloseTo(104.5, 2); // bug shape
  });

  // ── (b) RECHARGE path (synthetic — proves genericity, see header doc) ─────

  it("(b) a recharges-sourced auto sibling (synthetic) cascades identically when its RECHARGE parent is voided", () => {
    const supplierId = supplierIdByProvider(db, "RECHARGE_TEST");

    // Simulate a hypothetical future RECHARGE-side auto-booking site: a
    // recharges row + its own RECHARGE transaction, then an is_auto:true
    // supplier_ledger sibling with its OWN separate hidden transaction,
    // linked via source_ref_table/source_ref_id — the exact shape
    // FinancialServiceRepository produces today, just on a different table.
    const rechargeResult = db
      .prepare(
        `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code)
         VALUES ('MTC', 'CREDIT_TRANSFER', 50, 40, 50, 'USD')`,
      )
      .run();
    const rechargeId = Number(rechargeResult.lastInsertRowid);

    const parentTxnId = txnRepo.createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: rechargeId,
      user_id: 1,
      amount_usd: 50,
      amount_lbp: 0,
      summary: "Recharge: MTC synthetic test",
      metadata_json: {},
    });

    getSupplierRepository().addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "TOP_UP",
      amount_usd: 40,
      amount_lbp: 0,
      note: "Auto: synthetic recharge supplier debt",
      created_by: 1,
      is_auto: true,
      source_ref_table: "recharges",
      source_ref_id: rechargeId,
    });

    const before = ledgerRowsForSupplier(db, supplierId);
    expect(before).toHaveLength(1);
    const siblingTxnId = before[0].transaction_id!;
    expect(
      getSupplierRepository().getSupplierBalance(supplierId).balance_usd,
    ).toBeCloseTo(40, 2);

    txnRepo.voidTransaction(parentTxnId, 1);

    expect(txnStatus(db, siblingTxnId)).toBe("VOIDED");
    expect(
      getSupplierRepository().getSupplierBalance(supplierId).balance_usd,
    ).toBe(0);
  });

  // ── (c) already-settled sibling ────────────────────────────────────────────

  it("(c) voiding a SEND whose auto sibling was already settled is blocked, naming the settlement", () => {
    const omtId = supplierIdByProvider(db, "OMT");
    fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtServiceType: "INTRA",
      omtFee: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    const settlement = getSupplierRepository().settleTransactions({
      supplier_id: omtId,
      financial_service_ids: [1],
      amount_usd: 95, // owed(100) - commission(5)
      amount_lbp: 0,
      commission_usd: 5,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
    });
    expect(settlement.id).toBeTruthy();

    const parentTxn = txnRepo.getBySourceId("financial_services", 1)!;
    expect(() => txnRepo.voidTransaction(parentTxn.id, 1)).toThrow(
      /settlement/i,
    );

    // Nothing was mutated by the blocked attempt — parent stays ACTIVE.
    expect(txnStatus(db, parentTxn.id)).toBe("ACTIVE");
    const ledger = ledgerRowsForSupplier(db, omtId);
    const sibling = ledger.find((r) => r.entry_type === "TOP_UP")!;
    expect(sibling.is_refunded).toBe(0);
  });

  it("(c) FAILING-FIRST capture: without the settled-guard, the void would succeed and desync the settlement", () => {
    const omtId = supplierIdByProvider(db, "OMT");
    fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtServiceType: "INTRA",
      omtFee: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    getSupplierRepository().settleTransactions({
      supplier_id: omtId,
      financial_service_ids: [1],
      amount_usd: 95,
      amount_lbp: 0,
      commission_usd: 5,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
    });

    const balanceAtSettlement =
      getSupplierRepository().getSupplierBalance(omtId);
    // TOP_UP is GROSS (grossOwedDelta): `omtFee: 0` means the auto-commission
    // block's `resolvedFee > 0` guard never fires (FinancialServiceRepository.ts
    // :685), so the explicit `commission: 5` param is NOT overridden this
    // time (unlike test (a), where a nonzero fee DOES trigger the
    // auto-recalculation) — TOP_UP = principal(100) + fee(0) − commission(5)
    // = 95. SETTLEMENT(-95) is the only other ledger movement: 95 − 95 = 0
    // (this settlement was never meant to be "correct" money — just
    // realistic enough to prove the void-block guard below). (Was, float
    // model, superseded: TOP_UP = |fee(0)| − |commission(5)| = −5, so
    // −5 − 95 = −100 — the principal never appeared in the ledger at all.)
    expect(balanceAtSettlement.balance_usd).toBeCloseTo(0, 2);

    // Bypass the guard directly (the exact code path _assertSupplierSiblingsVoidable
    // exists to block) to prove what would happen without it: cascading the
    // TOP_UP away desyncs the already-computed settlement math.
    const ledgerBefore = ledgerRowsForSupplier(db, omtId);
    const topUp = ledgerBefore.find((r) => r.entry_type === "TOP_UP")!;
    db.prepare(
      `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(topUp.id);

    const balanceIfCascadedAnyway =
      getSupplierRepository().getSupplierBalance(omtId);
    // Without the TOP_UP(95) counted, only SETTLEMENT(-95) remains: 0 - 95 =
    // -95 — the balance shifts by exactly the un-counted TOP_UP,
    // desyncing from the already-computed settlement math. This is exactly
    // the corruption the guard prevents.
    expect(balanceIfCascadedAnyway.balance_usd).toBeCloseTo(-95, 2);
  });

  // ── (d) Katsh BILL inside a split group ────────────────────────────────────

  it("(d) voidCheckoutGroup cascades a Katsh BILL split-group member's auto SUPPLIER_PAYS_US sibling too", () => {
    const katshId = supplierIdByProvider(db, "Katsh");
    const groupId = "33333333-3333-4333-8333-333333333333";

    const carrierFs = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 20,
      cost: 20,
      price: 20,
      currency: "USD",
      commission: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 35 }],
      checkoutTotal: { usd: 35, lbp: 0 },
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "carrier",
      split_units: 2,
      userId: 1,
    });
    const siblingFs = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 15,
      cost: 15,
      price: 15,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      split_group: groupId,
      split_role: "sibling",
      split_units: 2,
      userId: 1,
    });

    // COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 cut over the live BILL
    // auto-booking: every BILL row `createTransaction` creates today (both
    // fixtures above are BILLs) is born `commission_model = 1` — the stamp
    // is gated to `service_type === "BILL"` specifically, not every new row
    // (OMT/WHISH stay `commission_model = 0` until Phase 2 ships; see
    // FinancialServiceRepository.omtCommissionModelGate.test.ts) — which
    // books NOTHING at creation (commission is entered at settlement
    // instead — see
    // FinancialServiceRepository.billsSettlement.test.ts). The auto
    // SUPPLIER_PAYS_US sibling + cascade mechanism THIS test proves still
    // exists for legacy (`commission_model = 0`) rows — pre-migration data
    // this method never produces anymore, so it's reconstructed directly
    // here: flip both rows to the legacy flag and call the REAL
    // `addLedgerEntry` is_auto:true/source_ref call site by hand (the exact
    // call the old unconditional booking made), so it creates its own hidden
    // SUPPLIER_PAYMENT transaction + link exactly like production code did.
    for (const fs of [carrierFs, siblingFs]) {
      db.prepare(
        `UPDATE financial_services SET commission_model = 0 WHERE id = ?`,
      ).run(fs.id);
      getSupplierRepository().addLedgerEntry({
        supplier_id: katshId,
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: 0,
        amount_lbp: -20000,
        note: "Auto: BILL commission from Katsh",
        created_by: 1,
        is_auto: true,
        source_ref_table: "financial_services",
        source_ref_id: fs.id,
      });
    }

    // Both split units carry their OWN auto SUPPLIER_PAYS_US commission row
    // (the legacy BILL branch ran per FS row, independent of carrier/sibling role).
    const ledgerBefore = ledgerRowsForSupplier(db, katshId);
    expect(ledgerBefore).toHaveLength(2);
    expect(ledgerBefore.every((r) => r.entry_type === "SUPPLIER_PAYS_US")).toBe(
      true,
    );
    const siblingTxnIds = ledgerBefore.map((r) => r.transaction_id!);

    txnRepo.voidCheckoutGroup(groupId, 1);

    for (const id of siblingTxnIds) {
      expect(txnStatus(db, id)).toBe("VOIDED");
    }
    const ledgerAfter = ledgerRowsForSupplier(db, katshId);
    expect(ledgerAfter.every((r) => r.is_refunded === 1)).toBe(true);
    expect(
      getSupplierRepository().getSupplierBalance(katshId).balance_lbp,
    ).toBe(0);

    // Sanity: the carrier/sibling FS rows themselves were voided too (the
    // pre-existing voidCheckoutGroup behavior, untouched by this fix) — read
    // by raw source_id since getBySourceId filters to status='ACTIVE' and
    // would return null for an already-voided row.
    const carrierFsTxn = db
      .prepare(
        `SELECT status FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
      )
      .get(carrierFs.id) as { status: string };
    const siblingFsTxn = db
      .prepare(
        `SELECT status FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
      )
      .get(siblingFs.id) as { status: string };
    expect(carrierFsTxn.status).toBe("VOIDED");
    expect(siblingFsTxn.status).toBe("VOIDED");
  });
});
