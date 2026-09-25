/**
 * SupplierRepository.settleAccount() — LIRA-189 (wave 2, CONTRACT_W2.md §1/
 * §3 lane W1), the OMT open-credit account settlement: ONE
 * `SUPPLIER_SETTLEMENT` transaction, one `supplier_ledger` row per member
 * touched (never a single lump row on the parent — plan §4).
 *
 * Authored against wave 1 (LIRA-187/188/190/192, already in the working
 * tree) and lane W2's TransactionRepository extension IN PARALLEL. The
 * multi-member void test (rule 17) started as `test.failing` against
 * `_reverseSupplierSettlement`'s pre-LIRA-189 single-row shape; by the time
 * this file ran, W2 had already landed the
 * `supplier_ledger WHERE transaction_id = ?` reversal generalization
 * (CONTRACT_W2.md §1.1/§9.4) this file's row shape was designed against, so
 * it was converted to a normal, green regression test — see that test's own
 * comment for the full account.
 *
 * Schema notes:
 *  - `financial_services` carries the FULL column set (commission_model,
 *    omt_fee, etc.) so `getFinancialServiceRepository().findById()` /
 *    `SUPPLIER_OWED_EXPR` (both consumed unmodified by
 *    `_bookCommissionAtSettlement`/`getAccountUnsettled`) resolve correctly
 *    — same shape as `SupplierRepository.commissionAtSettlement.test.ts`.
 *  - `suppliers.account_supplier_id` and `supplier_ledger.settlement_id`/
 *    `source_ref_table`/`source_ref_id` are migration v176 + v136 columns
 *    (`SupplierRepository.accountRollup.test.ts`'s fixture shape).
 *  - A WALLET_CASHOUT cashout is simulated by seeding its two rows directly
 *    (a `supplier_ledger` PAYMENT row + its `transactions` sibling carrying
 *    `metadata_json.commission`) rather than calling
 *    `RechargeRepository.cashoutToSupplier` — that method lives in a
 *    DIFFERENT lane's file (RechargeRepository.ts, LIRA-192) and this file
 *    only needs its OUTPUT SHAPE, not its own write path.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  getTransactionRepository,
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

// FinancialServiceRepository.ts imports DebtService at module scope — mocked
// the same way SupplierRepository.accountRollup.test.ts does so the
// module-level import resolves without a real DB.
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

    -- Full column set — SupplierRepository._bookCommissionAtSettlement /
    -- getAccountUnsettled read gross via
    -- getFinancialServiceRepository().findById()/getUnsettledBySupplier(),
    -- which select FinancialServiceRepository.getColumns()'s full explicit
    -- list (rule 14: reusing SUPPLIER_OWED_EXPR rather than re-deriving it
    -- means every one of these columns must exist here too).
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

    -- Migration v150 (COMMISSION_AT_SETTLEMENT_PLAN.md §3) real schema.
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

// ─── Helpers ──────────────────────────────────────────────────────────────

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
    isRefunded?: number;
    settlementId?: number | null;
    sourceRefTable?: string | null;
    sourceRefId?: number | null;
    createdAt?: string;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO supplier_ledger
         (supplier_id, entry_type, amount_usd, amount_lbp, is_refunded, settlement_id, source_ref_table, source_ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    )
    .run(
      data.supplierId,
      data.entryType,
      data.amountUsd ?? 0,
      data.amountLbp ?? 0,
      data.isRefunded ?? 0,
      data.settlementId ?? null,
      data.sourceRefTable ?? null,
      data.sourceRefId ?? null,
      data.createdAt ?? null,
    );
  return Number(res.lastInsertRowid);
}

function seedFs(
  db: Database.Database,
  data: {
    provider: string;
    serviceType?: string;
    amount: number;
    currency?: string;
    commissionModel?: 0 | 1;
    omtFee?: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission_model, omt_fee, is_settled)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      data.provider,
      data.serviceType ?? "SEND",
      data.amount,
      data.currency ?? "USD",
      data.commissionModel ?? 1,
      data.omtFee ?? 0,
    );
  return Number(res.lastInsertRowid);
}

/** Simulates a WALLET_CASHOUT credit — the ledger row
 *  `RechargeRepository.cashoutToSupplier` writes (negative, PAYMENT,
 *  source-ref'd to a "recharges" row) plus its unified transaction sibling
 *  (`metadata_json.commission`/`.currency` — LIRA-192's own shape, plan
 *  §10.2: there is no dedicated commission column). */
function seedCashout(
  db: Database.Database,
  data: {
    supplierId: number;
    principal: number;
    commission: number;
    currency: "USD" | "LBP";
    rechargeId: number;
  },
): number {
  const total = data.principal + data.commission;
  const ledgerId = seedLedgerEntry(db, {
    supplierId: data.supplierId,
    entryType: "PAYMENT",
    amountUsd: data.currency === "USD" ? -total : 0,
    amountLbp: data.currency === "LBP" ? -total : 0,
    sourceRefTable: "recharges",
    sourceRefId: data.rechargeId,
  });
  db.prepare(
    `INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp, metadata_json)
     VALUES ('WALLET_CASHOUT', 'recharges', ?, ?, ?, ?)`,
  ).run(
    data.rechargeId,
    data.currency === "USD" ? data.principal : 0,
    data.currency === "LBP" ? data.principal : 0,
    JSON.stringify({ commission: data.commission, currency: data.currency }),
  );
  return ledgerId;
}

function ledgerSum(
  db: Database.Database,
  supplierId: number,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM supplier_ledger WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierId) as { usd: number; lbp: number };
  return row;
}

function drawerBal(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function fsRow(
  db: Database.Database,
  id: number,
): { is_settled: number; settlement_id: number | null } {
  return db
    .prepare(
      `SELECT is_settled, settlement_id FROM financial_services WHERE id = ?`,
    )
    .get(id) as { is_settled: number; settlement_id: number | null };
}

function ledgerRow(
  db: Database.Database,
  id: number,
): {
  settlement_id: number | null;
  is_refunded: number;
  transaction_id: number | null;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
} {
  return db
    .prepare(
      `SELECT settlement_id, is_refunded, transaction_id, entry_type, amount_usd, amount_lbp
       FROM supplier_ledger WHERE id = ?`,
    )
    .get(id) as {
    settlement_id: number | null;
    is_refunded: number;
    transaction_id: number | null;
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
  };
}

interface SettlementTxnRow {
  id: number;
  type: string;
  status: string;
  profit_usd: number;
  profit_lbp: number;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
}

function settlementTxnFor(
  db: Database.Database,
  txnId: number,
): SettlementTxnRow {
  return db
    .prepare(`SELECT * FROM transactions WHERE id = ?`)
    .get(txnId) as SettlementTxnRow;
}

/**
 * A throw from INSIDE `settleAccount`'s write transaction (its `try` block
 * wraps `this.db.transaction(...)`) is re-wrapped as
 * `new DatabaseError("Failed to settle account", { cause: e })` — the
 * top-level `.message` is always that generic string, and the SPECIFIC
 * reason lives on `details.cause`. Used by the "validate-then-write race
 * (Finding B)" suite, whose new guards throw from inside that transaction,
 * to assert on the real message instead of the generic wrapper text.
 */
function innerErrorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const cause = (e as { details?: { cause?: unknown } })?.details?.cause;
    if (cause instanceof Error) return cause.message;
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("Expected function to throw, but it did not");
}

/** Cast target for spying on `SupplierRepository`'s private
 *  `_sumCashoutCommission` — the "validate-then-write race (Finding B)"
 *  suite's hook point for injecting a mutation into the window between step
 *  0's validation and the write transaction (see that describe block's own
 *  comment). `as unknown as` cast, never `any` (rule 1) — same pattern
 *  CarrierLineRepository's own tests use to reach a private method. */
