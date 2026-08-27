/**
 * LIRA-145 — recording CONSUMPTION of a shop carrier line's credits as an
 * expense (`CarrierLineRepository.recordUsage`).
 *
 * The flow's money contract, in one line: the credits leave the carrier's own
 * credit drawer at face value ($1/credit, USD), NOT the cash till, and the
 * line's `credits` column moves by the same number in the same db
 * transaction — which is exactly what keeps §0.1's invariant
 * `drawer_balances[CARRIER_DRAWER_NAMES[c]].USD == getCarrierCreditsSum(c)`
 * true across the write.
 *
 * Covered here:
 *  (a) happy path — the four rows (`expenses`, unified EXPENSE transaction,
 *      ONE payment leg + drawer delta, `carrier_line_movements`), their exact
 *      field values, and the sum invariant.
 *  (b) rule 20 — create + generic void nets to 0 across EVERY ledger the flow
 *      touches, per currency: line credits, carrier drawer USD/LBP,
 *      transactions, and the active-expense totals the profit page reads.
 *      The netting hinges on the movement row carrying the expense's
 *      `transaction_id`; proven failing-first by passing `transactionId: null`
 *      into `applyMovement` (see this phase's report for the captured output).
 *  (c) every server-side rejection in the contract, each proven atomic — a
 *      rejected call leaves no expense, no transaction, no leg, no movement,
 *      and an untouched drawer.
 *  (d) tenant scoping — every row written carries the active tenant, and a
 *      line belonging to tenant 1 is invisible to tenant 2.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
  CARRIER_DRAWER_NAMES,
  LINE_USAGE_EXPENSE_CATEGORY,
  LINE_USAGE_PAID_BY_METHOD,
  LINE_USAGE_MOVEMENT_REASON,
} from "../CarrierLineRepository.js";
import {
  CarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "../CarrierLineMovementRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetExpenseRepository } from "../ExpenseRepository.js";
import { ProfitRepository } from "../ProfitRepository.js";
import { CarrierLineService } from "../../services/CarrierLineService.js";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext.js";

const USER_ID = 7;
const FUTURE_EXPIRY = "2099-01-01";
/** Wide enough that the local-vs-UTC conversion inside `getExpenseTotals`
 *  can never push today's row out of range. */
