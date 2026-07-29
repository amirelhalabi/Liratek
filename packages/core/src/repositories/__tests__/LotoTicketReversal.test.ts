/**
 * LOTO ticket sale void/refund reversal (rule 20).
 *
 * Scope (owner decision — see the task's design contract):
 *   - a ticket NOT in any checkpoint is reversible
 *   - a ticket in a checkpoint that is NOT yet settled is reversible, and
 *     that checkpoint's frozen totals are delta-adjusted so its own future
 *     settle-to-zero math stays correct
 *   - a ticket in an ALREADY-SETTLED checkpoint is BLOCKED (named error)
 *   - LOTO_CASH_PRIZE and LOTO_SETTLEMENT stay OUT of scope (unchanged)
 *
 * The ticket TOP_UP row is LINK-mode (CQ-7, a3d09e7, 2026-07-19):
 * `LotoTicketRepository.createTicket` calls
 * `addLedgerEntry({ transaction_id: txnId })`, so the supplier_ledger row's
 * own `transaction_id` IS the LOTO transaction's id — no `is_auto`/
 * `source_ref_*` sibling exists, and neither `_cascadeSupplierSiblingVoid`
 * nor `_assertSupplierSiblingsVoidable` (which only scan `is_auto = 1` rows)
 * ever see it. `TransactionRepository._reverseLotoSupplierLedger` /
 * `_assertLotoTicketVoidable` are the new owners this test proves.
 *
 * Rule-17 classification: FAILING-FIRST. To watch every "reversal" case here
 * go red on the pre-fix code, comment out the two new call sites —
 *   `this._reverseLotoSupplierLedger(original);`   (void step 5f, refund step 4f)
 * — and the `this._assertLotoTicketVoidable(original);` guard calls in both
 * `_voidTransactionInternal` and `refundTransaction`, then re-run this file:
 *   - "nets to 0" assertions fail (supplier_ledger balance stays at the
 *     un-reversed TOP_UP amount; drawer nets to 0 for a different, unrelated
 *     reason — the generic `_reversePayments` already covers that half)
 *   - the unsettled-checkpoint delta-adjust assertions fail (checkpoint
 *     totals stay at their pre-void frozen values)
 *   - the settled-checkpoint block assertion fails (the void/refund would
 *     SUCCEED instead of throwing — the single most dangerous regression,
 *     since it would silently desync a posted settlement)
 * Revert the comment-outs afterward. LOTO_CASH_PRIZE's block (case 7) is
 * unrelated to this fix and passed before and after — a stability check that
 * this ticket's scope carve-out didn't leak.
 *
 * "Case 3b" (added later, see git blame) composes case 2's delta-adjust with
 * `LotoCheckpointRepository.settleCheckpoint` — the crux invariant manual
 * test point 1 asks for: refund mid-checkpoint, THEN settle with the
 * checkpoint's own re-read totals, and the Loto supplier ledger must net to
 * exactly 0. Same failing-first recipe (comment out the two call sites
 * above): the checkpoint delta-adjust never runs, so re-reading its "totals"
 * yields the stale pre-refund numbers, settling with those leaves a
 * non-zero balance, and the two positive-path tests fail.
 *
 * The negative-control test shows the OTHER failure cause, under the current
 * (fixed) code: settling from totals captured BEFORE the refund silently
 * strands that ticket's own contribution in the ledger. Its job is to
 * distinguish "stale totals were used" from "the delta-adjust didn't run" —
 * two different bugs with the same symptom. Treat the two positive-path
 * Case-3b tests as THE regression guard for the delta-adjust; don't reason
 * about this one's behaviour under a revert (measured 2026-07-29: commenting
 * out both `_reverseLotoSupplierLedger` call sites does turn it red, but that
 * is incidental to what it is asserting, not the property it was written to
 * pin).
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Loto Liban', 'LOTO', 1);

    -- v136 schema: source_ref_table/source_ref_id (unused here — link mode).
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

    CREATE TABLE loto_tickets (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT,
      sale_amount REAL NOT NULL,
      commission_rate REAL DEFAULT 0.0445,
      commission_amount REAL NOT NULL,
      is_winner INTEGER DEFAULT 0,
      prize_amount REAL DEFAULT 0,
      prize_paid_date TEXT,
      sale_date TEXT NOT NULL DEFAULT (date('now')),
      payment_method TEXT,
      currency TEXT DEFAULT 'LBP',
      note TEXT,
      checkpoint_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Needed only by the settle-cycle composition tests below
    -- (LotoCheckpointRepository.settleCheckpoint touches both).
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE loto_settlements (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      checkpoint_ids TEXT NOT NULL,
      total_sales REAL NOT NULL DEFAULT 0,
      total_commission REAL NOT NULL DEFAULT 0,
      total_cash_prizes REAL NOT NULL DEFAULT 0,
      net_settlement REAL NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      direction TEXT NOT NULL,
      notes TEXT,
      user_id INTEGER,
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
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 5000000, CURRENT_TIMESTAMP);
  `);
  return db;
}

function lotoSupplierId(db: Database.Database): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`)
    .get() as { id: number };
  return row.id;
}

function ledgerSumLbp(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_lbp), 0) AS lbp FROM supplier_ledger
       WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierId) as { lbp: number };
  return row.lbp;
}

function drawerBal(db: Database.Database, name: string, ccy = "LBP"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function ticketRow(
  db: Database.Database,
  id: number,
): { is_refunded: number; checkpoint_id: number | null } {
  return db
    .prepare(`SELECT is_refunded, checkpoint_id FROM loto_tickets WHERE id = ?`)
    .get(id) as { is_refunded: number; checkpoint_id: number | null };
}

function checkpointRow(
  db: Database.Database,
  id: number,
): {
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
} {
  return db
    .prepare(
      `SELECT total_sales, total_commission, total_tickets, total_prizes FROM loto_checkpoints WHERE id = ?`,
    )
    .get(id) as {
    total_sales: number;
    total_commission: number;
    total_tickets: number;
    total_prizes: number;
  };
}

/** Seeds a ticket + its link-mode TOP_UP supplier_ledger row + its unified
 * LOTO transaction row, exactly mirroring what
 * `LotoTicketRepository.createTicket` writes at sale time (minus the drawer
 * payment leg, added separately per-test since only some cases need it). */
