/**
 * LIRA-239 — verify (and, if needed, fix) that refunding a "sold ahead" days
 * sale TOGETHER WITH the later line recharge, in the same session, nets to
 * zero on every ledger: line credits, line validity/days_owed, the drawer,
 * the "days still to send" list, and profit.
 *
 * Uses the REAL writers: `RechargeRepository.processRecharge` (DAYS sale,
 * the note #28 path, v184/`9ed8d90f`) for the days sale,
 * `FinancialServiceRepository.selfChargeTelecomItem` (TELECOM_SELF_CHARGE)
 * for "the later line recharge", and `TransactionRepository.voidTransaction`
 * for both reversals.
 *
 * ROOT CAUSE (traced by reading `CarrierLineRepository.reverseMovement`,
 * ~:862): a SELL's reversal reclaims onto `validity_expires_at` any part of
 * its own sold-ahead banking that a LATER charge already paid off (M1 fix,
 * v184), read off the line's CURRENT `days_owed` at reversal time. A
 * CHARGE's reversal instead does a VERBATIM restore of its own
 * `previous_validity_expires_at` snapshot, captured at the charge's own
 * creation time. Reversing the SELL first (while the charge is still
 * active) correctly reclaims the charge's payoff onto validity — but then
 * reversing the CHARGE SECOND overwrites that already-correct value with
 * its now-STALE snapshot (captured before the sell was ever reversed) AND
 * re-adds `days_owed_delta` back onto `days_owed` even though the sell's
 * own reversal already converted that same debt into validity days. The
 * charge's own debt payoff gets double-restored — once as validity (by the
 * sell's reversal) and once as `days_owed` (by the charge's own reversal) —
 * so reversing SELL-then-CHARGE does not net to the pre-sale baseline.
 * Reversing CHARGE-then-SELL (strict reverse-creation-order / LIFO) DOES
 * net correctly, because by the time the sell is reversed, nothing newer
 * remains active to have invalidated its own reclaim arithmetic.
 *
 * FIX: `CarrierLineRepository.reverseMovement` refuses to reverse a
 * validity-affecting movement while a NEWER, still-active,
 * validity-affecting movement exists on the same line — forcing LIFO order,
 * which this file's own math (and the pre-existing M1/m3 single-movement
 * tests) already prove is always correct. `TransactionRepository
 * ._reverseCarrierLineMovements` propagates that refusal instead of
 * silently swallowing it, so a wrong-order void/refund fails loudly (the
 * whole db transaction rolls back — nothing partially reverses) rather than
 * leaving the line permanently wrong.
 *
 * RULE 17 — RED, actually run (`npx jest
 * CarrierLine.soldAheadSessionReversal --maxWorkers=2`, 2026-09-28) against
 * the pre-fix `reverseMovement` (no LIFO guard):
 *
 *   FAIL ... › voiding the DAYS sale THEN the later self-charge does NOT
 *   net to the pre-sale baseline (the bug, proven directly)
 *     Expected line.validity_expires_at: "<TODAY+150>"
 *     Received: "<TODAY>"
 *     Expected line.days_owed: 0
 *     Received: 210
 *   The $/day accounting silently drifted by exactly the self-charge's
 *   210-day payoff — double-booked as both "restored validity" (by the
 *   sell's own reversal) and "restored debt" (by the stale charge
 *   snapshot).
 *
 * GREEN after the LIFO guard: that same wrong-order void now THROWS before
 * touching anything (transaction rolls back — line/drawer/owed-list
 * unchanged), and voiding newest-first (self-charge, then the days sale)
 * nets everything to zero.
 *
 * LIRA-239 follow-up (2026-09-28) — "SessionReversal" in this file's name is
 * the colloquial "refund both together" scenario, NOT the app's Customer
 * Session basket feature ("Void basket"/"Refund basket",
 * `TransactionRepository.voidSessionBasket`/`refundSessionBasket`). Traced
 * with the real writers: `FinancialServiceRepository.selfChargeTelecomItem`
 * is the ONLY production writer of a CHARGE-shaped (`validity_days_delta >
 * 0`) carrier-line movement (grep `validityDaysDelta:` across
 * `packages/core/src` — every other production call site is 0 or negative),
 * and its ONLY caller (`KatshForm.tsx`'s `handleConfirmSelfCharge`) never
 * calls `linkTransaction`/`useSession().linkTransaction` the way its
 * sibling "aggregated cart" submit a few hundred lines above it does — a
 * self-charge is never written into `customer_session_transactions`. So a
 * days sale (the only SELL-shaped writer) and a self-charge can never BOTH
 * be members of one `voidSessionBasket`/`refundSessionBasket` call today:
 * the basket loop's `ORDER BY cst.id ASC` (oldest-first) can only ever
 * misorder a pairing that can actually become basket members, and this
 * pairing can't. This file's two tests (plain `voidTransaction` calls, no
 * session at all) remain the right-shaped coverage for the reachable bug.
 * If a future change ever links a self-charge to a session, re-open this
 * question — `voidSessionBasket`/`refundSessionBasket` would need the same
 * newest-first handling this file's LIFO guard already proves correct.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository.js";
import { FinancialServiceRepository } from "../FinancialServiceRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import {
  resetCarrierLineMovementRepository,
} from "../CarrierLineMovementRepository.js";
import { resetCarrierLineService } from "../../services/CarrierLineService.js";
import {
  CarrierLineOwedDeliveryRepository,
  resetCarrierLineOwedDeliveryRepository,
} from "../CarrierLineOwedDeliveryRepository.js";
import { resetMobileServiceItemRepository } from "../MobileServiceItemRepository.js";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository.js";
import { resetDebtService } from "../../services/DebtService.js";
import { resetDebtRepository } from "../DebtRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { localDay } from "../../utils/localDate.js";

const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;
const CREDIT_COST_RATE_LBP = 85_000;

function daysCostUsd(days: number): number {
  return (days / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

const TODAY = localDay();

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role     TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      notes        TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, key_name)
    );
    INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'alfa_credit_cost_lbp', '${CREDIT_COST_RATE_LBP}');

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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC',     'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'iPick',   'LBP', 100000000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 100000000);

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
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      status                 TEXT NOT NULL DEFAULT 'completed',
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER DEFAULT 1,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT DEFAULT NULL,
      edited_at               TEXT DEFAULT NULL,
      is_refunded             INTEGER DEFAULT 0,
      refunded_at             TEXT DEFAULT NULL
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
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
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_line_owed_deliveries (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER DEFAULT 1,
      carrier_line_id  INTEGER NOT NULL,
      transaction_id   INTEGER,
      client_id        INTEGER,
      client_name      TEXT,
      days_owed        INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'PENDING',
      sent_at          DATETIME,
      sent_by          INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mobile_service_items (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                 INTEGER DEFAULT 1,
      provider                  TEXT NOT NULL,
      category                  TEXT NOT NULL,
      subcategory               TEXT NOT NULL,
      label                     TEXT NOT NULL,
      cost_lbp                  REAL NOT NULL DEFAULT 0,
      sell_lbp                  REAL NOT NULL DEFAULT 0,
      sort_order                INTEGER NOT NULL DEFAULT 0,
      is_active                 INTEGER NOT NULL DEFAULT 1,
      validity_days             INTEGER,
      credits                   REAL,
      days_cost_lbp             REAL,
      sell_days_lbp             REAL,
      sell_credit_lbp           REAL,
      max_returned_credits_usd  REAL,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function setTestDb(db: Database.Database): void {
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
    .__LIRATEK_TEST_DB__;
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function txnIdFor(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = ? AND source_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(sourceTable, sourceId) as { id: number };
  return row.id;
}

describe("LIRA-239 — sold-ahead days sale + later line recharge, refunded together", () => {
  let db: Database.Database;
  let rechargeRepo: RechargeRepository;
  let financialRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  let carrierLineRepo: CarrierLineRepository;
  let owedDeliveryRepo: CarrierLineOwedDeliveryRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetCarrierLineOwedDeliveryRepository();
    resetMobileServiceItemRepository();
    resetFinancialServiceRepository();
    rechargeRepo = new RechargeRepository();
    financialRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
    carrierLineRepo = new CarrierLineRepository();
    owedDeliveryRepo = new CarrierLineOwedDeliveryRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetCarrierLineOwedDeliveryRepository();
    resetMobileServiceItemRepository();
    resetFinancialServiceRepository();
    db.close();
  });

  /** Sells 360 days off a 150-day mtc line (sold ahead 210), then
   *  self-charges +365 days (the "later line recharge") which pays the 210
   *  off and stacks 155 more. Returns the two transaction ids plus every
   *  PRE-mutation baseline so each test can assert its own net-zero. */
  function setupSoldAheadThenRecharge(): {
    line: { id: number; carrier: "mtc" };
    daysSaleTxnId: number;
    selfChargeTxnId: number;
    baseline: {
      validity: string;
      daysOwed: number;
      credits: number;
      mtcUsd: number;
      iPickLbp: number;
    };
  } {
    const line = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03222111",
      credits: 20,
      validity_expires_at: addDays(TODAY, 150),
      is_primary: true,
    } as never, 1);

    const item = db
      .prepare(
        `INSERT INTO mobile_service_items
           (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, 'iPick', 'mtc', 'card', 'MTC 365d card', 900000, 950000, 50, 365)`,
      )
      .run();

    const baseline = {
      validity: addDays(TODAY, 150),
      daysOwed: 0,
      credits: 20,
      mtcUsd: drawer(db, "MTC", "USD"),
      iPickLbp: drawer(db, "iPick", "LBP"),
    };

    const sale = rechargeRepo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 360,
      cost: daysCostUsd(360) * CREDIT_COST_RATE_LBP,
      price: 3_000_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "70000000",
      clientName: "Sold Ahead Client",
      userId: 1,
      client_day: TODAY,
    });
    expect(sale.success).toBe(true);
    const daysSaleTxnId = txnIdFor(db, "recharges", sale.id as number);

    // Sanity: the sale really did sell ahead (owed 210, pinned at today).
    const afterSale = carrierLineRepo.getById(line.id)!;
    expect(afterSale.validity_expires_at).toBe(TODAY);
    expect(afterSale.days_owed).toBe(210);
    expect(owedDeliveryRepo.getAllPending().length).toBe(1);

    const charge = financialRepo.selfChargeTelecomItem({
      mobileServiceItemId: item.lastInsertRowid as number,
      carrierLineId: line.id,
      userId: 1,
      client_day: TODAY,
    });
    const selfChargeTxnId = charge.transactionId;

    // Sanity: the recharge paid the debt off and stacked the remainder.
    const afterCharge = carrierLineRepo.getById(line.id)!;
    expect(afterCharge.days_owed).toBe(0);
    expect(afterCharge.validity_expires_at).toBe(addDays(TODAY, 155));

    return { line: { id: line.id, carrier: "mtc" }, daysSaleTxnId, selfChargeTxnId, baseline };
  }

  it("voiding the DAYS sale ALONE succeeds (the sold-ahead reclaim, M1) — but THEN voiding the self-charge is refused rather than silently corrupting the line (the bug, proven directly)", () => {
    const { line, daysSaleTxnId, selfChargeTxnId } =
      setupSoldAheadThenRecharge();

    // Voiding the OLDER days sale alone, while the newer self-charge stays
    // active, is a legitimate, already-proven-correct operation in its own
    // right (CarrierLineRepository.soldAheadDays.test.ts's M1 case): the
    // sell's reclaim arithmetic reads the line's CURRENT state, so it
    // correctly folds the self-charge's still-active payoff back onto
    // validity, capped at the 365-day ceiling.
    txnRepo.voidTransaction(daysSaleTxnId, 1);
    const afterFirstVoid = carrierLineRepo.getById(line.id)!;
    expect(afterFirstVoid.validity_expires_at).toBe(addDays(TODAY, 365));
    expect(afterFirstVoid.days_owed).toBe(0);

    // Wrong order NOW: the days sale (older) has ALREADY been reversed.
    // The self-charge's OWN reversal restores validity via a VERBATIM
    // snapshot captured back when the sell's effect was still live — that
    // snapshot is now stale (the sell's own, order-safe reversal already
    // superseded it). Voiding the self-charge here is refused rather than
    // silently restoring the stale snapshot (which would land on
    // `TODAY` with `days_owed` wrongly re-added to 210 — see this file's
    // header comment for the exact pre-fix numbers, captured live).
    //
    // Coordinator follow-up (2026-09-28) — this IS the "older movement
    // already reversed" blocker (`getOlderReversedValidityMovement`), not
    // the "later movement still active" one: the days sale here is OLDER
    // than the self-charge, and it's the one already reversed. The old
    // shared message called it "a later movement" regardless, which was
    // backwards for this exact case — see the dedicated (a)/(b) tests
    // below for the dis-entangled, plain-language messages.
    expect(() => txnRepo.voidTransaction(selfChargeTxnId, 1)).toThrow(
      /days sale.*already voided or refunded/i,
    );

    // Nothing partially reversed: the self-charge transaction is still
    // ACTIVE, and the line is exactly where the first (legitimate) void
    // left it.
    const selfChargeTxn = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(selfChargeTxnId) as { status: string };
    expect(selfChargeTxn.status).toBe("ACTIVE");
    const afterRefusedVoid = carrierLineRepo.getById(line.id)!;
    expect(afterRefusedVoid.validity_expires_at).toBe(addDays(TODAY, 365));
    expect(afterRefusedVoid.days_owed).toBe(0);
  });

  it("voiding newest-first (self-charge, then the days sale) nets every ledger to zero: credits, validity/days_owed, drawers, the owed-days list, and profit", () => {
    const { line, daysSaleTxnId, selfChargeTxnId, baseline } =
      setupSoldAheadThenRecharge();

    const profitBefore = (
      db.prepare(`SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions`).get() as {
        p: number;
      }
    ).p;

    txnRepo.voidTransaction(selfChargeTxnId, 1);
    txnRepo.voidTransaction(daysSaleTxnId, 1);

    const finalLine = carrierLineRepo.getById(line.id)!;
    expect(finalLine.validity_expires_at).toBe(baseline.validity);
    expect(finalLine.days_owed).toBe(baseline.daysOwed);
    expect(finalLine.credits).toBe(baseline.credits);

    expect(drawer(db, "MTC", "USD")).toBeCloseTo(baseline.mtcUsd, 6);
    expect(drawer(db, "iPick", "LBP")).toBeCloseTo(baseline.iPickLbp, 6);

    // The "days still to send" checklist entry is gone (M5 filter — its
    // source transaction is now VOIDED).
    expect(owedDeliveryRepo.getAllPending().length).toBe(0);

    // Profit nets to 0 too (both writers stamp 0 profit; a void negates
    // whatever was stamped).
    const profitAfter = (
      db.prepare(`SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions`).get() as {
        p: number;
      }
    ).p;
    expect(profitAfter).toBe(profitBefore);

    // Both movements are flipped reversed — no partial state.
    const unreversed = db
      .prepare(
        `SELECT COUNT(*) AS n FROM carrier_line_movements WHERE carrier_line_id = ? AND is_reversed = 0`,
      )
      .get(line.id) as { n: number };
    expect(unreversed.n).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Coordinator follow-up (2026-09-28) — `CarrierLineRepository
  // .reverseMovement`'s LIFO guard has TWO distinct blockers
  // (`getLaterUnreversedValidityMovement` / `getOlderReversedValidityMovement`)
  // that used to share ONE message, worded only for the first ("a later
  // movement ... reverse that later movement FIRST"). That wording is
  // actively WRONG for the second blocker — `getOlderReversedValidityMovement`
  // returns a movement OLDER than the one being reversed, which is already
  // reversed, so "reverse that later movement first" describes an action the
  // cashier cannot take (there is nothing left to reverse — it's already
  // done). The test right above this one ("voiding the DAYS sale ALONE
  // succeeds... but THEN voiding the self-charge is refused") is, on
  // inspection, exactly this SECOND (older-already-reversed) case, not the
  // first — its `/later movement/i` assertion was pattern-matching text that
  // is itself the bug, not proof the message is right. Both blockers now get
  // their own plain-language, cashier-facing message (no "carrier line
  // movement #id" jargon — the line's own phone number instead).
  // ───────────────────────────────────────────────────────────────────────

  it("(a) NEW SCENARIO, no prior coverage — reversing an OLDER recharge while a NEWER validity change on the SAME line is still active is refused in plain language naming the line, not a movement id", () => {
    // Two self-charges on the same line: charge1 (older), charge2 (newer,
    // still active). Neither is a "sold ahead" days sale — this is the
    // OTHER blocker (`getLaterUnreversedValidityMovement`), deliberately
    // isolated from the (b) scenario below.
    const line = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999888",
      credits: 0,
      validity_expires_at: addDays(TODAY, 10),
      is_primary: true,
    } as never);
    const item = db
      .prepare(
        `INSERT INTO mobile_service_items
           (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
         VALUES (1, 'iPick', 'mtc', 'card', 'MTC 30d card', 100000, 120000, 5, 30)`,
      )
      .run();
    const itemId = item.lastInsertRowid as number;

    const charge1 = financialRepo.selfChargeTelecomItem({
      mobileServiceItemId: itemId,
      carrierLineId: line.id,
      userId: 1,
      client_day: TODAY,
    });
    financialRepo.selfChargeTelecomItem({
      mobileServiceItemId: itemId,
      carrierLineId: line.id,
      userId: 1,
      client_day: TODAY,
    });

    let caught: Error | undefined;
    try {
      txnRepo.voidTransaction(charge1.transactionId, 1);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    // Plain language, names the line, tells the cashier what to do next —
    // no "carrier line movement #7" jargon.
    expect(caught!.message).toMatch(
      /refund the later recharge of line 03999888 first, then this one/i,
    );
    expect(caught!.message).not.toMatch(/carrier line movement #/i);

    // Nothing partially reversed.
    const chargeTxn = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(charge1.transactionId) as { status: string };
    expect(chargeTxn.status).toBe("ACTIVE");
  });

  it("(b) an older days sale already reversed makes the newer recharge impossible to refund on its own — plain language, names the line, not the misleading 'later movement' text", () => {
    const { daysSaleTxnId, selfChargeTxnId } = setupSoldAheadThenRecharge();

    txnRepo.voidTransaction(daysSaleTxnId, 1);

    let caught: Error | undefined;
    try {
      txnRepo.voidTransaction(selfChargeTxnId, 1);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    // Explains WHY (the days sale from this line was already reversed
    // before this recharge) and what that means (it can no longer be
    // refunded on its own) — not "reverse that later movement first",
    // which describes an action that already happened.
    expect(caught!.message).toMatch(/line 03222111/);
    expect(caught!.message).toMatch(/days sale/i);
    expect(caught!.message).toMatch(/already/i);
    expect(caught!.message).toMatch(/refunded first/i);
    expect(caught!.message).not.toMatch(/a later movement/i);
    expect(caught!.message).not.toMatch(/carrier line movement #/i);
  });
});
