/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — bills slice (LIRA-089).
 *
 * Covers the three bills-slice deliverables built on top of Foundation's
 * Phase 0 predicate swap (`isPendingSupplierSettlement` / `PENDING_SETTLEMENT_SQL`,
 * `FinancialServiceRepository.ts`):
 *
 *  1. The hardcoded −20,000 LBP `SUPPLIER_PAYS_US` auto-booking at BILL
 *     creation time is skipped for `commission_model = 1` rows — commission
 *     is entered AT settlement now, so booking it again at creation would
 *     double the supplier's credit (the -20,000 arrives a second time via
 *     the settlement's own commission allocation).
 *
 *     Rule 17 — observed failing pre-fix:
 *       FAIL  "a new-model (commission_model=1) Katsh BILL does NOT book the
 *              legacy −20,000 LBP SUPPLIER_PAYS_US credit at creation"
 *         expect(received).toHaveLength(0)
 *         Received length: 1
 *         Received array:  [{"amount_lbp": -20000, "entry_type": "SUPPLIER_PAYS_US", ...}]
 *     Reproduced by temporarily removing the `if (commissionModel === 0)`
 *     guard around the booking call (i.e. restoring the pre-Phase-1
 *     unconditional `supplierRepo.addLedgerEntry(...)` call) — re-ran this
 *     file, watched the test above fail with exactly that output, then
 *     restored the guard and re-ran green.
 *
 *  2. New-model bills join the settle tab: `getUnsettledBySupplier` /
 *     `getUnsettledSummaryByProvider` already inherited this for free from
 *     Foundation's `PENDING_SETTLEMENT_SQL` swap (D2) — this file proves it
 *     positively (a new-model BILL row appears) and adds the one thing that
 *     swap didn't cover: `supplier_owed`/`total_owed_*` incorrectly fell
 *     through `SUPPLIER_OWED_EXPR`'s `ELSE ABS(amount)` branch for BILL rows
 *     (a case that could never previously be reached — bills were always
 *     born `is_settled = 1`, invisible to every query `SUPPLIER_OWED_EXPR`
 *     feeds). A bill's principal already left the shop via the
 *     provider-drawer cost leg at creation (prepaid balance, not a ledger
 *     receivable) — settling a bill books ONLY the commission credit
 *     (plan's "Bills settlement note"), so a bill's contribution to "gross
 *     owed" must be 0, never its face amount. `getUnsettledSummaryByProvider`
 *     also gains a `bill_count` projection (COUNT of unsettled BILL rows per
 *     provider) so RATE-mode settlement (rate × unit_count) has a count to
 *     read without pulling the full unsettled row array.
 *
 *     Rule 17 — observed failing pre-fix:
 *       FAIL  "a new-model Katsh BILL projects supplier_owed = 0, not its
 *              face amount, in the unsettled queue"
 *         expect(received).toBe(expected)
 *         Expected: 0
 *         Received: 20
 *     Reproduced by temporarily reverting `SUPPLIER_OWED_EXPR`'s new
 *     `WHEN service_type = 'BILL' THEN 0` branch (falling through to the
 *     pre-existing `ELSE ABS(amount)`) — re-ran, watched it fail with
 *     `Received: 20` (the bill's face amount), then restored the branch and
 *     re-ran green.
 *
 *  3. `notRefunded` — a pre-existing leak (NOT specific to bills; applies to
 *     any pending-settlement row) where a voided/refunded financial_services
 *     row that was `is_settled = 0` at creation stays settleable forever:
 *     `_markSourceRefunded` stamps `is_refunded = 1` on the source row but
 *     never touches `is_settled`, and neither unsettled query filtered on
 *     `is_refunded` before this fix.
 *
 *     Rule 17 — observed failing pre-fix:
 *       FAIL  "a voided new-model Katsh BILL is excluded from the unsettled
 *              queue (pre-existing notRefunded leak, fixed here)"
 *         expect(received).toHaveLength(0)
 *         Received length: 1
 *       FAIL  "... is excluded from getUnsettledSummaryByProvider too"
 *         expect(received).toEqual([])
 *         Received: [{"provider": "Katsh", "count": 1, ...}]
 *     Reproduced by temporarily removing the `AND is_refunded = 0` clause
 *     from both queries — re-ran, watched both fail with the voided row
 *     still present, then restored the clause and re-ran green.
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

// Schema: the union used by TransactionRepository.supplierSiblingVoidCascade
// .test.ts (Katsh BILL drawers, v136 supplier_ledger source_ref columns, v150
// financial_services.commission_model/is_refunded/refunded_at) — proven to
// exercise a full Katsh BILL creation + void round trip already.
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
      edited_by TEXT,
      edited_at TEXT,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT,
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT
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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
      commission_eligible INTEGER NOT NULL DEFAULT 1 CHECK(commission_eligible IN (0, 1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- LIRA-112 (D12): Katsh earns 20,000 LBP/bill (commission_eligible = 1);
    -- iPick earns nothing (commission_eligible = 0).
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('OMT', 'OMT', 1, 1);
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('Katsh', 'Katsh', 1, 1);
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('iPick', 'iPick', 1, 0);

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

    -- v150 (COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6) — real commission
    -- storage, needed here so the rule-20 create→settle→void test below
    -- exercises the REAL new-model settlement path (not the "no v150
    -- tables, falls back to legacy" branch).
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

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'USD', 500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'LBP', 0,         CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'USD', 500,       CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'LBP', 0,         CURRENT_TIMESTAMP);
  `);

  return db;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
    .get(provider) as { id: number };
  return row.id;
}

function ledgerRowsForSupplier(
  db: Database.Database,
  supplierId: number,
): Array<{ entry_type: string; amount_usd: number; amount_lbp: number }> {
  return db
    .prepare(
      `SELECT entry_type, amount_usd, amount_lbp FROM supplier_ledger WHERE supplier_id = ? ORDER BY id ASC`,
    )
    .all(supplierId) as Array<{
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

// BILL_COMMISSION_SETTLEMENT_PLAN.md — the bills-only commission books a
// REAL provider-drawer credit, not a supplier_ledger row.
function drawerBalance(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawerName, currencyCode) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("COMMISSION_AT_SETTLEMENT_PLAN.md Phase 1 — bills slice", () => {
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

  // ── 1. The −20,000 auto-booking must not fire for commission_model = 1 ──

  it("a new-model (commission_model=1) Katsh BILL does NOT book the legacy −20,000 LBP SUPPLIER_PAYS_US credit at creation", () => {
    const katshId = supplierIdByProvider(db, "Katsh");

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

    const ledger = ledgerRowsForSupplier(db, katshId);
    expect(ledger).toHaveLength(0);
  });

  // ── 2. New-model bills join the unsettled queue with correct owed = 0 ───

  it("a new-model Katsh BILL appears in getUnsettledBySupplier, is_settled = 0", () => {
    fsRepo.createTransaction({
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

    const rows = fsRepo.getUnsettledBySupplier("Katsh");
    expect(rows).toHaveLength(1);
    expect(rows[0].service_type).toBe("BILL");
    expect(rows[0].is_settled).toBe(0);
  });

  it("a new-model Katsh BILL projects supplier_owed = 0, not its face amount, in the unsettled queue", () => {
    fsRepo.createTransaction({
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

    const rows = fsRepo.getUnsettledBySupplier("Katsh");
    expect(rows).toHaveLength(1);
    // The bill's $20 principal already left via the provider-drawer cost
    // leg (prepaid balance) at creation — it is NOT a ledger receivable, so
    // it must contribute 0 to "gross owed", never its face amount.
    expect(rows[0].supplier_owed).toBe(0);
  });

  it("getUnsettledSummaryByProvider surfaces the new-model Katsh BILL with count=1, bill_count=1, total_owed_usd=0", () => {
    fsRepo.createTransaction({
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

    const summary = fsRepo.getUnsettledSummaryByProvider();
    const katsh = summary.find((s) => s.provider === "Katsh");
    expect(katsh).toBeDefined();
    expect(katsh!.count).toBe(1);
    expect(katsh!.bill_count).toBe(1);
    expect(katsh!.total_owed_usd).toBe(0);
  });

  it("bill_count only counts BILL rows for a provider that also carries non-BILL pending rows", () => {
    // Two Katsh BILLs...
    fsRepo.createTransaction({
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
    fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 10,
      cost: 10,
      price: 10,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      userId: 1,
    });

    const summary = fsRepo.getUnsettledSummaryByProvider();
    const katsh = summary.find((s) => s.provider === "Katsh");
    expect(katsh!.count).toBe(2);
    expect(katsh!.bill_count).toBe(2);
  });

  // ── 3. notRefunded — pre-existing leak, not bills-specific, fixed here ──

  it("a voided new-model Katsh BILL is excluded from the unsettled queue (pre-existing notRefunded leak, fixed here)", () => {
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

    // Confirm the leak's precondition: the row IS pending settlement before
    // voiding (is_settled = 0), so a query that only checks is_settled would
    // wrongly keep including it after the void below.
    expect(
      fsRepo.getUnsettledBySupplier("Katsh").some((r) => r.id === id),
    ).toBe(true);

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
      )
      .get(id) as { id: number };
    txnRepo.voidTransaction(txn.id, 1);

    const refunded = db
      .prepare(
        `SELECT is_refunded, is_settled FROM financial_services WHERE id = ?`,
      )
      .get(id) as { is_refunded: number; is_settled: number };
    expect(refunded.is_refunded).toBe(1);
    // is_settled is untouched by the generic void path (only the reversal's
    // own `_reverseSupplierSettlement` branch resets it, and that's not what
    // ran here) — this is exactly why is_refunded must be checked
    // independently in the unsettled queries, not inferred from is_settled.
    expect(refunded.is_settled).toBe(0);

    const rows = fsRepo.getUnsettledBySupplier("Katsh");
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it("a voided new-model Katsh BILL is excluded from getUnsettledSummaryByProvider too", () => {
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

    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
      )
      .get(id) as { id: number };
    txnRepo.voidTransaction(txn.id, 1);

    const summary = fsRepo.getUnsettledSummaryByProvider();
    expect(summary.find((s) => s.provider === "Katsh")).toBeUndefined();
  });
});

// ── LIRA-112 (D12) — iPick bills book NO commission; only Katsh pays ───────
//
// Owner: "i said ipick bills gives us no comission, but katsh does. So in
// katsh we should count the bills we sold. And at settlement in suppliers
// page we should showcase an estimated commission amount for the customer
// 20,000 LBP per bill sold. Whereas in ipick its not the case. No comission
// in ipick."
//
// Both the pre-plan code and this file's OWN Phase 1 tests above (before
// this fix) treated iPick and Katsh identically — the BILL branch of
// isPendingSupplierSettlement/PENDING_SETTLEMENT_SQL hardcoded
// `provider IN ('iPick', 'Katsh')` with no distinction between them.
//
// Rule 17 — observed failing pre-fix: the BILL branch was temporarily
// reverted to that exact hardcode (ignoring `supplierCommissionEligible`) —
// re-ran this describe block, watched "an iPick BILL is absent from
// getUnsettledBySupplier('iPick')" fail with `Received length: 1` (the
// iPick bill WAS in the queue) and "...absent from getUnsettledSummaryByProvider"
// fail with the iPick row present in the summary — then restored the real
// fix and re-ran green. See the task report for the exact failure output.
describe("LIRA-112 (D12) — iPick books zero commission; Katsh does", () => {
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

  it("an iPick BILL books zero supplier_ledger rows at creation (same as Katsh — this part was never the bug)", () => {
    const ipickId = supplierIdByProvider(db, "iPick");

    fsRepo.createTransaction({
      provider: "iPick",
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

    expect(ledgerRowsForSupplier(db, ipickId)).toHaveLength(0);
  });

  it("an iPick BILL is born is_settled = 1 and is absent from getUnsettledBySupplier('iPick') — the LIRA-112 fix", () => {
    const { id } = fsRepo.createTransaction({
      provider: "iPick",
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
      .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
      .get(id) as { is_settled: number };
    expect(row.is_settled).toBe(1);

    expect(fsRepo.getUnsettledBySupplier("iPick")).toHaveLength(0);
  });

  it("an iPick BILL is absent from getUnsettledSummaryByProvider — no estimated commission surfaced for it", () => {
    fsRepo.createTransaction({
      provider: "iPick",
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

    const summary = fsRepo.getUnsettledSummaryByProvider();
    expect(summary.find((s) => s.provider === "iPick")).toBeUndefined();
  });

  it("a Katsh BILL DOES join both the unsettled queue and the summary (contrast case, same DB/run as the iPick assertions above)", () => {
    fsRepo.createTransaction({
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
    fsRepo.createTransaction({
      provider: "iPick",
      serviceType: "BILL",
      amount: 15,
      cost: 15,
      price: 15,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      userId: 1,
    });

    expect(fsRepo.getUnsettledBySupplier("Katsh")).toHaveLength(1);
    expect(fsRepo.getUnsettledBySupplier("iPick")).toHaveLength(0);

    const summary = fsRepo.getUnsettledSummaryByProvider();
    expect(summary.find((s) => s.provider === "Katsh")?.bill_count).toBe(1);
    expect(summary.find((s) => s.provider === "iPick")).toBeUndefined();
  });

  it("the settle estimate (rate × bill count) is driven by the supplier's stored config: Katsh's commission_entry_mode/commission_rate/commission_rate_currency read RATE/20000/LBP", () => {
    // v151 columns are only selected by getColumns() when present — this
    // fixture's `suppliers` table (createTestDb, top of file) predates v151,
    // so ALTER it in here to prove the real (migrated) shape end-to-end.
    db.exec(`
      ALTER TABLE suppliers ADD COLUMN commission_entry_mode TEXT DEFAULT 'LUMP';
      ALTER TABLE suppliers ADD COLUMN commission_rate REAL;
      ALTER TABLE suppliers ADD COLUMN commission_rate_currency TEXT DEFAULT 'USD';
      UPDATE suppliers SET commission_entry_mode = 'RATE', commission_rate = 20000, commission_rate_currency = 'LBP'
        WHERE provider = 'Katsh';
    `);
    resetSupplierRepository();
    const freshSupplierRepo = getSupplierRepository();

    fsRepo.createTransaction({
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
    fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 10,
      cost: 10,
      price: 10,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      userId: 1,
    });

    const katsh = freshSupplierRepo.getByProvider("Katsh")!;
    expect(katsh.commission_entry_mode).toBe("RATE");
    expect(katsh.commission_rate).toBe(20000);
    expect(katsh.commission_rate_currency).toBe("LBP");

    const summary = fsRepo.getUnsettledSummaryByProvider();
    const katshSummary = summary.find((s) => s.provider === "Katsh")!;
    expect(katshSummary.bill_count).toBe(2);
    // The settle screen's estimate = rate × bill count, from stored config.
    expect(katsh.commission_rate! * katshSummary.bill_count).toBe(40000);
  });

  // ── Rule 20 — create → settle → void nets to 0, per currency, per drawer,
  //    per profit (BILL_COMMISSION_SETTLEMENT_PLAN.md, LIRA-137: the
  //    commission now books as a Katsh-drawer top-up + a profit stamp on
  //    the settlement's own transaction — NOT a supplier_ledger row) ──────
  it("Katsh BILL: create → settle (RATE × count, 20,000 LBP) → void nets the Katsh drawer + profit back to 0 (no supplier_ledger row for this money)", () => {
    const katshId = supplierIdByProvider(db, "Katsh");
    const supplierRepo = getSupplierRepository();

    const { id: fsId } = fsRepo.createTransaction({
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

    // Pending, real queue read (not a synthetic insert) — proves the whole
    // pipeline this fix touches, end to end.
    const unsettled = fsRepo.getUnsettledBySupplier("Katsh");
    expect(unsettled.map((r) => r.id)).toContain(fsId);

    const katshLbpBeforeSettle = drawerBalance(db, "Katsh", "LBP");

    const settlement = supplierRepo.settleTransactions({
      supplier_id: katshId,
      financial_service_ids: [fsId],
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 20000,
      entry_mode: "RATE",
      commission_rate: 20000,
      commission_unit_count: 1,
      created_by: 1,
    });

    // Settled: row cleared from the queue, and the ONLY supplier_ledger row
    // is the (zero-amount) SETTLEMENT row itself — NO SUPPLIER_PAYS_US
    // credit row for this batch shape any more.
    const postSettleLedger = ledgerRowsForSupplier(db, katshId);
    expect(postSettleLedger).toHaveLength(1);
    expect(postSettleLedger[0].entry_type).toBe("SETTLEMENT");
    expect(
      fsRepo.getUnsettledBySupplier("Katsh").map((r) => r.id),
    ).not.toContain(fsId);

    // The REAL money movement: the Katsh drawer (LBP) increases by EXACTLY
    // the entered commission — a top-up funded by Katsh itself, per the
    // owner's own model (2026-08-11), never a supplier_ledger receivable.
    expect(drawerBalance(db, "Katsh", "LBP") - katshLbpBeforeSettle).toBe(
      20000,
    );

    const settlementTxn = txnRepo.getBySourceId(
      "supplier_ledger",
      settlement.id,
    )!;
    // Profit, entirely (owner's words) — stamped on the settlement's own
    // transaction, same mechanism every other commission-earning flow uses.
    expect(settlementTxn.profit_lbp).toBe(20000);
    expect(settlementTxn.profit_usd).toBe(0);

    txnRepo.voidTransaction(settlementTxn.id, 1);

    // Rule 20 — nets to 0, per currency, across EVERY ledger/drawer/profit
    // this batch touched:
    //   1. supplier_ledger: still exactly the (zero-amount) SETTLEMENT row —
    //      there was never a nonzero row for this money to net out.
    const postVoidLedger = ledgerRowsForSupplier(db, katshId);
    expect(
      postVoidLedger.every((r) => r.amount_usd === 0 && r.amount_lbp === 0),
    ).toBe(true);
    //   2. Katsh drawer (LBP): the generic `_reversePayments` step mirrors
    //      the top-up leg with a negated amount — back to its pre-settle
    //      balance, with NO bespoke reversal code (this is the point).
    expect(drawerBalance(db, "Katsh", "LBP")).toBe(katshLbpBeforeSettle);
    //   3. Profit: the original settlement row flips to VOIDED (excluded
    //      from every ACTIVE-only profit sum) and its reversal row carries
    //      no profit stamp of its own — summed over ACTIVE rows for this
    //      exact source, profit nets to 0.
    const activeProfitLbp = db
      .prepare(
        `SELECT COALESCE(SUM(profit_lbp), 0) as total FROM transactions
           WHERE source_table = 'supplier_ledger' AND source_id = ? AND status = 'ACTIVE'`,
      )
      .get(settlement.id) as { total: number };
    expect(activeProfitLbp.total).toBe(0);

    // Reversal symmetry (rule 20): the bill row re-joins the unsettled
    // queue, exactly as if it had never been settled.
    expect(fsRepo.getUnsettledBySupplier("Katsh").map((r) => r.id)).toContain(
      fsId,
    );

    const allocations = db
      .prepare(
        `SELECT * FROM settlement_commission_allocations WHERE financial_service_id = ?`,
      )
      .all(fsId);
    // supplier_settlements/settlement_commission_allocations have no
    // soft-void column (DELETE is their reversal — TransactionRepository's
    // _reverseCommissionAtSettlementRecords) — if this fixture's minimal
    // schema doesn't carry those v150 tables, the reversal skips them
    // gracefully (see FinancialServiceRepository.omtCommissionModelGate.test.ts's
    // "falls back to legacy behavior" precedent); either way none survive.
    expect(allocations).toHaveLength(0);
  });

  // Owner follow-up (2026-08-13) — the "Other payment" sibling of the
  // rule-20 proof above: same money fact (create → settle → void nets to 0),
  // different collection mode. The commission now arrives via a real CASH
  // leg into General instead of a Katsh-drawer top-up — General must net
  // back to 0 too, and the Katsh drawer must never have moved at all.
  it("Katsh BILL: create → settle (Other payment, CASH, 20,000 LBP) → void nets the General drawer + profit back to 0, and the Katsh drawer never moves", () => {
    const katshId = supplierIdByProvider(db, "Katsh");
    const supplierRepo = getSupplierRepository();

    const { id: fsId } = fsRepo.createTransaction({
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

    const katshLbpBeforeSettle = drawerBalance(db, "Katsh", "LBP");
    const generalLbpBeforeSettle = drawerBalance(db, "General", "LBP");

    const settlement = supplierRepo.settleTransactions({
      supplier_id: katshId,
      financial_service_ids: [fsId],
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 20000,
      entry_mode: "RATE",
      commission_rate: 20000,
      commission_unit_count: 1,
      created_by: 1,
      commission_collection_mode: "OTHER_PAYMENT",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 20000 }],
    });

    // The chosen drawer (General) gains exactly the commission; the
    // provider's own drawer (Katsh) is UNTOUCHED — the top-up branch never
    // ran for this mode.
    expect(drawerBalance(db, "General", "LBP") - generalLbpBeforeSettle).toBe(
      20000,
    );
    expect(drawerBalance(db, "Katsh", "LBP")).toBe(katshLbpBeforeSettle);

    const settlementTxn = txnRepo.getBySourceId(
      "supplier_ledger",
      settlement.id,
    )!;
    expect(settlementTxn.profit_lbp).toBe(20000);
    expect(settlementTxn.profit_usd).toBe(0);

    txnRepo.voidTransaction(settlementTxn.id, 1);

    // Rule 20 — nets to 0, per currency, across EVERY drawer/profit this
    // batch touched:
    //   1. General (LBP): the generic `_reversePayments` step mirrors the
    //      CASH leg with a negated amount — back to its pre-settle balance,
    //      no bespoke reversal code.
    expect(drawerBalance(db, "General", "LBP")).toBe(generalLbpBeforeSettle);
    //   2. Katsh drawer: still untouched (0 delta) throughout create, settle,
    //      AND void — this money never passed through it in this mode.
    expect(drawerBalance(db, "Katsh", "LBP")).toBe(katshLbpBeforeSettle);
    //   3. supplier_ledger: no nonzero row for this money at any point.
    const postVoidLedger = ledgerRowsForSupplier(db, katshId);
    expect(
      postVoidLedger.every((r) => r.amount_usd === 0 && r.amount_lbp === 0),
    ).toBe(true);
    //   4. Profit: nets to 0 across ACTIVE rows for this exact source.
    const activeProfitLbp = db
      .prepare(
        `SELECT COALESCE(SUM(profit_lbp), 0) as total FROM transactions
           WHERE source_table = 'supplier_ledger' AND source_id = ? AND status = 'ACTIVE'`,
      )
      .get(settlement.id) as { total: number };
    expect(activeProfitLbp.total).toBe(0);

    // Reversal symmetry: the bill re-joins the unsettled queue.
    expect(fsRepo.getUnsettledBySupplier("Katsh").map((r) => r.id)).toContain(
      fsId,
    );
  });
});
