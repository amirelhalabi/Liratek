/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * Owner decision #11-A (2026-09-24, netted session checkout) —
 * `BasketPaymentLeg.payoutOrigin` ("SYSTEM" | "GENERAL").
 *
 * The pre-existing PCD/General payout split (`ratioForCurrency`,
 * SessionPaymentService.phaseF.test.ts) is a SESSION-level blended ratio —
 * `primarySystemPayoutUsd / payoutTotalUsd`, computed from EVERY payout item
 * linked to the session, regardless of how many legs (or what amounts) the
 * frontend actually sends. That is exactly right when a single leg's amount
 * IS the full gross payout total. It silently mis-splits once netting
 * (#11-A) means a leg's amount no longer equals that total — e.g. a basket
 * with a $100 OMT-system payout (always gross, never netted) PLUS a $20
 * General-drawer payout (a loto-prize/wallet excess the frontend nets down
 * to $20 after absorbing the rest into the charge): the blended ratio here
 * is 100/120 = 0.8333, so a leg tagged with NEITHER origin would put
 * $83.33/$16.67 on the two drawers instead of the owner's required EXACT
 * $100 (OMT box) / $20 (General) split ("OMT box −$100 and General +$20" —
 * OWNER_NOTES_REMAINING_BUILD.md #11-A).
 *
 * `payoutOrigin` fixes this by forcing the ratio to 1 ("SYSTEM") or 0
 * ("GENERAL") per leg, bypassing the blended session ratio for exactly the
 * two legs #11-A's frontend now sends separately.
 *
 * Rule 17 (failing-first): temporarily deleting the two `originHint` early
 * returns in `ratioForCurrency` (SessionPaymentService.ts) makes the first
 * test below fail. Fix-round finding #5 (2026-09-24): the fixture's General
 * ITEM is deliberately -$50, not -$20 — matching the SYSTEM leg's own item
 * amount to the leg amount (item -100 / leg 100, item -20 / leg 20, as an
 * earlier cut of this test did) makes total(SYSTEM leg + GENERAL leg) ==
 * total(SYSTEM item + GENERAL item) == 120 regardless of how the blended
 * ratio is applied — a single ratio r applied to any split of the SAME
 * total T always sums back to T*r / T*(1-r), so that fixture passed
 * WHETHER OR NOT the originHint short-circuit existed and proved nothing.
 * Here the GENERAL leg (20) is only the EXCESS left after #11-A netting —
 * the item itself still contributes its full -$50 to `payoutTotalUsd`
 * (150 total), so the blended ratio (100/150 = 0.6667) and the exact
 * per-origin split (100/20) diverge: blended gives PCD -66.67/-13.33 for
 * the two legs (total PCD -80, General -40); the fix gives exactly
 * PCD -100, General -20.
 *
 * Fixture lifted from the sibling `SessionPaymentService.phaseF.test.ts`
 * (same in-memory schema/helpers — kept local per that file's own note that
 * each sibling duplicates the harness).
 */

import Database from "better-sqlite3";

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

const mockRedeemByCode = jest.fn();
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: mockRedeemByCode }),
  resetVoucherRepository: jest.fn(),
}));

