/**
 * LIRA-258 G14 (POSTING_INTEGRITY_PLAN.md item 2.8, POSTING_MAP.md §7.1):
 * a loto ticket's payment legs were booked one by one with no check that they
 * add up to the ticket, and every non-drawer leg except an IN
 * CUSTOMER_ACCOUNT leg was silently dropped:
 *   - legs that underpay / overpay the ticket were accepted as-is;
 *   - a GIFT_CARD leg redeemed nothing and charged no one;
 *   - a CUSTOMER_ACCOUNT OUT leg (change kept as store credit) credited no
 *     one — the customer lost their change;
 *   - an unregistered non-drawer method vanished;
 *   - a for-partner ticket still posted OUT drawer legs (the leg loop ran
 *     before the partner guard, and the guard only looked at IN legs);
 *   - editing a ticket's sale_amount / commission after creation moved no
 *     posting at all.
 *
 * Every ledger is checked with `postingAssert` (a ledger not named must not
 * move), and the store-credit / gift-card cases are voided again to prove
 * rule 20: create + void nets to 0 on every ledger, per currency.
 *
 * Rule 17: this file was written BEFORE the fix and run against the unfixed
 * code; the failing cases are recorded in the LIRA-258 hand-back.
 */
import Database from "better-sqlite3";
import { LotoTicketRepository } from "../LotoTicketRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setDb } = require("../../db/connection");

const SALE = 500_000;
const COMMISSION = 22_250;
const WE_OWE = SALE - COMMISSION;
const SELL_RATE = 90_000;
const CLIENT_ID = 1;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'Walk In', '70000000');

    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Partner A');

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate)
      VALUES (1, 'LBP', 89500, 89000, ${SELL_RATE});

    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );
    INSERT INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_system) VALUES
      (1, 'CASH', 'Cash', 'General', 1, 0, 1),
      (1, 'OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      (1, 'CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 4, 1),
      (1, 'GIFT_CARD', 'Gift Card / Voucher', 'General', 0, 5, 1),
      (1, 'IOU_NOTE', 'IOU note (no drawer)', 'General', 0, 6, 0);

    CREATE TABLE vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      code TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_phone TEXT,
      amount DECIMAL(10, 2) NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      redeemed_at TEXT,
      redeemed_by INTEGER,
      redeemed_in_transaction TEXT,
      redeemed_transaction_id INTEGER,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      note TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, created_by)
      VALUES (1, 'GIFT-LOTO-0001', 1, 'Walk In', ${SALE}, 'LBP', 1);

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
      edited_by TEXT,
      edited_at DATETIME,
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
      session_id INTEGER,
      note TEXT,
      created_by INTEGER,
      due_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
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
      settlement_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
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
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 50000000, CURRENT_TIMESTAMP);
  `);
  return db;
}

function lotoSupplierId(db: Database.Database): number {
  return (
    db.prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`).get() as {
      id: number;
    }
  ).id;
}

