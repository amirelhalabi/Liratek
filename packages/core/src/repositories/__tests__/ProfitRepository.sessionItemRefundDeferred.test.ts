/**
 * LIRA-232 phase 1 — cross-module check requested by the plan (SESSION_ITEM_
 * REFUND_PLAN.md §1, §8): does `ProfitRepository.getPendingSaleProfit` (the
 * Profits page's "Deferred > Unpaid sales" card) reflect a session item
 * refund's reduced debt WITHOUT any change to ProfitRepository.ts?
 *
 * It does. `getPendingSaleProfit`'s net-of-refund branch
 * (`_getPendingSaleProfitNet`, already shipped ahead of this ticket) reads
 * `sale_items.refunded_quantity` (which `refundSessionBasketItem` updates
 * via `SalesRepository.applySaleItemReversalForSession`) for its revenue net
 * and sums `transactions` rows by `source_table = 'sales' AND source_id`
 * for `potential_profit_usd` (`salePlusRefundProfitSubquery`) — the SAME
 * shape `refundSessionBasketItem`'s SALE-branch REFUND row uses. Neither
 * formula cares whether the refund came from the standalone POS flow or the
 * session-basket flow. `sales.paid_usd` (the OTHER half of `outstanding_usd`)
 * is untouched by an item refund, but for amir's fully-on-account scenario
 * it was already 0 (nothing was actually collected), so the net revenue side
 * alone carries the whole correction.
 *
 * Verified empirically (not just read from source, per fable-brain rule 28):
 * before the refund this fixture prints `total_amount_usd 1635 /
 * potential_profit_usd 225`, matching the owner's bug report; after
 * refunding the iPhone line, `135 / 25`, matching the plan's target table.
 */
