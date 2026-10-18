/**
 * LIRA-335 T016 + T021 — void vs refund of a transaction that carries a
 * `CHECKPOINT_RESOLUTION` offset leg, and the Drawer shortage expense guard.
 *
 * The offset leg is SEEDED here exactly as the engine
 * (`checkpointResolution.resolveBackTimedDrawerMovement`) writes it — a
 * payments row on the resolving transaction itself plus the same drawer
 * delta — so this file does not depend on the checkpoint tables and can be
 * proven failing-first against today's void/refund code.
 *
 * Owner model (spec FR-009): a VOID says "it never happened", so the offset
 * is mirrored and the drawer returns to where it stood before the sale was
 * entered. A REFUND (full, override, item) is new cash handed back now: the
 * counted cash was real, so the offset stays and the drawer moves by exactly
 * the cash returned.
 *
 * FR-013: a "Drawer shortage" expense (`source_ref_table =
 * 'checkpoint_differences'`) is removed only by Reopen; every manual path
 * refuses it, and the internal path (`{ internal: true }`) still works.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { z } from "zod";
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { ExpenseRepository, resetExpenseRepository } from "../ExpenseRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import { applyDrawerDelta, insertPaymentRow } from "../moneyPosting";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";

type SalePayload = z.input<typeof saleProcessSchema>;

/** The engine's leg method (constants/checkpointAdjustment.ts,
 *  CHECKPOINT_RESOLUTION_METHOD — contracts/api.md). */
const RESOLUTION_METHOD = "CHECKPOINT_RESOLUTION";
const CHECKPOINT_DIFFERENCE_SOURCE_TABLE = "checkpoint_differences";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;

let db: Database.Database;
let repo: SalesRepository;

function buildDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(d);
  runMigrations(d);
  return d;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetExpenseRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetDebtService();
}

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

function addProduct(price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 1, ?, 10)`,
      )
      .run(`P-${Math.random()}`, price).lastInsertRowid,
  );
}

/** A $30 + $20 cash sale paid $50 into General. */
function sell(): { saleId: number; txnId: number; twentyItemId: number } {
  const payload: SalePayload = {
    client_id: null,
    items: [
      { product_id: addProduct(30), quantity: 1, price: 30 },
      { product_id: addProduct(20), quantity: 1, price: 20 },
    ],
    total_amount: 50,
    discount: 0,
    final_amount: 50,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
  };
  const res = repo.processSale(
    saleProcessSchema.parse(payload) as SaleRequest,
    USER_ID,
  );
  expect(res.success).toBe(true);
  const txn = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(res.id) as { id: number };
  const twenty = db
    .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND sold_price_usd = 20`)
    .get(res.id) as { id: number };
  return { saleId: res.id!, txnId: txn.id, twentyItemId: twenty.id };
}

/** What the engine writes when this sale resolves an Over of `amount`. */
function seedOffset(txnId: number, amount: number): void {
  insertPaymentRow(db, {
    transactionId: txnId,
    method: RESOLUTION_METHOD,
    drawerName: "General",
    currencyCode: "USD",
    amount: -amount,
    note: "Resolves checkpoint #1 (General)",
    createdBy: USER_ID,
    tenantId: 1,
  });
  applyDrawerDelta(db, {
    drawerName: "General",
    currencyCode: "USD",
    delta: -amount,
    tenantId: 1,
  });
}

