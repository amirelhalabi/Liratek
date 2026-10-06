/**
 * SalesRepository.processSale — completion guards (LIRA-258,
 * POSTING_INTEGRITY_PLAN.md items 2.1 and 2.7, POSTING_MAP.md §7 gaps G6/G12).
 *
 * G12 — re-completing an already-completed sale. processSale used to accept
 * `{ id, status: "completed" }` for a sale that was ALREADY completed: it
 * reversed only the old payment legs, then deleted the sale_items (orphaning
 * their FIFO consumption rows) and re-booked stock, FIFO, Sale Debt, the
 * partner's FOR_POS charge and any store credit — doubling all of them. A
 * draft-status resave of a completed sale hit the same DELETE. No real flow
 * needs either: the only completion flow is draft → completed, and edits to a
 * completed sale go through updateSaleMetadata. The fix: an existing `id`
 * must currently be a draft.
 *
 * G6 — a for-partner sale inside a customer-session basket. Under
 * `deferPayment` processSale skipped the whole partner branch, so the sale
 * committed and the partner owed nothing. The POS "Add to session cart"
 * payload never carries partnerId/partnerMode and the session checkout modal
 * does not offer the partner toggle, so the UI cannot produce this request.
 * Decision: reject it with a clear error instead of inventing partner
 * routing for session baskets.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetDebtService();
}

function addProduct(db: Database.Database, stock: number, cost = 4): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, 10, ?)`,
      )
      .run(`P-${Math.random()}`, cost, stock).lastInsertRowid,
  );
}

function addClient(db: Database.Database): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, `03${Math.floor(Math.random() * 1e6)}`)
      .lastInsertRowid,
  );
}

function addPartner(db: Database.Database): number {
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${Math.random()}`).lastInsertRowid,
  );
}

function stockOf(db: Database.Database, productId: number): number {
  return (
    db
      .prepare(`SELECT stock_quantity AS s FROM products WHERE id = ?`)
      .get(productId) as { s: number }
  ).s;
}

function consumptionCount(db: Database.Database): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM stock_batch_consumptions`)
      .get() as { c: number }
  ).c;
}

function saleItemCount(db: Database.Database, saleId: number): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { c: number }
  ).c;
}

function baseSale(productId: number, qty = 2): SaleRequest {
  return {
    client_id: null,
    items: [{ product_id: productId, quantity: qty, price: 10 }],
    total_amount: 10 * qty,
    discount: 0,
    final_amount: 10 * qty,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: 89500,
    status: "completed",
  };
}

describe("LIRA-258 — processSale completion guards", () => {
  let db: Database.Database;
  let repo: SalesRepository;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  describe("G12 — an already-completed sale cannot be completed (or resaved) again", () => {
    it("re-completing an on-account sale is refused and posts nothing a second time", () => {
      const productId = addProduct(db, 10);
      const clientId = addClient(db);
      const first = repo.processSale(
        {
          ...baseSale(productId),
          client_id: clientId,
          payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        },
        USER_ID,
      );
      expect(first.success).toBe(true);
      const saleId = first.id!;

      const before = snapshotLedgers(db);
      const stockBefore = stockOf(db, productId);
      const consumptionsBefore = consumptionCount(db);

      const retry = repo.processSale(
        {
          ...baseSale(productId),
          id: saleId,
          client_id: clientId,
          payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        },
        USER_ID,
      );

      expect(retry.success).toBe(false);
      expect(retry.error).toMatch(/already completed/i);
      expectPostings(before, snapshotLedgers(db), {});
      expect(stockOf(db, productId)).toBe(stockBefore);
      expect(consumptionCount(db)).toBe(consumptionsBefore);
      expect(saleItemCount(db, saleId)).toBe(1);
    });

    it("re-completing a for-partner sale is refused: the partner is charged once", () => {
      const productId = addProduct(db, 10);
      const partnerId = addPartner(db);
      const sale: SaleRequest = {
        ...baseSale(productId),
        partnerId,
        partnerMode: "FOR",
        payments: [],
      };
      const first = repo.processSale(sale, USER_ID);
      expect(first.success).toBe(true);

      const before = snapshotLedgers(db);
      const retry = repo.processSale({ ...sale, id: first.id }, USER_ID);

      expect(retry.success).toBe(false);
      expectPostings(before, snapshotLedgers(db), {});
      expect(snapshotLedgers(db).partner).toEqual({ [`${partnerId}|USD`]: 20 });
    });

    it("a draft-status resave of a completed sale is refused (it would delete the sold lines)", () => {
      const productId = addProduct(db, 10);
      const first = repo.processSale(
        {
          ...baseSale(productId),
          payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        },
        USER_ID,
      );
      expect(first.success).toBe(true);

      const resave = repo.processSale(
        { ...baseSale(productId), id: first.id, status: "draft" },
        USER_ID,
      );

      expect(resave.success).toBe(false);
      const row = db
        .prepare(`SELECT status FROM sales WHERE id = ?`)
        .get(first.id) as { status: string };
      expect(row.status).toBe("completed");
      expect(saleItemCount(db, first.id!)).toBe(1);
    });

    it("an unknown sale id is refused instead of writing items for a sale that does not exist", () => {
      const productId = addProduct(db, 10);
      const result = repo.processSale(
        { ...baseSale(productId), id: 999_999 },
        USER_ID,
      );
      expect(result.success).toBe(false);
      expect(stockOf(db, productId)).toBe(10);
    });

    it("control: draft -> completed still works exactly once", () => {
      const productId = addProduct(db, 10);
      const draft = repo.processSale(
        { ...baseSale(productId), status: "draft" },
        USER_ID,
      );
      expect(draft.success).toBe(true);
      const before = snapshotLedgers(db);
      const done = repo.processSale(
        {
          ...baseSale(productId),
          id: draft.id,
          payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        },
        USER_ID,
      );
      expect(done.success).toBe(true);
      expectPostings(before, snapshotLedgers(db), {
        drawers: { "General|USD": 20 },
      });
      expect(stockOf(db, productId)).toBe(8);
    });
  });

  describe("G6 — a for-partner sale cannot go through a customer-session basket", () => {
    it("deferPayment + partnerMode FOR is rejected before anything is written", () => {
      const productId = addProduct(db, 10);
      const partnerId = addPartner(db);
      const before = snapshotLedgers(db);
      const salesBefore = (
        db.prepare(`SELECT COUNT(*) AS c FROM sales`).get() as { c: number }
      ).c;

      const result = repo.processSale(
        {
          ...baseSale(productId),
          partnerId,
          partnerMode: "FOR",
          payments: [],
          deferPayment: true,
        },
        USER_ID,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/partner/i);
      expect(result.error).toMatch(/session/i);
      expectPostings(before, snapshotLedgers(db), {});
      expect(stockOf(db, productId)).toBe(10);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM sales`).get() as { c: number })
          .c,
      ).toBe(salesBefore);
    });

    it("control: an ordinary session-basket sale (no partner) still goes through", () => {
      const productId = addProduct(db, 10);
      const result = repo.processSale(
        { ...baseSale(productId), payments: [], deferPayment: true },
        USER_ID,
      );
      expect(result.success).toBe(true);
      expect(stockOf(db, productId)).toBe(8);
    });
  });
});
