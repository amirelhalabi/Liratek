/**
 * TransactionRepository — a WHOLE-sale void/refund is refused once ANY of
 * the sale's lines has already been item-refunded (owner decision
 * 2026-08-26, LIRA-143 item 1).
 *
 * ## The money bug this closes
 *
 * `SalesRepository.refundSaleItem` refunds ONE line: it pro-rates the
 * original payment legs (`lineShareOfSale = refundAmount /
 * sales.total_amount_usd` — the line's share of the sale's PRE-discount total)
 * and debits the drawers by that share. Critically, the REFUND row it writes
 * carries NO `reverses_id` — it is a standalone row, not a reversal of the
 * SALE. `_refundTransactionInternal`'s existing double-refund guard looks for
 * `reverses_id = <sale txn> AND type = 'REFUND'`, so it never saw those
 * item refunds at all.
 *
 * A whole-sale refund/void then mirrors the original's FULL payment legs
 * (`_reversePayments`) — the entire tender, including the share already
 * handed back. Probe-proven on a $30 sale: a $10 item refund followed by a
 * whole refund moved $40 out of the drawer for a $30 sale.
 *
 * ## Why BLOCK rather than pro-rate (owner decision)
 *
 * The alternative deliberately NOT taken was to make the whole-sale reversal
 * subtract what the item refunds already returned — the money twin of what
 * `_restoreStock` does for quantity. Rejected because the arithmetic is not
 * reconstructible from the rows: an item refund's legs are a RATIO of the
 * original tender (split across every method/drawer/currency the customer
 * used), and `refundLegs` overrides (LIRA-078) let the operator hand the
 * money back through a DIFFERENT method than it came in on. "Net out the
 * remainder" would therefore have to guess which drawer still owes what,
 * and a wrong guess is a silent cash error rather than a visible one. The
 * per-item path already refunds the remainder exactly and is fully
 * reversible, so the operator loses no capability — only the shortcut.
 *
 * That "exactly" did NOT hold on a DISCOUNTED sale when this decision was
 * taken: `refundSaleItem`'s leg ratio divided by the POST-discount final while
 * its numerator was the line's PRE-discount value, so the per-line shares
 * summed to > 1 and refunding every line returned the full pre-discount price
 * on a discounted tender (over by the discount, per currency). Since this
 * guard makes the per-item route the only sanctioned one, that was fixed in
 * the same pass — see `SalesRepository.discountItemRefundTender.test.ts`.
 *
 * ## Rule 17 — failing-first, recorded
 *
 * Both blocked cases were run against the pre-guard code and observed
 * over-debiting the drawer:
 *
 *   refund path: expected drawer 5020, received 4990  (−$30 mirrored on top
 *                of the −$10 already returned, for a $30 sale)
 *   void   path: expected drawer 5020, received 4990  (identical)
 *
 * The exact assertions that produced those numbers are kept below, inverted:
 * where the pre-fix run recorded 4990 the test now demands the named throw
 * plus an UNCHANGED 5020.
 */