function lotoTxnId(db: Database.Database, ticketId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'LOTO' AND source_id = ?`,
      )
      .get(ticketId) as { id: number }
  ).id;
}

function rowCount(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

const base = {
  sale_amount: SALE,
  commission_amount: COMMISSION,
  sale_date: "2026-10-06",
  currency: "LBP",
  userId: 1,
};

describe("LotoTicketRepository — G14 leg integrity", () => {
  let db: Database.Database;
  let repo: LotoTicketRepository;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtRepository();
    resetDebtService();
    resetVoucherRepository();
    resetPaymentMethodRepository();
    repo = new LotoTicketRepository(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
    resetDebtRepository();
    resetDebtService();
    resetVoucherRepository();
    resetPaymentMethodRepository();
  });

  // ── reconciliation ─────────────────────────────────────────────────────

  it("rejects legs that UNDERPAY the ticket, and writes nothing", () => {
    const before = snapshotLedgers(db);
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
      }),
    ).toThrow(/do not reconcile/);
    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  it("rejects legs that OVERPAY the ticket with no change leg", () => {
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 800_000 }],
      }),
    ).toThrow(/do not reconcile/);
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  it("rejects OUT-only legs (nothing paid in)", () => {
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "CASH",
        payments: [
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 100_000,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/payment/i);
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  it("accepts a USD payment converted at the till's tender rate (buy/sell spread)", () => {
    // 500,000 LBP at the till's 89,000 buy rate = $5.618; at the 90,000 sell
    // rate it would be $5.556 — a $0.06 gap, over the $0.05 tolerance. The
    // till's own rate must be used, as RechargeRepository does.
    const usd = Math.round((SALE / 89_000) * 100) / 100;
    const before = snapshotLedgers(db);
    repo.createTicket({
      ...base,
      payment_method: "CASH",
      tender_exchange_rate: 89_000,
      payments: [{ method: "CASH", currencyCode: "USD", amount: usd }],
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": usd },
      supplier: { [`${lotoSupplierId(db)}|LBP`]: WE_OWE },
    });
  });

  it("control: the same USD payment WITHOUT the till's rate is compared at the sell rate and refused", () => {
    // Pins why the Loto page must send `tender_exchange_rate`: without it the
    // ticket reconciles at the 90,000 sell rate and the $0.06 spread gap is
    // over tolerance.
    const usd = Math.round((SALE / 89_000) * 100) / 100;
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: usd }],
      }),
    ).toThrow(/do not reconcile/);
  });

  // ── change kept as store credit (CUSTOMER_ACCOUNT OUT leg) ─────────────

  it("books a CUSTOMER_ACCOUNT OUT leg as store credit, and a void nets every ledger to 0", () => {
    const before = snapshotLedgers(db);
    const ticket = repo.createTicket({
      ...base,
      payment_method: "CASH",
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 500_000,
          direction: "OUT",
        },
      ],
    });
    const txnId = lotoTxnId(db, ticket.id);

    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": 1_000_000 },
      supplier: { [`${lotoSupplierId(db)}|LBP`]: WE_OWE },
      debt: { [`${CLIENT_ID}|LBP`]: -500_000 },
    });
    const credit = db
      .prepare(
        `SELECT transaction_id FROM debt_ledger WHERE transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get() as { transaction_id: number | null } | undefined;
    expect(credit?.transaction_id).toBe(txnId);

    new TransactionRepository().voidTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses store-credit change without a client", () => {
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "CASH",
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "LBP",
            amount: 500_000,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/client/i);
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  // ── gift card ──────────────────────────────────────────────────────────

  it("redeems a GIFT_CARD leg and charges it as Loto Debt (like Recharge); a void nets every ledger to 0", () => {
    const before = snapshotLedgers(db);
    const ticket = repo.createTicket({
      ...base,
      payment_method: "GIFT_CARD",
      clientId: CLIENT_ID,
      payments: [
        {
          method: "GIFT_CARD",
          currencyCode: "LBP",
          amount: SALE,
          voucherCode: "gift-loto-0001",
        },
      ],
    });
    const txnId = lotoTxnId(db, ticket.id);

    const voucher = db
      .prepare(
        `SELECT status, redeemed_transaction_id FROM vouchers WHERE code = 'GIFT-LOTO-0001'`,
      )
      .get() as { status: string; redeemed_transaction_id: number | null };
    expect(voucher.status).toBe("redeemed");
    expect(voucher.redeemed_transaction_id).toBe(txnId);

    const rows = db
      .prepare(
        `SELECT transaction_type, amount_lbp FROM debt_ledger WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnId) as { transaction_type: string; amount_lbp: number }[];
    expect(rows).toEqual([
      { transaction_type: "CREDIT_DEPOSIT", amount_lbp: -SALE },
      { transaction_type: "Loto Debt", amount_lbp: SALE },
    ]);
    // Voucher value in, ticket charge out: the customer's balance nets to 0.
    expectPostings(before, snapshotLedgers(db), {
      supplier: { [`${lotoSupplierId(db)}|LBP`]: WE_OWE },
    });

    new TransactionRepository().voidTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses a GIFT_CARD leg with no voucher code, naming the problem", () => {
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "GIFT_CARD",
        clientId: CLIENT_ID,
        payments: [{ method: "GIFT_CARD", currencyCode: "LBP", amount: SALE }],
      }),
    ).toThrow(/gift card code/i);
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  // ── unsupported non-drawer methods ─────────────────────────────────────

  it("refuses a non-drawer method it cannot post (not a silent drop)", () => {
    expect(() =>
      repo.createTicket({
        ...base,
        payment_method: "IOU_NOTE",
        clientId: CLIENT_ID,
        payments: [{ method: "IOU_NOTE", currencyCode: "LBP", amount: SALE }],
      }),
    ).toThrow(/IOU_NOTE/);
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  // ── for-partner ticket ─────────────────────────────────────────────────

  it("refuses ANY leg on a for-partner ticket — an OUT drawer leg must not post", () => {
    const before = snapshotLedgers(db);
    expect(() =>
      repo.createTicket({
        ...base,
        partnerId: 1,
        partnerMode: "FOR",
        payments: [
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 100_000,
            direction: "OUT",
          },
        ],
      }),
    ).toThrow(/takes no counter payment/);
    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCount(db, "loto_tickets")).toBe(0);
  });

  // ── editing money fields after creation ────────────────────────────────

  it("refuses to edit sale_amount / commission after creation; winner fields stay editable", () => {
    const ticket = repo.createTicket({
      ...base,
      payment_method: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
    });

    expect(() => repo.updateTicket(ticket.id, { sale_amount: 1 })).toThrow(
      /void/i,
    );
    expect(() =>
      repo.updateTicket(ticket.id, { commission_amount: 1 }),
    ).toThrow(/void/i);
    expect(() =>
      repo.updateTicket(ticket.id, { commission_rate: 0.1 }),
    ).toThrow(/void/i);

    const row = repo.getTicketById(ticket.id)!;
    expect(row.sale_amount).toBe(SALE);
    expect(row.commission_amount).toBe(COMMISSION);

    const winner = repo.updateTicket(ticket.id, {
      is_winner: 1,
      prize_amount: 1_000_000,
    });
    expect(winner?.is_winner).toBe(1);
    expect(winner?.prize_amount).toBe(1_000_000);
  });
});
