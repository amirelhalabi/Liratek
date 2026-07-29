/**
 * CQ-8 — counterparty transaction metadata contract guard.
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
 * (2026-07-18)". Every counterparty money transaction (the seven write sites
 * across DebtRepository/SupplierRepository/PartnerRepository) must stamp a
 * `counterparty` object into `transactions.metadata_json` that parses against
 * `counterpartyMetadataSchema`, with the correct `kind`/`flow`/
 * `ledger_entry_id` for that site.
 *
 * Failing-first (rule 17): every assertion below was verified to FAIL against
 * the pre-stamp code (metadata_json carried no `counterparty` key at all,
 * so `counterpartyMetadataSchema.parse(meta.counterparty)` threw on
 * `undefined`) — proven by temporarily reverting each repo's stamp block,
 * rerunning this file, and confirming every "stamps counterparty" test fails,
 * then restoring the stamp. See the CQ-8 report for the exact revert/rerun
 * log.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository";
import { SupplierRepository } from "../SupplierRepository";
import { PartnerRepository } from "../PartnerRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { counterpartyMetadataSchema } from "../../validators/counterparty";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (1, 'Jane Client');

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (id, name, provider) VALUES (1, 'Acme Supplier', 'OMT');

    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Bob Partner');

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO financial_services (id, provider, service_type, amount, currency)
      VALUES (1, 'OMT', 'RECEIVE', 100, 'USD');

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
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
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);
  return db;
}

function getTxnMetadata(
  db: Database.Database,
  txnId: number,
): Record<string, unknown> {
  const row = db
    .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
    .get(txnId) as { metadata_json: string } | undefined;
  if (!row?.metadata_json) {
    throw new Error(`No metadata_json on transaction #${txnId}`);
  }
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function debtLedgerTxnId(db: Database.Database, ledgerId: number): number {
  const row = db
    .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
    .get(ledgerId) as { transaction_id: number };
  return row.transaction_id;
}

function supplierLedgerTxnId(db: Database.Database, ledgerId: number): number {
  const row = db
    .prepare(`SELECT transaction_id FROM supplier_ledger WHERE id = ?`)
    .get(ledgerId) as { transaction_id: number };
  return row.transaction_id;
}

describe("CQ-8 counterparty metadata contract", () => {
  let db: Database.Database;
  let debtRepo: DebtRepository;
  let supplierRepo: SupplierRepository;
  let partnerRepo: PartnerRepository;

  beforeEach(() => {
    db = createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    debtRepo = new DebtRepository();
    supplierRepo = new SupplierRepository();
    partnerRepo = new PartnerRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__LIRATEK_TEST_DB__;
  });

  // ── Client (DebtRepository) ────────────────────────────────────────────

  it("DEBT_REPAYMENT (addRepayment) stamps kind=client, flow=IN, ledger_entry_id", () => {
    const { id: repaymentId } = debtRepo.addRepayment({
      client_id: 1,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });
    const meta = getTxnMetadata(db, debtLedgerTxnId(db, repaymentId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("client");
    expect(cp.id).toBe(1);
    expect(cp.name).toBe("Jane Client");
    expect(cp.flow).toBe("IN");
    expect(cp.ledger_entry_id).toBe(repaymentId);
  });

  it("CREDIT_CASH_OUT (cashOutCredit) stamps kind=client, flow=OUT", () => {
    const { id: ledgerId } = debtRepo.cashOutCredit({
      client_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: 1,
    });
    const meta = getTxnMetadata(db, debtLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("client");
    expect(cp.flow).toBe("OUT");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("CREDIT_CASH_IN (addAccountCashEntry, direction=credit) stamps flow=IN", () => {
    const { id: ledgerId } = debtRepo.addAccountCashEntry({
      direction: "credit",
      client_id: 1,
      amount_usd: 15,
      amount_lbp: 0,
      created_by: 1,
    });
    const meta = getTxnMetadata(db, debtLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("client");
    expect(cp.flow).toBe("IN");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("DEBT_CASH_OUT (addAccountCashEntry, direction=debt) stamps flow=OUT", () => {
    const { id: ledgerId } = debtRepo.addAccountCashEntry({
      direction: "debt",
      client_id: 1,
      amount_usd: 15,
      amount_lbp: 0,
      created_by: 1,
    });
    const meta = getTxnMetadata(db, debtLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("client");
    expect(cp.flow).toBe("OUT");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  // ── Supplier (SupplierRepository) ───────────────────────────────────────

  it("SUPPLIER_SETTLEMENT (settleTransactions) stamps kind=supplier, flow=OUT", () => {
    const { id: ledgerId } = supplierRepo.settleTransactions({
      supplier_id: 1,
      financial_service_ids: [1],
      amount_usd: 80,
      amount_lbp: 0,
      commission_usd: 20,
      commission_lbp: 0,
      // Float model: the net owed is paid through a real payment-method leg;
      // the bare `drawer_name` fallback is gone (settlement no longer debits a
      // named drawer by a ledger-derived amount). Commission is informational
      // metadata only now — it has no drawer effect.
      payments: [{ method: "CASH", currency_code: "USD", amount: 80 }],
      created_by: 1,
    });
    const meta = getTxnMetadata(db, supplierLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("supplier");
    expect(cp.id).toBe(1);
    expect(cp.name).toBe("Acme Supplier");
    expect(cp.flow).toBe("OUT");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("SUPPLIER_PAYMENT (recordSupplierCashflow, PAY) stamps flow=OUT", () => {
    const { id: ledgerId } = supplierRepo.recordSupplierCashflow({
      supplier_id: 1,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
      created_by: 1,
    });
    const meta = getTxnMetadata(db, supplierLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("supplier");
    expect(cp.flow).toBe("OUT");
    expect(cp.method).toBe("CASH");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("SUPPLIER_PAYMENT (recordSupplierCashflow, RECEIVE) stamps flow=IN", () => {
    const { id: ledgerId } = supplierRepo.recordSupplierCashflow({
      supplier_id: 1,
      direction: "RECEIVE",
      payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
      created_by: 1,
    });
    const meta = getTxnMetadata(db, supplierLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("supplier");
    expect(cp.flow).toBe("IN");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("SUPPLIER_PAYMENT (addLedgerEntry, PAYMENT + drawer_name) stamps flow=OUT, method=leg method", () => {
    const { id: ledgerId } = supplierRepo.addLedgerEntry({
      supplier_id: 1,
      entry_type: "PAYMENT",
      amount_usd: 25,
      amount_lbp: 0,
      created_by: 1,
      drawer_name: "General",
      method: "WHISH",
    });
    const meta = getTxnMetadata(db, supplierLedgerTxnId(db, ledgerId));
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("supplier");
    expect(cp.flow).toBe("OUT");
    expect(cp.method).toBe("WHISH");
    expect(cp.ledger_entry_id).toBe(ledgerId);
  });

  it("SUPPLIER_PAYMENT (addLedgerEntry, no-drawer TOP_UP, is_auto) stamps flow=IN, method=LEDGER, top-level is_auto=true", () => {
    const { id: ledgerId } = supplierRepo.addLedgerEntry({
      supplier_id: 1,
      entry_type: "TOP_UP",
      amount_usd: 15,
      amount_lbp: 0,
      created_by: 1,
      is_auto: true,
    });
    const txnId = supplierLedgerTxnId(db, ledgerId);
    const meta = getTxnMetadata(db, txnId);
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("supplier");
    expect(cp.flow).toBe("IN");
    expect(cp.method).toBe("LEDGER");
    expect(cp.ledger_entry_id).toBe(ledgerId);
    // D2 (owner decision): auto-generated supplier rows carry a top-level
    // is_auto marker so the viewer can hide them by default.
    expect(meta.is_auto).toBe(true);
  });

  it("SUPPLIER_PAYMENT (addLedgerEntry, manual entry) does NOT stamp top-level is_auto", () => {
    const { id: ledgerId } = supplierRepo.addLedgerEntry({
      supplier_id: 1,
      entry_type: "ADJUSTMENT",
      amount_usd: 5,
      amount_lbp: 0,
      created_by: 1,
    });
    const meta = getTxnMetadata(db, supplierLedgerTxnId(db, ledgerId));
    expect(meta.is_auto).toBeUndefined();
  });

  // ── Partner (PartnerRepository) ─────────────────────────────────────────

  it("PARTNER_SETTLEMENT (recordSettlementMoneyMovement, CREDIT) stamps kind=partner, flow=IN", () => {
    const entry = partnerRepo.addLedgerEntry({
      partner_id: 1,
      transaction_type: "SETTLEMENT",
      amount: 40,
      currency: "USD",
      direction: "CREDIT",
      user_id: 1,
    });
    const txnId = partnerRepo.recordSettlementMoneyMovement(
      entry,
      1,
      "PARTNER_SETTLEMENT",
    );
    const meta = getTxnMetadata(db, txnId);
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("partner");
    expect(cp.id).toBe(1);
    expect(cp.name).toBe("Bob Partner");
    expect(cp.flow).toBe("IN");
    expect(cp.ledger_entry_id).toBe(entry.id);
  });

  it("PARTNER_PAYMENT (recordSettlementMoneyMovement, DEBIT) stamps flow=OUT", () => {
    const entry = partnerRepo.addLedgerEntry({
      partner_id: 1,
      transaction_type: "ADJUSTMENT",
      amount: 40,
      currency: "USD",
      direction: "DEBIT",
      user_id: 1,
    });
    const txnId = partnerRepo.recordSettlementMoneyMovement(
      entry,
      1,
      "PARTNER_PAYMENT",
    );
    const meta = getTxnMetadata(db, txnId);
    const cp = counterpartyMetadataSchema.parse(meta.counterparty);
    expect(cp.kind).toBe("partner");
    expect(cp.flow).toBe("OUT");
    expect(cp.ledger_entry_id).toBe(entry.id);
  });
});
