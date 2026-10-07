/**
 * Debts — kept change (owner decisions 2026-10-07), both directions:
 *
 *  - Repayment (payer = customer): the client hands over MORE than the debt
 *    and the cashier keeps the extra as shop profit. The server now checks
 *    the claim with `resolveKeptChange` (POSTING_MAP G42) and the kept extra
 *    no longer feeds the FIFO sale/service coverage or the provider-drawer
 *    routing (G44) — only the amount actually applied to the debt does.
 *  - Credit cash-out (payer = payout): the shop hands the client LESS than
 *    the credit (e.g. $101 of a $101.12 credit). The credit still clears to
 *    0 and the shortfall is shop profit on the CREDIT_CASH_OUT row. A payout
 *    never carries an OUT (change) leg, and a cash-out can only be paid out
 *    of a real drawer.
 *
 * Rule 17: every "guard" case below was run against the unchanged
 * repository first and failed — see the report that accompanied this file.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { snapshotLedgers, ledgerDeltas } from "../testHelpers/postingAssert.js";

const RATE = 90_000;
const CLIENT_ID = 1;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (${CLIENT_ID}, 'Repayment Client');

    CREATE TABLE transactions (
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
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    -- Supplier Stock Intake (LIRA-164): refundTransaction()'s sale branch
    -- unconditionally restores stock via StockBatchRepository.
    -- restoreForSaleItem, which queries/prepares against both tables even
    -- when the product has no batch history — the "refunding the SALE
    -- itself" case above dies in setup without these.
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      quantity_remaining INTEGER NOT NULL CHECK(quantity_remaining >= 0),
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );



    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE' CHECK(reason IN ('SALE','ADJUSTMENT','SERVICE')),
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
  maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
);

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'BILL',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);
  `);
  return db;
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** A raw manual debt charge — no transaction link needed: neither
 *  _coverServiceDebtsFIFO/_unwindServiceDebtCoverageFifo require one. */
function seedCharge(
  db: Database.Database,
  clientId: number,
  type: string,
  usd: number,
  lbp = 0,
): void {
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(clientId, type, usd, lbp);
}

/** An unpaid sale wired the way _markSalesPaidFIFO's JOIN expects. */
function seedUnpaidSale(
  db: Database.Database,
  clientId: number,
  finalAmountUsd: number,
): number {
  const sale = db
    .prepare(
      `INSERT INTO sales (final_amount_usd, paid_usd, status) VALUES (?, 0, 'completed')`,
    )
    .run(finalAmountUsd);
  const saleId = Number(sale.lastInsertRowid);
  db.prepare(
    `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, client_id, summary)
     VALUES ('SALE', 'sales', ?, 1, ?, ?, 'Sale on account')`,
  ).run(saleId, finalAmountUsd, clientId);
  return saleId;
}

/** OMT service debt wired the way the provider-routing lookup expects. */
function seedServiceDebt(
  db: Database.Database,
  clientId: number,
  amountUsd: number,
): void {
  const fs = db
    .prepare(
      `INSERT INTO financial_services (provider, amount) VALUES ('OMT', ?)`,
    )
    .run(amountUsd);
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, client_id)
       VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, 1, ?, ?)`,
    )
    .run(fs.lastInsertRowid, amountUsd, clientId);
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
     VALUES (?, 'Service Debt', ?, 0, ?, 1)`,
  ).run(clientId, amountUsd, txn.lastInsertRowid);
}

