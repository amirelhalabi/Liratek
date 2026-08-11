/**
 * LIRA-090 §8 — TransactionRepository is the rule-20 reversal owner for
 * `carrier_line_movements`.
 *
 * `carrier_lines` has no `is_refunded` column and is absent from
 * `_markSourceRefunded`'s whitelist, so a naive void/refund would leave the
 * shop's carrier line permanently decremented/extended after a void. This
 * file proves `_reverseCarrierLineMovements` closes that hole:
 *
 *  - VOID and REFUND both reverse every ledger a self-charge-shaped
 *    transaction touches: drawer LBP (iPick, item cost), drawer USD (MTC,
 *    credit in), carrier line credits, AND carrier line validity — all the
 *    way back to the pre-mutation baseline (exactly 0 net change).
 *  - The movement row is flipped to `is_reversed = 1`.
 *  - A double-void (blocked by TransactionRepository's own existing
 *    "already voided" guard) leaves the carrier line and the movement row
 *    untouched a second time — no double-restore.
 *  - A direct, white-box double-invocation of the reversal method itself
 *    (bypassing the outer guard entirely) ALSO does not double-restore —
 *    proving the `is_reversed = 0` predicate is its own independent guard,
 *    not just inheriting safety from the caller.
 *
 * Per CLAUDE.md rule 17, the core "nets to 0" proof was run against the
 * pre-fix code (the two `_reverseCarrierLineMovements(original)` call sites
 * commented out) and observed to FAIL before being restored — see this
 * phase's final report for the captured failing-then-green output.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
  type TransactionEntity,
} from "../TransactionRepository.js";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import {
  CarrierLineMovementRepository,
  resetCarrierLineMovementRepository,
} from "../CarrierLineMovementRepository.js";
import { CarrierLineService } from "../../services/CarrierLineService.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const FUTURE_EXPIRY = "2099-01-01"; // far enough out that it is never "already expired"

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
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      is_refunded  INTEGER DEFAULT 0,
      refunded_at  TEXT,
      settlement_id INTEGER,
      tenant_id    INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO financial_services (id) VALUES (1);

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
  `);
  return db;
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("TransactionRepository — carrier_line_movements reversal (LIRA-090 §8, rule 20)", () => {
  let db: Database.Database;
  let repo: TransactionRepository;
  let lineRepo: CarrierLineRepository;
  let movementRepo: CarrierLineMovementRepository;
  let service: CarrierLineService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    repo = new TransactionRepository();
    lineRepo = new CarrierLineRepository();
    movementRepo = new CarrierLineMovementRepository();
    service = new CarrierLineService(lineRepo, movementRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTenantContext();
  });

  /**
   * Seeds a self-charge-shaped transaction (spec §5.2): cost leaves the
   * iPick drawer in LBP, full-face credit + validity land on the MTC drawer
   * (USD) AND the target carrier_lines row, via a REAL
   * `CarrierLineService.applyMovement` call tied to the transaction's id —
   * exactly the contract Phase 4's money path must honor.
   */
  function seedSelfChargeTransaction(lineId: number): number {
    const txnId = repo.createTransaction({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      source_id: 1,
      user_id: 1,
      amount_usd: 0,
      amount_lbp: 0,
      exchange_rate: 90_000,
      summary: "Self-charge: MTC 77$ cart",
      metadata_json: { flow: "SELF_CHARGE" },
    });

    // Item cost out — iPick drawer, LBP.
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'CASH', 'iPick', 'LBP', ?)`,
    ).run(txnId, -7_600_000);
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'iPick', 'LBP', ?)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = balance + excluded.balance`,
    ).run(-7_600_000);

    // Credit in — MTC drawer, USD.
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'MTC', 'MTC', 'USD', ?)`,
    ).run(txnId, 77);
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'MTC', 'USD', ?)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = balance + excluded.balance`,
    ).run(77);

    // Carrier line: full-face credit + validity days, tied to this transaction.
    const applied = service.applyMovement({
      carrierLineId: lineId,
      creditsDelta: 77,
      validityDaysDelta: 30,
      reason: "SELF_CHARGE",
      transactionId: txnId,
    });
    if (!applied.success) {
      throw new Error(`seed failed: ${applied.error}`);
    }

    return txnId;
  }

  it("VOID nets every ledger back to 0: iPick LBP, MTC USD, carrier line credits, AND carrier line validity", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 20,
      validity_expires_at: FUTURE_EXPIRY,
    });

    const txnId = seedSelfChargeTransaction(line.id);

    // Confirm the seed actually moved every ledger before voiding.
    expect(drawer(db, "iPick", "LBP")).toBeCloseTo(-7_600_000, 2);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(77, 2);
    const afterSeed = lineRepo.getById(line.id)!;
    expect(afterSeed.credits).toBeCloseTo(97, 2); // 20 + 77
    expect(afterSeed.validity_expires_at).not.toBe(FUTURE_EXPIRY); // extended by 30 days

    repo.voidTransaction(txnId, 1);

    // Drawers net to 0 (payments-leg reversal — pre-existing mechanism).
    expect(drawer(db, "iPick", "LBP")).toBeCloseTo(0, 2);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(0, 2);

    // Carrier line nets EXACTLY back to its pre-mutation baseline — the
    // rule-20 reversal this phase adds.
    const afterVoid = lineRepo.getById(line.id)!;
    expect(afterVoid.credits).toBeCloseTo(20, 2);
    expect(afterVoid.validity_expires_at).toBe(FUTURE_EXPIRY);

    // The movement itself is marked reversed.
    const movements = movementRepo.getByTransactionId(txnId);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.is_reversed).toBe(1);
  });

  it("REFUND nets every ledger back to 0 the same way", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 5,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const txnId = seedSelfChargeTransaction(line.id);

    repo.refundTransaction(txnId, 1);

    expect(drawer(db, "iPick", "LBP")).toBeCloseTo(0, 2);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(0, 2);
    const afterRefund = lineRepo.getById(line.id)!;
    expect(afterRefund.credits).toBeCloseTo(5, 2);
    expect(afterRefund.validity_expires_at).toBe(FUTURE_EXPIRY);
    expect(movementRepo.getByTransactionId(txnId)[0]!.is_reversed).toBe(1);
  });

  it("double-void does not double-restore: the second void throws, and the carrier line / movement are untouched a second time", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const txnId = seedSelfChargeTransaction(line.id);

    repo.voidTransaction(txnId, 1);
    const afterFirstVoid = lineRepo.getById(line.id)!;
    expect(afterFirstVoid.credits).toBeCloseTo(10, 2);
    expect(afterFirstVoid.validity_expires_at).toBe(FUTURE_EXPIRY);

    expect(() => repo.voidTransaction(txnId, 1)).toThrow(/already voided/i);

    // State after the REJECTED second attempt is byte-identical to after
    // the first void — no double-restore snuck in before the throw.
    const afterSecondAttempt = lineRepo.getById(line.id)!;
    expect(afterSecondAttempt.credits).toBeCloseTo(10, 2);
    expect(afterSecondAttempt.validity_expires_at).toBe(FUTURE_EXPIRY);

    const movements = movementRepo.getByTransactionId(txnId);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.is_reversed).toBe(1);
  });

  it("white-box: invoking the reversal method itself twice (bypassing the outer void/refund guard) still does not double-restore — the is_reversed=0 predicate is its own independent guard", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 30,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const txnId = seedSelfChargeTransaction(line.id);
    const original = repo.findById(txnId) as TransactionEntity;

    const reverseFn = (
      repo as unknown as {
        _reverseCarrierLineMovements: (o: TransactionEntity) => void;
      }
    )._reverseCarrierLineMovements.bind(repo);

    reverseFn(original);
    const afterFirst = lineRepo.getById(line.id)!;
    expect(afterFirst.credits).toBeCloseTo(30, 2); // 30 + 77 - 77
    expect(afterFirst.validity_expires_at).toBe(FUTURE_EXPIRY);

    // Calling it again directly must be a no-op — the movement is already
    // is_reversed=1, so the SELECT ... WHERE is_reversed = 0 predicate
    // excludes it before any second subtraction happens.
    reverseFn(original);
    const afterSecond = lineRepo.getById(line.id)!;
    expect(afterSecond.credits).toBeCloseTo(30, 2);
    expect(afterSecond.validity_expires_at).toBe(FUTURE_EXPIRY);
  });

  it("a movement with NO transaction_id (a manual, non-transactional adjustment) is invisible to void/refund reversal — nothing to reverse it FROM", () => {
    const line = lineRepo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
      validity_expires_at: FUTURE_EXPIRY,
    });
    // Manual movement, no transaction tie.
    service.applyMovement({
      carrierLineId: line.id,
      creditsDelta: 15,
      reason: "MANUAL_ADJUSTMENT",
    });
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(25, 2);

    // A real, UNRELATED transaction gets voided — must not touch the line.
    const txnId = seedSelfChargeTransaction(
      lineRepo.createLine({ carrier: "mtc", phone_number: "03222222" }).id,
    );
    repo.voidTransaction(txnId, 1);

    // The manual-adjustment line is completely unaffected.
    expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(25, 2);
  });
});
