/**
 * Bug 7 (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §2 bug 7 / §4 Phase F):
 * `SessionPaymentRepository.getSessionCashSplitContext` used to sum the
 * basket's linked item amounts SIGNED into one number
 * (`SUM(cst.amount_usd)`), so a negative payout item (a session
 * RECEIVE/Loto-prize cashout) shrank or inverted the ratio that drives the
 * whole basket's cash-leg PCD/General split.
 *
 * This file drives `getSessionCashSplitContext` DIRECTLY (not through
 * `recordBasketPayment`) to pin the fixed contract: gross per-DIRECTION
 * sums, never a signed net.
 *
 * RULE 17 (failing-first): the "never −50" case below was run against the
 * PRE-FIX repository (`SUM(cst.amount_usd)`/`SUM(CASE WHEN fs.provider = ?
 * THEN cst.amount_usd ELSE 0 END)`, no direction split) by temporarily
 * reverting `getSessionCashSplitContext` to that shape — the old code
 * returned `basketTotalUsd: -50` (custom service +50, RECEIVE item −100,
 * signed sum) and `primarySystemUsd: -100` (the RECEIVE item alone, since
 * it's the only FS row and its SIGNED amount carries through), i.e. a ratio
 * of `-100 / -50 = 2` — a nonsensical (>1, sign-flipped) multiplier. Under
 * the fix, `chargeTotalUsd` reads 50 and `payoutTotalUsd` reads 100 — the
 * custom service and the RECEIVE item land in the CORRECT, independent
 * buckets. Reverted back to the fixed code after observing the failure; see
 * the task's final report for the exact diff/observed-output/restore
 * transcript.
 */

import Database from "better-sqlite3";
import {
  SessionPaymentRepository,
  resetSessionPaymentRepository,
} from "../SessionPaymentRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
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

    CREATE TABLE transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      provider     TEXT NOT NULL,
      service_type TEXT,
      amount       REAL,
      currency     TEXT DEFAULT 'USD',
      omt_fee      REAL DEFAULT 0,
      whish_fee    REAL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );
    INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'shop_base_system', 'OMT');
  `);

  return db;
}

/** A non-FS basket item (e.g. a custom service): counts toward the CHARGE
 *  bucket, never toward the primary-system subtotal (no linked FS row). */
function seedNonFsChargeItem(
  db: Database.Database,
  sessionId: number,
  amountUsd: number,
): void {
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd) VALUES ('CUSTOM_SERVICE', 'custom_services', 0, ?)",
      )
      .run(amountUsd).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd) VALUES (?, 'custom_service', 0, ?, ?)",
  ).run(sessionId, txnId, amountUsd);
}

/** A financial-service basket item — `amountUsd` is SIGNED (positive charge,
 *  negative payout), exactly the convention SessionCheckoutService links. */
function seedFsItem(
  db: Database.Database,
  sessionId: number,
  opts: { provider: string; amountUsd: number },
): number {
  const fsId = Number(
    db
      .prepare(
        "INSERT INTO financial_services (provider, service_type, amount, currency) VALUES (?, 'RECEIVE', ?, 'USD')",
      )
      .run(opts.provider, Math.abs(opts.amountUsd)).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd) VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?)",
      )
      .run(fsId, opts.amountUsd).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd) VALUES (?, 'omt_system', ?, ?, ?)",
  ).run(sessionId, fsId, txnId, opts.amountUsd);
  return fsId;
}

describe("SessionPaymentRepository.getSessionCashSplitContext — bug 7 (gross per-direction sums)", () => {
  let db: Database.Database;
  let repo: SessionPaymentRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSettingsRepository();
    resetSessionPaymentRepository();
    repo = new SessionPaymentRepository();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("[custom service +50, FS RECEIVE -100] -> gross {charge: 50, payout: 100}, never a signed -50", () => {
    const sessionId = 901;
    seedNonFsChargeItem(db, sessionId, 50);
    seedFsItem(db, sessionId, { provider: "OMT", amountUsd: -100 });

    const ctx = repo.getSessionCashSplitContext(sessionId);

    // THE bug 7 assertion: gross per-direction, never the signed net (-50).
    expect(ctx.chargeTotalUsd).toBe(50);
    expect(ctx.payoutTotalUsd).toBe(100);

    // The RECEIVE item is the ONLY financial-service row and its provider
    // (OMT) matches shop_base_system (OMT) -> its full magnitude is the
    // primary-system payout share; the $50 charge item is NOT a financial
    // service at all, so it contributes nothing to the primary-system
    // CHARGE share.
    expect(ctx.primarySystemPayoutUsd).toBe(100);
    expect(ctx.primarySystemChargeUsd).toBe(0);

    expect(ctx.chargeTotalLbp).toBe(0);
    expect(ctx.payoutTotalLbp).toBe(0);
  });

  it("multiple payout items on DIFFERENT providers split the payout-side primary share correctly", () => {
    const sessionId = 902;
    // Primary-system (OMT) payout item.
    seedFsItem(db, sessionId, { provider: "OMT", amountUsd: -30 });
    // Secondary-provider (WHISH) payout item — counts toward payoutTotal,
    // NOT toward primarySystemPayout.
    seedFsItem(db, sessionId, { provider: "WHISH", amountUsd: -10 });
    seedNonFsChargeItem(db, sessionId, 20);

    const ctx = repo.getSessionCashSplitContext(sessionId);

    expect(ctx.chargeTotalUsd).toBe(20);
    expect(ctx.payoutTotalUsd).toBe(40);
    expect(ctx.primarySystemPayoutUsd).toBe(30);
    expect(ctx.primarySystemChargeUsd).toBe(0);
  });

  it("a basket with ONLY charge items (legacy, no payout) is byte-identical to the pre-bug-7 basketTotal/primarySystem numbers", () => {
    const sessionId = 903;
    seedFsItem(db, sessionId, { provider: "OMT", amountUsd: 105 });

    const ctx = repo.getSessionCashSplitContext(sessionId);

    expect(ctx.chargeTotalUsd).toBe(105);
    expect(ctx.primarySystemChargeUsd).toBe(105);
    expect(ctx.payoutTotalUsd).toBe(0);
    expect(ctx.primarySystemPayoutUsd).toBe(0);
  });

  it("fee-on-top RECEIVE (feeOnTopReceiveFsIds): the persisted omt_fee/whish_fee folds into the CHARGE bucket, gated by provider for the primary-system share", () => {
    const sessionId = 904;
    // A RECEIVE item whose OWN linked amount is the payout (-100), but whose
    // omt_fee (5) is fee-on-top — collected via the pooled charge legs, not
    // reflected in the item's own cst amount.
    const fsId = seedFsItem(db, sessionId, {
      provider: "OMT",
      amountUsd: -100,
    });
    db.prepare("UPDATE financial_services SET omt_fee = 5 WHERE id = ?").run(
      fsId,
    );

    const withoutGate = repo.getSessionCashSplitContext(sessionId, []);
    expect(withoutGate.chargeTotalUsd).toBe(0);
    expect(withoutGate.primarySystemChargeUsd).toBe(0);

    const withGate = repo.getSessionCashSplitContext(sessionId, [fsId]);
    expect(withGate.chargeTotalUsd).toBe(5);
    expect(withGate.primarySystemChargeUsd).toBe(5);
    // The payout side is unaffected by the gate — it's driven purely by the
    // linked item's own (negative) amount.
    expect(withGate.payoutTotalUsd).toBe(100);
    expect(withGate.primarySystemPayoutUsd).toBe(100);
  });
});