function drawer(db: Database.Database, name: string, ccy: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function balance(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
}

function txnFor(db: Database.Database, ledgerId: number) {
  return db
    .prepare(
      `SELECT t.id, t.type, t.profit_usd, t.profit_lbp
       FROM debt_ledger dl JOIN transactions t ON t.id = dl.transaction_id
       WHERE dl.id = ?`,
    )
    .get(ledgerId) as {
    id: number;
    type: string;
    profit_usd: number;
    profit_lbp: number;
  };
}

function activeProfit(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
       FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
}

function rowCounts(db: Database.Database) {
  const n = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  return {
    transactions: n("transactions"),
    payments: n("payments"),
    debt_ledger: n("debt_ledger"),
  };
}

/** A client holding a prepaid credit (negative balance). */
function seedCredit(db: Database.Database, usd: number, lbp = 0): void {
  seedCharge(db, CLIENT_ID, "CREDIT_DEPOSIT", -usd, -lbp);
}

type CashOutArgs = Parameters<DebtRepository["cashOutCredit"]>[0];

describe("Debts — kept change", () => {
  let db: Database.Database;
  let debtRepo: DebtRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    debtRepo = new DebtRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  // ── Repayment (payer = customer) ─────────────────────────────────────────

  describe("repayment", () => {
    it("books an honest kept extra as profit, reduces the debt by the applied amount only", () => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
      const { id } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 100,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
        kept_change_usd: 5,
        tender_exchange_rate: RATE,
      });
      expect(txnFor(db, id).profit_usd).toBeCloseTo(5, 6);
      expect(balance(db).usd).toBeCloseTo(0, 6);
      expect(drawer(db, "General", "USD")).toBeCloseTo(105, 6);
    });

    it("GUARD: refuses a kept claim the payment lines do not support (tampered), writing nothing", () => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
      const before = rowCounts(db);
      expect(() =>
        debtRepo.addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 100,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          kept_change_usd: 5,
          tender_exchange_rate: RATE,
        }),
      ).toThrow(/reconcile/);
      expect(rowCounts(db)).toEqual(before);
      expect(activeProfit(db).usd).toBe(0);
    });

    it("GUARD: refuses a phantom kept under the $0.05 reconcile epsilon on an exact payment", () => {
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
      expect(() =>
        debtRepo.addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 100,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          kept_change_usd: 0.04,
          tender_exchange_rate: RATE,
        }),
      ).toThrow(/more than the change actually due/);
    });

    it("GUARD (G44): the kept extra does not FIFO-cover the next open service charge", () => {
      const saleId = seedUnpaidSale(db, CLIENT_ID, 100);
      seedCharge(db, CLIENT_ID, "Sale Debt", 100);
      seedCharge(db, CLIENT_ID, "Recharge Debt", 50);
      debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 100,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 1,
        tender_exchange_rate: RATE,
      });
      const sale = db
        .prepare(`SELECT paid_usd FROM sales WHERE id = ?`)
        .get(saleId) as { paid_usd: number };
      expect(sale.paid_usd).toBeCloseTo(100, 6);
      const charge = db
        .prepare(
          `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Recharge Debt'`,
        )
        .get() as { covered_usd: number };
      expect(charge.covered_usd).toBeCloseTo(0, 6);
    });

    it("GUARD (G44): the kept extra is not routed into the provider's cash drawer", () => {
      seedServiceDebt(db, CLIENT_ID, 150);
      debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 100,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 1,
        tender_exchange_rate: RATE,
      });
      expect(drawer(db, "OMT_System", "USD")).toBeCloseTo(100, 6);
      expect(drawer(db, "General", "USD")).toBeCloseTo(1, 6);
    });

    it("GUARD (G44): an LBP kept extra does not FIFO-cover the next open LBP charge", () => {
      // Two LBP module charges; 1,000,000 LBP handed over against the first
      // (900,000) with 100,000 kept. Only 900,000 is applied.
      seedCharge(db, CLIENT_ID, "Recharge Debt", 0, 900_000);
      seedCharge(db, CLIENT_ID, "Recharge Debt", 0, 500_000);
      debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 0,
        amount_lbp: 900_000,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 1_000_000 }],
        kept_change_lbp: 100_000,
        tender_exchange_rate: RATE,
      });
      const rows = db
        .prepare(
          `SELECT covered_lbp FROM debt_ledger WHERE transaction_type = 'Recharge Debt' ORDER BY id`,
        )
        .all() as Array<{ covered_lbp: number }>;
      expect(rows.map((r) => r.covered_lbp)).toEqual([900_000, 0]);
    });

    it("create + void nets drawers, debt and profit to 0 per currency", () => {
      seedServiceDebt(db, CLIENT_ID, 150);
      seedCharge(db, CLIENT_ID, "Recharge Debt", 20);
      const before = snapshotLedgers(db);
      const profitBefore = activeProfit(db);
      const { id } = debtRepo.addRepayment({
        client_id: CLIENT_ID,
        amount_usd: 100,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        kept_change_usd: 1,
        tender_exchange_rate: RATE,
      });
      expect(activeProfit(db).usd).toBeCloseTo(profitBefore.usd + 1, 6);
      txnRepo.voidTransaction(txnFor(db, id).id, 1);
      expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
        drawers: {},
        supplier: {},
        partner: {},
        debt: {},
      });
      expect(activeProfit(db)).toEqual(profitBefore);
    });

    it.each(["void", "refund"] as const)(
      "%s of a kept repayment gives back exactly the coverage it applied (kept extra never covered)",
      (mode) => {
        // Two module charges; an earlier repayment (nothing kept) leaves the
        // oldest partly covered, so an over-unwind could not hide behind the
        // clamp at 0.
        seedCharge(db, CLIENT_ID, "Recharge Debt", 50);
        seedCharge(db, CLIENT_ID, "Recharge Debt", 50);
        debtRepo.addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 30,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
          tender_exchange_rate: RATE,
        });
        const covered = () =>
          (
            db
              .prepare(
                `SELECT covered_usd FROM debt_ledger WHERE transaction_type = 'Recharge Debt' ORDER BY id`,
              )
              .all() as Array<{ covered_usd: number }>
          ).map((r) => r.covered_usd);
        expect(covered()).toEqual([30, 0]);

        const { id } = debtRepo.addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 40,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 41 }],
          kept_change_usd: 1,
          tender_exchange_rate: RATE,
        });
        expect(covered()).toEqual([50, 20]);

        const txnId = txnFor(db, id).id;
        if (mode === "void") txnRepo.voidTransaction(txnId, 1);
        else txnRepo.refundTransaction(txnId, 1);
        expect(covered()).toEqual([30, 0]);
        expect(activeProfit(db).usd).toBeCloseTo(0, 6);
      },
    );

    it("no kept claimed: behaves exactly as before (no reconcile added)", () => {
      // Smart rounding: a $0.01 debt settled by a 5,900 LBP note is accepted
      // today although it exceeds the $0.05 epsilon — unchanged.
      seedCharge(db, CLIENT_ID, "Sale Debt", 0.01);
      expect(() =>
        debtRepo.addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 0.01,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 5_900 }],
          tender_exchange_rate: RATE,
        }),
      ).not.toThrow();
    });
  });

  // ── Credit cash-out (payer = payout) ─────────────────────────────────────

  describe("credit cash-out", () => {
    it("GUARD: kept shortfall is shop profit and the credit clears to 0", () => {
      seedCredit(db, 101.12);
      const before = snapshotLedgers(db);
      const { id } = debtRepo.cashOutCredit({
        client_id: CLIENT_ID,
        amount_usd: 101.12,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
        tender_exchange_rate: RATE,
        kept_change_usd: 0.12,
      } as CashOutArgs);
      const t = txnFor(db, id);
      expect(t.type).toBe("CREDIT_CASH_OUT");
      expect(t.profit_usd).toBeCloseTo(0.12, 6);
      expect(t.profit_lbp).toBe(0);
      expect(balance(db).usd).toBeCloseTo(0, 6);
      expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
        drawers: { "General|USD": -101 },
        supplier: {},
        partner: {},
        debt: { [`${CLIENT_ID}|USD`]: 101.12 },
      });
    });

    it("GUARD: LBP credit — kept shortfall stamped as LBP profit, credit clears to 0", () => {
      seedCredit(db, 0, 9_050_000);
      const { id } = debtRepo.cashOutCredit({
        client_id: CLIENT_ID,
        amount_usd: 0,
        amount_lbp: 9_050_000,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 9_000_000 }],
        tender_exchange_rate: RATE,
        kept_change_lbp: 50_000,
      } as CashOutArgs);
      const t = txnFor(db, id);
      expect(t.profit_lbp).toBe(50_000);
      expect(t.profit_usd).toBe(0);
      expect(balance(db).lbp).toBeCloseTo(0, 6);
      expect(drawer(db, "General", "LBP")).toBe(-9_000_000);
    });

    it("GUARD: an OUT (change) leg is refused — it used to be debited with the wrong sign", () => {
      seedCredit(db, 50);
      const before = rowCounts(db);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 45,
          amount_lbp: 0,
          created_by: 1,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 50 },
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 5,
              direction: "OUT",
            },
          ],
          tender_exchange_rate: RATE,
        }),
      ).toThrow(/OUT/);
      expect(rowCounts(db)).toEqual(before);
      expect(drawer(db, "General", "USD")).toBe(0);
    });

    it("GUARD: a tampered kept claim is refused (lines already cover the credit)", () => {
      seedCredit(db, 100);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 100,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          tender_exchange_rate: RATE,
          kept_change_usd: 0.5,
        } as CashOutArgs),
      ).toThrow();
      expect(activeProfit(db).usd).toBe(0);
    });

    it("GUARD: a kept claim at or above the $1 cap is refused", () => {
      seedCredit(db, 110);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 110,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          tender_exchange_rate: RATE,
          kept_change_usd: 10,
        } as CashOutArgs),
      ).toThrow(/small leftover/);
    });

    it("GUARD: payout lines that do not match the credit reduction are refused", () => {
      // Hands out $80 but books a $100 credit reduction with nothing kept —
      // $20 of credit would vanish unbooked.
      seedCredit(db, 100);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 100,
          amount_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 80 }],
          tender_exchange_rate: RATE,
        }),
      ).toThrow(/reconcile/);
    });

    it("GUARD: a CUSTOMER_ACCOUNT payout leg is refused instead of silently skipped", () => {
      seedCredit(db, 40);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 40,
          amount_lbp: 0,
          created_by: 1,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 40 },
          ],
          tender_exchange_rate: RATE,
        }),
      ).toThrow(/drawer/);
      expect(balance(db).usd).toBeCloseTo(-40, 6);
    });

    it("GUARD: kept change on a mixed USD + LBP credit is refused", () => {
      seedCredit(db, 50, 900_000);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 50,
          amount_lbp: 900_000,
          created_by: 1,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 49.5 },
            { method: "CASH", currencyCode: "LBP", amount: 900_000 },
          ],
          tender_exchange_rate: RATE,
          kept_change_usd: 0.5,
        } as CashOutArgs),
      ).toThrow(/one currency/);
    });

    it("cross-currency cash-out without kept reconciles at the tender rate", () => {
      // LBP credit paid out in USD at the buy rate the sheet used (89,000).
      seedCredit(db, 0, 890_000);
      expect(() =>
        debtRepo.cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 0,
          amount_lbp: 890_000,
          created_by: 1,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
          tender_exchange_rate: 89_000,
        }),
      ).not.toThrow();
      expect(balance(db).lbp).toBeCloseTo(0, 6);
    });

    it("legacy caller with no payment lines still works (default CASH legs)", () => {
      seedCredit(db, 20, 100_000);
      debtRepo.cashOutCredit({
        client_id: CLIENT_ID,
        amount_usd: 20,
        amount_lbp: 100_000,
        created_by: 1,
      });
      expect(drawer(db, "General", "USD")).toBe(-20);
      expect(drawer(db, "General", "LBP")).toBe(-100_000);
    });
  });
});
