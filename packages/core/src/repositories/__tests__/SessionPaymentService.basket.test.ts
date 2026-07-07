/**
 * SessionPaymentService — basket-payment allocation/payout regression coverage.
 *
 * Verifies the three fixes that landed on feat/session-basket-payment, directly
 * against SessionPaymentService.recordBasketPayment / backfillSaleSettlement:
 *
 *   #2 Cross-item cash bleed: a SALE charged to CUSTOMER_ACCOUNT plus a non-sale
 *      item paid CASH must NOT realize the sale. The account debt is allocated to
 *      sales first ("account-debt-to-sales-first"), so the sale stays pending
 *      (paid_usd == 0) and the cash lands in the General drawer only.
 *
 *   #3 Gift-card realization: a GIFT_CARD-paid sale realizes (paid_usd == amount)
 *      because gift-card value is prepaid/collected and is EXCLUDED from the
 *      account debt that keeps sales pending. The CUSTOMER_ACCOUNT control proves
 *      an on-account sale of the same shape stays pending.
 *
 *   #1 Loto/payout OUT leg: a basket with no sales and a CASH OUT leg posts the
 *      payout exactly once — General drawer goes negative and a single negative
 *      payments row is written.
 *
 *   posted-once sanity: two covered sales + one CASH IN leg realize both sales
 *      and move the drawer by the leg amount once (not double-counted).
 *
 * Runs against an in-memory SQLite DB injected via the connection test hook
 * (globalThis.__LIRATEK_TEST_DB__). DebtService and VoucherRepository are mocked;
 * every other repository the service resolves uses the real test DB. The
 * payment_methods table is intentionally omitted so paymentMethodToDrawerName /
 * isDrawerAffectingMethod fall back to the hardcoded map (CASH → General,
 * CUSTOMER_ACCOUNT / GIFT_CARD → non-drawer).
 */

import Database from "better-sqlite3";

// ─── Mock DebtService (addCredit — used only for OUT-on-account store credit) ──
const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── Mock VoucherRepository (redeemByCode — gift-card redemption is a noop here) ─
const mockRedeemByCode = jest.fn();
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: mockRedeemByCode }),
  resetVoucherRepository: jest.fn(),
}));

import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";

// ─── In-memory schema (only the tables recordBasketPayment touches) ───────────

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
      is_active      INTEGER NOT NULL DEFAULT 1
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
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
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
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      session_id       INTEGER
    );

    -- Seed the General drawer (cash) at zero so deltas are easy to read.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

interface SeedSaleResult {
  saleId: number;
  txnId: number;
}

/** Create a session with a resolvable client (matched by phone). */
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

/**
 * Create a SALE row + its unified SALE transaction + the
 * customer_session_transactions link the back-fill query joins on.
 */
function seedSessionSale(
  db: Database.Database,
  sessionId: number,
  finalUsd: number,
): SeedSaleResult {
  const saleId = Number(
    db
      .prepare(
        "INSERT INTO sales (total_amount_usd, final_amount_usd, paid_usd, paid_lbp) VALUES (?, ?, 0, 0)",
      )
      .run(finalUsd, finalUsd).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd) VALUES ('SALE', 'sales', ?, ?)",
      )
      .run(saleId, finalUsd).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd) VALUES (?, 'sale', ?, ?, ?)",
  ).run(sessionId, saleId, txnId, finalUsd);
  return { saleId, txnId };
}

/** A non-sale basket item (e.g. a custom service): a non-SALE unified txn link. */
function seedSessionNonSale(
  db: Database.Database,
  sessionId: number,
  amountUsd: number,
): number {
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
  return txnId;
}

// ─── Read helpers ───────────────────────────────────────────────────────────────