import Database from "better-sqlite3";
import { SalesRepository, type SaleRequest } from "../SalesRepository.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetProductUnitRepository } from "../ProductUnitRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      cost_price_usd  REAL NOT NULL DEFAULT 0,
      stock_quantity  INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER,
      tenant_id       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL NOT NULL DEFAULT 0,
      discount_usd           REAL NOT NULL DEFAULT 0,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      change_given_usd       REAL NOT NULL DEFAULT 0,
      change_given_lbp       REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT NOT NULL DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                 INTEGER NOT NULL,
      product_id              INTEGER,
      quantity                INTEGER NOT NULL DEFAULT 1,
      sold_price_usd          REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL NOT NULL DEFAULT 0,
      imei                    TEXT,
      warranty_until          TEXT,
      is_refunded             INTEGER NOT NULL DEFAULT 0,
      refunded_quantity       INTEGER NOT NULL DEFAULT 0,
      tenant_id               INTEGER NOT NULL DEFAULT 1
    );

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
      tenant_id     INTEGER NOT NULL DEFAULT 1,
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance, updated_at) VALUES (1, 'General', 'LBP', 20000000, CURRENT_TIMESTAMP);

    -- Only for the "non-sale transaction" short-circuit case below:
    -- _markSourceRefunded stamps is_refunded on this table by name.
    CREATE TABLE expenses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd   REAL NOT NULL DEFAULT 0,
      is_refunded  INTEGER NOT NULL DEFAULT 0,
      refunded_at  TEXT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO expenses (id, amount_usd, tenant_id) VALUES (1, 12, 1);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'cashier')`).run();
  return db;
}

/** The named guard message, as the operator sees it. */
const PARTIAL_REFUND_BLOCK =
  /This sale was partially refunded — refund the remaining items individually/;

/**
 * LIRA-146 — the guard's OTHER message: every line was already refunded
 * item-by-item (nothing partial remains), so the old "refund the remaining
 * items individually" text was a dead end. See `_assertNoPartialItemRefunds`.
 */
const FULLY_ITEM_REFUNDED_BLOCK =
  /This sale has already been fully refunded item-by-item — nothing remains to refund\./;

describe("TransactionRepository — whole-sale void/refund after a partial item refund", () => {
  let db: Database.Database;
  let salesRepo: SalesRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetProductUnitRepository();
    salesRepo = new SalesRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetProductUnitRepository();
    resetTenantContext();
  });

  const baseSale = (overrides: Partial<SaleRequest> = {}): SaleRequest => ({
    client_id: null,
    items: [],
    total_amount: 0,
    discount: 0,
    final_amount: 0,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: 90_000,
    ...overrides,
  });

  function drawerUsd(): number {
    return (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
        )
        .get() as { balance: number }
    ).balance;
  }

  function saleTxnId(saleId: number): number {
    return (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
        )
        .get(saleId) as { id: number }
    ).id;
  }

  function refundRowCount(saleId: number): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM transactions WHERE type = 'REFUND' AND source_table = 'sales' AND source_id = ?`,
        )
        .get(saleId) as { c: number }
    ).c;
  }

  function saleStatus(saleId: number): string {
    return (
      db.prepare(`SELECT status FROM sales WHERE id = ?`).get(saleId) as {
        status: string;
      }
    ).status;
  }

  /** $30 sale: 3 x $10, tendered in cash to General/USD. */
  function sellThreeAtTen(): { saleId: number; saleItemId: number } {
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES ('Charger', 4, 10, 1)`,
        )
        .run().lastInsertRowid,
    );
    const result = salesRepo.processSale(
      baseSale({
        items: [{ product_id: productId, quantity: 3, price: 10 }],
        total_amount: 30,
        final_amount: 30,
        payment_usd: 30,
      }),
      1,
    );
    expect(result.success).toBe(true);
    const saleId = result.id!;
    const saleItemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as {
        id: number;
      }
    ).id;
    return { saleId, saleItemId };
  }

  describe("blocked", () => {
    it("refundTransaction is refused, and the drawer is left exactly where the item refund left it", () => {
      const { saleId, saleItemId } = sellThreeAtTen();
      expect(drawerUsd()).toBe(5030); // 5000 + $30 tender

      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
      });
      // Pro-rated: $10 of the $30 tender handed back.
      expect(drawerUsd()).toBe(5020);
      const refundsAfterItem = refundRowCount(saleId);
      expect(refundsAfterItem).toBe(1);

      const txnId = saleTxnId(saleId);
      expect(() =>
        getTransactionRepository().refundTransaction(txnId, 1),
      ).toThrow(PARTIAL_REFUND_BLOCK);

      // Pre-guard this read 4990 — the full $30 mirrored on top of the $10
      // already returned. The guard throws before this.transaction() opens,
      // so nothing partial is left behind either.
      expect(drawerUsd()).toBe(5020);
      expect(refundRowCount(saleId)).toBe(refundsAfterItem);
      expect(saleStatus(saleId)).toBe("completed");
    });

    it("voidTransaction is refused on the same sale, with the same drawer untouched", () => {
      const { saleId, saleItemId } = sellThreeAtTen();
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
      });
      expect(drawerUsd()).toBe(5020);

      const txnId = saleTxnId(saleId);
      expect(() =>
        getTransactionRepository().voidTransaction(txnId, 1),
      ).toThrow(PARTIAL_REFUND_BLOCK);

      // Pre-guard this read 4990.
      expect(drawerUsd()).toBe(5020);
      expect(saleStatus(saleId)).toBe("completed");
      const status = (
        db
          .prepare(`SELECT status FROM transactions WHERE id = ?`)
          .get(txnId) as {
          status: string;
        }
      ).status;
      expect(status).toBe("ACTIVE");
    });

    it("refundBySaleId (the POS / SaleDetailModal entry point) is refused too", () => {
      const { saleId, saleItemId } = sellThreeAtTen();
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
      });

      expect(() =>
        getTransactionRepository().refundBySaleId(saleId, 1),
      ).toThrow(PARTIAL_REFUND_BLOCK);
      expect(drawerUsd()).toBe(5020);
    });

    it("stays blocked when a MULTI-line sale has only ONE of its lines item-refunded", () => {
      const productA = Number(
        db
          .prepare(
            `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES ('Cable', 2, 10, 1)`,
          )
          .run().lastInsertRowid,
      );
      const productB = Number(
        db
          .prepare(
            `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES ('Case', 3, 10, 1)`,
          )
          .run().lastInsertRowid,
      );
      const result = salesRepo.processSale(
        baseSale({
          items: [
            { product_id: productA, quantity: 1, price: 20 },
            { product_id: productB, quantity: 1, price: 30 },
          ],
          total_amount: 50,
          final_amount: 50,
          payment_usd: 50,
        }),
        1,
      );
      const saleId = result.id!;
      const items = db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
        .all(saleId) as { id: number }[];

      salesRepo.refundSaleItem({
        saleId,
        saleItemId: items[0].id,
        refundQuantity: 1,
        userId: 1,
      });
      const afterItem = drawerUsd();

      expect(() =>
        getTransactionRepository().refundTransaction(saleTxnId(saleId), 1),
      ).toThrow(PARTIAL_REFUND_BLOCK);
      expect(drawerUsd()).toBe(afterItem);

      // The operator's remaining route works and lands the drawer back at
      // the pre-sale balance — the capability is not lost, only the shortcut.
      salesRepo.refundSaleItem({
        saleId,
        saleItemId: items[1].id,
        refundQuantity: 1,
        userId: 1,
      });
      expect(drawerUsd()).toBe(5000);
      expect(saleStatus(saleId)).toBe("refunded");
    });
  });

  describe("LIRA-146 — fully item-refunded sale gets the distinct 'nothing remains' message", () => {
    it("refundTransaction reports the NEW message, not the old 'refund remaining items' dead end", () => {
      const { saleId, saleItemId } = sellThreeAtTen();
      expect(drawerUsd()).toBe(5030);

      // Refund all 3 units of the sale's one line individually — nothing
      // partial is left: refunded_quantity (3) has caught up to quantity (3).
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 3,
        userId: 1,
      });
      expect(drawerUsd()).toBe(5000); // full $30 tender already back
      expect(saleStatus(saleId)).toBe("refunded");

      expect(() =>
        getTransactionRepository().refundTransaction(saleTxnId(saleId), 1),
      ).toThrow(FULLY_ITEM_REFUNDED_BLOCK);
      // Still refused — the throw/no-throw boundary is unchanged — and the
      // drawer stays exactly where the item refunds left it.
      expect(drawerUsd()).toBe(5000);
    });

    it("voidTransaction reports the NEW message too, drawer untouched", () => {
      const { saleId, saleItemId } = sellThreeAtTen();
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 3,
        userId: 1,
      });
      expect(drawerUsd()).toBe(5000);

      expect(() =>
        getTransactionRepository().voidTransaction(saleTxnId(saleId), 1),
      ).toThrow(FULLY_ITEM_REFUNDED_BLOCK);
      expect(drawerUsd()).toBe(5000);
    });

    it("a MULTI-line sale gets the NEW message once EVERY line is individually fully refunded", () => {
      const productA = Number(
        db
          .prepare(
            `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES ('Cable', 2, 10, 1)`,
          )
          .run().lastInsertRowid,
      );
      const productB = Number(
        db
          .prepare(
            `INSERT INTO products (name, cost_price_usd, stock_quantity, tenant_id) VALUES ('Case', 3, 10, 1)`,
          )
          .run().lastInsertRowid,
      );
      const result = salesRepo.processSale(
        baseSale({
          items: [
            { product_id: productA, quantity: 1, price: 20 },
            { product_id: productB, quantity: 1, price: 30 },
          ],
          total_amount: 50,
          final_amount: 50,
          payment_usd: 50,
        }),
        1,
      );
      const saleId = result.id!;
      const items = db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC`)
        .all(saleId) as { id: number }[];

      // Refund BOTH lines individually, in full.
      salesRepo.refundSaleItem({
        saleId,
        saleItemId: items[0].id,
        refundQuantity: 1,
        userId: 1,
      });
      salesRepo.refundSaleItem({
        saleId,
        saleItemId: items[1].id,
        refundQuantity: 1,
        userId: 1,
      });
      expect(drawerUsd()).toBe(5000);
      expect(saleStatus(saleId)).toBe("refunded");

      expect(() =>
        getTransactionRepository().refundTransaction(saleTxnId(saleId), 1),
      ).toThrow(FULLY_ITEM_REFUNDED_BLOCK);
      expect(drawerUsd()).toBe(5000);
    });
  });

  describe("regression — a sale with NO item refunds behaves exactly as before", () => {
    it("refundTransaction still reverses the full tender and marks the sale refunded", () => {
      const { saleId } = sellThreeAtTen();
      expect(drawerUsd()).toBe(5030);

      const refundId = getTransactionRepository().refundTransaction(
        saleTxnId(saleId),
        1,
      );
      expect(refundId).toBeGreaterThan(0);
      expect(drawerUsd()).toBe(5000);
      expect(saleStatus(saleId)).toBe("refunded");
      const items = db
        .prepare(`SELECT is_refunded FROM sale_items WHERE sale_id = ?`)
        .all(saleId) as { is_refunded: number }[];
      expect(items.every((i) => i.is_refunded === 1)).toBe(true);
    });

    it("voidTransaction still reverses the full tender and cancels the sale", () => {
      const { saleId } = sellThreeAtTen();
      expect(drawerUsd()).toBe(5030);

      const reversalId = getTransactionRepository().voidTransaction(
        saleTxnId(saleId),
        1,
      );
      expect(reversalId).toBeGreaterThan(0);
      expect(drawerUsd()).toBe(5000);
      expect(saleStatus(saleId)).toBe("cancelled");
    });

    it("a NON-sale transaction is never touched by the guard (no sale_items to look at)", () => {
      // A bare EXPENSE row with one cash leg, written directly so the leg
      // shape is unambiguous: the guard's `source_table !== 'sales'`
      // short-circuit must fire before any sale_items query, and the generic
      // `_reversePayments` must still give the $12 back.
      const txnId = Number(
        db
          .prepare(
            `INSERT INTO transactions (type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, summary, tenant_id)
             VALUES ('EXPENSE', 'ACTIVE', 'expenses', 1, 1, -12, 0, 90000, 'Guard short-circuit probe', 1)`,
          )
          .run().lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, created_by, tenant_id)
         VALUES (?, 'CASH', 'General', 'USD', -12, 1, 1)`,
      ).run(txnId);
      db.prepare(
        `UPDATE drawer_balances SET balance = balance - 12 WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD'`,
      ).run();
      expect(drawerUsd()).toBe(4988);

      getTransactionRepository().refundTransaction(txnId, 1);
      expect(drawerUsd()).toBe(5000);
    });
  });
});