function offsetRowsOn(txnId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM payments WHERE transaction_id = ? AND method = ?`,
      )
      .get(txnId, RESOLUTION_METHOD) as { c: number }
  ).c;
}

describe("LIRA-335 — void mirrors the offset, refund skips it", () => {
  it("void: every drawer back to where it stood before the sale (regression guard — void already mirrored every leg)", () => {
    const before = snapshotLedgers(db);
    const { txnId } = sell();
    seedOffset(txnId, 50);
    const reversalId = getTransactionRepository().voidTransaction(txnId, USER_ID);
    expectPostings(before, snapshotLedgers(db), {});
    expect(offsetRowsOn(reversalId)).toBe(1);
  });

  it("full refund: the drawer moves by the $50 handed back, the offset stays", () => {
    const { txnId } = sell();
    seedOffset(txnId, 50);
    const afterSale = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundTransaction(txnId, USER_ID);
    expectPostings(afterSale, snapshotLedgers(db), {
      drawers: { "General|USD": -50 },
    });
    expect(offsetRowsOn(refundId)).toBe(0);
  });

  it("refund with chosen return method: the drawer moves by the $50 handed back, the offset stays", () => {
    const { txnId } = sell();
    seedOffset(txnId, 50);
    const afterSale = snapshotLedgers(db);
    const refundId = getTransactionRepository().refundTransaction(txnId, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
    });
    expectPostings(afterSale, snapshotLedgers(db), {
      drawers: { "General|USD": -50 },
    });
    expect(offsetRowsOn(refundId)).toBe(0);
  });

  it("item refund of the $20 line: the drawer moves by $20, the offset is not scaled into it", () => {
    const { saleId, txnId, twentyItemId } = sell();
    seedOffset(txnId, 50);
    const afterSale = snapshotLedgers(db);
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: twentyItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    expectPostings(afterSale, snapshotLedgers(db), {
      drawers: { "General|USD": -20 },
    });
    expect(offsetRowsOn(refundId)).toBe(0);
  });

  it("item refund preview lists only the $20 of customer cash", () => {
    const { saleId, txnId, twentyItemId } = sell();
    seedOffset(txnId, 50);
    const preview = repo.getItemRefundPreview({
      saleId,
      saleItemId: twentyItemId,
      refundQuantity: 1,
    });
    expect(preview.legs.map((l) => l.method)).not.toContain(RESOLUTION_METHOD);
    expect(preview.legs.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(20, 6);
  });

  it("undo of an item refund puts every drawer back to after the sale", () => {
    const { saleId, txnId, twentyItemId } = sell();
    seedOffset(txnId, 50);
    const afterSale = snapshotLedgers(db);
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: twentyItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.undoSaleItemRefund({ refundTransactionId: refundId, userId: USER_ID });
    expectPostings(afterSale, snapshotLedgers(db), {});
  });
});

describe("LIRA-335 FR-013 — a Drawer shortage expense is removed only by Reopen", () => {
  function shortageExpense(): { expenseId: number; txnId: number } {
    const expenseRepo = new ExpenseRepository();
    const expenseId = expenseRepo.createExpense(
      {
        description: "Drawer shortage (General, checkpoint #1)",
        category: "Drawer shortage",
        paid_by_method: "CASH",
        amount_usd: 8,
        amount_lbp: 0,
        expense_date: "2026-10-12",
        books_only: true,
        source_ref_table: CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
        source_ref_id: 7,
      },
      USER_ID,
    );
    const txn = getTransactionRepository().getBySourceId("expenses", expenseId)!;
    return { expenseId, txnId: txn.id };
  }

  function txnStatus(id: number): string {
    return (db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(id) as {
      status: string;
    }).status;
  }

  it("the Expenses page delete is refused", () => {
    const { expenseId, txnId } = shortageExpense();
    expect(() => new ExpenseRepository().deleteExpense(expenseId, USER_ID)).toThrow(
      /Reopen the checkpoint difference/,
    );
    expect(txnStatus(txnId)).toBe("ACTIVE");
  });

  it("a category change is refused; a description edit is allowed", () => {
    const { expenseId } = shortageExpense();
    const expenseRepo = new ExpenseRepository();
    expect(() =>
      expenseRepo.updateMetadata(expenseId, { category: "Rent" }, "admin"),
    ).toThrow(/Reopen the checkpoint difference/);
    expect(expenseRepo.updateMetadata(expenseId, { description: "x" }, "admin")?.category).toBe(
      "Drawer shortage",
    );
  });

  it("the Transactions table void and refund are refused", () => {
    const { txnId } = shortageExpense();
    const txnRepo = getTransactionRepository();
    expect(() => txnRepo.voidTransaction(txnId, USER_ID)).toThrow(
      /Reopen the checkpoint difference/,
    );
    expect(() => txnRepo.refundTransaction(txnId, USER_ID)).toThrow(
      /Reopen the checkpoint difference/,
    );
    expect(txnStatus(txnId)).toBe("ACTIVE");
  });

  it("voidLinkedExpenses without { internal: true } is refused", () => {
    const { txnId } = shortageExpense();
    expect(() =>
      getTransactionRepository().voidLinkedExpenses(
        CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
        7,
        USER_ID,
      ),
    ).toThrow(/Reopen the checkpoint difference/);
    expect(txnStatus(txnId)).toBe("ACTIVE");
  });

  it("the internal paths still remove it (Reopen / shrink)", () => {
    const first = shortageExpense();
    getTransactionRepository().voidLinkedExpenses(
      CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
      7,
      USER_ID,
      { internal: true },
    );
    expect(txnStatus(first.txnId)).toBe("VOIDED");

    const second = shortageExpense();
    new ExpenseRepository().deleteExpense(second.expenseId, USER_ID, {
      internal: true,
    });
    expect(txnStatus(second.txnId)).toBe("VOIDED");
  });

  it("an ordinary expense still deletes and voids as before", () => {
    const expenseRepo = new ExpenseRepository();
    const expenseId = expenseRepo.createExpense(
      {
        description: "Paper",
        category: "Supplies",
        paid_by_method: "CASH",
        amount_usd: 3,
        amount_lbp: 0,
        expense_date: "2026-10-12",
      },
      USER_ID,
    );
    const txn = getTransactionRepository().getBySourceId("expenses", expenseId)!;
    expenseRepo.deleteExpense(expenseId, USER_ID);
    expect(txnStatus(txn.id)).toBe("VOIDED");
  });
});
