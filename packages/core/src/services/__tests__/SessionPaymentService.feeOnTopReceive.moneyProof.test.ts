/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — THE session money proof:
 * a fee-on-top OMT RECEIVE session-basket item (x=100, f=5, c=1) checked out
 * with pooled legs [IN CASH 5 (the fee), OUT kind:"PAYOUT" CASH 100 (the
 * cashout)] must satisfy FEATURE_GUIDE §8.4's invariant —
 *
 *   Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed to provider) = c + kept_change
 *
 * — end to end: `FinancialServiceRepository.createTransaction` (real, under
 * `deferPayment: true`, exactly as SessionCheckoutService.processCartItem
 * calls it) books the supplier-ledger debit and profit stamp UNCONDITIONALLY
 * (bug 1 — these are not payment-collection facts, they don't wait for
 * deferPayment) while skipping its own fee/payout legs (deferred to the
 * basket); `SessionPaymentRepository.getSessionCashSplitContext` (bug 7's
 * third component) folds the RECEIVE item's persisted `omt_fee` into the
 * basket's CHARGE bucket via `feeOnTopReceiveFsIds`; `SessionPaymentService
 * .recordBasketPayment` posts the pooled legs, splitting the payout leg by
 * `kind: "PAYOUT"` (the mirrored payout-side ratio, not the charge-side one).
 *
 * Numbers deliberately match `FinancialServiceRepository.receiveFeeLegs
 * .test.ts` case (a) (OMT/USD/x=100/f=5/c=1, fee via a single CASH leg) so
 * the two are directly diffable: the STANDALONE flow posts the fee/payout as
 * its own implicit legs and gets OMT_System delta -95 / supplier delta -96 /
 * commission 1; this SESSION flow posts the SAME two legs via the basket
 * recorder instead and must land on the identical numbers — proving
 * deferPayment + recordBasketPayment reconstructs the same money movement,
 * not a different (phantom or short) one.
 *
 * Harness: reuses `getDatabase()`'s native `__LIRATEK_TEST_DB__` test hook
 * (no `jest.mock` needed — `BaseRepository.db` is a live getter, so
 * FinancialServiceRepository, SessionPaymentRepository, TransactionRepository,
 * SupplierRepository and SettingsRepository all resolve the SAME db). Schema
 * is `FinancialServiceRepository.receiveFeeLegs.test.ts`'s schema (money
 * ledgers) plus `customer_session_transactions` (the session-basket link
 * table) and `sales` (empty — `getSessionSaleRows`/`backfillSaleSettlement`
 * unconditionally join it; a session with no SALE items still needs the
 * table to exist).
 *
 * RULE 17 (failing-first): every case below was proven against the pre-fix
 * code by (1) reverting `getSessionCashSplitContext` to sum the SIGNED net
 * (this file's own "fee attribution wiring" case does the equivalent via the
 * public API — passing `feeOnTopReceiveFsIds: []` — showing the fee lands in
 * General instead of the PCD) and (2) temporarily deleting the
 * `feeOnTopReceiveFsIds` accumulation block in `SessionCheckoutService
 * .checkout()` and re-running — the fee-attribution case failed both times
 * (OMT_System -100 / General +5 instead of -95 / 0) before the fix; restored
 * after confirming red. See the task's final report for the exact
 * revert/observe/restore transcript.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../SessionPaymentService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DebtService (CUSTOMER_ACCOUNT/GIFT_CARD unused in this file — every
// leg here is CASH) ────────────────────────────────────────────────────────
jest.mock("../DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: jest.fn() }),
  resetVoucherRepository: jest.fn(),
}));

// ─── In-memory schema: FinancialServiceRepository.receiveFeeLegs.test.ts's
// money-ledger schema + the session-basket link table + an (empty) sales
// table `getSessionSaleRows` unconditionally joins. ────────────────────────
function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
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
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
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
      session_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    -- Session-basket link table (SessionPaymentRepository.getSessionCashSplitContext
    -- / getSessionSaleRows) — NOT part of the receiveFeeLegs fixture.
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

    -- Empty — getSessionSaleRows joins it unconditionally; backfillSaleSettlement
    -- no-ops when it finds zero rows (this basket has no SALE items).
    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd       REAL,
      tenant_id              INTEGER NOT NULL DEFAULT 1
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 0, CURRENT_TIMESTAMP);

    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

// ─── Snapshot / invariant helpers — same shape as
// FinancialServiceRepository.receiveFeeLegs.test.ts's (rule 14: same THE
// invariant, one definition per file that needs to assert it against its own
// schema; the arithmetic is identical). ────────────────────────────────────

const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
  ["Whish_App", "USD"],
  ["Whish_System", "USD"],
];

interface Snapshot {
  drawers: Record<string, number>;
  supplierUsd: number;
  debtUsd: number;
}

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function supplierLedgerSumUsd(db: Database.Database, provider: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_usd), 0) as total
         FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = ?`,
    )
    .get(provider) as { total: number };
  return row.total;
}