import Database from "better-sqlite3";
import { SalesRepository, resetSalesRepository } from "../SalesRepository";
import { TransactionRepository, resetTransactionRepository } from "../TransactionRepository";
import { getProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { SessionPaymentService, resetSessionPaymentService } from "../../services/SessionPaymentService";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');
    CREATE TABLE clients (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, phone_number TEXT, whatsapp_opt_in INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE products (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cost_price_usd REAL NOT NULL DEFAULT 0, stock_quantity INTEGER NOT NULL DEFAULT 0, warranty_months INTEGER);
    CREATE TABLE sales (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, total_amount_usd REAL NOT NULL DEFAULT 0, discount_usd REAL NOT NULL DEFAULT 0, final_amount_usd REAL NOT NULL DEFAULT 0, paid_usd REAL NOT NULL DEFAULT 0, paid_lbp REAL NOT NULL DEFAULT 0, change_given_usd REAL NOT NULL DEFAULT 0, change_given_lbp REAL NOT NULL DEFAULT 0, exchange_rate_snapshot REAL, drawer_name TEXT DEFAULT 'General', status TEXT NOT NULL DEFAULT 'completed', note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sale_items (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER, quantity INTEGER NOT NULL DEFAULT 1, sold_price_usd REAL NOT NULL DEFAULT 0, cost_price_snapshot_usd REAL NOT NULL DEFAULT 0, imei TEXT, warranty_until TEXT, is_refunded INTEGER NOT NULL DEFAULT 0, refunded_quantity INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE transactions (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 1, amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, exchange_rate REAL, client_id INTEGER, client_name TEXT, client_phone TEXT, reverses_id INTEGER, profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT, device_id TEXT, transaction_time DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE payments (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, session_id INTEGER, method TEXT NOT NULL, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, amount REAL NOT NULL, note TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawer_balances (tenant_id INTEGER DEFAULT 1, drawer_name TEXT NOT NULL, currency_code TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (tenant_id, drawer_name, currency_code));
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
    CREATE TABLE payment_methods (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, label TEXT NOT NULL, drawer_name TEXT NOT NULL, affects_drawer INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, is_system INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES ('CASH', 'Cash', 'General', 1, 1, 1), ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);
    CREATE TABLE debt_ledger (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL, amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, transaction_id INTEGER, note TEXT, due_date TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, session_id INTEGER, is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE customer_sessions (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT, customer_phone TEXT, customer_notes TEXT, user_id INTEGER, started_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT, started_by TEXT NOT NULL, closed_by TEXT, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE customer_session_transactions (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, transaction_type TEXT NOT NULL, transaction_id INTEGER NOT NULL, unified_transaction_id INTEGER, amount_usd REAL NOT NULL DEFAULT 0, amount_lbp REAL NOT NULL DEFAULT 0, profit_usd REAL NOT NULL DEFAULT 0, profit_lbp REAL NOT NULL DEFAULT 0, paid_exchange_rate REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE exchange_rates (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, to_code TEXT NOT NULL, market_rate REAL NOT NULL, buy_rate REAL NOT NULL, sell_rate REAL NOT NULL, is_stronger INTEGER NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES ('LBP', 90000, 89000, 91000, 1);
    CREATE TABLE system_settings (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT NOT NULL UNIQUE, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
    CREATE TABLE product_stock_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, product_id INTEGER NOT NULL, supplier_id INTEGER, quantity INTEGER NOT NULL, quantity_remaining INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0, books_debt INTEGER NOT NULL DEFAULT 0, ledger_entry_id INTEGER, transaction_id INTEGER, is_opening INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE maintenance_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, maintenance_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0, unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0, stock_restored INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE stock_batch_consumptions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, batch_id INTEGER NOT NULL, sale_item_id INTEGER, custom_service_id INTEGER, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_cost_usd DECIMAL(10,2) NOT NULL, reason TEXT NOT NULL DEFAULT 'SALE', is_restored INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL);
    CREATE TABLE partner_ledger (tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER, reference_table TEXT, reference_id INTEGER, transaction_type TEXT, amount REAL DEFAULT 0, covered_amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', direction TEXT);
  `);
  return db;
}

describe("VERIFY Profits Deferred reflects session item refund", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;
  const USER_ID = 1;
  const RATE = 90000;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSalesRepository();
    resetTransactionRepository();
    resetProfitRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetRateRepository();
    resetSessionPaymentService();
    salesRepo = new SalesRepository();
    txnRepo = new TransactionRepository();
    sessionPaymentService = new SessionPaymentService();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetSalesRepository();
    resetTransactionRepository();
    resetProfitRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetRateRepository();
    resetSessionPaymentService();
  });

  it("Deferred unpaid-sales card reflects $135/$25 after the iPhone item refund", () => {
    const clientId = Number(
      db.prepare(`INSERT INTO clients (full_name) VALUES ('amir')`).run().lastInsertRowid,
    );
    const sessionId = Number(
      db.prepare("INSERT INTO customer_sessions (started_by) VALUES ('admin')").run()
        .lastInsertRowid,
    );
    const productIds = [
      Number(
        db
          .prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('iPhone', 1300, 100)`)
          .run().lastInsertRowid,
      ),
      Number(
        db
          .prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('test', 100, 100)`)
          .run().lastInsertRowid,
      ),
      Number(
        db
          .prepare(`INSERT INTO products (name, cost_price_usd, stock_quantity) VALUES ('testpart', 10, 100)`)
          .run().lastInsertRowid,
      ),
    ];
    const result = salesRepo.processSale(
      {
        client_id: clientId,
        items: [
          { product_id: productIds[0], quantity: 1, price: 1500 },
          { product_id: productIds[1], quantity: 1, price: 120 },
          { product_id: productIds[2], quantity: 1, price: 15 },
        ],
        total_amount: 1635,
        discount: 0,
        final_amount: 1635,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        deferPayment: true,
      },
      USER_ID,
    );
    const saleId = result.id!;
    const txnRow = db
      .prepare(`SELECT id FROM transactions WHERE source_table='sales' AND source_id=? AND type='SALE'`)
      .get(saleId) as { id: number };
    db.prepare(
      `INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp) VALUES (?, 'sale', ?, ?, 1635, 0)`,
    ).run(sessionId, saleId, txnRow.id);
    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 1635 }],
      exchangeRate: RATE,
      userId: USER_ID,
      clientId,
    });

    const before = getProfitRepository().getPendingSaleProfit();
    console.log("BEFORE:", JSON.stringify(before));

    const itemIds = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id=? ORDER BY id ASC`).all(saleId) as {
        id: number;
      }[]
    ).map((r) => r.id);
    txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnRow.id,
      saleItemId: itemIds[0],
      quantity: 1,
      userId: USER_ID,
    });

    const after = getProfitRepository().getPendingSaleProfit();
    console.log("AFTER:", JSON.stringify(after));

    expect(after[0].total_amount_usd).toBeCloseTo(135, 6);
    expect(after[0].outstanding_usd).toBeCloseTo(135, 6);
    expect(after[0].potential_profit_usd).toBeCloseTo(25, 6);
  });
});