interface SpiedCashoutCommission {
  _sumCashoutCommission(
    ledgerIds: number[],
    tenantId: number,
  ): { usd: number; lbp: number };
}

/** Cast target for spying on `_assertSelectionsStillEligible` — the "stale
 *  cashout-commission read (fourth hole)" suite's hook point (see that
 *  describe block's own comment for why this specific method marks the
 *  boundary between the old and new read timing). Signature carries the
 *  fourth-hardening-round `memberSupplierIds`/`accountSupplierId` params
 *  (Finding 1's live membership re-check) added alongside the pre-existing
 *  eligibility re-check. */
interface SpiedAssertEligible {
  _assertSelectionsStillEligible(
    financialServiceIds: number[],
    ledgerIds: number[],
    memberSupplierIds: number[],
    accountSupplierId: number,
    tenantId: number,
  ): void;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SupplierRepository.settleAccount()", () => {
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

  function seedOmtAccount(): {
    omtId: number;
    appId: number;
    ipickId: number;
  } {
    const omtId = seedSupplier(db, {
      name: "OMT",
      provider: "OMT",
      isSystem: 1,
    });
    const appId = seedSupplier(db, {
      name: "OMT App",
      provider: "OMT_APP",
      accountSupplierId: omtId,
      commissionEligible: 0,
    });
    const ipickId = seedSupplier(db, {
      name: "iPick",
      provider: "iPick",
      accountSupplierId: omtId,
      commissionEligible: 0,
    });
    return { omtId, appId, ipickId };
  }

  function supplierIdOfLedgerRow(id: number): number {
    return (
      db
        .prepare(`SELECT supplier_id FROM supplier_ledger WHERE id = ?`)
        .get(id) as { supplier_id: number }
    ).supplier_id;
  }

  // ── Full settle of a mixed account ──────────────────────────────────────

