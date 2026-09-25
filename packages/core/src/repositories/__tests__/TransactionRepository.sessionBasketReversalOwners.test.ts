/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — whole-basket void/
 * refund reversal owners: a LOTO_CASH_PRIZE basket member, a KEPT_CHANGE
 * basket member, and a session-scoped pooled CREDIT_DEPOSIT.
 *
 * Rule 20 proof: for a session basket containing all three of these shapes
 * plus the basket's pooled cash leg(s), `voidSessionBasket` must net every
 * ledger it touches back to ZERO, per currency:
 *   - drawer_balances (the pooled cash legs the checkout posted)
 *   - supplier_ledger (the loto prize's CASH_PRIZE row soft-voided)
 *   - loto_cash_prizes.voided (excluded from prize totals/checkpoints)
 *   - debt_ledger (the pooled CREDIT_DEPOSIT reversed)
 *   - transactions.status (the KEPT_CHANGE row VOIDED — every profit query
 *     already gates on status = 'ACTIVE', so its profit stops counting)
 *
 * Owner spec (OWNER_NOTES_REMAINING_BUILD.md #11-C):
 *   "Kept change goes back to the customer on reversal: the drawer returns
 *   everything he handed over and the kept-change profit is cancelled."
 *   "Loto prize inside a basket: needs a reversal owner ... soft-voids the
 *   CASH_PRIZE supplier_ledger row and marks the prize voided ... Prize
 *   totals and checkpoints must exclude voided prizes ... Block with a
 *   clear message when the prize is already reimbursed or its loto
 *   checkpoint is settled."
 *   "Session-scoped CREDIT_DEPOSIT rows ... must be reversed too ... Prove
 *   create + reverse nets to 0 per ledger and per currency."
 *
 * This file constructs the basket directly at the SQL level (the way
 * `TransactionRepository.debtReversal.test.ts`'s "whitelist guard" case
 * does) rather than through the full checkout service chain — it is
 * proving `TransactionRepository`'s reversal owners, not
 * `SessionCheckoutService`'s creation path (already exercised elsewhere,
 * e.g. `TransactionRepository.refundSessionBasketCostPriceFlow.test.ts`).
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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
      source_ref_table TEXT,
      source_ref_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      settlement_id INTEGER,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      session_id INTEGER,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE customer_sessions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_phone TEXT,
      user_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      started_by TEXT NOT NULL,
      closed_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE loto_checkpoints (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkpoint_date TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_tickets INTEGER NOT NULL DEFAULT 0,
      total_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      total_cash_prizes_count INTEGER NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_cash_prizes (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT,
      prize_amount REAL NOT NULL,
      customer_name TEXT,
      prize_date TEXT NOT NULL,
      is_reimbursed INTEGER NOT NULL DEFAULT 0,
      reimbursed_date TEXT,
      reimbursed_in_settlement_id INTEGER,
      checkpoint_id INTEGER,
      note TEXT,
      voided INTEGER NOT NULL DEFAULT 0,
      voided_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
  `);

  return db;
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

function seedClient(db: Database.Database, name = "Test Client"): number {
  return Number(
    db.prepare("INSERT INTO clients (full_name) VALUES (?)").run(name)
      .lastInsertRowid,
  );
}

function seedLotoSupplier(db: Database.Database): number {
  return Number(
    db
      .prepare(
        "INSERT INTO suppliers (name, is_system, module_key) VALUES ('Loto', 1, 'loto')",
      )
      .run().lastInsertRowid,
  );
}

function seedSession(db: Database.Database): number {
  return Number(
    db
      .prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')")
      .run().lastInsertRowid,
  );
}

/** Net outstanding on-account balance for a client across CREDIT_DEPOSIT +
 *  its reversal (rule 20 — nets to 0 once a create is fully reversed). */
function clientDebtUsd(db: Database.Database, clientId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM debt_ledger WHERE client_id = ?",
    )
    .get(clientId) as { total: number };
  return row.total;
}

describe("TransactionRepository.voidSessionBasket — LIRA-201c reversal owners", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;
  const USER_ID = 1;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTransactionRepository();
  });

  /**
   * Builds a basket with all three LIRA-201c shapes:
   *   - a LOTO_CASH_PRIZE item (400,000 LBP), deferred (no own drawer leg —
   *     matches LotoCashPrizeRepository's session branch)
   *   - a KEPT_CHANGE item ($2 profit, no own drawer leg)
   *   - the basket's own pooled cash legs (+$50 USD IN, -10,000 LBP OUT —
   *     the owner's worked example, #11-A's netted physical legs)
   *   - a pooled session CREDIT_DEPOSIT (-$5, shop owes the customer)
   */
  function seedFullBasket(opts?: {
    checkpointId?: number | null;
    prizeReimbursed?: boolean;
  }): {
    sessionId: number;
    clientId: number;
    supplierId: number;
    prizeId: number;
    prizeTxnId: number;
    keptChangeTxnId: number;
  } {
    const clientId = seedClient(db);
    const supplierId = seedLotoSupplier(db);
    const sessionId = seedSession(db);

    // --- Item 1: LOTO_CASH_PRIZE ---
    const prizeId = Number(
      db
        .prepare(
          `INSERT INTO loto_cash_prizes
             (prize_amount, customer_name, prize_date, is_reimbursed, reimbursed_date, checkpoint_id)
           VALUES (?, 'Test Client', '2026-09-24', ?, ?, ?)`,
        )
        .run(
          400000,
          opts?.prizeReimbursed ? 1 : 0,
          opts?.prizeReimbursed ? "2026-09-20" : null,
          opts?.checkpointId ?? null,
        ).lastInsertRowid,
    );
    const prizeTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions
             (type, source_table, source_id, user_id, amount_usd, amount_lbp, client_id, summary)
           VALUES ('LOTO_CASH_PRIZE', 'loto_cash_prizes', ?, ?, 0, -400000, ?, 'Loto cash prize payout')`,
        )
        .run(prizeId, USER_ID, clientId).lastInsertRowid,
    );
    // Deferred (session basket) — LotoCashPrizeRepository skips the General
    // payout in deferPayment mode, so the prize itself posts NO drawer leg;
    // only the CASH_PRIZE supplier_ledger row and the pooled physical cash
    // leg below represent the money.
    db.prepare(
      `INSERT INTO supplier_ledger
         (supplier_id, entry_type, amount_lbp, transaction_id, is_auto, is_refunded)
       VALUES (?, 'CASH_PRIZE', 400000, ?, 0, 0)`,
    ).run(supplierId, prizeTxnId);
    db.prepare(
      `INSERT INTO customer_session_transactions
         (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'loto_cash_prize', ?, ?, 0, -400000)`,
    ).run(sessionId, prizeId, prizeTxnId);

    // --- Item 2: KEPT_CHANGE ($2 profit-only, session-linked) ---
    const keptChangeTxnId = Number(
      db
        .prepare(
          `INSERT INTO transactions
             (type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, summary)
           VALUES ('KEPT_CHANGE', 'customer_sessions', ?, ?, 0, 0, 2, 0, ?, 'Kept change (session checkout): $2')`,
        )
        .run(sessionId, USER_ID, clientId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions
         (session_id, transaction_type, transaction_id, unified_transaction_id, profit_usd, profit_lbp)
       VALUES (?, 'kept_change', ?, ?, 2, 0)`,
    ).run(sessionId, keptChangeTxnId, keptChangeTxnId);

    // --- Basket's own pooled physical cash legs (owner's worked example:
    // in 50$, out 40$ + 10,000 LBP — modeled here as the NET physical
    // legs #11-A's netted checkout would have posted: +$50 USD in,
    // -10,000 LBP out) ---
    db.prepare(
      `INSERT INTO payments (transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by)
       VALUES (NULL, ?, 'CASH', 'General', 'USD', 50, 'Basket payment', ?)`,
    ).run(sessionId, USER_ID);
    db.prepare(
      `INSERT INTO payments (transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by)
       VALUES (NULL, ?, 'CASH', 'General', 'LBP', -10000, 'Change returned', ?)`,
    ).run(sessionId, USER_ID);
    db.prepare(
      `UPDATE drawer_balances SET balance = balance + 50 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
    ).run();
    db.prepare(
      `UPDATE drawer_balances SET balance = balance - 10000 WHERE drawer_name = 'General' AND currency_code = 'LBP'`,
    ).run();

    // --- Pooled session CREDIT_DEPOSIT ($5 leftover credited on account) ---
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, session_id, note, created_by)
       VALUES (?, 'CREDIT_DEPOSIT', -5, 0, NULL, ?, 'Kept as account credit', ?)`,
    ).run(clientId, sessionId, USER_ID);

    return {
      sessionId,
      clientId,
      supplierId,
      prizeId,
      prizeTxnId,
      keptChangeTxnId,
    };
  }

  it("nets every ledger to 0 per currency: drawers, supplier_ledger, loto_cash_prizes.voided, debt_ledger, and the KEPT_CHANGE profit", () => {
    const { sessionId, clientId, prizeId, prizeTxnId, keptChangeTxnId } =
      seedFullBasket();

    // Baseline BEFORE the basket's cash legs were ever posted (this test's
    // seed applies them directly, mimicking checkout having already run).
    const baselineUsd = balance(db, "General", "USD") - 50;
    const baselineLbp = balance(db, "General", "LBP") + 10000;

    const result = txnRepo.voidSessionBasket(sessionId, USER_ID);

    expect(result.itemCount).toBe(2);
    expect(result.reversedTransactionIds.sort()).toEqual(
      [prizeTxnId, keptChangeTxnId].sort(),
    );

    // 1. Drawers: create + reverse nets back to the pre-basket baseline.
    expect(balance(db, "General", "USD")).toBeCloseTo(baselineUsd, 6);
    expect(balance(db, "General", "LBP")).toBeCloseTo(baselineLbp, 6);

    // 2. supplier_ledger CASH_PRIZE row soft-voided.
    const ledgerRow = db
      .prepare(
        `SELECT is_refunded FROM supplier_ledger WHERE transaction_id = ? AND entry_type = 'CASH_PRIZE'`,
      )
      .get(prizeTxnId) as { is_refunded: number };
    expect(ledgerRow.is_refunded).toBe(1);

    // 3. loto_cash_prizes.voided — excluded from prize totals/checkpoints.
    const prizeRow = db
      .prepare(`SELECT voided, voided_at FROM loto_cash_prizes WHERE id = ?`)
      .get(prizeId) as { voided: number; voided_at: string | null };
    expect(prizeRow.voided).toBe(1);
    expect(prizeRow.voided_at).not.toBeNull();

    // 4. debt_ledger CREDIT_DEPOSIT nets to 0 (create -5, reversal +5).
    expect(clientDebtUsd(db, clientId)).toBeCloseTo(0, 6);
    const reversalRow = db
      .prepare(
        `SELECT amount_usd FROM debt_ledger WHERE session_id = ? AND transaction_type = 'Refund Reversal'`,
      )
      .get(sessionId) as { amount_usd: number } | undefined;
    expect(reversalRow?.amount_usd).toBeCloseTo(5, 6);

    // 5. Both basket items flip to VOIDED — the KEPT_CHANGE profit stops
    // counting once every profit query's status = 'ACTIVE' gate excludes it.
    const prizeTxnStatus = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(prizeTxnId) as { status: string };
    const keptChangeStatus = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(keptChangeTxnId) as { status: string };
    expect(prizeTxnStatus.status).toBe("VOIDED");
    expect(keptChangeStatus.status).toBe("VOIDED");
  });

  it("delta-adjusts an OPEN loto checkpoint's totals when the voided prize belonged to one", () => {
    const checkpointId = Number(
      db
        .prepare(
          `INSERT INTO loto_checkpoints
             (checkpoint_date, period_start, period_end, total_cash_prizes, total_cash_prizes_count, is_settled)
           VALUES ('2026-09-24', '2026-09-24', '2026-09-24', 400000, 1, 0)`,
        )
        .run().lastInsertRowid,
    );
    const { sessionId } = seedFullBasket({ checkpointId });

    txnRepo.voidSessionBasket(sessionId, USER_ID);

    const checkpoint = db
      .prepare(
        `SELECT total_cash_prizes, total_cash_prizes_count FROM loto_checkpoints WHERE id = ?`,
      )
      .get(checkpointId) as {
      total_cash_prizes: number;
      total_cash_prizes_count: number;
    };
    expect(checkpoint.total_cash_prizes).toBe(0);
    expect(checkpoint.total_cash_prizes_count).toBe(0);
  });

  it("blocks voiding a basket whose loto prize was already reimbursed, with the owner-worded message", () => {
    const { sessionId } = seedFullBasket({ prizeReimbursed: true });

    expect(() => txnRepo.voidSessionBasket(sessionId, USER_ID)).toThrow(
      /already settled with Loto on 2026-09-20\. Fix it from the Loto page\./,
    );

    // Refused up-front — nothing was reversed (rule 17's "before any write").
    expect(balance(db, "General", "USD")).toBe(5050);
  });

  it("refuses a second voidSessionBasket call on the same session (idempotency guard on the pooled leg/debt)", () => {
    const { sessionId } = seedFullBasket();
    txnRepo.voidSessionBasket(sessionId, USER_ID);
    expect(() => txnRepo.voidSessionBasket(sessionId, USER_ID)).toThrow(
      /already been voided\/refunded/,
    );
  });
});