function debtLedgerSumUsd(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_usd), 0) as total FROM debt_ledger`)
    .get() as { total: number };
  return row.total;
}

function snapshot(db: Database.Database): Snapshot {
  const drawers: Record<string, number> = {};
  for (const [name, currency] of DRAWERS) {
    drawers[`${name}_${currency}`] = balance(db, name, currency);
  }
  return {
    drawers,
    supplierUsd: supplierLedgerSumUsd(db, "OMT"),
    debtUsd: debtLedgerSumUsd(db),
  };
}

function drawerDelta(before: Snapshot, after: Snapshot, key: string): number {
  return after.drawers[key] - before.drawers[key];
}

function drawerDeltaSum(before: Snapshot, after: Snapshot): number {
  let sum = 0;
  for (const [name, currency] of DRAWERS) {
    sum += drawerDelta(before, after, `${name}_${currency}`);
  }
  return sum;
}

/** THE invariant (FEATURE_GUIDE §8.1/§8.4). */
function assertInvariant(
  before: Snapshot,
  after: Snapshot,
  opts: { commission: number; keptChange?: number },
): void {
  const debtDelta = after.debtUsd - before.debtUsd;
  const sigma = drawerDeltaSum(before, after) + debtDelta;
  const owedDelta = after.supplierUsd - before.supplierUsd;
  const lhs = sigma - owedDelta;
  const rhs = opts.commission + (opts.keptChange ?? 0);
  expect(lhs).toBeCloseTo(rhs, 5);
}

function txnIdForFsRow(db: Database.Database, fsId: number): number {
  const row = db
    .prepare(
      "SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?",
    )
    .get(fsId) as { id: number } | undefined;
  if (!row)
    throw new Error(`No transaction row found for financial_services #${fsId}`);
  return row.id;
}

/** Link the (already-created) FS row into the session basket, exactly as
 *  SessionCheckoutService.checkout()'s repo.linkTransaction call would — the
 *  RECEIVE item's linked amount is the PAYOUT magnitude only (negative), NOT
 *  including the fee (§1.5 — the fee is not its own basket line). */
function linkReceiveItemToSession(
  db: Database.Database,
  sessionId: number,
  fsId: number,
  payoutAmountUsd: number,
): void {
  const txnId = txnIdForFsRow(db, fsId);
  db.prepare(
    `INSERT INTO customer_session_transactions
       (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp, tenant_id)
     VALUES (?, 'omt_system', ?, ?, ?, 0, 1)`,
  ).run(sessionId, fsId, txnId, -payoutAmountUsd);
}

describe("SessionPaymentService — fee-on-top RECEIVE session item (Phase F money proof)", () => {
  let db: Database.Database;
  let finRepo: FinancialServiceRepository;
  let service: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetTransactionRepository();
    resetSupplierRepository();
    resetSettingsRepository();
    resetSessionPaymentRepository();
    resetSessionPaymentService();

    finRepo = new FinancialServiceRepository();
    service = new SessionPaymentService();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("(c) x=100 f=5 c=1: fee folded into the CHARGE bucket, kind:PAYOUT leg debits the PCD by its own share — §8.4 invariant holds", () => {
    const before = snapshot(db);

    // 1. Replay the cart item exactly as SessionCheckoutService.processCartItem
    //    does for ipcChannel 'financial:create'/'omt:add-transaction': the FS
    //    row + unified transaction are created under deferPayment (fee/payout
    //    legs skipped; supplier ledger + profit stamped unconditionally).
    const { id: fsId } = finRepo.createTransaction({
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

    // No legs written yet — deferPayment skipped both the fee leg and the payout.
    expect(db.prepare("SELECT COUNT(*) as c FROM payments").get()).toEqual({
      c: 0,
    });

    const sessionId = 501;
    linkReceiveItemToSession(db, sessionId, fsId, 100);

    // 2. SessionCheckoutService hands the fsId down as fee-on-top (gate
    //    resolved from cart formData: serviceType RECEIVE, includingFees !== true).
    const result = service.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 5, direction: "IN" },
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 100,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
      clientId: 1,
      feeOnTopReceiveFsIds: [fsId],
    });

    const after = snapshot(db);

    // Both legs are 100% primary-system (the only basket contributor is this
    // OMT RECEIVE item) so both the fee and the payout land entirely in the
    // PCD: OMT_System +5 (fee) - 100 (payout) = -95 — IDENTICAL to
    // receiveFeeLegs.test.ts case (a)'s implicit-leg number.
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5);
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    assertInvariant(before, after, { commission: 1 });

    // Payout/change are distinguishable in the result (no consumer mistakes
    // the $100 payout for change).
    expect(result.drawerPayoutUsd).toBeCloseTo(100, 5);
    expect(result.drawerChangeUsd).toBeCloseTo(0, 5);
    expect(result.drawerInUsd).toBeCloseTo(5, 5);

    // Note discriminator on the posted payout leg.
    const payoutRow = db
      .prepare("SELECT note FROM payments WHERE session_id = ? AND amount < 0")
      .get(sessionId) as { note: string };
    expect(payoutRow.note).toBe(
      "Basket payout to customer (primary-system item share)",
    );
  });

  it("fee-attribution wiring matters: WITHOUT feeOnTopReceiveFsIds the $5 fee is misrouted to General instead of the PCD (documents the pre-fix-equivalent gap)", () => {
    const before = snapshot(db);

    const { id: fsId } = finRepo.createTransaction({
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

    const sessionId = 502;
    linkReceiveItemToSession(db, sessionId, fsId, 100);

    service.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 5, direction: "IN" },
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 100,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
      clientId: 1,
      // Gate omitted — chargeTotalUsd has no fee contribution, so the
      // charge-side ratio's denominator is 0 and the $5 fee IN leg falls
      // through to General (splitCashLegByItemShare's ratio<=0 branch) while
      // the payout side (fed purely by the linked item, unaffected by the
      // gate) still correctly finds its own 100% primary-system share.
      feeOnTopReceiveFsIds: [],
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-100, 5);
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(5, 5);
    // Aggregate conservation still holds (money isn't lost, only misrouted
    // between PCD/General) — the invariant sums ALL drawers, so it cannot
    // see a routing bug on its own; this is exactly why the PCD-specific
    // assertions above (not just the invariant) are the regression guard.
    assertInvariant(before, after, { commission: 1 });
  });
});
