/**
 * TransactionRepository — NON_REVERSIBLE gate covers every flow the generic
 * void/refund cannot fully reverse (rule 20).
 *
 * Pre-fix, these types were absent from NON_REVERSIBLE_TRANSACTION_TYPES, so
 * a direct API call (transactions:void / POST /api/transactions/:id/void —
 * the UI merely hid the buttons) ran the generic reversal on flows it cannot
 * undo:
 *   - MTC_TOPUP / ALFA_TOPUP (topUpFromCustomer): moves BOTH drawers directly
 *     with NO payments legs — the void reversed nothing, leaving General down
 *     the cash and the provider drawer up the credits on a VOIDED row.
 *   - DRAWER_TOPUP (createTopUpFromDrawer): two drawer movements but only the
 *     General-side leg — voiding vanishes the source drawer's cash.
 *   - HOLD_MONEY / HOLD_MONEY_COLLECT: hold_money.status is not reset
 *     (hold_money is not in _markSourceRefunded) — void-then-collect pays out
 *     twice.
 *   - LOTO_MONTHLY_FEE: loto_monthly_fees.is_paid stays 1 on a voided payment.
 *   - CHECKPOINT: a physical-count reconciliation anchor — reversing it shifts
 *     live balances away from counted reality and orphans the daily_closings
 *     snapshot.
 *   - CLIENT_CREATED / CLIENT_UPDATED / CLIENT_DELETED: non-financial audit
 *     markers; a reversal row is meaningless.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  NON_REVERSIBLE_TRANSACTION_TYPES,
  type TransactionType,
} from "../../constants/transactionTypes.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE recharges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier     TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      tenant_id   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'admin')`).run();
  return db;
}

/** [type, source_table] for every flow the generic reversal cannot undo. */
const GATED: Array<[TransactionType, string]> = [
  ["MTC_TOPUP", "recharges"],
  ["ALFA_TOPUP", "recharges"],
  ["DRAWER_TOPUP", "drawer_topups"],
  ["DRAWER_CASHOUT", "drawer_cashouts"],
  ["HOLD_MONEY", "hold_money"],
  ["HOLD_MONEY_COLLECT", "hold_money"],
  ["LOTO_MONTHLY_FEE", "loto_monthly_fees"],
  ["CHECKPOINT", "daily_closings"],
  ["CLIENT_CREATED", "clients"],
  ["CLIENT_UPDATED", "clients"],
  ["CLIENT_DELETED", "clients"],
  // LIRA-066: the paper (no-cash) "Record Tx" entry — no generic
  // partner_ledger reversal owner exists for a bare paper ADJUSTMENT (unlike
  // PARTNER_SETTLEMENT/PARTNER_PAYMENT below, which LIRA-085 moved OUT of
  // this gate — see TransactionRepository.partnerSettlementReversal.test.ts).
  ["PARTNER_ADJUSTMENT", "partner_ledger"],
  // CQ-10: a COUNTERPARTY_DISCOUNT row has no drawer/legs to reverse and its
  // FIFO coverage stamps can't be un-applied either — same rationale as
  // PARTNER_SETTLEMENT above, just for the discount row itself.
  ["COUNTERPARTY_DISCOUNT", "debt_ledger"],
];

describe("TransactionRepository — non-reversible gate (rule 20)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  function seedTxn(type: TransactionType, sourceTable: string): number {
    return repo.createTransaction({
      type,
      source_table: sourceTable,
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      summary: `${type} (gate test)`,
      metadata_json: {},
    });
  }

  it.each(GATED)("rejects VOID of a %s row", (type, sourceTable) => {
    const id = seedTxn(type, sourceTable);
    expect(() => repo.voidTransaction(id, 1)).toThrow(
      /cannot be voided or refunded/i,
    );
  });

  it.each(GATED)("rejects REFUND of a %s row", (type, sourceTable) => {
    const id = seedTxn(type, sourceTable);
    expect(() => repo.refundTransaction(id, 1)).toThrow(
      /cannot be voided or refunded/i,
    );
  });

  it("control: RECHARGE stays voidable (generic reversal fully covers it)", () => {
    db.prepare(`INSERT INTO recharges (id, carrier) VALUES (1, 'MTC')`).run();
    const id = seedTxn("RECHARGE", "recharges");
    const reversalId = repo.voidTransaction(id, 1);
    expect(reversalId).toBeGreaterThan(0);
  });

  // LIRA-085: PARTNER_SETTLEMENT/PARTNER_PAYMENT/SUPPLIER_SETTLEMENT moved
  // OUT of NON_REVERSIBLE_TRANSACTION_TYPES — a dedicated reversal owner now
  // exists for each (TransactionRepository._reversePartnerSettlementLedger /
  // _reverseSupplierSettlement). Full create+reverse+nets-to-0 coverage
  // lives in TransactionRepository.partnerSettlementReversal.test.ts /
  // TransactionRepository.supplierSettlementReversal.test.ts (this file only
  // owns the GATE, not the reversal mechanics) — this is a fast membership
  // check that they no longer sit in the gated set.
  it("PARTNER_SETTLEMENT/PARTNER_PAYMENT/SUPPLIER_SETTLEMENT are no longer NON_REVERSIBLE", () => {
    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has("PARTNER_SETTLEMENT")).toBe(
      false,
    );
    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has("PARTNER_PAYMENT")).toBe(false);
    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has("SUPPLIER_SETTLEMENT")).toBe(
      false,
    );
  });
});