function seedTicket(
  db: Database.Database,
  txnRepo: TransactionRepository,
  opts: {
    saleAmount: number;
    commissionAmount: number;
    checkpointId?: number;
    isWinner?: boolean;
    prizeAmount?: number;
  },
): { ticketId: number; txnId: number } {
  const supplierId = lotoSupplierId(db);
  const saleAmount = opts.saleAmount;
  const commissionAmount = opts.commissionAmount;
  const amountWeOwe = saleAmount - commissionAmount;

  const ticketRes = db
    .prepare(
      `INSERT INTO loto_tickets
        (sale_amount, commission_amount, is_winner, prize_amount, sale_date, checkpoint_id)
       VALUES (?, ?, ?, ?, date('now'), ?)`,
    )
    .run(
      saleAmount,
      commissionAmount,
      opts.isWinner ? 1 : 0,
      opts.prizeAmount ?? 0,
      opts.checkpointId ?? null,
    );
  const ticketId = Number(ticketRes.lastInsertRowid);

  const txnId = txnRepo.createTransaction({
    type: "LOTO",
    source_table: "loto_tickets",
    source_id: ticketId,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: saleAmount,
    profit_usd: 0,
    profit_lbp: commissionAmount,
    summary: `Loto ticket sale #${ticketId}`,
    metadata_json: {},
  });

  db.prepare(
    `INSERT INTO supplier_ledger
      (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto)
     VALUES (?, 'TOP_UP', 0, ?, 'Ticket sale', 1, ?, 0)`,
  ).run(supplierId, amountWeOwe, txnId);

  return { ticketId, txnId };
}