  it("full settle: OMT counter debt + iPick debt + OMT App debt net EVERY child to 0, one settlement transaction, commission credited on OMT only", () => {
    const { omtId, appId, ipickId } = seedOmtAccount();

    const fsId = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      omtFee: 5,
      commissionModel: 1,
    }); // gross owed = 105 (SUPPLIER_OWED_EXPR: ABS(amount) + ABS(omt_fee))
    seedLedgerEntry(db, {
      supplierId: omtId,
      entryType: "TOP_UP",
      amountUsd: 105,
      sourceRefTable: "financial_services",
      sourceRefId: fsId,
    });
    const ipickLedgerId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
    });
    const appLedgerId = seedLedgerEntry(db, {
      supplierId: appId,
      entryType: "TOP_UP",
      amountUsd: 50,
    });

    expect(ledgerSum(db, omtId).usd).toBeCloseTo(105);
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(200);
    expect(ledgerSum(db, appId).usd).toBeCloseTo(50);
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(1000);

    // Net owed = 105 (OMT) + 200 (iPick) + 50 (OMT App) − 0.50 commission
    // (credited back separately on OMT, per-member — plan §1 "do not
    // aggregate") = 354.50.
    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [
        { kind: "FINANCIAL_SERVICE", id: fsId },
        { kind: "LEDGER", id: ipickLedgerId },
        { kind: "LEDGER", id: appLedgerId },
      ],
      amount_usd: 354.5,
      amount_lbp: 0,
      commission_usd: 0.5,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 354.5 }],
    });

    // Every member nets to EXACTLY 0 — not just the account total (§4).
    expect(ledgerSum(db, omtId).usd).toBeCloseTo(0);
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
    expect(ledgerSum(db, appId).usd).toBeCloseTo(0);

    // The PCD absorbs exactly the net cash — a CASH leg to the account's
    // PARENT provider (OMT) resolves through the PCD (D3).
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(1000 - 354.5);

    // financial_services stamped settled, keyed off the OMT member's OWN row
    // (the anchor here — it's the unique commission-eligible FS group).
    const anchorRow = ledgerRow(db, result.id);
    expect(supplierIdOfLedgerRow(result.id)).toBe(omtId);
    const fs = fsRow(db, fsId);
    expect(fs.is_settled).toBe(1);
    expect(fs.settlement_id).toBe(result.id);

    // iPick/OMT App's ORIGINAL debt rows are stamped settled against THEIR
    // OWN new row — never the anchor's id (plan §1.1's per-member marking).
    const ipickOriginal = ledgerRow(db, ipickLedgerId);
    const appOriginal = ledgerRow(db, appLedgerId);
    expect(ipickOriginal.settlement_id).not.toBeNull();
    expect(ipickOriginal.settlement_id).not.toBe(result.id);
    expect(appOriginal.settlement_id).not.toBeNull();
    expect(appOriginal.settlement_id).not.toBe(result.id);
    expect(appOriginal.settlement_id).not.toBe(ipickOriginal.settlement_id);

    // Every row this settlement wrote shares ONE transaction_id (§1.1 — the
    // reversal mechanism W2 iterates).
    const txnId = anchorRow.transaction_id as number;
    expect(txnId).not.toBeNull();
    const siblingCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM supplier_ledger WHERE transaction_id = ?`,
        )
        .get(txnId) as { cnt: number }
    ).cnt;
    expect(siblingCount).toBe(3); // OMT anchor + iPick + OMT App

    // Exactly ONE SUPPLIER_SETTLEMENT transaction, commission stamped as its
    // profit (batchModel === 1 → data.commission_usd, no cashout in play).
    const txn = settlementTxnFor(db, txnId);
    expect(txn.type).toBe("SUPPLIER_SETTLEMENT");
    expect(txn.profit_usd).toBeCloseTo(0.5);
    expect(txn.profit_lbp).toBeCloseTo(0);

    // The commission credit itself — a SUPPLIER_PAYS_US row on OMT, never
    // touching iPick or OMT App (never aggregated across members).
    const commissionRows = db
      .prepare(
        `SELECT supplier_id, amount_usd FROM supplier_ledger WHERE entry_type = 'SUPPLIER_PAYS_US'`,
      )
      .all() as { supplier_id: number; amount_usd: number }[];
    expect(commissionRows).toHaveLength(1);
    expect(commissionRows[0].supplier_id).toBe(omtId);
    expect(commissionRows[0].amount_usd).toBeCloseTo(-0.5);
  });

  // ── Partial settlement — an explicit subset, not "all open rows" ───────

  it("partial: settling ONE of iPick's two open rows leaves the other open and iPick's balance correspondingly reduced", () => {
    const { omtId, ipickId } = seedOmtAccount();
    const smallDebt = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 100,
    });
    const largeDebt = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 200,
    });

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [{ kind: "LEDGER", id: smallDebt }],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
    });

    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(200); // only the large row remains
    expect(ledgerRow(db, smallDebt).settlement_id).toBe(result.id);
    expect(ledgerRow(db, largeDebt).settlement_id).toBeNull();

    // getAccountUnsettled's LEDGER branch returns every open ledger row —
    // including this settlement's OWN self-settled neutralizing row, if it
    // somehow weren't excluded (plan §10.2: D8's tick/untick UI, not the
    // repository, is what scopes a sane batch) — so assert membership, not
    // exact-list equality: the settled row is GONE, the still-open one is
    // still there.
    const stillOpen = repo.getAccountUnsettled(omtId);
    expect(stillOpen.some((r) => r.id === smallDebt)).toBe(false);
    expect(stillOpen.some((r) => r.id === largeDebt)).toBe(true);
  });

  // ── Mixed-sign batch: a cashout credit nets against counter debt ──────

  it("mixed-sign: an OMT App cashout credit nets against OMT counter debt, both children settle to 0 in ONE PAY", () => {
    const { omtId, appId } = seedOmtAccount();

    const fsId = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      omtFee: 0,
      commissionModel: 1,
    }); // gross owed = 50
    seedLedgerEntry(db, {
      supplierId: omtId,
      entryType: "TOP_UP",
      amountUsd: 50,
      sourceRefTable: "financial_services",
      sourceRefId: fsId,
    });
    const cashoutLedgerId = seedCashout(db, {
      supplierId: appId,
      principal: 20,
      commission: 0.02,
      currency: "USD",
      rechargeId: 501,
    });
    expect(ledgerSum(db, appId).usd).toBeCloseTo(-20.02);

    // Net = 50 (OMT) − 20.02 (OMT App credit) = 29.98, still shop-owes-OMT
    // overall → PAY, even though ONE member's own row is a credit.
    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [
        { kind: "FINANCIAL_SERVICE", id: fsId },
        { kind: "LEDGER", id: cashoutLedgerId },
      ],
      amount_usd: 29.98,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 29.98 }],
    });

    expect(ledgerSum(db, omtId).usd).toBeCloseTo(0);
    expect(ledgerSum(db, appId).usd).toBeCloseTo(0); // the credit nets to 0 too
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(1000 - 29.98);

    // D14 — the cashout's stored commission is recognised as profit NOW,
    // at settlement (it was 0 at cashout creation).
    const txnId = ledgerRow(db, result.id).transaction_id as number;
    const txn = settlementTxnFor(db, txnId);
    expect(txn.profit_usd).toBeCloseTo(0.02);
  });

  // ── Net-negative account — the COLLECT direction ───────────────────────

  it("net-negative: an account with only a cashout credit settles in the COLLECT direction, cash flows IN", () => {
    const { omtId, appId } = seedOmtAccount();
    const cashoutLedgerId = seedCashout(db, {
      supplierId: appId,
      principal: 100,
      commission: 0.1,
      currency: "USD",
      rechargeId: 601,
    });

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "COLLECT",
      selections: [{ kind: "LEDGER", id: cashoutLedgerId }],
      amount_usd: 100.1,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 100.1 }],
    });

    expect(ledgerSum(db, appId).usd).toBeCloseTo(0);
    expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(1000 + 100.1); // cash IN
    expect(ledgerRow(db, result.id).entry_type).toBe("SUPPLIER_PAYS_US");

    const txnId = ledgerRow(db, result.id).transaction_id as number;
    expect(settlementTxnFor(db, txnId).profit_usd).toBeCloseTo(0.1);
  });

  it("rejects PAY for a net-negative selection — direction is never trusted from the client", () => {
    const { omtId, appId } = seedOmtAccount();
    const cashoutLedgerId = seedCashout(db, {
      supplierId: appId,
      principal: 100,
      commission: 0.1,
      currency: "USD",
      rechargeId: 602,
    });

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: cashoutLedgerId }],
        amount_usd: 100.1,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100.1 }],
      }),
    ).toThrow(/Direction mismatch/i);
  });

  // ── A batch whose parent has no debt of its own ────────────────────────

  it("parent has no debt of its own: iPick + OMT App debt settle together, anchored on a CHILD row (never assuming a parent row exists)", () => {
    const { omtId, appId, ipickId } = seedOmtAccount();
    const ipickLedgerId = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 150,
    });
    const appLedgerId = seedLedgerEntry(db, {
      supplierId: appId,
      entryType: "TOP_UP",
      amountUsd: 30,
    });

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections: [
        { kind: "LEDGER", id: ipickLedgerId },
        { kind: "LEDGER", id: appLedgerId },
      ],
      amount_usd: 180,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 180 }],
    });

    // Never the parent — OMT never appears in this batch at all.
    expect(supplierIdOfLedgerRow(result.id)).not.toBe(omtId);
    expect([ipickId, appId]).toContain(supplierIdOfLedgerRow(result.id));
    expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
    expect(ledgerSum(db, appId).usd).toBeCloseTo(0);
  });

  // ── D14 — deferred cashout commission, summed per currency ─────────────

  it("D14: sums stored cashout commission from BOTH a USD and an LBP cashout, stamped as profit per currency", () => {
    const { omtId, appId } = seedOmtAccount();
    const usdCashout = seedCashout(db, {
      supplierId: appId,
      principal: 100,
      commission: 0.1,
      currency: "USD",
      rechargeId: 701,
    });
    const lbpCashout = seedCashout(db, {
      supplierId: appId,
      principal: 1_000_000,
      commission: 1_000,
      currency: "LBP",
      rechargeId: 702,
    });

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "COLLECT",
      selections: [
        { kind: "LEDGER", id: usdCashout },
        { kind: "LEDGER", id: lbpCashout },
      ],
      amount_usd: 100.1,
      amount_lbp: 1_001_000,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100.1 },
        { method: "CASH", currency_code: "LBP", amount: 1_001_000 },
      ],
    });

    const txnId = ledgerRow(db, result.id).transaction_id as number;
    const txn = settlementTxnFor(db, txnId);
    expect(txn.profit_usd).toBeCloseTo(0.1);
    expect(txn.profit_lbp).toBeCloseTo(1_000);
  });

  // ── D14 preview — the settle sheet's "deferred cashout commission" bug ─
  //
  // The account settle sheet sums each selected row's `commission_usd`/
  // `commission_lbp` BEFORE the operator confirms, so it can show the
  // commission that settlement is about to recognise. That preview reads
  // `getAccountUnsettled`'s own output — this proves it is populated, and
  // (the load-bearing part) that it EXACTLY matches the profit
  // `settleAccount` goes on to stamp for the very same rows, never just
  // "non-zero". A plain (non-cashout) LEDGER row must preview as 0 too.

  it("D14 preview: getAccountUnsettled's per-row commission_usd/commission_lbp equals what settleAccount later stamps as profit", () => {
    const { omtId, appId, ipickId } = seedOmtAccount();
    const usdCashout = seedCashout(db, {
      supplierId: appId,
      principal: 100,
      commission: 0.1,
      currency: "USD",
      rechargeId: 801,
    });
    const lbpCashout = seedCashout(db, {
      supplierId: appId,
      principal: 1_000_000,
      commission: 1_000,
      currency: "LBP",
      rechargeId: 802,
    });
    // A plain (non-cashout) debt row on another member — must preview $0/0,
    // never inherit the cashouts' commission.
    const plainDebt = seedLedgerEntry(db, {
      supplierId: ipickId,
      entryType: "TOP_UP",
      amountUsd: 50,
    });

    const preview = repo.getAccountUnsettled(omtId);
    const previewUsd = preview.find((r) => r.id === usdCashout)!;
    const previewLbp = preview.find((r) => r.id === lbpCashout)!;
    const previewPlain = preview.find((r) => r.id === plainDebt)!;

    expect(previewUsd.commission_usd).toBeCloseTo(0.1);
    expect(previewUsd.commission_lbp).toBeCloseTo(0);
    expect(previewLbp.commission_usd).toBeCloseTo(0);
    expect(previewLbp.commission_lbp).toBeCloseTo(1_000);
    expect(previewPlain.commission_usd).toBeCloseTo(0);
    expect(previewPlain.commission_lbp).toBeCloseTo(0);

    // Selecting ONLY the two cashouts (leave the plain debt open) — the
    // preview total an operator would see summing the selected rows' own
    // fields must equal the settlement's real recognised profit, per
    // currency.
    const previewTotalUsd = previewUsd.commission_usd + previewLbp.commission_usd;
    const previewTotalLbp = previewUsd.commission_lbp + previewLbp.commission_lbp;

    const result = repo.settleAccount({
      account_supplier_id: omtId,
      direction: "COLLECT",
      selections: [
        { kind: "LEDGER", id: usdCashout },
        { kind: "LEDGER", id: lbpCashout },
      ],
      amount_usd: 100.1,
      amount_lbp: 1_001_000,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100.1 },
        { method: "CASH", currency_code: "LBP", amount: 1_001_000 },
      ],
    });

    const txnId = ledgerRow(db, result.id).transaction_id as number;
    const txn = settlementTxnFor(db, txnId);
    expect(txn.profit_usd).toBeCloseTo(previewTotalUsd);
    expect(txn.profit_lbp).toBeCloseTo(previewTotalLbp);
    // Pin the absolute figures too, so a future change that shifts BOTH
    // sides of the equality by the same (wrong) amount still gets caught.
    expect(txn.profit_usd).toBeCloseTo(0.1);
    expect(txn.profit_lbp).toBeCloseTo(1_000);
  });

  // ── Validation guards — never trust the client ─────────────────────────

  it("rejects a selection that isn't an open row on this account", () => {
    const { omtId } = seedOmtAccount();
    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: 999_999 }],
        amount_usd: 1,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 1 }],
      }),
    ).toThrow(/is not an open row on account/i);
  });

  it("rejects one entered commission figure spanning two commission-eligible members", () => {
    const omtId = seedSupplier(db, { name: "OMT", provider: "OMT", isSystem: 1 });
    const katshId = seedSupplier(db, {
      name: "Katsh",
      provider: "Katsh",
      accountSupplierId: omtId,
    });
    const omtFsId = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      commissionModel: 1,
    });
    const katshFsId = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 50,
      commissionModel: 1,
    });
    seedLedgerEntry(db, {
      supplierId: omtId,
      entryType: "TOP_UP",
      amountUsd: 100,
      sourceRefTable: "financial_services",
      sourceRefId: omtFsId,
    });
    seedLedgerEntry(db, {
      supplierId: katshId,
      entryType: "TOP_UP",
      amountUsd: 50,
      sourceRefTable: "financial_services",
      sourceRefId: katshFsId,
    });

    expect(() =>
      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [
          { kind: "FINANCIAL_SERVICE", id: omtFsId },
          { kind: "FINANCIAL_SERVICE", id: katshFsId },
        ],
        amount_usd: 150,
        amount_lbp: 0,
        commission_usd: 1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      }),
    ).toThrow(/multiple.*financial_service-owning members/i);
  });

  // ── Leg reconciliation (the money-leak bug this ticket fixes) ──────────
  //
  // Before the fix, `settleAccount`'s cash-leg posting loop (a) applied
  // EVERY `data.payments` leg to the drawer verbatim with no check that the
  // legs sum, per currency, to the server-recomputed settled amount, and
  // (b) applied the SAME paying sign to every leg regardless of
  // `direction`, never partitioning IN vs OUT (rule 16). These tests would
  // have failed against that code — see the rule-17 proof recorded in the
  // task handover (bug (a) reintroduced by deleting the reconciliation
  // block, bug (b) by reverting the posting loop to a single un-partitioned
  // `for (const p of data.payments)` using `cashSign` on every leg).
  describe("leg reconciliation", () => {
    it("rejects an overpaid CASH leg — legs must equal the settled amount, not just be accepted verbatim", () => {
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
          created_by: 1,
          // A $100 debt "settled" with a $150 CASH leg — the pre-fix bug:
          // the $50 difference would leave the drawer with no ledger row,
          // no profit stamp, and no kept-change record.
          payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
        }),
      ).toThrow(/do not reconcile/i);

      // Nothing moved — the whole write rolled back atomically.
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
      expect(
        repo.getAccountUnsettled(omtId).some((r) => r.id === debtId),
      ).toBe(true);
    });

    it("rejects an underpaid CASH leg — a partial tender is not silently accepted as a full settlement", () => {
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
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        }),
      ).toThrow(/do not reconcile/i);

      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("rejects when only the LBP side of a mixed-currency batch fails to reconcile — checked per currency, not aggregated", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const debtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 50,
        amountLbp: 100_000,
      });
      const preDrawerUsd = drawerBal(db, "OMT_System", "USD");
      const preDrawerLbp = drawerBal(db, "OMT_System", "LBP");

      expect(() =>
        repo.settleAccount({
          account_supplier_id: omtId,
          direction: "PAY",
          selections: [{ kind: "LEDGER", id: debtId }],
          amount_usd: 50,
          amount_lbp: 100_000,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          // USD leg is exactly right; LBP leg is 50,000 over.
          payments: [
            { method: "CASH", currency_code: "USD", amount: 50 },
            { method: "CASH", currency_code: "LBP", amount: 150_000 },
          ],
        }),
      ).toThrow(/do not reconcile/i);

      expect(ledgerSum(db, ipickId)).toEqual({ usd: 50, lbp: 100_000 });
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawerUsd);
      expect(drawerBal(db, "OMT_System", "LBP")).toBeCloseTo(preDrawerLbp);
    });

    // Historical note (superseded, third hardening round, Finding A): this
    // test used to prove a PAY-direction OUT (change) leg was credited back
    // with the opposite sign instead of double-debiting (rule 16's IN/OUT
    // partitioning). That OUT-leg support is exactly what Finding A closed:
    // a supplier settlement has no customer to hand change back to, and the
    // same IN/OUT shape let a caller wash money between two real drawers
    // (see the "cross-drawer wash" describe block below). `settleTransactions`/
    // `recordSupplierCashflow` still support OUT legs correctly — only this
    // method's own support was removed.
    it("PAY: an OUT (change) leg is rejected outright, not credited back — Finding A superseded rule-16 OUT support here", () => {
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
          created_by: 1,
          // Tendered $150, $50 "change" back — the shape rule 16 supports
          // elsewhere, now hard-rejected here (Finding A).
          payments: [
            { method: "CASH", currency_code: "USD", amount: 150 },
            {
              method: "CASH",
              currency_code: "USD",
              amount: 50,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/does not accept OUT/i);

      // Nothing moved — rejected before the write transaction opened.
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("COLLECT: an OUT (change-back) leg is rejected outright too, not just on PAY", () => {
      const { omtId, appId } = seedOmtAccount();
      // A raw credit row on the account child — the shop is owed $100.
      const creditId = seedLedgerEntry(db, {
        supplierId: appId,
        entryType: "PAYMENT",
        amountUsd: -100,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      expect(() =>
        repo.settleAccount({
          account_supplier_id: omtId,
          direction: "COLLECT",
          selections: [{ kind: "LEDGER", id: creditId }],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 120 },
            {
              method: "CASH",
              currency_code: "USD",
              amount: 20,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/does not accept OUT/i);

      expect(ledgerSum(db, appId).usd).toBeCloseTo(-100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });
  });

  // ── Cross-drawer wash via an IN/OUT pair (Finding A, third hardening
  // round) — reproduced independently before the fix: an equal-and-opposite
  // IN/OUT pair used to net to 0 on the per-currency reconciliation guard
  // (step 4b) even in a currency the settled rows never touch, while the
  // posting loop (step E) resolved each leg through
  // `resolveServiceCashDrawer` — which could route the IN and OUT legs to
  // TWO DIFFERENT real drawers. Real money moved between the shop's drawers
  // with no ledger fact and no audit trail.
  //
  // The fix that closed this was the BLANKET OUT-leg ban a few steps above
  // step 4b (`data.payments?.some((p) => p.direction === "OUT")`), not
  // anything wash-specific — any leg carrying `direction: "OUT"` is now
  // rejected before either step 4b or step E ever runs, so there is no
  // remaining path (verified: every reconciliation/posting sum uses
  // `Math.abs`, additively, with no subtraction left anywhere a caller could
  // exploit to cancel two legs against each other) through which an
  // IN/OUT pair — matched drawers or not — could still reach the posting
  // loop. This test therefore now exercises exactly the same guard as the
  // "leg reconciliation" describe block's OUT-rejection tests above; it is
  // kept, named for what it actually proves today, as a dedicated regression
  // guard for the ORIGINAL cross-drawer-wash payload shape (mismatched
  // drawers, in a currency the settled row never touches) specifically —
  // not as evidence of any wash-specific defense that no longer exists.
  describe("cross-drawer wash (Finding A) — closed by the blanket OUT-leg ban", () => {
    it("rejects an equal-and-opposite IN/OUT pair across two different drawers via the blanket OUT-leg ban — regression guard for the original wash payload", () => {
      const { omtId, ipickId } = seedOmtAccount();
      // $100 USD debt — the settlement never touches LBP at all.
      const debtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });
      const preOmtSystemUsd = drawerBal(db, "OMT_System", "USD");
      const preOmtAppLbp = drawerBal(db, "OMT_App", "LBP");
      const preWhishAppLbp = drawerBal(db, "Whish_App", "LBP");

      expect(() =>
        repo.settleAccount({
          account_supplier_id: omtId,
          direction: "PAY",
          selections: [{ kind: "LEDGER", id: debtId }],
          amount_usd: 100,
          amount_lbp: 0, // the settled row never touches LBP
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          payments: [
            // Correctly settles the $100 USD debt.
            { method: "CASH", currency_code: "USD", amount: 100 },
            // Equal-and-opposite LBP pair — nets to 0 against amount_lbp: 0,
            // but OMT and WHISH resolve to TWO DIFFERENT wallet drawers
            // (OMT_App vs Whish_App) if ever allowed through.
            { method: "OMT", currency_code: "LBP", amount: 500_000 },
            {
              method: "WHISH",
              currency_code: "LBP",
              amount: 500_000,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/does not accept OUT/i);

      // Nothing moved anywhere — not even the correctly-sized CASH leg,
      // because the whole batch is rejected atomically before the write
      // transaction ever opens.
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preOmtSystemUsd);
      expect(drawerBal(db, "OMT_App", "LBP")).toBeCloseTo(preOmtAppLbp);
      expect(drawerBal(db, "Whish_App", "LBP")).toBeCloseTo(preWhishAppLbp);
    });
  });

  // ── Non-drawer-affecting legs (second leak this ticket fixes) ──────────
  // The reconciliation guard above sums EVERY leg per currency, but the
  // posting loop (step E) used to `continue` past a leg whose method
  // `isDrawerAffectingMethod` excludes (CUSTOMER_ACCOUNT, GIFT_CARD, ...).
  // A leg set that reconciles cleanly on paper could still leave real money
  // uncollected/unpaid at the drawer.
  describe("non-drawer-affecting legs", () => {
    it("rejects a CASH + CUSTOMER_ACCOUNT split that reconciles cleanly on paper — the reproduced $30 leak", () => {
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
          created_by: 1,
          // 70 + 30 = 100 reconciles per currency, but CUSTOMER_ACCOUNT
          // never touches a drawer — only $70 would actually leave it while
          // the ledger stamped the full $100 settled.
          payments: [
            { method: "CASH", currency_code: "USD", amount: 70 },
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      // Nothing moved — rejected before the write transaction opened.
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
      expect(
        repo.getAccountUnsettled(omtId).some((r) => r.id === debtId),
      ).toBe(true);
    });

    it("rejects an all-CUSTOMER_ACCOUNT leg set — the worst case, zero dollars would leave the drawer", () => {
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
          created_by: 1,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 100 },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT.*does not move a real drawer/i);

      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    // Finding A (third hardening round) moved the OUT-leg rejection AHEAD of
    // this non-drawer-method check, so an OUT leg is now rejected for BEING
    // an OUT leg before its method is ever inspected — this test's original
    // purpose (proving the non-drawer check also covers OUT legs) is now
    // subsumed by the blanket OUT rejection; updated to assert that outcome
    // instead of weakening or deleting the coverage.
    it("rejects an OUT (change) leg before ever inspecting its method — even a non-drawer method never reaches that check", () => {
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
          created_by: 1,
          // $130 tendered, $30 "change" credited to a customer account —
          // that's not a real return leg, it's inventing money nobody paid.
          payments: [
            { method: "CASH", currency_code: "USD", amount: 130 },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 30,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/does not accept OUT/i);

      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("rejects a non-drawer method on the COLLECT direction too, not just PAY", () => {
      const { omtId, appId } = seedOmtAccount();
      const creditId = seedLedgerEntry(db, {
        supplierId: appId,
        entryType: "PAYMENT",
        amountUsd: -100,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      expect(() =>
        repo.settleAccount({
          account_supplier_id: omtId,
          direction: "COLLECT",
          selections: [{ kind: "LEDGER", id: creditId }],
          amount_usd: 100,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 70 },
            { method: "GIFT_CARD", currency_code: "USD", amount: 30 },
          ],
        }),
      ).toThrow(/GIFT_CARD.*does not move a real drawer/i);

      expect(ledgerSum(db, appId).usd).toBeCloseTo(-100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });
  });

  // ── Validate-then-write race (Finding B, third hardening round) ────────
  //
  // Step 0's `getAccountUnsettled` re-validation runs BEFORE the write
  // transaction opens. `_sumCashoutCommission` is the last read-only call
  // `settleAccount` makes after that validation and before the transaction
  // starts — hooking it lets these tests inject a mutation into exactly the
  // window this finding describes (a concurrent void/refund/second
  // settlement landing after step 0 validated a row as open, before this
  // batch's own write stamps it) without needing real OS-level concurrency,
  // the same technique an independent adversarial reviewer used to reproduce
  // it with a scratch test.
  describe("validate-then-write race (Finding B)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("aborts the WHOLE transaction — including an untouched OTHER member — when a selected LEDGER row is voided in the window", () => {
      const { omtId, ipickId, appId } = seedOmtAccount();
      const raceDebtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });
      const safeDebtId = seedLedgerEntry(db, {
        supplierId: appId,
        entryType: "TOP_UP",
        amountUsd: 50,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      const original = (
        repo as unknown as SpiedCashoutCommission
      )._sumCashoutCommission.bind(repo);
      jest
        .spyOn(
          repo as unknown as SpiedCashoutCommission,
          "_sumCashoutCommission",
        )
        .mockImplementation((ledgerIds, tenantId) => {
          // The concurrent void this finding describes, landing AFTER step
          // 0 validated `raceDebtId` as open but BEFORE this write.
          db.prepare(
            `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = datetime('now') WHERE id = ?`,
          ).run(raceDebtId);
          return original(ledgerIds, tenantId);
        });

      expect(
        innerErrorMessage(() =>
          repo.settleAccount({
            account_supplier_id: omtId,
            direction: "PAY",
            selections: [
              { kind: "LEDGER", id: raceDebtId },
              { kind: "LEDGER", id: safeDebtId },
            ],
            amount_usd: 150,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            created_by: 1,
            payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
          }),
        ),
      ).toMatch(/voided|refunded|settled|affected/i);

      // The WHOLE transaction rolled back — `safeDebtId` (a perfectly valid,
      // untouched-by-the-race member) must NOT have been stamped either. A
      // partial write here would leave appId settled while ipickId's balance
      // went permanently wrong with no open row left to explain it.
      // (`raceDebtId`'s own `is_refunded` flag stays 1 — that's the test's
      // own injected mutation, standing in for the real concurrent void;
      // `ledgerSum`'s helper filters `is_refunded` rows out by design, so
      // ipick's sum is asserted via the row directly, not that helper.)
      expect(ledgerRow(db, safeDebtId).settlement_id).toBeNull();
      expect(ledgerSum(db, appId).usd).toBeCloseTo(50);
      const raceRow = ledgerRow(db, raceDebtId);
      expect(raceRow.settlement_id).toBeNull();
      expect(raceRow.amount_usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("aborts when a selected FINANCIAL_SERVICE row is refunded in the same window", () => {
      const { omtId } = seedOmtAccount();
      const fsId = seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commissionModel: 1,
      });
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
        sourceRefTable: "financial_services",
        sourceRefId: fsId,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      const original = (
        repo as unknown as SpiedCashoutCommission
      )._sumCashoutCommission.bind(repo);
      jest
        .spyOn(
          repo as unknown as SpiedCashoutCommission,
          "_sumCashoutCommission",
        )
        .mockImplementation((ledgerIds, tenantId) => {
          db.prepare(
            `UPDATE financial_services SET is_refunded = 1, refunded_at = datetime('now') WHERE id = ?`,
          ).run(fsId);
          return original(ledgerIds, tenantId);
        });

      expect(
        innerErrorMessage(() =>
          repo.settleAccount({
            account_supplier_id: omtId,
            direction: "PAY",
            selections: [{ kind: "FINANCIAL_SERVICE", id: fsId }],
            amount_usd: 100,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            created_by: 1,
            payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
          }),
        ),
      ).toMatch(/voided|refunded|settled|affected/i);

      expect(fsRow(db, fsId).settlement_id).toBeNull();
      expect(fsRow(db, fsId).is_settled).toBe(0);
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });
  });

  // ── Stale cashout-commission read (fourth hole, third hardening round) ──
  //
  // Hunted while re-reading the method for a fourth leak: D14's cashout
  // commission sum (`_sumCashoutCommission` → `_cashoutCommissionByLedgerId`
  // → `getBySourceId(...).status === 'ACTIVE'`) used to run BEFORE the write
  // transaction opened — a DIFFERENT read than the one Finding B's
  // `_assertSelectionsStillEligible` re-checks (that one only looks at the
  // `supplier_ledger` row's OWN `is_refunded`/`settlement_id`, never the
  // ACTIVE status of the separate `WALLET_CASHOUT` transaction its
  // commission is stamped from). Voiding that cashout does NOT touch the
  // ledger row being settled here — it stays perfectly "open" the whole
  // time — so a cashout voided in the window between the old read and the
  // write would still get its commission stamped as this settlement's
  // `profit_usd`/`profit_lbp`: phantom profit with no active cashout behind
  // it. Not a drawer leak (the cash leg amount is unaffected — this is a
  // profit-figure integrity gap), but real enough that rule 20 (reversal
  // symmetry) would care: a settlement's profit should never outlive the
  // cashout it was computed from voiding.
  //
  // Fix: moved the sum to run INSIDE the write transaction, immediately
  // after `_assertSelectionsStillEligible`, so both reads land in the same
  // narrow window. Reproduced (rule 17) by spying on
  // `_assertSelectionsStillEligible` — the last call that runs BEFORE the
  // (now-moved) commission sum — and voiding the cashout's transaction from
  // inside that spy: pre-fix, the sum had already run at the OLD
  // (pre-transaction) location and captured the stale $0.10; post-fix, it
  // hasn't run yet at that point and correctly sees the void.
  describe("stale cashout-commission read (fourth hole)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("recomputes cashout commission LIVE inside the write transaction — a cashout voided in the window is never stamped as profit", () => {
      const { omtId, appId } = seedOmtAccount();
      const cashoutLedgerId = seedCashout(db, {
        supplierId: appId,
        principal: 100,
        commission: 0.1,
        currency: "USD",
        rechargeId: 901,
      });

      const original = (
        repo as unknown as SpiedAssertEligible
      )._assertSelectionsStillEligible.bind(repo);
      jest
        .spyOn(
          repo as unknown as SpiedAssertEligible,
          "_assertSelectionsStillEligible",
        )
        .mockImplementation((fsIds, ledgerIds, memberIds, accountId, tid) => {
          // The cashout's OWN transaction voided in the window — its ledger
          // row (being settled here) is untouched and stays open throughout.
          db.prepare(
            `UPDATE transactions SET status = 'VOIDED' WHERE type = 'WALLET_CASHOUT' AND source_id = ?`,
          ).run(901);
          return original(fsIds, ledgerIds, memberIds, accountId, tid);
        });

      const result = repo.settleAccount({
        account_supplier_id: omtId,
        direction: "COLLECT",
        selections: [{ kind: "LEDGER", id: cashoutLedgerId }],
        amount_usd: 100.1,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100.1 }],
      });

      // The settlement itself still succeeds — the ledger row was never
      // invalid — but its profit must be $0, not the stale $0.10 a
      // pre-transaction read would have stamped from the now-voided cashout.
      const txnId = ledgerRow(db, result.id).transaction_id as number;
      expect(settlementTxnFor(db, txnId).profit_usd).toBeCloseTo(0);
    });
  });

  // ── Fourth hardening round — three narrower findings ────────────────────
  //
  // Three adversarial rounds had already fixed four real leaks in this
  // method (Findings A/B above, plus the two earlier leg-reconciliation/
  // non-drawer-method fixes). A fourth round of 35 scenarios across three
  // independent attackers found only these three, narrower, items.

  // ── Finding 1 — membership + drawer-provider re-check ───────────────────
  //
  // `_assertSelectionsStillEligible` re-verified each selected row was open/
  // unsettled/not-refunded (Finding B), but never re-checked `accountMemberOf`
  // — the SAME predicate `getAccountUnsettled` used, at step 0, to decide
  // each row's owning supplier belongs to THIS account. Separately, the
  // account PARENT (`parent.provider`, which feeds `drawerCtx` and routes
  // EVERY cash leg via `resolveServiceCashDrawer`) was read ONCE, before this
  // method's whole validation pipeline — a provider edit landing in that
  // window would silently apply to every leg this settlement posts.
  describe("membership + drawer-provider re-check (Finding 1, fourth hardening round)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("aborts when a selected row's owning supplier is re-parented off the account in the window between validation and write", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const debtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });
      // A second, unrelated account root to re-parent iPick onto — standing
      // in for "an admin moved iPick under a different account" mid-flight.
      const otherAccountId = seedSupplier(db, {
        name: "Other Account",
        provider: "OTHER",
        isSystem: 1,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      const original = (
        repo as unknown as SpiedAssertEligible
      )._assertSelectionsStillEligible.bind(repo);
      jest
        .spyOn(
          repo as unknown as SpiedAssertEligible,
          "_assertSelectionsStillEligible",
        )
        .mockImplementation((fsIds, ledgerIds, memberIds, accountId, tid) => {
          // The race: iPick gets re-parented OFF the OMT account in the
          // window between step 0's validation and this write.
          db.prepare(
            `UPDATE suppliers SET account_supplier_id = ? WHERE id = ?`,
          ).run(otherAccountId, ipickId);
          return original(fsIds, ledgerIds, memberIds, accountId, tid);
        });

      expect(
        innerErrorMessage(() =>
          repo.settleAccount({
            account_supplier_id: omtId,
            direction: "PAY",
            selections: [{ kind: "LEDGER", id: debtId }],
            amount_usd: 100,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            created_by: 1,
            payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
          }),
        ),
      ).toMatch(/no longer members/i);

      // Nothing moved — the whole write rolled back atomically.
      expect(ledgerRow(db, debtId).settlement_id).toBeNull();
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("re-reads the account parent's provider live — a provider edit in the window is never used for drawer routing", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const debtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });

      const original = (
        repo as unknown as SpiedAssertEligible
      )._assertSelectionsStillEligible.bind(repo);
      jest
        .spyOn(
          repo as unknown as SpiedAssertEligible,
          "_assertSelectionsStillEligible",
        )
        .mockImplementation((fsIds, ledgerIds, memberIds, accountId, tid) => {
          // The race: OMT's OWN provider is edited in the window between
          // step 0's validation and this write — no longer equal to the
          // shop's base system ("OMT"), so a CASH leg should no longer route
          // to the primary cash drawer (OMT_System) once re-read live.
          db.prepare(`UPDATE suppliers SET provider = 'WHISH' WHERE id = ?`).run(
            omtId,
          );
          return original(fsIds, ledgerIds, memberIds, accountId, tid);
        });

      repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: debtId }],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      });

      // The CASH leg followed the FRESH provider ("WHISH" ≠ base system
      // "OMT") and stayed on General — never the stale pre-validation "OMT"
      // reading, which would have routed it to the primary cash drawer.
      expect(drawerBal(db, "General", "USD")).toBeCloseTo(1000 - 100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(1000);
    });
  });

  // ── Finding 2 — self-stamp writes now verify `.changes` ─────────────────
  //
  // The anchor row's own `UPDATE supplier_ledger SET transaction_id = …,
  // settlement_id = …` and each non-anchor member's own `UPDATE
  // supplier_ledger SET settlement_id = …` linked the settlement row to
  // itself without ever inspecting the write's result — unlike
  // `_markFinancialServicesSettled`/`_markLedgerRowsSettled` (Finding B),
  // which now abort on a silent zero-row write. A stamp that quietly no-ops
  // must never be treated as success.
  describe("self-stamp write verification (Finding 2, fourth hardening round)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("aborts when the anchor row's own transaction/settlement self-stamp affects zero rows", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const debtId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 100,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      // `createTransaction` is the ONE repository call that runs between the
      // anchor row's INSERT (step A) and its own self-stamp UPDATE (step B)
      // — hooking it lets this test delete the just-inserted anchor row in
      // that exact window, standing in for a concurrent hard-delete/data-fix
      // touching supplier_ledger, without needing real OS-level concurrency.
      const txnRepoSingleton = getTransactionRepository();
      const originalCreate =
        txnRepoSingleton.createTransaction.bind(txnRepoSingleton);
      jest
        .spyOn(txnRepoSingleton, "createTransaction")
        .mockImplementation((data) => {
          const txnId = originalCreate(data);
          db.prepare(`DELETE FROM supplier_ledger WHERE id = ?`).run(
            data.source_id,
          );
          return txnId;
        });

      expect(
        innerErrorMessage(() =>
          repo.settleAccount({
            account_supplier_id: omtId,
            direction: "PAY",
            selections: [{ kind: "LEDGER", id: debtId }],
            amount_usd: 100,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            created_by: 1,
            payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
          }),
        ),
      ).toMatch(/failed to stamp the anchor/i);

      // Nothing committed — the whole write (including the injected DELETE)
      // rolled back atomically.
      expect(ledgerRow(db, debtId).settlement_id).toBeNull();
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(100);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });

    it("aborts when a non-anchor member's own settlement-row self-stamp affects zero rows", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const fsId = seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        omtFee: 0,
        commissionModel: 1,
      });
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
        sourceRefTable: "financial_services",
        sourceRefId: fsId,
      });
      const ipickLedgerId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      // Intercept ONLY the non-anchor member's own self-stamp statement
      // (`SET settlement_id = ?` alone, never `transaction_id`, and never
      // the bulk `_markLedgerRowsSettled` form which uses `id IN (...)`) and
      // force it to report zero rows affected — standing in for a
      // concurrent hard-delete of iPick's own just-inserted row.
      const realPrepare = db.prepare.bind(db);
      const fakeRun = () => ({
        changes: 0,
        lastInsertRowid: 0,
      });
      jest.spyOn(db, "prepare").mockImplementation(((sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (
          normalized ===
          "UPDATE supplier_ledger SET settlement_id = ? WHERE id = ? AND tenant_id = ?"
        ) {
          return { run: fakeRun } as unknown as ReturnType<
            Database.Database["prepare"]
          >;
        }
        return realPrepare(sql);
      }) as typeof db.prepare);

      expect(
        innerErrorMessage(() =>
          repo.settleAccount({
            account_supplier_id: omtId,
            direction: "PAY",
            selections: [
              { kind: "FINANCIAL_SERVICE", id: fsId },
              { kind: "LEDGER", id: ipickLedgerId },
            ],
            amount_usd: 300,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            created_by: 1,
            payments: [{ method: "CASH", currency_code: "USD", amount: 300 }],
          }),
        ),
      ).toMatch(/failed to stamp member/i);

      jest.restoreAllMocks();
      // Nothing committed — the whole write rolled back atomically.
      expect(ledgerRow(db, ipickLedgerId).settlement_id).toBeNull();
      expect(fsRow(db, fsId).is_settled).toBe(0);
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(100);
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(200);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
    });
  });

  // ── Finding 3 — bills-only commission member is rejected outright ───────
  //
  // A commission-eligible member whose selected `financial_services` rows
  // are ALL `service_type = 'BILL'` has NO ledger-based gross to net against
  // (`SUPPLIER_OWED_EXPR` is structurally 0 for a BILL row). Left unguarded,
  // `settleAccount`'s generic per-member ledger-negation would read the
  // entered commission back as phantom cash OWED and demand a payment leg
  // for it — on top of whatever `_bookCommissionAtSettlement`'s bills-only
  // branch separately credits for the SAME commission. Unreachable via
  // today's creation gate (a `commission_eligible = 0` supplier's BILL rows
  // are born already-settled — see `isPendingSupplierSettlement` — so they
  // never reach `getAccountUnsettled`'s queue), but `commission_eligible` is
  // a runtime-mutable per-supplier setting, not a compile-time constant —
  // this seeds the FS row directly (bypassing the creation-time gate) to
  // prove the account-settlement method itself refuses this shape outright,
  // rather than relying on that external invariant staying true forever.
  describe("bills-only commission member guard (Finding 3, fourth hardening round)", () => {
    it("rejects an entered commission for a member whose selected rows are ALL BILL type, before any drawer/ledger write", () => {
      // NOT `seedOmtAccount()` — that helper's iPick is `commissionEligible:
      // 0` (today's real config), whose BILL rows are born already-settled
      // (`isPendingSupplierSettlement`) and never reach the unsettled queue
      // at all. This seeds the hypothetical-but-reachable shape the guard's
      // own doc comment describes: an account child whose `commission_eligible`
      // has been flipped to 1, with a genuinely pending BILL row.
      const omtId = seedSupplier(db, {
        name: "OMT",
        provider: "OMT",
        isSystem: 1,
      });
      seedSupplier(db, {
        name: "iPick",
        provider: "iPick",
        accountSupplierId: omtId,
        commissionEligible: 1,
      });
      const billFsId = seedFs(db, {
        provider: "iPick",
        serviceType: "BILL",
        amount: 50,
        commissionModel: 1,
      });
      const preOmtSystemUsd = drawerBal(db, "OMT_System", "USD");
      const preIpickDrawerUsd = drawerBal(db, "iPick", "USD");

      expect(() =>
        repo.settleAccount({
          account_supplier_id: omtId,
          direction: "COLLECT",
          selections: [{ kind: "FINANCIAL_SERVICE", id: billFsId }],
          amount_usd: 5,
          amount_lbp: 0,
          commission_usd: 5,
          commission_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        }),
      ).toThrow(/ALL BILL type/i);

      // Nothing moved — rejected before the write transaction ever opened.
      expect(fsRow(db, billFsId).is_settled).toBe(0);
      expect(fsRow(db, billFsId).settlement_id).toBeNull();
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preOmtSystemUsd);
      expect(drawerBal(db, "iPick", "USD")).toBeCloseTo(preIpickDrawerUsd);
    });
  });

  // ── Reversal (rule 20) — create + void nets to 0, per currency ─────────

  describe("void", () => {
    it("single-member (anchor-only) settlement: create + void nets the drawer, the ledger and profit back to the PRE-settlement state", () => {
      const { omtId, appId } = seedOmtAccount();
      const cashoutLedgerId = seedCashout(db, {
        supplierId: appId,
        principal: 100,
        commission: 0.1,
        currency: "USD",
        rechargeId: 801,
      });
      const preSettleAppBalance = ledgerSum(db, appId).usd; // -100.10
      const preSettleDrawer = drawerBal(db, "OMT_System", "USD"); // 1000

      const result = repo.settleAccount({
        account_supplier_id: omtId,
        direction: "COLLECT",
        selections: [{ kind: "LEDGER", id: cashoutLedgerId }],
        amount_usd: 100.1,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100.1 }],
      });
      expect(ledgerSum(db, appId).usd).toBeCloseTo(0);

      const txnId = ledgerRow(db, result.id).transaction_id as number;
      txnRepo.voidTransaction(txnId, 1);

      expect(ledgerSum(db, appId).usd).toBeCloseTo(preSettleAppBalance);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preSettleDrawer);
      expect(settlementTxnFor(db, txnId).status).toBe("VOIDED");
    });

    // Rule 17 — this test was FIRST WRITTEN as `test.failing` against
    // `_reverseSupplierSettlement`'s pre-LIRA-189 shape (which keyed its
    // un-stamp/soft-void off the SETTLEMENT transaction's single
    // `source_table`/`source_id` — the ANCHOR member's row alone) — run and
    // OBSERVED to unexpectedly pass instead: by the time this file ran,
    // `TransactionRepository` (W2's lane, in parallel) had already landed
    // the `supplier_ledger WHERE transaction_id = ?` generalization
    // (CONTRACT_W2.md §1.1/§9.4) this ticket's `settleAccount` row shape
    // (every member's row sharing ONE `transaction_id`) was designed
    // against. Converted to a normal, currently-GREEN regression guard —
    // the multi-member proof obligation the contract asks for: create +
    // void nets every child ledger, the account, every drawer and profit to
    // 0, per currency.
    it("multi-member settlement: create + void nets OMT, iPick, the PCD and profit ALL back to their pre-settlement state", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const fsId = seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        omtFee: 0,
        commissionModel: 1,
      });
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
        sourceRefTable: "financial_services",
        sourceRefId: fsId,
      });
      const ipickLedgerId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });

      const preOmt = ledgerSum(db, omtId).usd; // 100
      const preIpick = ledgerSum(db, ipickId).usd; // 200
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      const result = repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [
          { kind: "FINANCIAL_SERVICE", id: fsId },
          { kind: "LEDGER", id: ipickLedgerId },
        ],
        amount_usd: 299.75,
        amount_lbp: 0,
        commission_usd: 0.25,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 299.75 }],
      });
      // Correct post-settle state — proves the FORWARD path first.
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(0);
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
      expect(fsRow(db, fsId).is_settled).toBe(1);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer - 299.75);

      const txnId = ledgerRow(db, result.id).transaction_id as number;
      const preVoidProfit = settlementTxnFor(db, txnId).profit_usd;
      expect(preVoidProfit).toBeCloseTo(0.25);

      txnRepo.voidTransaction(txnId, 1);

      // EVERY child ledger nets back to its pre-settlement balance — not
      // just the anchor (OMT); iPick, which never shares `source_id` with
      // the settlement transaction, is reached via `transaction_id`.
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(preOmt);
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(preIpick);
      // The account rollup (LIRA-188) also nets back, not just its members
      // individually — a sum-of-parts check that a per-member bug could
      // still slip through if it happened to cancel out.
      const account = repo
        .getAccountBalances()
        .find((a) => a.account_supplier_id === omtId)!;
      expect(account.total_usd).toBeCloseTo(preOmt + preIpick);
      // The PCD (OMT_System) is restored — the generic `_reversePayments`
      // step, unaffected by the per-child row count.
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
      // financial_services un-stamped back to open.
      const fs = fsRow(db, fsId);
      expect(fs.is_settled).toBe(0);
      expect(fs.settlement_id).toBeNull();
      // iPick's ORIGINAL debt row is un-stamped too (v176 supplier_ledger
      // .settlement_id) — re-enters the unsettled queue.
      expect(ledgerRow(db, ipickLedgerId).settlement_id).toBeNull();
      expect(
        repo.getAccountUnsettled(omtId).some((r) => r.id === ipickLedgerId),
      ).toBe(true);
      // Profit nets to 0 (VOIDED transactions are excluded from every
      // ACTIVE-only profit aggregate — the same generic mechanism every
      // other transaction type relies on).
      expect(settlementTxnFor(db, txnId).status).toBe("VOIDED");
    });
  });

  // ── Reversal via REFUND, not just VOID (reversal-auditor coverage gap) ──
  //
  // Every reversal test above drives `voidTransaction`. `refundTransaction`
  // is a DIFFERENT code path (it inserts a negating REFUND sibling row
  // instead of flipping `status`), and shares `_reverseSupplierSettlement`
  // with void (TransactionRepository.ts) — but nothing previously exercised
  // that sharing against the REAL `settleAccount()`. Mirrors the void
  // suite's own multi-member test exactly, swapping the reversal call.
  describe("refund", () => {
    it("multi-member settlement: create + refundTransaction() nets OMT, iPick, the PCD and profit ALL back to their pre-settlement state", () => {
      const { omtId, ipickId } = seedOmtAccount();
      const fsId = seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        omtFee: 0,
        commissionModel: 1,
      });
      seedLedgerEntry(db, {
        supplierId: omtId,
        entryType: "TOP_UP",
        amountUsd: 100,
        sourceRefTable: "financial_services",
        sourceRefId: fsId,
      });
      const ipickLedgerId = seedLedgerEntry(db, {
        supplierId: ipickId,
        entryType: "TOP_UP",
        amountUsd: 200,
      });

      const preOmt = ledgerSum(db, omtId).usd; // 100
      const preIpick = ledgerSum(db, ipickId).usd; // 200
      const preDrawer = drawerBal(db, "OMT_System", "USD");

      const result = repo.settleAccount({
        account_supplier_id: omtId,
        direction: "PAY",
        selections: [
          { kind: "FINANCIAL_SERVICE", id: fsId },
          { kind: "LEDGER", id: ipickLedgerId },
        ],
        amount_usd: 299.75,
        amount_lbp: 0,
        commission_usd: 0.25,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 299.75 }],
      });
      // Forward path, same as the void suite's sibling test.
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(0);
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(0);
      expect(fsRow(db, fsId).is_settled).toBe(1);
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer - 299.75);

      const txnId = ledgerRow(db, result.id).transaction_id as number;
      expect(settlementTxnFor(db, txnId).profit_usd).toBeCloseTo(0.25);

      const refundId = txnRepo.refundTransaction(txnId, 1);

      // Original stays ACTIVE — refundTransaction reverses via a NEGATING
      // sibling row, unlike voidTransaction's status flip.
      expect(settlementTxnFor(db, txnId).status).toBe("ACTIVE");
      const refundTxn = settlementTxnFor(db, refundId);
      expect(refundTxn.type).toBe("REFUND");
      expect(refundTxn.profit_usd).toBeCloseTo(-0.25);

      // EVERY child ledger nets back to its pre-settlement balance.
      expect(ledgerSum(db, omtId).usd).toBeCloseTo(preOmt);
      expect(ledgerSum(db, ipickId).usd).toBeCloseTo(preIpick);
      const account = repo
        .getAccountBalances()
        .find((a) => a.account_supplier_id === omtId)!;
      expect(account.total_usd).toBeCloseTo(preOmt + preIpick);
      // The PCD (OMT_System) is restored.
      expect(drawerBal(db, "OMT_System", "USD")).toBeCloseTo(preDrawer);
      // financial_services un-stamped back to open.
      const fs = fsRow(db, fsId);
      expect(fs.is_settled).toBe(0);
      expect(fs.settlement_id).toBeNull();
      // iPick's ORIGINAL debt row is un-stamped too — re-enters the queue.
      expect(ledgerRow(db, ipickLedgerId).settlement_id).toBeNull();
      expect(
        repo.getAccountUnsettled(omtId).some((r) => r.id === ipickLedgerId),
      ).toBe(true);
      // Profit nets to 0 across original (ACTIVE, +0.25) + REFUND (-0.25) —
      // the same generic sum every other transaction type relies on.
      expect(
        settlementTxnFor(db, txnId).profit_usd + refundTxn.profit_usd,
      ).toBeCloseTo(0);
    });
  });
});