const RANGE_FROM = "2000-01-01 00:00:00";
const RANGE_TO = "2999-12-31 23:59:59";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE expenses (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER,
      description    TEXT,
      category       TEXT,
      expense_type   TEXT,
      amount_usd     REAL,
      amount_lbp     REAL,
      paid_by_method TEXT DEFAULT 'CASH',
      status         TEXT NOT NULL DEFAULT 'active',
      expense_date   TEXT DEFAULT CURRENT_TIMESTAMP,
      note           TEXT DEFAULT NULL,
      edited_by      TEXT DEFAULT NULL,
      edited_at      TEXT DEFAULT NULL,
      is_refunded    INTEGER DEFAULT 0,
      refunded_at    TEXT DEFAULT NULL,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Minimal tables joined by TransactionRepository.getRecent (LIRA-064
    -- structured payment legs) — the actual read path the Transactions
    -- viewer uses, per lira-145's e2e assertion that a line-usage expense
    -- renders NO customer-facing payment legs.
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL,
      tenant_id INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE clients (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      tenant_id INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER,
      transaction_type       TEXT,
      transaction_id         INTEGER,
      unified_transaction_id INTEGER,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

interface ExpenseRow {
  id: number;
  tenant_id: number;
  description: string;
  category: string;
  amount_usd: number;
  amount_lbp: number;
  paid_by_method: string;
  status: string;
  is_refunded: number;
}

interface PaymentRow {
  id: number;
  transaction_id: number;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
  created_by: number | null;
  tenant_id: number;
}

interface MovementRow {
  id: number;
  tenant_id: number;
  carrier_line_id: number;
  transaction_id: number | null;
  credits_delta: number;
  validity_days_delta: number;
  reason: string;
  is_reversed: number;
}

interface TxnRow {
  id: number;
  type: string;
  status: string;
  source_table: string | null;
  source_id: number | null;
  user_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  metadata_json: string | null;
  tenant_id: number;
}

describe("CarrierLineRepository.recordUsage (LIRA-145)", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;
  let txnRepo: TransactionRepository;
  let service: CarrierLineService;

  // ---------------------------------------------------------------------------
  // Query helpers — every one reads a REAL production row, never a
  // reconstruction of what the code was supposed to write.
  // ---------------------------------------------------------------------------

  const drawer = (name: string, currency: string, tenantId = 1): number => {
    const row = db
      .prepare(
        `SELECT balance FROM drawer_balances
         WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
      )
      .get(name, currency, tenantId) as { balance: number } | undefined;
    return row?.balance ?? 0;
  };

  const expenseById = (id: number): ExpenseRow | undefined =>
    db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as
      | ExpenseRow
      | undefined;

  const txnById = (id: number): TxnRow | undefined =>
    db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as
      | TxnRow
      | undefined;

  const legsFor = (txnId: number): PaymentRow[] =>
    db
      .prepare(`SELECT * FROM payments WHERE transaction_id = ? ORDER BY id`)
      .all(txnId) as PaymentRow[];

  const movementsFor = (txnId: number): MovementRow[] =>
    db
      .prepare(
        `SELECT * FROM carrier_line_movements WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnId) as MovementRow[];

  const rowCount = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  /** The active-expense totals the profit page actually reads. */
  const activeExpenseTotals = (): { total_usd: number; total_lbp: number } => {
    const t = new ProfitRepository().getExpenseTotals(RANGE_FROM, RANGE_TO);
    return { total_usd: t.total_usd, total_lbp: t.total_lbp };
  };

  /**
   * Two active MTC lines whose credits sum to the seeded MTC drawer balance —
   * so the §0.1 sum invariant starts TRUE and every assertion about it after
   * the write is meaningful. The second line also proves the flow debits the
   * carrier's shared drawer, not a per-line one.
   */
  function seedMtcShop(): { primary: number; other: number } {
    const primary = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      label: "Counter SIM",
      credits: 100,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const other = repo.createLine({
      carrier: "mtc",
      phone_number: "03222222",
      credits: 25,
    });
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'MTC', 'USD', 125)`,
    ).run();
    return { primary: primary.id, other: other.id };
  }

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
    resetExpenseRepository();
    repo = new CarrierLineRepository();
    movementRepo = new CarrierLineMovementRepository();
    txnRepo = new TransactionRepository();
    service = new CarrierLineService(repo, movementRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
    resetExpenseRepository();
    resetTenantContext();
  });

  // ===========================================================================
  // (a) Happy path
  // ===========================================================================

  describe("happy path", () => {
    it("writes the expense, the EXPENSE transaction, ONE carrier-drawer leg and the movement — and leaves the line on exactly newCredits", () => {
      const { primary } = seedMtcShop();

      const result = repo.recordUsage(
        {
          carrierLineId: primary,
          newCredits: 62.5,
          expectedCurrentCredits: 100,
          note: "Sent 10 top-ups",
        },
        USER_ID,
      );

      expect(result.creditsUsed).toBeCloseTo(37.5, 2);
      expect(result.newCredits).toBeCloseTo(62.5, 2);

      // 1. expenses row
      const expense = expenseById(result.expenseId)!;
      expect(expense).toBeDefined();
      expect(expense.category).toBe(LINE_USAGE_EXPENSE_CATEGORY);
      expect(expense.paid_by_method).toBe(LINE_USAGE_PAID_BY_METHOD);
      expect(expense.amount_usd).toBeCloseTo(37.5, 2);
      expect(expense.amount_lbp).toBe(0);
      expect(expense.status).toBe("active");
      expect(expense.is_refunded).toBe(0);
      expect(expense.description).toBe(
        "Line usage: MTC 03111111 (Counter SIM) — Sent 10 top-ups",
      );

      // 2. unified transaction row
      const txn = txnById(result.transactionId)!;
      expect(txn.type).toBe("EXPENSE");
      expect(txn.status).toBe("ACTIVE");
      expect(txn.source_table).toBe("expenses");
      expect(txn.source_id).toBe(result.expenseId);
      expect(txn.user_id).toBe(USER_ID);
      expect(txn.amount_usd).toBeCloseTo(-37.5, 2);
      expect(txn.amount_lbp).toBe(0);
      expect(txn.profit_usd).toBe(0);
      expect(txn.profit_lbp).toBe(0);
      expect(txn.client_id).toBeNull();
      const meta = JSON.parse(txn.metadata_json!) as Record<string, unknown>;
      expect(meta.carrier_line_id).toBe(primary);
      expect(meta.carrier).toBe("mtc");
      expect(meta.credits_before).toBeCloseTo(100, 2);
      expect(meta.credits_after).toBeCloseTo(62.5, 2);
      // The canonical expense keys survive the extra_metadata merge.
      expect(meta.category).toBe(LINE_USAGE_EXPENSE_CATEGORY);
      expect(meta.paid_by).toBe(LINE_USAGE_PAID_BY_METHOD);

      // 3. EXACTLY ONE payment leg, on the carrier credit drawer, in USD
      const legs = legsFor(result.transactionId);
      expect(legs).toHaveLength(1);
      expect(legs[0]!.drawer_name).toBe(CARRIER_DRAWER_NAMES.mtc);
      expect(legs[0]!.currency_code).toBe("USD");
      expect(legs[0]!.amount).toBeCloseTo(-37.5, 2);
      expect(legs[0]!.method).toBe(LINE_USAGE_PAID_BY_METHOD);
      expect(legs[0]!.created_by).toBe(USER_ID);

      // ...and the drawer moved by exactly that, with NO cash drawer touched.
      expect(drawer("MTC", "USD")).toBeCloseTo(87.5, 2);
      expect(drawer("General", "USD")).toBe(0);
      expect(drawer("General", "LBP")).toBe(0);
      expect(drawer("MTC", "LBP")).toBe(0);

      // 4. movement row, linked to the expense's transaction
      const movements = movementsFor(result.transactionId);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.carrier_line_id).toBe(primary);
      expect(movements[0]!.credits_delta).toBeCloseTo(-37.5, 2);
      expect(movements[0]!.validity_days_delta).toBe(0);
      expect(movements[0]!.reason).toBe(LINE_USAGE_MOVEMENT_REASON);
      expect(movements[0]!.is_reversed).toBe(0);

      // The line lands exactly on the counted balance; validity untouched.
      const line = repo.getById(primary)!;
      expect(line.credits).toBeCloseTo(62.5, 2);
      expect(line.validity_expires_at).toBe(FUTURE_EXPIRY);

      // §0.1 invariant holds across the write (drawer 87.5 == 62.5 + 25).
      expect(drawer("MTC", "USD")).toBeCloseTo(
        repo.getCarrierCreditsSum("mtc"),
        2,
      );

      // No counterparty obligation changed — prepaid-units model.
      expect(rowCount("debt_ledger")).toBe(0);
    });

    it("does not surface the LINE_CREDIT leg as customer-facing cash — the Transactions viewer must show NO payment legs for a line-usage expense (lira-145 e2e)", () => {
      const { primary } = seedMtcShop();

      const result = repo.recordUsage(
        { carrierLineId: primary, newCredits: 62.5, note: "Sent 10 top-ups" },
        USER_ID,
      );

      // Same read path the Transactions viewer uses (LIRA-064 structured
      // payment legs) — NOT a re-derivation of the filter here.
      const row = txnRepo
        .getRecent(50)
        .find((r) => r.id === result.transactionId);
      expect(row).toBeTruthy();
      expect(row!.payments).toEqual([]);

      // The internal-leg filter is a READ/display concern only — void must
      // still restore the carrier drawer from the raw (unfiltered) leg.
      txnRepo.voidTransaction(result.transactionId, USER_ID);
      expect(drawer("MTC", "USD")).toBeCloseTo(125, 2);
      expect(repo.getById(primary)!.credits).toBeCloseTo(100, 2);
    });

    it("omits the label and the note from the description when the line has no label and no note was given", () => {
      const line = repo.createLine({
        carrier: "alfa",
        phone_number: "03999999",
        credits: 40,
      });

      const result = repo.recordUsage(
        { carrierLineId: line.id, newCredits: 30 },
        USER_ID,
      );

      expect(expenseById(result.expenseId)!.description).toBe(
        "Line usage: ALFA 03999999",
      );
      // Alfa lines debit the Alfa drawer, never MTC's.
      expect(legsFor(result.transactionId)[0]!.drawer_name).toBe(
        CARRIER_DRAWER_NAMES.alfa,
      );
      expect(drawer("Alfa", "USD")).toBeCloseTo(-10, 2);
      expect(drawer("MTC", "USD")).toBe(0);
    });

    it("snaps a sub-cent input to cents on entry and preserves the drawer==credits-sum invariant EXACTLY", () => {
      const line = repo.createLine({
        carrier: "mtc",
        phone_number: "03333333",
        credits: 1.5,
      });

      // Snapshot the OFFSET between the carrier drawer and the credits sum
      // (not the absolute values — this line's drawer wasn't seeded to
      // match) so the assertion below proves the write moved both sides by
      // the exact same number, which is the actual invariant this method
      // must preserve.
      const offsetBefore =
        drawer("MTC", "USD") - repo.getCarrierCreditsSum("mtc");

      const result = repo.recordUsage(
        { carrierLineId: line.id, newCredits: 1.375 },
        USER_ID,
      );

      // The operator's typed 1.375 is snapped to cents ON ENTRY:
      // round2(1.375) === 1.38 (verified: 1.375 * 100 === 137.5 exactly in
      // IEEE-754 double, and Math.round(137.5) === 138). The delta is then
      // rounded ONCE from that: round2(1.5 - 1.38) === 0.12. One rounding,
      // one number, shared by the expense, the drawer leg and the movement
      // — no half-cent drift between them.
      expect(result.newCredits).toBe(1.38);
      expect(result.creditsUsed).toBe(0.12);
      expect(expenseById(result.expenseId)!.amount_usd).toBe(0.12);
      expect(repo.getById(line.id)!.credits).toBe(1.38);
      expect(movementsFor(result.transactionId)[0]!.credits_delta).toBe(-0.12);

      // The point of the test: the drawer moved by EXACTLY minus the line's
      // credits delta, so the offset is unchanged to the bit — no
      // `toBeCloseTo` tolerance hiding a residual sub-cent drift.
      const offsetAfter =
        drawer("MTC", "USD") - repo.getCarrierCreditsSum("mtc");
      expect(offsetAfter - offsetBefore).toBe(0);
    });

    it("service.recordUsage wraps the same write in the { success, data } envelope", () => {
      const { primary } = seedMtcShop();

      const res = service.recordUsage(
        { carrierLineId: primary, newCredits: 90 },
        USER_ID,
      );

      expect(res.success).toBe(true);
      expect(res.error).toBeUndefined();
      expect(res.data!.creditsUsed).toBeCloseTo(10, 2);
      expect(res.data!.newCredits).toBe(90);
      expect(res.data!.expenseId).toBeGreaterThan(0);
      expect(res.data!.transactionId).toBeGreaterThan(0);
      expect(repo.getById(primary)!.credits).toBeCloseTo(90, 2);
    });
  });

  // ===========================================================================
  // (b) Rule 20 — create + void nets to 0 across every ledger, per currency
  // ===========================================================================

  describe("void nets every ledger to zero (rule 20)", () => {
    it("restores the line, the carrier drawer, the movement flag and the active-expense totals", () => {
      const { primary } = seedMtcShop();

      const baseline = {
        lineCredits: repo.getById(primary)!.credits,
        drawerUsd: drawer("MTC", "USD"),
        drawerLbp: drawer("MTC", "LBP"),
        expenses: activeExpenseTotals(),
        creditsSum: repo.getCarrierCreditsSum("mtc"),
      };
      expect(baseline.expenses.total_usd).toBe(0);

      const result = repo.recordUsage(
        { carrierLineId: primary, newCredits: 62.5, note: "burned on tests" },
        USER_ID,
      );

      // Everything actually moved before the void — otherwise "nets to 0" is
      // vacuously true.
      expect(repo.getById(primary)!.credits).toBeCloseTo(62.5, 2);
      expect(drawer("MTC", "USD")).toBeCloseTo(87.5, 2);
      expect(activeExpenseTotals().total_usd).toBeCloseTo(37.5, 2);

      txnRepo.voidTransaction(result.transactionId, USER_ID);

      // --- per-currency netting -------------------------------------------
      expect(repo.getById(primary)!.credits).toBeCloseTo(
        baseline.lineCredits,
        2,
      );
      expect(drawer("MTC", "USD")).toBeCloseTo(baseline.drawerUsd, 2);
      expect(drawer("MTC", "LBP")).toBeCloseTo(baseline.drawerLbp, 2);
      expect(drawer("General", "USD")).toBe(0);
      expect(drawer("General", "LBP")).toBe(0);
      expect(repo.getCarrierCreditsSum("mtc")).toBeCloseTo(
        baseline.creditsSum,
        2,
      );
      // The invariant survives the reversal, not just the write.
      expect(drawer("MTC", "USD")).toBeCloseTo(
        repo.getCarrierCreditsSum("mtc"),
        2,
      );

      // The expense is out of the active totals AND flagged on its own row.
      expect(activeExpenseTotals().total_usd).toBeCloseTo(
        baseline.expenses.total_usd,
        2,
      );
      expect(activeExpenseTotals().total_lbp).toBeCloseTo(
        baseline.expenses.total_lbp,
        2,
      );
      expect(expenseById(result.expenseId)!.is_refunded).toBe(1);

      // The movement is marked reversed exactly once.
      const movements = movementsFor(result.transactionId);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.is_reversed).toBe(1);

      // Payment legs for the original + its reversal cancel out.
      const legSum = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) AS s FROM payments
             WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
          )
          .get() as { s: number }
      ).s;
      expect(legSum).toBeCloseTo(0, 2);

      // Transaction amounts for this expense net to 0 (original + VOID row).
      const txnSum = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS s FROM transactions
             WHERE source_table = 'expenses' AND source_id = ?`,
          )
          .get(result.expenseId) as { s: number }
      ).s;
      expect(txnSum).toBeCloseTo(0, 2);
      expect(txnById(result.transactionId)!.status).toBe("VOIDED");

      // Δ(owed to any counterparty) === 0 — no ledger row was ever written.
      expect(rowCount("debt_ledger")).toBe(0);
    });

    it("a second void attempt is refused and does not double-restore the line or the drawer", () => {
      const { primary } = seedMtcShop();
      const result = repo.recordUsage(
        { carrierLineId: primary, newCredits: 80 },
        USER_ID,
      );

      txnRepo.voidTransaction(result.transactionId, USER_ID);
      const afterFirst = {
        credits: repo.getById(primary)!.credits,
        drawerUsd: drawer("MTC", "USD"),
      };

      expect(() =>
        txnRepo.voidTransaction(result.transactionId, USER_ID),
      ).toThrow(/already voided/i);

      expect(repo.getById(primary)!.credits).toBeCloseTo(afterFirst.credits, 2);
      expect(drawer("MTC", "USD")).toBeCloseTo(afterFirst.drawerUsd, 2);
      expect(movementsFor(result.transactionId)[0]!.is_reversed).toBe(1);
    });
  });

  // ===========================================================================
  // (c) Rejections — every one atomic
  // ===========================================================================

  describe("rejections", () => {
    /** Nothing at all was written by the rejected call. */
    function expectNothingWritten(drawerBefore: number): void {
      expect(rowCount("expenses")).toBe(0);
      expect(rowCount("transactions")).toBe(0);
      expect(rowCount("payments")).toBe(0);
      expect(rowCount("carrier_line_movements")).toBe(0);
      expect(drawer("MTC", "USD")).toBeCloseTo(drawerBefore, 2);
    }

    it("rejects an unknown line", () => {
      seedMtcShop();
      expect(() =>
        repo.recordUsage({ carrierLineId: 99_999, newCredits: 1 }, USER_ID),
      ).toThrow(/#99999 not found/i);
      expectNothingWritten(125);
    });

    it("rejects an archived (inactive) line", () => {
      const { primary } = seedMtcShop();
      repo.archive(primary);

      expect(() =>
        repo.recordUsage({ carrierLineId: primary, newCredits: 50 }, USER_ID),
      ).toThrow(/archived/i);
      expectNothingWritten(125);
      expect(repo.getById(primary)!.credits).toBeCloseTo(100, 2);
    });

    it("rejects a stale expectedCurrentCredits (optimistic-concurrency guard)", () => {
      const { primary } = seedMtcShop();

      expect(() =>
        repo.recordUsage(
          {
            carrierLineId: primary,
            newCredits: 50,
            expectedCurrentCredits: 90,
          },
          USER_ID,
        ),
      ).toThrow(/balance changed/i);
      expectNothingWritten(125);
      expect(repo.getById(primary)!.credits).toBeCloseTo(100, 2);
    });

    it("accepts a matching expectedCurrentCredits within the sub-cent tolerance", () => {
      const { primary } = seedMtcShop();

      const result = repo.recordUsage(
        {
          carrierLineId: primary,
          newCredits: 50,
          expectedCurrentCredits: 100.001,
        },
        USER_ID,
      );
      expect(result.creditsUsed).toBeCloseTo(50, 2);
    });

    it("rejects newCredits equal to the current balance (nothing was used)", () => {
      const { primary } = seedMtcShop();
      expect(() =>
        repo.recordUsage({ carrierLineId: primary, newCredits: 100 }, USER_ID),
      ).toThrow(/must be below/i);
      expectNothingWritten(125);
    });

    it("rejects newCredits ABOVE the current balance (a top-up is not a usage)", () => {
      const { primary } = seedMtcShop();
      expect(() =>
        repo.recordUsage({ carrierLineId: primary, newCredits: 140 }, USER_ID),
      ).toThrow(/must be below/i);
      expectNothingWritten(125);
    });

    it("rejects a sub-cent delta", () => {
      const { primary } = seedMtcShop();
      expect(() =>
        repo.recordUsage(
          { carrierLineId: primary, newCredits: 99.995 },
          USER_ID,
        ),
      ).toThrow(/must be below/i);
      expectNothingWritten(125);
    });

    it("service.recordUsage turns every rejection into { success: false, error }", () => {
      const { primary } = seedMtcShop();

      const res = service.recordUsage(
        { carrierLineId: primary, newCredits: 100 },
        USER_ID,
      );
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatch(/must be below/i);
      expectNothingWritten(125);
    });
  });

  // ===========================================================================
  // (d) Tenant scoping
  // ===========================================================================

  describe("tenant scoping", () => {
    it("stamps the active tenant on every row it writes", () => {
      const { primary } = seedMtcShop();

      const result = repo.recordUsage(
        { carrierLineId: primary, newCredits: 62.5 },
        USER_ID,
      );

      expect(expenseById(result.expenseId)!.tenant_id).toBe(1);
      expect(txnById(result.transactionId)!.tenant_id).toBe(1);
      expect(legsFor(result.transactionId)[0]!.tenant_id).toBe(1);
      expect(movementsFor(result.transactionId)[0]!.tenant_id).toBe(1);
      const drawerRow = db
        .prepare(
          `SELECT tenant_id FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
        )
        .get() as { tenant_id: number };
      expect(drawerRow.tenant_id).toBe(1);
    });

    it("cannot record usage against another tenant's line, and writes nothing when it tries", () => {
      const { primary } = seedMtcShop();

      runWithTenant(2, () => {
        expect(() =>
          repo.recordUsage({ carrierLineId: primary, newCredits: 50 }, USER_ID),
        ).toThrow(/not found/i);
      });

      expect(rowCount("expenses")).toBe(0);
      expect(rowCount("transactions")).toBe(0);
      expect(rowCount("payments")).toBe(0);
      expect(rowCount("carrier_line_movements")).toBe(0);
      expect(repo.getById(primary)!.credits).toBeCloseTo(100, 2);
      expect(drawer("MTC", "USD")).toBeCloseTo(125, 2);
    });

    it("writes tenant 2's rows under tenant 2 and leaves tenant 1's drawer alone", () => {
      seedMtcShop();

      const result = runWithTenant(2, () => {
        const line = repo.createLine({
          carrier: "mtc",
          phone_number: "03444444",
          credits: 60,
        });
        return repo.recordUsage(
          { carrierLineId: line.id, newCredits: 20 },
          USER_ID,
        );
      });

      expect(drawer("MTC", "USD", 2)).toBeCloseTo(-40, 2);
      expect(drawer("MTC", "USD", 1)).toBeCloseTo(125, 2);
      expect(expenseById(result.expenseId)!.tenant_id).toBe(2);
      expect(txnById(result.transactionId)!.tenant_id).toBe(2);
      expect(legsFor(result.transactionId)[0]!.tenant_id).toBe(2);
      expect(movementsFor(result.transactionId)[0]!.tenant_id).toBe(2);
    });
  });
});
