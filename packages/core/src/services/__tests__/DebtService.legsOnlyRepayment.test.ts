/**
 * DebtService.addRepayment — LEGS-ONLY branch (amountUSD = amountLBP = 0, only
 * payment lines sent). Owner decision 2026-10-07: the debt goes down by the
 * money that came IN minus the change handed back (OUT legs), per currency —
 * never by the sum of every line. Before this fix a $120 payment with $20
 * change booked a $140 reduction.
 *
 * Cross-currency rule (this file pins it):
 *   - Each currency nets on its own: IN − OUT − kept in that currency.
 *   - A currency is never booked negative. If one side goes negative (change
 *     given in the other currency), the deficit is settled against the other
 *     side at the payload's `tender_exchange_rate` (rule 27: the client's
 *     rate, the same one the repository stamps and reconciles kept change at).
 *   - No tender rate sent in that case → refused with a plain message (the
 *     service may not read the server rate itself, rule 13).
 *   - Nothing left after netting → refused.
 *
 * Runs the REAL DebtRepository against an in-memory DB (schema copied from
 * DebtRepository.keptChange.test.ts). Payload field names come from
 * `addRepaymentSchema` (rule 24).
 *
 * Rule 17: the GUARD cases were run against the unfixed service first and
 * failed (see the report that accompanied this file). The void case is a
 * symmetry check — it passes before and after (a void reverses whatever was
 * booked) and is NOT failing-first.
 */

import Database from "better-sqlite3";
import { DebtService } from "../DebtService.js";
import { DebtRepository } from "../../repositories/DebtRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  snapshotLedgers,
  ledgerDeltas,
} from "../../repositories/testHelpers/postingAssert.js";
import { addRepaymentSchema } from "../../validators/debt.js";

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

function seedCharge(usd: number, lbp = 0): void {
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
     VALUES (?, 'Sale Debt', ?, ?, 1)`,
  ).run(CLIENT_ID, usd, lbp);
}

/** Sum of the client's debt ledger per currency (positive = owes). */
function balance(): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
}

function drawer(ccy: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ?`,
    )
    .get(ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function repaymentTxn(ledgerId: number) {
  return db
    .prepare(
      `SELECT t.id, t.amount_usd, t.amount_lbp, t.profit_usd, t.profit_lbp
       FROM debt_ledger dl JOIN transactions t ON t.id = dl.transaction_id
       WHERE dl.id = ?`,
    )
    .get(ledgerId) as {
    id: number;
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
  };
}

function ledgerRow(id: number): { amount_usd: number; amount_lbp: number } {
  return db
    .prepare(`SELECT amount_usd, amount_lbp FROM debt_ledger WHERE id = ?`)
    .get(id) as { amount_usd: number; amount_lbp: number };
}

function rowCount(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number })
    .c;
}

/** Legs-only payload, parsed through the shared schema (rule 24). */
function legsOnly(extra: Record<string, unknown>) {
  return {
    ...addRepaymentSchema.parse({ clientId: CLIENT_ID, ...extra }),
    userId: 1,
  };
}

let db: Database.Database;
let service: DebtService;
let txnRepo: TransactionRepository;