import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../SessionPaymentService";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetSalesRepository } from "../../repositories/SalesRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      notes           TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customer_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name  TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id        INTEGER,
      started_at     TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at      TEXT,
      started_by     TEXT NOT NULL,
      closed_by      TEXT,
      is_active      INTEGER NOT NULL DEFAULT 1,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

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

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL,
      discount_usd           REAL DEFAULT 0,
      final_amount_usd       REAL,
      paid_usd               REAL DEFAULT 0,
      paid_lbp               REAL DEFAULT 0,
      change_given_usd       REAL DEFAULT 0,
      change_given_lbp       REAL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
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
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      due_date         TEXT,
      note             TEXT,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      session_id       INTEGER
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

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      provider     TEXT NOT NULL,
      service_type TEXT,
      amount       REAL,
      currency     TEXT DEFAULT 'USD',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 0);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 0);
  `);

  return db;
}

function seedSessionWithClient(
  db: Database.Database,
  opts: { name: string; phone: string },
): { sessionId: number; clientId: number } {
  const clientId = Number(
    db
      .prepare("INSERT INTO clients (full_name, phone_number) VALUES (?, ?)")
      .run(opts.name, opts.phone).lastInsertRowid,
  );
  const sessionId = Number(
    db
      .prepare(
        "INSERT INTO customer_sessions (customer_name, customer_phone, started_by) VALUES (?, ?, 'admin')",
      )
      .run(opts.name, opts.phone).lastInsertRowid,
  );
  return { sessionId, clientId };
}

function seedSessionFsItem(
  db: Database.Database,
  sessionId: number,
  opts: {
    provider: string;
    serviceType?: "SEND" | "RECEIVE" | "BILL";
    amountUsd?: number;
    amountLbp?: number;
  },
): { fsId: number; txnId: number } {
  const amountUsd = opts.amountUsd ?? 0;
  const amountLbp = opts.amountLbp ?? 0;
  const fsId = Number(
    db
      .prepare(
        "INSERT INTO financial_services (provider, service_type, amount, currency) VALUES (?, ?, ?, ?)",
      )
      .run(
        opts.provider,
        opts.serviceType ?? "SEND",
        amountLbp !== 0 ? amountLbp : amountUsd,
        amountLbp !== 0 ? "LBP" : "USD",
      ).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp) VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?, ?)",
      )
      .run(fsId, amountUsd, amountLbp).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp) VALUES (?, 'financial_service', ?, ?, ?, ?)",
  ).run(sessionId, fsId, txnId, amountUsd, amountLbp);
  return { fsId, txnId };
}

/** A NON-financial-services basket item (e.g. a loto prize) — never counts
 *  toward `primarySystemPayout*` even when negative, since the blended-ratio
 *  query only credits provider-matched `financial_services` rows. */
function seedSessionNonSaleItem(
  db: Database.Database,
  sessionId: number,
  amountUsd = 0,
  amountLbp = 0,
): number {
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp) VALUES ('CUSTOM_SERVICE', 'custom_services', 0, ?, ?)",
      )
      .run(amountUsd, amountLbp).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp) VALUES (?, 'custom_service', 0, ?, ?, ?)",
  ).run(sessionId, txnId, amountUsd, amountLbp);
  return txnId;
}

function drawerBalance(
  db: Database.Database,
  drawerName: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawerName, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("SessionPaymentService.recordBasketPayment — payoutOrigin (owner decision #11-A)", () => {
  let db: Database.Database;
  let service: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetCustomerSessionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetSessionPaymentService();

    mockAddCredit.mockClear();
    mockRedeemByCode.mockClear();

    service = new SessionPaymentService();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("a mixed basket (system $100 item/leg + general $50 item netted to a $20 excess leg) splits EACH leg to its OWN drawer in full, not by the blended session ratio", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Mixed Payout",
      phone: "901",
    });

    // OMT (primary system, base_system='OMT') RECEIVE -100. SYSTEM payouts
    // are never netted (owner decision #11-A), so this item's leg is the
    // full -100.
    seedSessionFsItem(db, sessionId, {
      provider: "OMT",
      serviceType: "RECEIVE",
      amountUsd: -100,
    });
    // A non-financial-services General payout ITEM of -50 (e.g. a loto
    // prize) — contributes its FULL -50 to payoutTotalUsd (fix-round finding
    // #5: this must differ from the leg amount below, or the blended ratio
    // and the exact per-origin split coincidentally agree — see the file
    // header). Only the $20 EXCESS left after #11-A netted $30 of it against
    // some other charge in the real basket actually reaches
    // recordBasketPayment as a leg (below).
    seedSessionNonSaleItem(db, sessionId, -50);

    // Sanity: the BLENDED ratio this basket would compute is
    // 100 / (100 + 50) = 0.6667 — if the two legs below were sent WITHOUT
    // payoutOrigin, they'd each get split 66.67%/33.33% (PCD -66.67/-13.33,
    // totaling PCD -80/General -40) instead of landing whole on their own
    // drawer (this is what the pre-#11-A code — and any regression that
    // drops the originHint short-circuit — would do).

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 100,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "SYSTEM",
        },
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 20,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "GENERAL",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // Owner's exact bookkeeping (#11-A): "OMT box −$100 and General +$20" —
    // here both are OUT (payout), so OMT_System −100, General −20 exactly.
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(-100);
    expect(drawerBalance(db, "General", "USD")).toBe(-20);
  });

  it("a SYSTEM payout from the NON-base provider (fix-round finding #2) routes 100% to General, never the base provider's PCD", () => {
    // shop_base_system = 'OMT' (createTestDb). A Whish RECEIVE payout is
    // still `payoutOrigin: "SYSTEM"` (binanceCart.ts's SYSTEM_PAYOUT_MODULES
    // has no per-provider identity — it combines omt_system + whish_system
    // into one basket-level total), but Whish has no PCD of its own when OMT
    // is primary. Forcing this leg's ratio to 1 (the pre-fix-round #2
    // behavior) would wrongly debit OMT_System; the fix derives the ratio
    // from `systemPayoutTotalUsd`/`primarySystemPayoutUsd`
    // (SessionPaymentRepository), which are BOTH provider-scoped, giving
    // ratio 0/50 = 0 — the whole leg falls through to General, exactly like
    // a solo non-base-system transaction already does via
    // resolveServiceCashDrawer.
    const { sessionId } = seedSessionWithClient(db, {
      name: "Non-Base System Payout",
      phone: "903",
    });

    seedSessionFsItem(db, sessionId, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amountUsd: -50,
    });

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 50,
          direction: "OUT",
          kind: "PAYOUT",
          payoutOrigin: "SYSTEM",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    expect(drawerBalance(db, "General", "USD")).toBe(-50);
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(0);
    expect(drawerBalance(db, "Whish_System", "USD")).toBe(0);
  });

  it("legacy: a payout leg with NO payoutOrigin still uses the blended session ratio (backward compatible)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Legacy Blended",
      phone: "902",
    });

    seedSessionFsItem(db, sessionId, {
      provider: "OMT",
      serviceType: "RECEIVE",
      amountUsd: -100,
    });
    seedSessionNonSaleItem(db, sessionId, -20);

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 120,
          direction: "OUT",
          kind: "PAYOUT",
          // no payoutOrigin — legacy blended-ratio path.
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // payoutTotal 120, primaryPayout 100 -> ratio 0.8333.
    // 120 @ 0.8333 -> PCD 100, General 20 (rounds exactly here since the
    // ratio happens to be a round split of THIS particular leg amount).
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(-100);
    expect(drawerBalance(db, "General", "USD")).toBe(-20);
  });
});
