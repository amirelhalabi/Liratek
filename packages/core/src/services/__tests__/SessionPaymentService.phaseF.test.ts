/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — `BasketPaymentLeg.kind`
 * ("PAYOUT" | "CHANGE") on an OUT leg.
 *
 * Wire contract (frozen): `kind` is meaningful ONLY on a `direction: "OUT"`
 * leg. `kind: "PAYOUT"` (the shop pays the customer for a basket item — a
 * session RECEIVE/Loto-prize cashout) is noted "Basket payout to customer"
 * and splits the PCD/General ratio by the basket's PAYOUT-side primary-
 * system share. `kind: "CHANGE"` or absent (legacy) is noted "Basket change
 * returned" and splits by the CHARGE-side ratio — byte-identical to
 * pre-Phase-F behavior (the regression case below).
 *
 * Shares the fixture with the sibling `SessionPaymentService.basket.test.ts`
 * (Primary Cash Drawer plan §3 Phase D) — that file predates `kind` and its
 * every case omits it (kind-less OUT legs), so it is itself the primary
 * byte-identical-legacy regression guard; this file adds the NEW kind
 * dimension on top of the same harness.
 *
 * RULE 17 (failing-first): the discriminator/bucket-selection test below was
 * run against the pre-fix `SessionPaymentService` (no `kind` field, every OUT
 * leg noted "Basket change returned" and split by the single basket-wide
 * ratio) by temporarily reverting the `isPayout`/`outNote`/bucket-selection
 * changes — the PAYOUT leg's note read "Basket change returned" (not
 * "...payout...") and its PCD/General split used the CHARGE ratio (0.6)
 * instead of the PAYOUT ratio (0.75), giving PCD $24/General $16 instead of
 * the correct PCD $30/General $10. Reverted back to the fixed code after
 * observing the failure; see the task's final report for the exact
 * diff/observed-output/restore transcript.
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

// ─── In-memory schema — identical to SessionPaymentService.basket.test.ts ────

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
    );

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
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      provider     TEXT NOT NULL,
      service_type TEXT,
      amount       REAL,
      currency     TEXT DEFAULT 'USD',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

function paymentRows(db: Database.Database): Array<{
  session_id: number | null;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
}> {
  return db
    .prepare(
      "SELECT session_id, method, drawer_name, currency_code, amount, note FROM payments ORDER BY id ASC",
    )
    .all() as Array<{
    session_id: number | null;
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
    note: string | null;
  }>;
}

describe("SessionPaymentService.recordBasketPayment — kind: PAYOUT/CHANGE (Phase F)", () => {
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

  it("kind:PAYOUT OUT leg -> note 'Basket payout to customer', split by the PAYOUT-side ratio; kind-less OUT leg -> note 'Basket change returned', split by the CHARGE-side ratio (regression)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Kind Discriminator",
      phone: "801",
    });

    // Charge side: OMT SEND (primary) 60 + accessory 40 -> chargeTotal 100,
    // primaryCharge 60 -> charge ratio 0.6.
    seedSessionFsItem(db, sessionId, {
      provider: "OMT",
      serviceType: "SEND",
      amountUsd: 60,
    });
    seedSessionNonSaleItem(db, sessionId, 40);

    // Payout side: OMT RECEIVE (primary) -30 + WHISH RECEIVE (secondary) -10
    // -> payoutTotal 40, primaryPayout 30 -> payout ratio 0.75.
    seedSessionFsItem(db, sessionId, {
      provider: "OMT",
      serviceType: "RECEIVE",
      amountUsd: -30,
    });
    seedSessionFsItem(db, sessionId, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amountUsd: -10,
    });

    const result = service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 40,
          direction: "OUT",
          kind: "PAYOUT",
        },
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 100,
          direction: "OUT",
          // kind omitted -> legacy CHANGE behavior.
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // PAYOUT leg (40 @ ratio 0.75): PCD 30, General 10.
    // CHANGE leg (100 @ ratio 0.6): PCD 60, General 40.
    // Net PCD debit = 30 + 60 = 90; net General debit = 10 + 40 = 50.
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(-90);
    expect(drawerBalance(db, "General", "USD")).toBe(-50);

    expect(result.drawerPayoutUsd).toBe(40);
    expect(result.drawerChangeUsd).toBe(100);
    expect(result.drawerOutUsd).toBe(140);

    const rows = paymentRows(db);
    const payoutRows = rows.filter((r) => r.amount === -30 || r.amount === -10);
    expect(payoutRows).toHaveLength(2);
    expect(payoutRows.find((r) => r.drawer_name === "OMT_System")?.note).toBe(
      "Basket payout to customer (primary-system item share)",
    );
    expect(payoutRows.find((r) => r.drawer_name === "General")?.note).toBe(
      "Basket payout to customer",
    );

    const changeRows = rows.filter((r) => r.amount === -60 || r.amount === -40);
    expect(changeRows).toHaveLength(2);
    expect(changeRows.find((r) => r.drawer_name === "OMT_System")?.note).toBe(
      "Basket change returned (primary-system item share)",
    );
    expect(changeRows.find((r) => r.drawer_name === "General")?.note).toBe(
      "Basket change returned",
    );
  });

  it("kind:CHANGE is byte-identical to kind-less (both legacy 'Basket change returned', charge-side ratio)", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Kind Change Explicit",
      phone: "802",
    });
    seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 50 });
    seedSessionNonSaleItem(db, sessionId, 50); // basket total 100 -> ratio 0.5

    service.recordBasketPayment(sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 150, direction: "IN" },
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 50,
          direction: "OUT",
          kind: "CHANGE",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // IN 150 @ 0.5: PCD 75, General 75. OUT 50 @ 0.5 (kind CHANGE, same
    // ratio as kind-less): PCD 25, General 25. Net PCD 50, net General 50 —
    // identical numbers to the sibling basket.test.ts's kind-less rule-16 case.
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(50);
    expect(drawerBalance(db, "General", "USD")).toBe(50);

    const rows = paymentRows(db);
    const outRows = rows.filter((r) => r.amount < 0);
    expect(outRows).toHaveLength(2);
    for (const row of outRows) {
      expect(row.note).toMatch(/^Basket change returned/);
    }
  });

  it("a payout-only basket (no charge items at all) still splits the kind:PAYOUT leg correctly — chargeTotal 0 never breaks the payout ratio", () => {
    const { sessionId } = seedSessionWithClient(db, {
      name: "Payout Only",
      phone: "803",
    });
    seedSessionFsItem(db, sessionId, {
      provider: "OMT",
      serviceType: "RECEIVE",
      amountUsd: -80,
    });

    service.recordBasketPayment(sessionId, {
      legs: [
        {
          method: "CASH",
          currencyCode: "USD",
          amount: 80,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
    });

    // payoutTotal 80, primaryPayout 80 -> ratio 1 -> all to PCD.
    expect(drawerBalance(db, "OMT_System", "USD")).toBe(-80);
    expect(drawerBalance(db, "General", "USD")).toBe(0);
  });
});