beforeEach(() => {
  db = createTestDb();
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetTransactionRepository();
  service = new DebtService(new DebtRepository());
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

describe("DebtService.addRepayment — legs-only branch nets change out", () => {
  it("GUARD: $120 in + $20 change back reduces the debt by $100", () => {
    seedCharge(150);
    const input = legsOnly({
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 120 },
        { method: "CASH", currencyCode: "USD", amount: 20, direction: "OUT" },
      ],
    });
    expect(input.amountUSD).toBe(0);
    expect(input.amountLBP).toBe(0);

    const result = service.addRepayment(input);

    expect(result.success).toBe(true);
    expect(ledgerRow(result.id!).amount_usd).toBeCloseTo(-100, 6);
    expect(ledgerRow(result.id!).amount_lbp).toBeCloseTo(0, 6);
    expect(balance().usd).toBeCloseTo(50, 6);
    expect(repaymentTxn(result.id!).amount_usd).toBeCloseTo(100, 6);
    // Drawer: +120 in, −20 change = +100 (unchanged posting behaviour).
    expect(drawer("USD")).toBeCloseTo(100, 6);
  });

  it("GUARD: same-currency LBP — 2,000,000 in + 200,000 change back reduces LBP debt by 1,800,000, no rate needed", () => {
    seedCharge(0, 5_000_000);
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 2_000_000 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 200_000,
            direction: "OUT",
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(ledgerRow(result.id!).amount_lbp).toBe(-1_800_000);
    expect(ledgerRow(result.id!).amount_usd).toBeCloseTo(0, 6);
    expect(balance().lbp).toBe(3_200_000);
    expect(drawer("LBP")).toBe(1_800_000);
  });

  it("GUARD: cross-currency — $120 in, 900,000 LBP change at a 90,000 tender rate reduces USD by $110 and never books LBP negative", () => {
    seedCharge(150);
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 120 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
        tender_exchange_rate: RATE,
      }),
    );

    expect(result.success).toBe(true);
    const row = ledgerRow(result.id!);
    expect(row.amount_usd).toBeCloseTo(-110, 6);
    expect(row.amount_lbp).toBeCloseTo(0, 6); // never a positive (debt-raising) LBP leg
    expect(balance().usd).toBeCloseTo(40, 6);
    expect(drawer("USD")).toBeCloseTo(120, 6);
    expect(drawer("LBP")).toBe(-900_000);
  });

  it("GUARD: cross-currency change with NO tender rate is refused with a plain message and writes nothing", () => {
    seedCharge(150);
    const before = {
      t: rowCount("transactions"),
      p: rowCount("payments"),
      d: rowCount("debt_ledger"),
    };
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 120 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exchange rate/i);
    expect({
      t: rowCount("transactions"),
      p: rowCount("payments"),
      d: rowCount("debt_ledger"),
    }).toEqual(before);
  });

  it("GUARD: change back equal to the money in leaves nothing to repay and is refused", () => {
    seedCharge(150);
    const before = rowCount("debt_ledger");
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 20 },
          { method: "CASH", currencyCode: "USD", amount: 20, direction: "OUT" },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing left/i);
    expect(rowCount("debt_ledger")).toBe(before);
  });

  it("GUARD: kept change on a legs-only request — $105 in, $5 kept → debt −$100, $5 profit (verified by resolveKeptChange)", () => {
    seedCharge(150);
    const result = service.addRepayment(
      legsOnly({
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
        keptChangeUSD: 5,
        tender_exchange_rate: RATE,
      }),
    );

    expect(result.success).toBe(true);
    expect(ledgerRow(result.id!).amount_usd).toBeCloseTo(-100, 6);
    expect(repaymentTxn(result.id!).profit_usd).toBeCloseTo(5, 6);
    expect(drawer("USD")).toBeCloseTo(105, 6);
  });

  it("kept change still goes through resolveKeptChange: a kept claim funded only by an account leg is refused", () => {
    seedCharge(150);
    const before = rowCount("debt_ledger");
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 105 },
        ],
        keptChangeUSD: 5,
        tender_exchange_rate: RATE,
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/drawer|cash or wallet/i);
    expect(rowCount("debt_ledger")).toBe(before);
  });

  it("explicit amounts are still trusted verbatim (legs-only netting does not touch that branch)", () => {
    seedCharge(150);
    const result = service.addRepayment(
      legsOnly({
        amountUSD: 100,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 120 },
          { method: "CASH", currencyCode: "USD", amount: 20, direction: "OUT" },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(ledgerRow(result.id!).amount_usd).toBe(-100);
  });

  it("symmetry (not failing-first): voiding a legs-only repayment with change nets every ledger to 0 per currency", () => {
    seedCharge(150);
    const before = snapshotLedgers(db);
    const result = service.addRepayment(
      legsOnly({
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 120 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
        tender_exchange_rate: RATE,
      }),
    );
    expect(result.success).toBe(true);

    txnRepo.voidTransaction(repaymentTxn(result.id!).id, 1);

    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(balance().usd).toBeCloseTo(150, 6);
  });
});
