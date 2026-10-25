/**
 * Shop-day test 2026-10-16 (cashier D) — refunding ONE item from POS Sale
 * #182: iPhone 15 $799 + 2 cases $12 = $823, paid $700 + 11,500,000 LBP with
 * $6 + 20,000 LBP change, at 89,000.
 *
 * Three defects seen on the real refund (txn 10939):
 *
 *  1. Odd fractions in the drawers. Every sale payment row was scaled by the
 *     item's share (799/823) and posted unrounded: out $679.587 +
 *     11,164,641.555 LBP, in $5.825 + 19,416.768 LBP. Each refund leg must be
 *     a whole cent / whole LBP, and refunding every line one by one must put
 *     each drawer back EXACTLY where it was before the sale (rule 20).
 *  2. The refund row did not name the product: "1x product 122".
 *  3. The Transactions table could not link the item refund and its sale —
 *     `reverses_id` stays NULL on an item refund on purpose (it means
 *     "whole refund" to the guards and profit joins), so `getRecent` now
 *     derives the link: `item_refund_of_id` on the refund row, and
 *     `item_refunded` / `item_refund_remaining` on the sale row.
 *
 * Rule 17 — written before the fix and run against the unfixed code.
 * Failing-first (recorded): "whole cents and whole LBP" (got
 * -679.5868772782503), the product-name summary (got "1x product 1"), and
 * the four getRecent field tests (fields undefined).
 * Regression guards (passed on the unfixed code too): "preview = posted",
 * "refund then undo", "whole refund refused", and "every line one at a
 * time" — the last one guards the telescoping rounding against a naive
 * per-refund rounding, which would leave $700.01 on the $700 leg
 * ($10.21 + $10.21 + $679.59); shown by arithmetic, not by a run.
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
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_000;

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
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetDebtService();
}

function addProduct(name: string, cost: number, price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(name, cost, price).lastInsertRowid,
  );
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

/** Sale #182's shape: $799 phone + 2 x $12 case, split tender with change. */
function sellLikeSale182(): {
  saleId: number;
  saleTxnId: number;
  phoneItemId: number;
  caseItemId: number;
} {
  const phone = addProduct("iPhone 15 128GB", 690, 799);
  const kase = addProduct("iPhone 15 Clear MagSafe Case", 4, 12);
  const payload: SalePayload = {
    client_id: null,
    items: [
      { product_id: phone, quantity: 1, price: 799 },
      { product_id: kase, quantity: 2, price: 12 },
    ],
    total_amount: 823,
    discount: 0,
    final_amount: 823,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    payments: [
      { method: "CASH", currency_code: "USD", amount: 700 },
      { method: "CASH", currency_code: "LBP", amount: 11_500_000 },
    ],
    // 2026-10-25: cash change travels only as change_given_* (CASH OUT legs
    // are refused — validators/changeLegs.ts). Rewritten from two CASH OUT
    // legs ($6 + 20,000 LBP) into the shape the checkout really sends.
    change_given_usd: 6,
    change_given_lbp: 20_000,
  };
  const res = repo.processSale(
    saleProcessSchema.parse(payload) as SaleRequest,
    USER_ID,
  );
  expect(res.success).toBe(true);
  const saleId = res.id!;
  const items = db
    .prepare(`SELECT id, product_id FROM sale_items WHERE sale_id = ?`)
    .all(saleId) as { id: number; product_id: number }[];
  const saleTxn = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(saleId) as { id: number };
  return {
    saleId,
    saleTxnId: saleTxn.id,
    phoneItemId: items.find((i) => i.product_id === phone)!.id,
    caseItemId: items.find((i) => i.product_id === kase)!.id,
  };
}