function salePaid(
  db: Database.Database,
  saleId: number,
): { paid_usd: number; paid_lbp: number } {
  return db
    .prepare("SELECT paid_usd, paid_lbp FROM sales WHERE id = ?")
    .get(saleId) as { paid_usd: number; paid_lbp: number };
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

function debtRows(db: Database.Database): Array<{
  client_id: number;
  amount_usd: number;
  amount_lbp: number;
  session_id: number | null;
}> {
  return db
    .prepare(
      "SELECT client_id, amount_usd, amount_lbp, session_id FROM debt_ledger ORDER BY id ASC",
    )
    .all() as Array<{
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    session_id: number | null;
  }>;
}

function paymentRows(db: Database.Database): Array<{
  session_id: number | null;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
}> {
  return db
    .prepare(
      "SELECT session_id, method, drawer_name, currency_code, amount FROM payments ORDER BY id ASC",
    )
    .all() as Array<{
    session_id: number | null;
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }>;
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("SessionPaymentService.recordBasketPayment — basket allocation/payout", () => {
  let db: Database.Database;
  let service: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    // Inject the in-memory DB via the connection test hook so every repository
    // singleton (re-created below) resolves to it.
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

    // Reset singletons so they re-bind to the fresh DB.
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSessionPaymentRepository();
    resetSessionPaymentService();

    mockAddCredit.mockClear();
    mockRedeemByCode.mockClear();

    service = new SessionPaymentService();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ── #2 cross-item cash bleed ────────────────────────────────────────────────
  it("#2 does NOT bleed CASH into an on-account sale (sale stays pending)", () => {
    const { sessionId, clientId } = seedSessionWithClient(db, {
      name: "Cross Item",
      phone: "111",
    });
    const { saleId } = seedSessionSale(db, sessionId, 50); // SALE charged to account
    seedSessionNonSale(db, sessionId, 30); // non-sale item paid CASH

    service.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 30, direction: "IN" },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 50,
          direction: "IN",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // Account debt (50) >= sales total (50) → sale realizes nothing. The $30 cash
    // paid for the NON-sale item and must not touch the sale.
    expect(salePaid(db, saleId).paid_usd).toBe(0);

    // Cash landed in the General/USD drawer only.
    expect(drawerBalance(db, "General", "USD")).toBe(30);
    expect(drawerBalance(db, "General", "LBP")).toBe(0);

    // Exactly ONE debt-ledger row for the $50 account charge.
    const debts = debtRows(db);
    expect(debts).toHaveLength(1);
    expect(debts[0].client_id).toBe(clientId);
    expect(debts[0].amount_usd).toBe(50);
    expect(debts[0].amount_lbp).toBe(0);
    // The row must carry the basket's session_id — the Debts page joins on this
    // to show the itemized purchases behind a "Session Debt" entry.
    expect(debts[0].session_id).toBe(sessionId);
  });

  // ── #3 gift-card realization ────────────────────────────────────────────────
  it("#3 realizes a GIFT_CARD-paid sale (paid_usd == amount)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Gift Card",
      phone: "222",
    });
    const { saleId } = seedSessionSale(db, sessionId, 40);

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "GIFT_CARD",
          currencyCode: "USD",
          amount: 40,
          direction: "IN",
          voucherCode: "GC1",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // Gift card is prepaid/collected → excluded from the account debt that keeps
    // sales pending, so the sale realizes fully.
    expect(salePaid(db, saleId).paid_usd).toBe(40);

    // The voucher path ran exactly once with the redeemed code.
    expect(mockRedeemByCode).toHaveBeenCalledTimes(1);
    expect(mockRedeemByCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GC1", context: "session" }),
    );

    // No cash moved (gift card is non-drawer).
    expect(drawerBalance(db, "General", "USD")).toBe(0);
  });

  // ── #3 control: CUSTOMER_ACCOUNT stays pending under the same shape ─────────
  it("#3 control: a CUSTOMER_ACCOUNT-paid sale stays pending (paid_usd == 0)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "On Account",
      phone: "333",
    });
    const { saleId } = seedSessionSale(db, sessionId, 40);

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 40,
          direction: "IN",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // Account charge keeps the sale pending — proves the gift-card path above is
    // the realization difference, not the sale wiring.
    expect(salePaid(db, saleId).paid_usd).toBe(0);

    const debts = debtRows(db);
    expect(debts).toHaveLength(1);
    expect(debts[0].amount_usd).toBe(40);

    // No voucher redemption on the account path.
    expect(mockRedeemByCode).not.toHaveBeenCalled();
  });

  // ── #1 loto/payout OUT leg posts the payout once ────────────────────────────
  it("#1 posts a CASH OUT payout leg exactly once (drawer −, single negative payment)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Loto Winner",
      phone: "444",
    });
    // No sales in the basket — pure payout.

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 1_000_000,
          direction: "OUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // General/LBP debited by the payout exactly once.
    expect(drawerBalance(db, "General", "LBP")).toBe(-1_000_000);
    expect(drawerBalance(db, "General", "USD")).toBe(0);

    // Exactly one payments row, with the negative (OUT) amount, tied to the session.
    const pays = paymentRows(db);
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(-1_000_000);
    expect(pays[0].currency_code).toBe("LBP");
    expect(pays[0].drawer_name).toBe("General");
    expect(pays[0].session_id).toBe(sessionId);

    // A pure payout creates no client debt.
    expect(debtRows(db)).toHaveLength(0);
  });

  // ── CUSTOMER_ACCOUNT OUT leg = payout settled to the customer's account ─────
  // A session cash-out (Binance/OMT/Whish RECEIVE) the customer takes as
  // account credit arrives here as a CUSTOMER_ACCOUNT OUT leg. It must book a
  // real credit LINKED TO THE SESSION (session_id) — that's what surfaces it on
  // the Debts Payments side with the basket eye button and reduces the balance.
  it("books a session-linked credit for a CUSTOMER_ACCOUNT OUT (payout to account) leg", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Account Cashout",
      phone: "666",
    });

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 40,
          direction: "OUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // Credit booked via DebtService.addCredit, carrying session_id (pre-fix it
    // was called with no sessionId and note "Basket change returned").
    expect(mockAddCredit).toHaveBeenCalledTimes(1);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 40,
        amountLbp: 0,
        sessionId,
        note: `Session #${sessionId} basket`,
      }),
    );

    // A CUSTOMER_ACCOUNT leg is non-drawer — no General movement, no cash row.
    expect(drawerBalance(db, "General", "USD")).toBe(0);
    expect(paymentRows(db)).toHaveLength(0);
  });

  // ── posted-once sanity: two covered sales + one CASH leg ────────────────────
  it("posted-once: two CASH-covered sales realize fully and the drawer moves once", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Two Sales",
      phone: "555",
    });
    const { saleId: saleA } = seedSessionSale(db, sessionId, 30);
    const { saleId: saleB } = seedSessionSale(db, sessionId, 20);

    service.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 50, direction: "IN" },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // No account debt → full sales pool (50) realizes across both sales.
    expect(salePaid(db, saleA).paid_usd).toBe(30);
    expect(salePaid(db, saleB).paid_usd).toBe(20);

    // Drawer moved by the leg amount ONCE — not 100.
    expect(drawerBalance(db, "General", "USD")).toBe(50);

    // One cash payments row.
    const pays = paymentRows(db);
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(50);

    // Cash basket → no debt.
    expect(debtRows(db)).toHaveLength(0);
  });
});
