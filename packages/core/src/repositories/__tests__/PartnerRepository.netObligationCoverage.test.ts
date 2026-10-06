/**
 * LIRA-258 / G36 — partner settlement coverage applies to what the partner
 * STILL OWES after reversals, not to every obligation row ever written.
 *
 * `PartnerRepository.applySettlementCoverage` walks the partner's obligation
 * rows oldest first. Before this fix it ignored reversals, so:
 *  (a) a whole-sale refund's original FOR_POS DEBIT stayed "open" and soaked
 *      up the next settlement — the NEW sale stayed uncovered (profit held
 *      back) although the partner owed nothing;
 *  (b) an item refund's CREDIT (referencing the refund transaction) never
 *      reduced the sale's obligation — the sale took more coverage than it
 *      was owed and the excess was missing from the next sale;
 *  (c) refund + undo left the undo's DEBIT as a separate open obligation that
 *      took later settlement money meant for the next sale.
 *
 * The fix (constants/partnerObligation.ts) defines ONE net amount per
 * obligation, shared by the settlement FIFO, the settlement-void unwind and
 * the ProfitRepository ratio/pending fragments. Every number below was worked
 * out by hand before running.
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
import { SalesRepository, resetSalesRepository } from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getPartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import {
  hasPartnerObligation,
  notPartnerPending,
  partnerCoverageRatio,
  txnNotPartnerPending,
  txnPartnerCoverageRatio,
} from "../ProfitRepository";
import {
  getPartnerService,
  resetPartnerService,
} from "../../services/PartnerService";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetDebtService } from "../../services/DebtService";
import { snapshotLedgers } from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89500;

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
  resetVoucherRepository();
  resetDebtService();
  resetPartnerService();
}

describe("LIRA-258 / G36 — settlement coverage nets reversals", () => {
  let db: Database.Database;
  let repo: SalesRepository;
  let a: number;
  let b: number;
  let partnerId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
    const addProduct = (name: string): number =>
      Number(
        db
          .prepare(
            `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
             VALUES (1, ?, 'Product', 4, 10, 10)`,
          )
          .run(name).lastInsertRowid,
      );
    a = addProduct("Product A");
    b = addProduct("Product B");
    partnerId = Number(
      db.prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P')`).run()
        .lastInsertRowid,
    );
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  /** $20 for-partner sale (two $10 lines). */
  function forSale(): number {
    const r = repo.processSale(
      {
        client_id: null,
        items: [
          { product_id: a, quantity: 1, price: 10 },
          { product_id: b, quantity: 1, price: 10 },
        ],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        partnerId,
        partnerMode: "FOR",
        payments: [],
      },
      USER_ID,
    );
    expect(r.success).toBe(true);
    return r.id!;
  }

  function itemIds(saleId: number): number[] {
    return (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
        .all(saleId) as { id: number }[]
    ).map((r) => r.id);
  }

  function settle(amount: number): void {
    getPartnerRepository().addLedgerEntry({
      partner_id: partnerId,
      transaction_type: "SETTLEMENT",
      amount,
      currency: "USD",
      direction: "CREDIT",
      user_id: USER_ID,
    });
  }

  /** The sale's own FOR_POS row (the obligation head). */
  function saleCovered(saleId: number): number {
    return (
      db
        .prepare(
          `SELECT covered_amount FROM partner_ledger
            WHERE reference_table = 'sales' AND reference_id = ?
            ORDER BY id ASC LIMIT 1`,
        )
        .get(saleId) as { covered_amount: number }
    ).covered_amount;
  }

  function gates(saleId: number): {
    ratio: number;
    settled: number;
    has: number;
    txnRatio: number;
    txnSettled: number;
  } {
    return db
      .prepare(
        `SELECT ${partnerCoverageRatio("sales", "@id")} AS ratio,
                ${notPartnerPending("sales", "@id")} AS settled,
                ${hasPartnerObligation("sales", "@id")} AS has,
                (SELECT ${txnPartnerCoverageRatio("t")} FROM transactions t
                  WHERE t.source_table = 'sales' AND t.source_id = @id AND t.type = 'SALE') AS txnRatio,
                (SELECT ${txnNotPartnerPending("t")} FROM transactions t
                  WHERE t.source_table = 'sales' AND t.source_id = @id AND t.type = 'SALE') AS txnSettled`,
      )
      .get({ id: saleId }) as {
      ratio: number;
      settled: number;
      has: number;
      txnRatio: number;
      txnSettled: number;
    };
  }

  it("(a) a whole-sale refund's obligation no longer absorbs the next sale's settlement", () => {
    const sale1 = forSale();
    getTransactionRepository().refundBySaleId(sale1, USER_ID);
    const sale2 = forSale();
    settle(20);

    expect(snapshotLedgers(db).partner).toEqual({});
    expect(saleCovered(sale1)).toBe(0);
    expect(saleCovered(sale2)).toBe(20);
    expect(gates(sale2)).toEqual({
      ratio: 1,
      settled: 1,
      has: 1,
      txnRatio: 1,
      txnSettled: 1,
    });
  });

  it("(b) an item refund lowers the sale's obligation: the sale takes only what is still owed, the rest covers the next sale", () => {
    const sale1 = forSale();
    const [itemA] = itemIds(sale1);
    repo.refundSaleItem({
      saleId: sale1,
      saleItemId: itemA,
      refundQuantity: 1,
      userId: USER_ID,
    });
    // Partner now owes $10 on sale1. Before the next sale it pays that $10:
    // sale1 is fully settled even though its original row read $20.
    settle(10);
    expect(saleCovered(sale1)).toBe(10);
    expect(gates(sale1)).toEqual({
      ratio: 1,
      settled: 1,
      has: 1,
      txnRatio: 1,
      txnSettled: 1,
    });

    const sale2 = forSale();
    settle(20);
    expect(snapshotLedgers(db).partner).toEqual({});
    expect(saleCovered(sale1)).toBe(10);
    expect(saleCovered(sale2)).toBe(20);
    expect(gates(sale2).ratio).toBe(1);
    expect(gates(sale2).settled).toBe(1);
  });

  it("(b2) one settlement over an item-refunded sale and a new sale splits by what each still owes", () => {
    const sale1 = forSale();
    const [itemA] = itemIds(sale1);
    repo.refundSaleItem({
      saleId: sale1,
      saleItemId: itemA,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const sale2 = forSale();
    settle(30); // $10 still owed on sale1 + $20 on sale2

    expect(snapshotLedgers(db).partner).toEqual({});
    expect(saleCovered(sale1)).toBe(10);
    expect(saleCovered(sale2)).toBe(20);
    expect(gates(sale1).ratio).toBe(1);
    expect(gates(sale2).ratio).toBe(1);
  });

  it("(c) refund + undo: the undo's re-charge belongs to the sale, so it never takes the next sale's settlement", () => {
    const saleA = forSale();
    const [itemA] = itemIds(saleA);
    const refundTxnId = repo.refundSaleItem({
      saleId: saleA,
      saleItemId: itemA,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.undoSaleItemRefund({
      refundTransactionId: refundTxnId,
      userId: USER_ID,
    });
    // Partner owes the full $20 on saleA again.
    settle(20);
    expect(gates(saleA).ratio).toBe(1);

    const saleB = forSale();
    settle(20);
    expect(snapshotLedgers(db).partner).toEqual({});
    expect(saleCovered(saleB)).toBe(20);
    expect(gates(saleB)).toEqual({
      ratio: 1,
      settled: 1,
      has: 1,
      txnRatio: 1,
      txnSettled: 1,
    });
    // Reversal / undo rows never hold coverage.
    const linked = db
      .prepare(
        `SELECT SUM(covered_amount) AS c FROM partner_ledger WHERE reference_table = 'transactions'`,
      )
      .get() as { c: number };
    expect(linked.c).toBe(0);
  });

  it("voiding the settlement gives back exactly the coverage it applied to the net obligations", () => {
    const sale1 = forSale();
    const [itemA] = itemIds(sale1);
    repo.refundSaleItem({
      saleId: sale1,
      saleItemId: itemA,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const sale2 = forSale();
    const entry = getPartnerService().settle({
      partnerId,
      amount: 30,
      currency: "USD",
      settlementMethod: "CASH",
      userId: USER_ID,
    });
    expect(saleCovered(sale1)).toBe(10);
    expect(saleCovered(sale2)).toBe(20);

    const txnRepo = getTransactionRepository();
    txnRepo.voidTransaction(
      txnRepo.getBySourceId("partner_ledger", entry.id)!.id,
      USER_ID,
    );
    expect(snapshotLedgers(db).partner).toEqual({ [`${partnerId}|USD`]: 30 });
    expect(saleCovered(sale1)).toBe(0);
    expect(saleCovered(sale2)).toBe(0);
    expect(gates(sale1).ratio).toBe(0);
    expect(gates(sale2).ratio).toBe(0);
  });

  it("a payment TO the partner never covers a refund's reversal row", () => {
    const sale1 = forSale();
    getTransactionRepository().refundBySaleId(sale1, USER_ID);
    getPartnerRepository().addLedgerEntry({
      partner_id: partnerId,
      transaction_type: "SETTLEMENT",
      amount: 20,
      currency: "USD",
      direction: "DEBIT",
      user_id: USER_ID,
    });
    const covered = db
      .prepare(
        `SELECT SUM(covered_amount) AS c FROM partner_ledger WHERE transaction_type = 'FOR_POS'`,
      )
      .get() as { c: number };
    expect(covered.c).toBe(0);
  });
});