describe("LOTO ticket sale reversal (void/refund) — rule 20", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  // ── Case 1: uncheckpointed ticket ────────────────────────────────────────

  describe("uncheckpointed ticket", () => {
    it("VOID: supplier_ledger nets to 0, loto_tickets.is_refunded=1, transaction VOIDED", () => {
      const supplierId = lotoSupplierId(db);
      const { ticketId, txnId } = seedTicket(db, txnRepo, {
        saleAmount: 100_000,
        commissionAmount: 4_450,
      });
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(95_550, 4);

      txnRepo.voidTransaction(txnId, 1);

      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(0, 4);
      expect(ticketRow(db, ticketId).is_refunded).toBe(1);
      const txnRow = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(txnRow.status).toBe("VOIDED");
    });

    it("VOID: drawer nets to 0 across the ticket's own payment leg", () => {
      const { txnId } = seedTicket(db, txnRepo, {
        saleAmount: 50_000,
        commissionAmount: 2_225,
      });
      db.prepare(
        `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, created_by)
         VALUES (?, 'CASH', 'General', 'LBP', 50000, 1)`,
      ).run(txnId);
      db.prepare(
        `UPDATE drawer_balances SET balance = balance + 50000 WHERE drawer_name='General' AND currency_code='LBP'`,
      ).run();
      const before = drawerBal(db, "General", "LBP");

      txnRepo.voidTransaction(txnId, 1);

      expect(drawerBal(db, "General", "LBP")).toBeCloseTo(before - 50_000, 2);
    });

    it("REFUND: same per-currency (LBP) net-to-0 as void; original stays ACTIVE", () => {
      const supplierId = lotoSupplierId(db);
      const { ticketId, txnId } = seedTicket(db, txnRepo, {
        saleAmount: 30_000,
        commissionAmount: 1_335,
      });

      const refundId = txnRepo.refundTransaction(txnId, 1);

      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(0, 4);
      expect(ticketRow(db, ticketId).is_refunded).toBe(1);
      const original = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(original.status).toBe("ACTIVE");
      const refundRow = db
        .prepare(`SELECT type, reverses_id FROM transactions WHERE id = ?`)
        .get(refundId) as { type: string; reverses_id: number };
      expect(refundRow.type).toBe("REFUND");
      expect(refundRow.reverses_id).toBe(txnId);
    });

    it("FAILING-FIRST capture: without _reverseLotoSupplierLedger, the TOP_UP row would stand and the ledger would NOT net to 0", () => {
      // Demonstrates the exact pre-fix gap: mark ONLY the ticket refunded
      // (what the generic _markSourceRefunded step alone does) — the TOP_UP
      // row is untouched.
      const supplierId = lotoSupplierId(db);
      const { ticketId } = seedTicket(db, txnRepo, {
        saleAmount: 100_000,
        commissionAmount: 4_450,
      });
      db.prepare(`UPDATE loto_tickets SET is_refunded = 1 WHERE id = ?`).run(
        ticketId,
      );
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(95_550, 2);
      expect(ledgerSumLbp(db, supplierId)).not.toBeCloseTo(0, 2);
    });
  });

  // ── Case 2: ticket in an UNSETTLED checkpoint ────────────────────────────

  describe("ticket in an unsettled checkpoint", () => {
    function seedCheckpoint(db: Database.Database): number {
      const res = db
        .prepare(
          `INSERT INTO loto_checkpoints
            (checkpoint_date, period_start, period_end, total_sales, total_commission, total_tickets, total_prizes, is_settled)
           VALUES (date('now'), date('now'), date('now'), 180000, 27000, 3, 5000, 0)`,
        )
        .run();
      return Number(res.lastInsertRowid);
    }

    it("VOID succeeds AND decrements the checkpoint's frozen totals by exactly this ticket's own values (non-winner)", () => {
      const checkpointId = seedCheckpoint(db);
      const { txnId } = seedTicket(db, txnRepo, {
        saleAmount: 50_000,
        commissionAmount: 7_500,
        checkpointId,
      });
      const before = checkpointRow(db, checkpointId);

      txnRepo.voidTransaction(txnId, 1);

      const after = checkpointRow(db, checkpointId);
      expect(after.total_sales).toBeCloseTo(before.total_sales - 50_000, 4);
      expect(after.total_commission).toBeCloseTo(
        before.total_commission - 7_500,
        4,
      );
      expect(after.total_tickets).toBe(before.total_tickets - 1);
      // non-winner: total_prizes untouched (0 subtracted)
      expect(after.total_prizes).toBeCloseTo(before.total_prizes, 4);
    });

    it("VOID of a WINNING ticket also decrements total_prizes by its prize_amount", () => {
      const checkpointId = seedCheckpoint(db);
      const { txnId } = seedTicket(db, txnRepo, {
        saleAmount: 30_000,
        commissionAmount: 4_500,
        checkpointId,
        isWinner: true,
        prizeAmount: 2_000,
      });
      const before = checkpointRow(db, checkpointId);

      txnRepo.voidTransaction(txnId, 1);

      const after = checkpointRow(db, checkpointId);
      expect(after.total_prizes).toBeCloseTo(before.total_prizes - 2_000, 4);
    });

    it("REFUND: identical checkpoint delta-adjust as void", () => {
      const checkpointId = seedCheckpoint(db);
      const { txnId } = seedTicket(db, txnRepo, {
        saleAmount: 20_000,
        commissionAmount: 3_000,
        checkpointId,
      });
      const before = checkpointRow(db, checkpointId);

      txnRepo.refundTransaction(txnId, 1);

      const after = checkpointRow(db, checkpointId);
      expect(after.total_sales).toBeCloseTo(before.total_sales - 20_000, 4);
      expect(after.total_commission).toBeCloseTo(
        before.total_commission - 3_000,
        4,
      );
      expect(after.total_tickets).toBe(before.total_tickets - 1);
    });
  });

  // ── Case 3: ticket in an ALREADY-SETTLED checkpoint ──────────────────────

  describe("ticket in an already-settled checkpoint", () => {
    function seedSettledCheckpoint(db: Database.Database): number {
      const res = db
        .prepare(
          `INSERT INTO loto_checkpoints
            (checkpoint_date, period_start, period_end, total_sales, total_commission, total_tickets, total_prizes, is_settled, settled_at, settlement_id)
           VALUES ('2026-07-20', '2026-07-19', '2026-07-20', 100000, 15000, 1, 0, 1, '2026-07-20 10:00:00', 42)`,
        )
        .run();
      return Number(res.lastInsertRowid);
    }

    it("VOID throws naming the checkpoint/settlement, and writes NOTHING", () => {
      const checkpointId = seedSettledCheckpoint(db);
      const { ticketId, txnId } = seedTicket(db, txnRepo, {
        saleAmount: 100_000,
        commissionAmount: 15_000,
        checkpointId,
      });
      const supplierId = lotoSupplierId(db);
      const ledgerBefore = ledgerSumLbp(db, supplierId);
      const checkpointBefore = checkpointRow(db, checkpointId);

      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        new RegExp(`settlement #42`),
      );
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        new RegExp(`checkpoint #${checkpointId}`),
      );

      // Nothing changed.
      expect(ticketRow(db, ticketId).is_refunded).toBe(0);
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(ledgerBefore, 4);
      const checkpointAfter = checkpointRow(db, checkpointId);
      expect(checkpointAfter).toEqual(checkpointBefore);
      const txnStatus = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(txnStatus.status).toBe("ACTIVE");
    });

    it("REFUND throws the same way and writes NOTHING", () => {
      const checkpointId = seedSettledCheckpoint(db);
      const { ticketId, txnId } = seedTicket(db, txnRepo, {
        saleAmount: 100_000,
        commissionAmount: 15_000,
        checkpointId,
      });
      const supplierId = lotoSupplierId(db);
      const ledgerBefore = ledgerSumLbp(db, supplierId);

      expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(/settl/i);

      expect(ticketRow(db, ticketId).is_refunded).toBe(0);
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(ledgerBefore, 4);
      const existingRefund = db
        .prepare(`SELECT id FROM transactions WHERE reverses_id = ?`)
        .get(txnId);
      expect(existingRefund).toBeUndefined();
    });
  });

  // ── Case 3b: refund mid-checkpoint THEN settle — the composed crux ──────
  //
  // Point 1's second half (audit Q1): the checkpoint delta-adjust (case 2
  // above) and the settle-to-zero math (LotoSupplierLedgerSign.test.ts) are
  // each proven separately, but never chained. These three tests compose
  // them: sell N tickets into one unsettled checkpoint, refund ONE of them
  // (checkpoint delta-adjusts), re-read the checkpoint's now-adjusted
  // totals, settle with THOSE totals, and assert the Loto supplier ledger
  // nets to exactly 0.

  describe("refund mid-checkpoint, THEN settle — nets to exactly 0 (Point 1 crux)", () => {
    function seedOpenCheckpoint(
      totals: {
        total_sales: number;
        total_commission: number;
        total_tickets: number;
        total_prizes: number;
      },
      checkpointRepo: LotoCheckpointRepository,
    ): number {
      const cp = checkpointRepo.createCheckpoint({
        checkpoint_date: "2026-07-25",
        period_start: "2026-07-20",
        period_end: "2026-07-25",
        total_sales: totals.total_sales,
        total_commission: totals.total_commission,
        total_tickets: totals.total_tickets,
        total_prizes: totals.total_prizes,
        total_cash_prizes: 0,
        total_cash_prizes_count: 0,
      });
      return cp.id;
    }

    it("non-winner ticket: refund it mid-checkpoint, settle with the adjusted totals, ledger nets to 0", () => {
      const checkpointRepo = new LotoCheckpointRepository(db);
      const supplierId = lotoSupplierId(db);

      // Named constants — three tickets, none winning.
      const TICKET_A_SALE = 100_000;
      const TICKET_A_COMMISSION = 4_450;
      const TICKET_B_SALE = 50_000;
      const TICKET_B_COMMISSION = 2_225;
      const TICKET_C_SALE = 30_000; // this one gets refunded
      const TICKET_C_COMMISSION = 1_335;

      const checkpointId = seedOpenCheckpoint(
        {
          total_sales: TICKET_A_SALE + TICKET_B_SALE + TICKET_C_SALE,
          total_commission:
            TICKET_A_COMMISSION + TICKET_B_COMMISSION + TICKET_C_COMMISSION,
          total_tickets: 3,
          total_prizes: 0,
        },
        checkpointRepo,
      );

      seedTicket(db, txnRepo, {
        saleAmount: TICKET_A_SALE,
        commissionAmount: TICKET_A_COMMISSION,
        checkpointId,
      });
      seedTicket(db, txnRepo, {
        saleAmount: TICKET_B_SALE,
        commissionAmount: TICKET_B_COMMISSION,
        checkpointId,
      });
      const { txnId: txnC } = seedTicket(db, txnRepo, {
        saleAmount: TICKET_C_SALE,
        commissionAmount: TICKET_C_COMMISSION,
        checkpointId,
      });

      // Pre-refund: shop owes Loto (sale − commission) for all three tickets.
      const preRefundOwed =
        TICKET_A_SALE -
        TICKET_A_COMMISSION +
        (TICKET_B_SALE - TICKET_B_COMMISSION) +
        (TICKET_C_SALE - TICKET_C_COMMISSION);
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(preRefundOwed, 4);

      // Refund ticket C — checkpoint delta-adjusts (case 2 above already
      // pins this in isolation; here it feeds the next step).
      txnRepo.refundTransaction(txnC, 1);

      const adjusted = checkpointRow(db, checkpointId);
      expect(adjusted.total_sales).toBeCloseTo(
        TICKET_A_SALE + TICKET_B_SALE,
        4,
      );
      expect(adjusted.total_commission).toBeCloseTo(
        TICKET_A_COMMISSION + TICKET_B_COMMISSION,
        4,
      );
      expect(adjusted.total_tickets).toBe(2);
      expect(adjusted.total_prizes).toBeCloseTo(0, 4);

      // Settle using the checkpoint's OWN re-read (post-refund) totals —
      // never the stale pre-refund ones (see the negative-control test below).
      checkpointRepo.settleCheckpoint(
        checkpointId,
        adjusted.total_sales,
        adjusted.total_commission,
        adjusted.total_prizes,
        0, // total_cash_prizes param is deprecated, read from the checkpoint row
        "2026-07-25T12:00:00.000Z",
        1,
      );

      // Crux invariant: TOP_UP(A) + TOP_UP(B) + SETTLEMENT == 0.
      // TOP_UP(A) + TOP_UP(B) = 95,550 + 47,775 = 143,325 (C's TOP_UP is
      // excluded by the is_refunded filter in ledgerSumLbp); SETTLEMENT =
      // adjusted.total_commission − adjusted.total_sales = 6,675 − 150,000
      // = −143,325. Sum = 0.
      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(0, 4);
    });

    it("WINNING ticket: refund it mid-checkpoint (total_prizes delta-adjusts too), settle nets to 0", () => {
      const checkpointRepo = new LotoCheckpointRepository(db);
      const supplierId = lotoSupplierId(db);

      const TICKET_A_SALE = 100_000;
      const TICKET_A_COMMISSION = 4_450;
      const TICKET_B_SALE = 50_000;
      const TICKET_B_COMMISSION = 2_225;
      // Winning ticket — the one refunded. Its prize contributes to
      // total_prizes, so the delta-adjust must subtract it too.
      const TICKET_W_SALE = 30_000;
      const TICKET_W_COMMISSION = 1_335;
      const TICKET_W_PRIZE = 2_000;

      const checkpointId = seedOpenCheckpoint(
        {
          total_sales: TICKET_A_SALE + TICKET_B_SALE + TICKET_W_SALE,
          total_commission:
            TICKET_A_COMMISSION + TICKET_B_COMMISSION + TICKET_W_COMMISSION,
          total_tickets: 3,
          total_prizes: TICKET_W_PRIZE,
        },
        checkpointRepo,
      );

      seedTicket(db, txnRepo, {
        saleAmount: TICKET_A_SALE,
        commissionAmount: TICKET_A_COMMISSION,
        checkpointId,
      });
      seedTicket(db, txnRepo, {
        saleAmount: TICKET_B_SALE,
        commissionAmount: TICKET_B_COMMISSION,
        checkpointId,
      });
      const { txnId: txnW } = seedTicket(db, txnRepo, {
        saleAmount: TICKET_W_SALE,
        commissionAmount: TICKET_W_COMMISSION,
        checkpointId,
        isWinner: true,
        prizeAmount: TICKET_W_PRIZE,
      });

      txnRepo.refundTransaction(txnW, 1);

      const adjusted = checkpointRow(db, checkpointId);
      expect(adjusted.total_sales).toBeCloseTo(
        TICKET_A_SALE + TICKET_B_SALE,
        4,
      );
      expect(adjusted.total_commission).toBeCloseTo(
        TICKET_A_COMMISSION + TICKET_B_COMMISSION,
        4,
      );
      expect(adjusted.total_tickets).toBe(2);
      // The refunded ticket's OWN prize is removed from the frozen total.
      expect(adjusted.total_prizes).toBeCloseTo(0, 4);

      checkpointRepo.settleCheckpoint(
        checkpointId,
        adjusted.total_sales,
        adjusted.total_commission,
        adjusted.total_prizes,
        0,
        "2026-07-25T12:00:00.000Z",
        1,
      );

      expect(ledgerSumLbp(db, supplierId)).toBeCloseTo(0, 4);
    });

    it("NEGATIVE CONTROL: settling with the STALE pre-refund totals leaves a non-zero balance equal to the refunded ticket's own (sale − commission)", () => {
      const checkpointRepo = new LotoCheckpointRepository(db);
      const supplierId = lotoSupplierId(db);

      const TICKET_A_SALE = 100_000;
      const TICKET_A_COMMISSION = 4_450;
      const TICKET_B_SALE = 50_000;
      const TICKET_B_COMMISSION = 2_225;
      const TICKET_C_SALE = 30_000;
      const TICKET_C_COMMISSION = 1_335;

      const staleTotalSales = TICKET_A_SALE + TICKET_B_SALE + TICKET_C_SALE; // 180,000
      const staleTotalCommission =
        TICKET_A_COMMISSION + TICKET_B_COMMISSION + TICKET_C_COMMISSION; // 8,010

      const checkpointId = seedOpenCheckpoint(
        {
          total_sales: staleTotalSales,
          total_commission: staleTotalCommission,
          total_tickets: 3,
          total_prizes: 0,
        },
        checkpointRepo,
      );

      seedTicket(db, txnRepo, {
        saleAmount: TICKET_A_SALE,
        commissionAmount: TICKET_A_COMMISSION,
        checkpointId,
      });
      seedTicket(db, txnRepo, {
        saleAmount: TICKET_B_SALE,
        commissionAmount: TICKET_B_COMMISSION,
        checkpointId,
      });
      const { txnId: txnC } = seedTicket(db, txnRepo, {
        saleAmount: TICKET_C_SALE,
        commissionAmount: TICKET_C_COMMISSION,
        checkpointId,
      });

      // Refund C — the checkpoint DOES delta-adjust (this repo's own fix is
      // intact and untouched by this test); we simply choose, on purpose, to
      // settle with the ORIGINAL pre-refund totals instead of re-reading
      // them, to prove such a caller mistake is NOT silently absorbed.
      txnRepo.refundTransaction(txnC, 1);

      checkpointRepo.settleCheckpoint(
        checkpointId,
        staleTotalSales, // WRONG: still includes refunded ticket C
        staleTotalCommission, // WRONG: still includes refunded ticket C
        0,
        0,
        "2026-07-25T12:00:00.000Z",
        1,
      );

      const finalBalance = ledgerSumLbp(db, supplierId);
      const refundedTicketOwed = TICKET_C_SALE - TICKET_C_COMMISSION; // 28,665

      // Must NOT be zero...
      expect(finalBalance).not.toBeCloseTo(0, 4);
      // ...and the miss is exactly the refunded ticket's own (sale −
      // commission) contribution, left stranded by the stale totals.
      expect(finalBalance).toBeCloseTo(-refundedTicketOwed, 4);
    });
  });

  // ── Case 4: CUSTOMER_ACCOUNT ('Loto Debt') still cancelled generically ──

  it("a ticket charged to CUSTOMER_ACCOUNT ('Loto Debt'): the debt is cancelled too (generic _cancelDebt still fires)", () => {
    const { txnId } = seedTicket(db, txnRepo, {
      saleAmount: 40_000,
      commissionAmount: 1_780,
    });
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
       VALUES (1, 'Loto Debt', 0, 40000, ?, 1)`,
    ).run(txnId);

    txnRepo.voidTransaction(txnId, 1);

    const debtSum = db
      .prepare(
        `SELECT COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger WHERE client_id = 1`,
      )
      .get() as { lbp: number };
    expect(debtSum.lbp).toBeCloseTo(0, 4);
  });

  // ── Case 5: FOR_PARTNER ticket — partner_ledger nets to 0 ────────────────

  it("a FOR_PARTNER ticket: partner_ledger nets to 0 (generic _reversePartnerLedger still fires)", () => {
    const { ticketId, txnId } = seedTicket(db, txnRepo, {
      saleAmount: 60_000,
      commissionAmount: 2_670,
    });
    db.prepare(
      `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction)
       VALUES (1, 'FOR_LOTO', 'loto_tickets', ?, 60000, 'LBP', 'CREDIT')`,
    ).run(ticketId);

    txnRepo.voidTransaction(txnId, 1);

    const partnerSum = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS net
         FROM partner_ledger WHERE partner_id = 1`,
      )
      .get() as { net: number };
    expect(partnerSum.net).toBeCloseTo(0, 4);
  });

  // ── Case 6: LOTO_CASH_PRIZE stays refused (out of scope, unchanged) ──────

  it("LOTO_CASH_PRIZE is STILL refused — unrelated to this fix, unchanged", () => {
    const txnId = txnRepo.createTransaction({
      type: "LOTO_CASH_PRIZE",
      source_table: "loto_cash_prizes",
      source_id: 1,
      user_id: 1,
      amount_usd: 0,
      amount_lbp: 10_000,
      summary: "Cash prize payout",
      metadata_json: {},
    });

    expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
      /cannot be voided or refunded/i,
    );
    expect(() => txnRepo.refundTransaction(txnId, 1)).toThrow(
      /cannot be voided or refunded/i,
    );
  });
});