function refundPayments(
  refundTxnId: number,
): { currency_code: string; amount: number }[] {
  return db
    .prepare(
      `SELECT currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
    )
    .all(refundTxnId) as { currency_code: string; amount: number }[];
}

/** True when `n` is a whole multiple of the currency's smallest unit. */
function isWholeUnit(n: number, currency: string): boolean {
  const scaled = currency === "LBP" ? n : n * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

describe("item refund legs round to each currency (shop-day Sale #182)", () => {
  it("refunding the $799 phone posts whole cents and whole LBP only", () => {
    const { saleId, phoneItemId } = sellLikeSale182();
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const legs = refundPayments(refundId);
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) {
      expect({
        leg,
        whole: isWholeUnit(leg.amount, leg.currency_code),
      }).toEqual({
        leg,
        whole: true,
      });
    }
  });

  it("the preview shows exactly the legs the refund posts", () => {
    const { saleId, phoneItemId } = sellLikeSale182();
    const preview = repo.getItemRefundPreview({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
    });
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const posted = refundPayments(refundId).map((p) => -p.amount);
    expect(preview.legs.map((l) => l.signed_amount)).toEqual(posted);
  });

  it("refunding every line one at a time puts each drawer back exactly (per currency)", () => {
    const before = snapshotLedgers(db);
    const { saleId, phoneItemId, caseItemId } = sellLikeSale182();
    repo.refundSaleItem({
      saleId,
      saleItemId: caseItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.refundSaleItem({
      saleId,
      saleItemId: caseItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const after = snapshotLedgers(db);
    // To the micro-unit: rounding each refund on its own would leave a whole
    // cent behind here ($10.21 + $10.21 + $679.59 of a $700 leg).
    const micro = (n: number | undefined) =>
      Math.round((n ?? 0) * 1e6) / 1e6 + 0;
    for (const key of ["General|USD", "General|LBP"]) {
      expect({ key, balance: micro(after.drawers[key]) }).toEqual({
        key,
        balance: micro(before.drawers[key]),
      });
    }
    expectPostings(before, after, {});
  });

  it("refund then undo nets every ledger to 0", () => {
    const { saleId, phoneItemId } = sellLikeSale182();
    const afterSale = snapshotLedgers(db);
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.undoSaleItemRefund({ refundTransactionId: refundId, userId: USER_ID });
    expectPostings(afterSale, snapshotLedgers(db), {});
  });
});

describe("item refund names the product", () => {
  it("summary reads '1x iPhone 15 128GB from Sale #N', not the product id", () => {
    const { saleId, phoneItemId } = sellLikeSale182();
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const row = db
      .prepare(`SELECT summary FROM transactions WHERE id = ?`)
      .get(refundId) as { summary: string };
    expect(row.summary).toBe(
      `ITEM REFUND: 1x iPhone 15 128GB from Sale #${saleId}`,
    );
  });
});

describe("Transactions table links an item refund and its sale (getRecent)", () => {
  type LinkFields = {
    id: number;
    reversed_by_id: number | null;
    item_refund_of_id?: number | null;
    item_refunded?: boolean;
    item_refund_remaining?: boolean;
  };
  function recentRow(id: number): LinkFields {
    const rows = getTransactionRepository().getRecent(
      50,
    ) as unknown as LinkFields[];
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    return row!;
  }

  it("an untouched sale is not flagged", () => {
    const { saleTxnId } = sellLikeSale182();
    const row = recentRow(saleTxnId);
    expect(row.item_refunded).toBe(false);
    expect(row.item_refund_remaining).toBe(false);
  });

  it("after one item refund: sale is partly refunded, refund points at the sale, reversed_by_id unchanged", () => {
    const { saleId, saleTxnId, phoneItemId } = sellLikeSale182();
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const sale = recentRow(saleTxnId);
    expect(sale.item_refunded).toBe(true);
    expect(sale.item_refund_remaining).toBe(true);
    // Still means "fully refunded by a whole refund" only.
    expect(sale.reversed_by_id).toBeNull();
    const refund = recentRow(refundId);
    expect(refund.item_refund_of_id).toBe(saleTxnId);
    expect(refund.reversed_by_id).toBeNull();
  });

  it("every line item-refunded: flagged refunded with nothing remaining", () => {
    const { saleId, saleTxnId, phoneItemId, caseItemId } = sellLikeSale182();
    repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.refundSaleItem({
      saleId,
      saleItemId: caseItemId,
      refundQuantity: 2,
      userId: USER_ID,
    });
    const sale = recentRow(saleTxnId);
    expect(sale.item_refunded).toBe(true);
    expect(sale.item_refund_remaining).toBe(false);
  });

  it("undoing the only item refund clears the flag", () => {
    const { saleId, saleTxnId, phoneItemId } = sellLikeSale182();
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    repo.undoSaleItemRefund({ refundTransactionId: refundId, userId: USER_ID });
    const sale = recentRow(saleTxnId);
    expect(sale.item_refunded).toBe(false);
  });

  it("a whole refund after an item refund is refused (no double refund)", () => {
    const { saleId, saleTxnId, phoneItemId } = sellLikeSale182();
    repo.refundSaleItem({
      saleId,
      saleItemId: phoneItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const before = snapshotLedgers(db);
    expect(() =>
      getTransactionRepository().refundTransaction(saleTxnId, USER_ID),
    ).toThrow(/partially refunded/);
    expect(() =>
      getTransactionRepository().voidTransaction(saleTxnId, USER_ID),
    ).toThrow(/partially refunded/);
    expectPostings(before, snapshotLedgers(db), {});
  });
});
