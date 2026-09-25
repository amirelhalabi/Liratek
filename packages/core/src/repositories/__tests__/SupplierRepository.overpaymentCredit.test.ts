/**
 * SupplierRepository.settleAccount() — LIRA-203 (owner D18 follow-up,
 * OWNER_NOTES_2026-09-21.md §2b, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md): paying the
 * OMT account MORE than the ticked rows' net books the surplus as its own
 * standalone account credit, applied MANUALLY (never auto-applied) at a
 * later settlement.
 *
 * D18's non-negotiable guard — a leg total that differs from the SELECTED
 * ROWS' net "in EITHER direction" is a hard reject — is proven UNCHANGED by
 * the last `describe` block below (surplus omitted ⇒ byte-identical to
 * pre-LIRA-203 behaviour, `SupplierRepository.accountSettlement.test.ts`'s
 * own "leg reconciliation" suite is the fuller version of that guard and is
 * untouched by this ticket).
 *
 * Fixture shape copied from `SupplierRepository.accountSettlement.test.ts`
 * (same migration v176 columns, same helper shapes) — this file intentionally
 * does not import that file's helpers (house convention: every
 * `SupplierRepository.*.test.ts` file owns its own fixture, see that file's
 * sibling list) but keeps them byte-identical so behaviour observed here
 * generalizes.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";

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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      commission_eligible INTEGER NOT NULL DEFAULT 1,
      commission_rate_currency TEXT DEFAULT 'USD',
      account_supplier_id INTEGER REFERENCES suppliers(id),
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT', 'STOCK_INTAKE')),
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
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      client_id INTEGER,
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      item_key TEXT,
      note TEXT,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      created_by INTEGER,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
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
      session_id INTEGER,
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

    -- Unrelated to this file's own scenarios, but _cancelDebt/
    -- _restoreRepaymentDebt run unconditionally on every void (no-op here —
    -- no rows ever match).
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
  `);

  return db;
}

// ─── Helpers (mirrors SupplierRepository.accountSettlement.test.ts) ───────

function seedSupplier(
  db: Database.Database,
  data: {
    name: string;
    provider?: string | null;
    accountSupplierId?: number | null;
    isSystem?: number;
    commissionEligible?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO suppliers (name, provider, account_supplier_id, is_system, commission_eligible)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.provider ?? null,
      data.accountSupplierId ?? null,
      data.isSystem ?? 0,
      data.commissionEligible ?? 1,
    );
  return Number(res.lastInsertRowid);
}

function seedLedgerEntry(
  db: Database.Database,
  data: {
    supplierId: number;
    entryType: string;
    amountUsd?: number;
    amountLbp?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp)
       VALUES (?, ?, ?, ?)`,
    )
    .run(data.supplierId, data.entryType, data.amountUsd ?? 0, data.amountLbp ?? 0);
  return Number(res.lastInsertRowid);
}

function ledgerSum(
  db: Database.Database,
  supplierId: number,
): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM supplier_ledger WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierId) as { usd: number; lbp: number };
}

function drawerBal(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function ledgerRow(
  db: Database.Database,
  id: number,
): {
  supplier_id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  settlement_id: number | null;
  is_refunded: number;
  transaction_id: number | null;
  note: string | null;
} {
  return db
    .prepare(
      `SELECT supplier_id, entry_type, amount_usd, amount_lbp, settlement_id, is_refunded, transaction_id, note
       FROM supplier_ledger WHERE id = ?`,
    )
    .get(id) as {
    supplier_id: number;
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
    settlement_id: number | null;
    is_refunded: number;
    transaction_id: number | null;
    note: string | null;
  };
}

function settlementTxnFor(
  db: Database.Database,
  txnId: number,
): { id: number; status: string; profit_usd: number; profit_lbp: number } {
  return db
    .prepare(`SELECT id, status, profit_usd, profit_lbp FROM transactions WHERE id = ?`)
    .get(txnId) as { id: number; status: string; profit_usd: number; profit_lbp: number };
}

describe("SupplierRepository.settleAccount() — LIRA-203 overpayment surplus", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let txnRepo: TransactionRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
    txnRepo = new TransactionRepository();
    resetFinancialServiceRepository();
    resetTransactionRepository();
  });

  afterEach(() => {
    db.close();
    resetFinancialServiceRepository();
    resetTransactionRepository();
  });

  function seedOmtAccount(): { omtId: number; ipickId: number } {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT", isSystem: 1 });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
      commissionEligible: 0,
    });
    return { omtId, ipickId };
  }

  // ── Record-surplus half ───────────────────────────────────────────────

  it("PAY $150 against a $100 debt with a declared $50 surplus: the row settles to 0, the drawer drops the FULL $150, and a standalone -$50 credit row opens on the account parent", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });
    const preDrawer = drawerBal(db, "OMT_System", "USD");

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [{ kind: "LEDGER", id: debtId }],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      surplus_usd: 50,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
    });

    // The ticked row settled EXACTLY — D18's guard on the rows themselves,
    // untouched.
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
    expect(ledgerRow(db, debtId).settlement_id).not.toBeNull();

    // The drawer moved the FULL $150 — rows + surplus, one set of legs.
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer - 150);

    // The account's own balance now shows a $50 CREDIT (OMT owes the shop):
    // iPick nets to 0, but the parent (OMT) picked up a standalone -$50 row.
    expect(ledgerSum(db, omtId).usd).toBeCloseTo(-50);
    const account = repo
      .getAccountBalances()
      .find((a) => a.account_supplier_id === omtId)!;
    expect(account.total_usd).toBeCloseTo(-50); // 0 (iPick) + -50 (OMT credit)

    // The credit row itself: negative PAYMENT on the PARENT, sharing this
    // settlement's transaction_id (findable/reversible), but LEFT OPEN
    // (settlement_id NULL) — D18: "applied manually", never auto-applied.
    // `result.id` is the ANCHOR ledger row (settleAccount's own return
    // convention) — the ORIGINAL selected row only gets `settlement_id`
    // stamped, never `transaction_id` (that lives on the anchor/member rows
    // this settlement itself wrote).
    const txnId = ledgerRow(db, result.id).transaction_id as number;
    const creditRow = db
      .prepare(
        `SELECT id, supplier_id, entry_type, amount_usd, settlement_id, transaction_id
           FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT' AND amount_usd < 0`,
      )
      .get(omtId) as {
      id: number;
      supplier_id: number;
      entry_type: string;
      amount_usd: number;
      settlement_id: number | null;
      transaction_id: number | null;
    };
    expect(creditRow.amount_usd).toBeCloseTo(-50);
    expect(creditRow.settlement_id).toBeNull();
    expect(creditRow.transaction_id).toBe(txnId);

    // The credit is visible/selectable in the unsettled queue right away —
    // this IS the "apply manually" mechanism (no separate code path).
    const unsettled = repo.getAccountUnsettled(omtId);
    expect(
      unsettled.some((r) => r.kind === "LEDGER" && r.id === creditRow.id),
    ).toBe(true);

    // No profit was stamped for the surplus — it's a prepayment, not income.
    expect(settlementTxnFor(db, txnId).profit_usd).toBeCloseTo(0);
  });

  it("apply half: the credit row opened by an overpayment is later TICKED alongside a new debt row and nets it down — no auto-apply, no new code path", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });

    // First settlement: pay $130 against the $100 debt, $30 surplus.
    repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [{ kind: "LEDGER", id: debtId }],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      surplus_usd: 30,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 130 }],
    });

    const creditRow = db
      .prepare(
        `SELECT id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT' AND amount_usd < 0`,
      )
      .get(omtId) as { id: number };

    // A NEW debt shows up later.
    const newDebtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 20,
    });

    const preDrawer = drawerBal(db, "OMT_System", "USD");

    // Operator ticks BOTH the new debt AND the open credit row — the $30
    // credit covers the $20 debt, netting to a $10 COLLECT (OMT owes the
    // shop the remaining $10). No cash for the debt side; the shop instead
    // COLLECTS the $10 that's left over.
    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "COLLECT",
      selections: [
        { kind: "LEDGER", id: newDebtId },
        { kind: "LEDGER", id: creditRow.id },
      ],
      amount_usd: 10,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
    });

    // The credit is now CONSUMED — stamped settled against a real ledger
    // fact (rule 20/D18: consumption is backed by a ledger fact, never a
    // silent status flip).
    const consumedCredit = ledgerRow(db, creditRow.id);
    expect(consumedCredit.settlement_id).not.toBeNull();
    expect(
      repo.getAccountUnsettled(omtId).some((r) => r.id === creditRow.id),
    ).toBe(false);

    // The new debt row settled too.
    expect(ledgerRow(db, newDebtId).settlement_id).not.toBeNull();

    // Cash moved: the shop COLLECTED $10 — the drawer went UP, not down.
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer + 10);

    // The account nets to 0 overall — the credit is fully absorbed.
    const account = repo
      .getAccountBalances()
      .find((a) => a.account_supplier_id === omtId)!;
    expect(account.total_usd).toBeCloseTo(0);
    expect(result.id).toBeDefined();
  });

  // ── Guards ───────────────────────────────────────────────────────────

  it("rejects a nonzero surplus on COLLECT — overpaying only makes sense when PAYING the account", () => {
    const { omtId, ipickId } = seedOmtAccount();
    // A cashout-shaped credit row nets the account negative, forcing COLLECT.
    const creditId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "PAYMENT",
      amountUsd: -50,
    });

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "COLLECT",
        selections: [{ kind: "LEDGER", id: creditId }],
        amount_usd: 50,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        surplus_usd: 10,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
      }),
    ).toThrow(/overpayment surplus is only valid when paying/i);

    // Nothing moved.
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(-50);
  });

  it("rejects a negative surplus_usd outright", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: debtId }],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        surplus_usd: -5,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      }),
    ).toThrow(/cannot be negative/i);
  });

  it("a declared surplus that the payment legs don't actually cover is rejected — legs must equal rows + surplus, exactly", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });
    const preDrawer = drawerBal(db, "OMT_System", "USD");

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: debtId }],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        surplus_usd: 50, // declares a $50 surplus...
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 120 }], // ...but only sends $120
      }),
    ).toThrow(/do not reconcile/i);

    // Nothing moved — atomic rollback, exactly like the no-surplus case.
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
  });

  // ── D18's original guard, UNCHANGED when surplus is simply omitted ─────

  it("with no surplus field at all, an overpaid leg is STILL hard-rejected — byte-identical to pre-LIRA-203 behaviour", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: debtId }],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      }),
    ).toThrow(/do not reconcile/i);

    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
  });

  // ── Void/reversal (rule 20) ─────────────────────────────────────────────

  it("void nets the surplus credit, the rows, the drawer and profit ALL back to their pre-settlement state", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const debtId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });
    const preOmt = ledgerSum(db, omtId).usd; // 0
    const preIpick = ledgerSum(db, ipickId).usd; // 100
    const preDrawer = drawerBal(db, "OMT_System", "USD");

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [{ kind: "LEDGER", id: debtId }],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      surplus_usd: 50,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
    });

    // Forward path first (rule 17).
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
    expect(ledgerSum(db, omtId).usd).toBeCloseTo(-50);
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer - 150);

    // `result.id` is the ANCHOR ledger row — see the happy-path test's own
    // comment for why the ORIGINAL `debtId` row never carries
    // `transaction_id`.
    const txnId = ledgerRow(db, result.id).transaction_id as number;
    txnRepo.voidTransaction(txnId, 1);

    // EVERY ledger touched nets back to its pre-settlement state — the
    // credit row (found via `transaction_id`, same mechanism as any other
    // non-anchor member row) is soft-voided along with the debt's own row.
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(preIpick);
    expect(ledgerSum(db, omtId).usd).toBeCloseTo(preOmt);
    const account = repo
      .getAccountBalances()
      .find((a) => a.account_supplier_id === omtId)!;
    expect(account.total_usd).toBeCloseTo(preOmt + preIpick);

    // The full $150 leg reverses — the generic `_reversePayments` step,
    // unaware of (and unaffected by) the surplus/rows split.
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);

    // The debt row re-opens.
    expect(ledgerRow(db, debtId).settlement_id).toBeNull();
    expect(repo.getAccountUnsettled(omtId).some((r) => r.id === debtId)).toBe(
      true,
    );

    // The credit row itself is gone from the unsettled queue too (voided,
    // not just consumed) — `is_refunded` excludes it everywhere.
    const creditRow = db
      .prepare(
        `SELECT id, is_refunded FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT' AND amount_usd < 0`,
      )
      .get(omtId) as { id: number; is_refunded: number };
    expect(creditRow.is_refunded).toBe(1);
    expect(
      repo.getAccountUnsettled(omtId).some((r) => r.id === creditRow.id),
    ).toBe(false);

    expect(settlementTxnFor(db, txnId).status).toBe("VOIDED");
  });
});
