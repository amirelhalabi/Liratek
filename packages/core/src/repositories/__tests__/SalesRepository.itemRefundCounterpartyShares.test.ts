/**
 * SalesRepository.refundSaleItem / undoSaleItemRefund — the refunded item's
 * share of the partner charge and of the customer's credits (LIRA-258,
 * POSTING_INTEGRITY_PLAN.md items 3.1 and 3.2, POSTING_MAP.md §7 gaps G5/G21).
 *
 * G5 — a for-partner POS sale books the FULL price to the partner (FOR_POS
 * DEBIT). A per-item refund never reversed the refunded item's share, and
 * after one item refund the whole-sale refund is blocked, so the partner kept
 * owing for goods that came back.
 *
 * G21 — change kept as store credit. The item refund hands back the item's
 * pro-rata share of the sale's payment legs, and those legs include the
 * overpayment that became store credit. So unless the same share of that
 * credit is cancelled too, refunding the items one by one hands the customer
 * the overpayment twice (once in cash, once as credit it keeps).
 *
 * Voucher credit is deliberately NOT touched by an item refund (decision, see
 * the voucher case below): a gift card is turned into account credit when it
 * is redeemed, and the unpaid sale amount becomes a Sale Debt that credit
 * offsets. Cancelling the item's Sale Debt share already gives the item's
 * value back as account credit; also cancelling the voucher deposit would
 * give the customer nothing back for the returned item.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 * Every case checks every ledger (postingAssert) and ends with the undo.
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getPartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import { notPartnerPending, partnerCoverageRatio } from "../ProfitRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetDebtService } from "../../services/DebtService";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

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
}

let seq = 0;
function addProduct(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 4, 10, 10)`,
      )
      .run(`Product ${seq}`).lastInsertRowid,
  );
}

function addClient(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${seq}`, `03${100000 + seq}`).lastInsertRowid,
  );
}

function addPartner(db: Database.Database): number {
  seq += 1;
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${seq}`).lastInsertRowid,
  );
}

/** Two $10 lines (products A and B), $20 before discount. */
function twoItemSale(
  a: number,
  b: number,
  extra: Partial<SaleRequest>,
): SaleRequest {
  const discount = extra.discount ?? 0;
  return {
    client_id: null,
    items: [
      { product_id: a, quantity: 1, price: 10 },
      { product_id: b, quantity: 1, price: 10 },
    ],
    total_amount: 20,
    discount,
    final_amount: 20 - discount,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function saleItemIds(db: Database.Database, saleId: number): number[] {
  return (
    db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
      .all(saleId) as { id: number }[]
  ).map((r) => r.id);
}

describe("LIRA-258 — item refund reverses the item's partner and credit shares", () => {
  let db: Database.Database;
  let repo: SalesRepository;
  let a: number;
  let b: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
    a = addProduct(db);
    b = addProduct(db);
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  function refund(saleId: number, saleItemId: number): number {
    return repo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
  }

  function undo(refundTxnId: number): number {
    return repo.undoSaleItemRefund({
      refundTransactionId: refundTxnId,
      userId: USER_ID,
    });
  }

  describe("G5 — for-partner sale", () => {
    function forSale(partnerId: number, discount = 0): number {
      const r = repo.processSale(
        twoItemSale(a, b, {
          partnerId,
          partnerMode: "FOR",
          payments: [],
          discount,
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      return r.id!;
    }

    it("refunding one of two items lowers what the partner owes by that item's price; undo restores it", () => {
      const partnerId = addPartner(db);
      const saleId = forSale(partnerId);
      const [itemA] = saleItemIds(db, saleId);

      const beforeRefund = snapshotLedgers(db);
      const refundTxnId = refund(saleId, itemA);
      expectPostings(beforeRefund, snapshotLedgers(db), {
        partner: { [`${partnerId}|USD`]: -10 },
      });

      const beforeUndo = snapshotLedgers(db);
      undo(refundTxnId);
      expectPostings(beforeUndo, snapshotLedgers(db), {
        partner: { [`${partnerId}|USD`]: 10 },
      });
    });

    it("refunding every item nets the partner back to zero (discounted sale, pro rata)", () => {
      const partnerId = addPartner(db);
      const beforeSale = snapshotLedgers(db);
      const saleId = forSale(partnerId, 2); // partner owes $18
      expect(snapshotLedgers(db).partner[`${partnerId}|USD`]).toBe(18);

      const [itemA, itemB] = saleItemIds(db, saleId);
      const beforeRefund = snapshotLedgers(db);
      refund(saleId, itemA);
      expectPostings(beforeRefund, snapshotLedgers(db), {
        partner: { [`${partnerId}|USD`]: -9 },
      });
      refund(saleId, itemB);
      expectPostings(beforeSale, snapshotLedgers(db), {});
    });

    it("reversal rows reuse the generic shape (FOR_POS, opposite direction, same currency) but reference the refund / undo transaction, not the sale", () => {
      const partnerId = addPartner(db);
      const saleId = forSale(partnerId);
      const [itemA] = saleItemIds(db, saleId);
      const refundTxnId = refund(saleId, itemA);
      const undoTxnId = undo(refundTxnId);
      const rows = db
        .prepare(
          `SELECT transaction_type, direction, amount, currency, reference_table, reference_id
             FROM partner_ledger WHERE partner_id = ? ORDER BY id`,
        )
        .all(partnerId);
      expect(rows).toEqual([
        {
          transaction_type: "FOR_POS",
          direction: "DEBIT",
          amount: 20,
          currency: "USD",
          reference_table: "sales",
          reference_id: saleId,
        },
        {
          transaction_type: "FOR_POS",
          direction: "CREDIT",
          amount: 10,
          currency: "USD",
          reference_table: "transactions",
          reference_id: refundTxnId,
        },
        {
          transaction_type: "FOR_POS",
          direction: "DEBIT",
          amount: 10,
          currency: "USD",
          reference_table: "transactions",
          reference_id: undoTxnId,
        },
      ]);
    });

    it("the sale's profit gates and settlement coverage see exactly what they saw before the refund", () => {
      const partnerId = addPartner(db);
      const saleId = forSale(partnerId);
      const [itemA] = saleItemIds(db, saleId);
      const gates = () =>
        db
          .prepare(
            `SELECT ${partnerCoverageRatio("sales", "?")} AS ratio,
                    ${notPartnerPending("sales", "?")} AS settled`,
          )
          .get(saleId, saleId) as { ratio: number; settled: number };
      const saleRows = () =>
        db
          .prepare(
            `SELECT id, amount, covered_amount FROM partner_ledger
              WHERE reference_table = 'sales' AND reference_id = ?`,
          )
          .all(saleId);

      const rowsBefore = saleRows();
      const gatesBefore = gates();
      refund(saleId, itemA);
      expect(saleRows()).toEqual(rowsBefore);
      expect(gates()).toEqual(gatesBefore);

      // The partner pays the $10 it now owes: the payment covers the
      // sale's original row, never the refund's reversal row.
      getPartnerRepository().addLedgerEntry({
        partner_id: partnerId,
        transaction_type: "SETTLEMENT",
        amount: 10,
        currency: "USD",
        direction: "CREDIT",
        user_id: USER_ID,
      });
      expect(snapshotLedgers(db).partner).toEqual({});
      const reversal = db
        .prepare(
          `SELECT covered_amount FROM partner_ledger WHERE reference_table = 'transactions'`,
        )
        .get() as { covered_amount: number };
      expect(reversal.covered_amount).toBe(0);
      expect(saleRows()).toEqual([
        { id: (rowsBefore[0] as { id: number }).id, amount: 20, covered_amount: 10 },
      ]);
    });

    it("refund an item, undo it, then refund the whole sale: the partner nets to zero", () => {
      const partnerId = addPartner(db);
      const beforeSale = snapshotLedgers(db);
      const saleId = forSale(partnerId);
      const [itemA] = saleItemIds(db, saleId);
      undo(refund(saleId, itemA));
      getTransactionRepository().refundBySaleId(saleId, USER_ID);
      expect(snapshotLedgers(db).partner).toEqual(beforeSale.partner);
      expectPostings(beforeSale, snapshotLedgers(db), {});
    });
  });

  describe("G21 — change kept as store credit", () => {
    it("USD credit: each item refund cancels its share of the credit; refunding everything nets drawer and account to zero; undo re-credits", () => {
      const clientId = addClient(db);
      const beforeSale = snapshotLedgers(db);
      const r = repo.processSale(
        twoItemSale(a, b, {
          client_id: clientId,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 25 },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: 5,
              direction: "OUT",
            },
          ],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      expectPostings(beforeSale, snapshotLedgers(db), {
        drawers: { "General|USD": 25 },
        debt: { [`${clientId}|USD`]: -5 },
      });

      const [itemA, itemB] = saleItemIds(db, r.id!);
      const beforeRefundA = snapshotLedgers(db);
      const refundA = refund(r.id!, itemA);
      // $12.50 cash back and $2.50 of the kept credit cancelled = $10 net,
      // exactly the item's price.
      expectPostings(beforeRefundA, snapshotLedgers(db), {
        drawers: { "General|USD": -12.5 },
        debt: { [`${clientId}|USD`]: 2.5 },
      });

      const beforeUndo = snapshotLedgers(db);
      undo(refundA);
      expectPostings(beforeUndo, snapshotLedgers(db), {
        drawers: { "General|USD": 12.5 },
        debt: { [`${clientId}|USD`]: -2.5 },
      });
      // The re-credit is a credit again, not a negative 'Sale Debt'.
      const lastRow = db
        .prepare(
          `SELECT transaction_type FROM debt_ledger WHERE client_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(clientId) as { transaction_type: string };
      expect(lastRow.transaction_type).toBe("CREDIT_DEPOSIT");

      refund(r.id!, itemA);
      refund(r.id!, itemB);
      expectPostings(beforeSale, snapshotLedgers(db), {});
    });

    it("LBP credit: the cancelled share stays in LBP, and undo restores it in LBP", () => {
      const clientId = addClient(db);
      const beforeSale = snapshotLedgers(db);
      const r = repo.processSale(
        twoItemSale(a, b, {
          client_id: clientId,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 25 },
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: 447500,
              direction: "OUT",
            },
          ],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      const [itemA, itemB] = saleItemIds(db, r.id!);

      const beforeRefundA = snapshotLedgers(db);
      const refundA = refund(r.id!, itemA);
      expectPostings(beforeRefundA, snapshotLedgers(db), {
        drawers: { "General|USD": -12.5 },
        debt: { [`${clientId}|LBP`]: 223750 },
      });

      const beforeUndo = snapshotLedgers(db);
      undo(refundA);
      expectPostings(beforeUndo, snapshotLedgers(db), {
        drawers: { "General|USD": 12.5 },
        debt: { [`${clientId}|LBP`]: -223750 },
      });

      refund(r.id!, itemA);
      refund(r.id!, itemB);
      expectPostings(beforeSale, snapshotLedgers(db), {});
    });

    it("on-account part and kept credit together: an on-account sale's debt share is still cancelled (control)", () => {
      const clientId = addClient(db);
      const beforeSale = snapshotLedgers(db);
      const r = repo.processSale(
        twoItemSale(a, b, {
          client_id: clientId,
          payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      const [itemA, itemB] = saleItemIds(db, r.id!);
      const beforeRefundA = snapshotLedgers(db);
      refund(r.id!, itemA);
      expectPostings(beforeRefundA, snapshotLedgers(db), {
        drawers: { "General|USD": -2.5 },
        debt: { [`${clientId}|USD`]: -7.5 },
      });
      refund(r.id!, itemB);
      expectPostings(beforeSale, snapshotLedgers(db), {});
    });
  });

  describe("G21 — voucher (decision: the voucher deposit is left alone)", () => {
    it("refunded items come back as account credit; the voucher stays redeemed; undo takes the credit back", () => {
      const clientId = addClient(db);
      db.prepare(
        `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, created_by)
         VALUES (1, 'GIFT-TEST-0001', ?, 'Owner', 20, 'USD', 1)`,
      ).run(clientId);
      const beforeSale = snapshotLedgers(db);
      const r = repo.processSale(
        twoItemSale(a, b, {
          client_id: clientId,
          payments: [
            {
              method: "GIFT_CARD",
              currency_code: "USD",
              amount: 20,
              voucher_code: "GIFT-TEST-0001",
            },
          ],
        }),
        USER_ID,
      );
      expect(r.success).toBe(true);
      // Voucher deposit (-20) offsets the sale's on-account amount (+20).
      expectPostings(beforeSale, snapshotLedgers(db), {});

      const [itemA, itemB] = saleItemIds(db, r.id!);
      const beforeRefundA = snapshotLedgers(db);
      const refundA = refund(r.id!, itemA);
      expectPostings(beforeRefundA, snapshotLedgers(db), {
        debt: { [`${clientId}|USD`]: -10 },
      });

      const beforeUndo = snapshotLedgers(db);
      undo(refundA);
      expectPostings(beforeUndo, snapshotLedgers(db), {
        debt: { [`${clientId}|USD`]: 10 },
      });

      refund(r.id!, itemA);
      refund(r.id!, itemB);
      expectPostings(beforeSale, snapshotLedgers(db), {
        debt: { [`${clientId}|USD`]: -20 },
      });
      const voucher = db
        .prepare(`SELECT status FROM vouchers WHERE code = 'GIFT-TEST-0001'`)
        .get() as { status: string };
      expect(voucher.status).toBe("redeemed");
    });
  });
});
