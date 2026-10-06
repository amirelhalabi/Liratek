/**
 * LIRA-258 / G37 — refunding a sale paid with a gift card gives the gift card
 * back.
 *
 * Redeeming a voucher (VoucherRepository.redeemByCode) deposits its full face
 * value to the owner's account (CREDIT_DEPOSIT linked to the sale's
 * transaction) and marks it `redeemed`; the GIFT_CARD leg is non-drawer, so
 * the sale's amount becomes a 'Sale Debt' the deposit offsets. The generic
 * whole-sale refund (`TransactionRepository._cancelDebt`) cancels BOTH ledger
 * rows — but left the voucher `redeemed`, so the customer lost its value.
 *
 * Decision (rule 20): restore the voucher to `pending` alongside cancelling
 * the deposit. That is the only choice that returns EVERY ledger to its
 * pre-sale state AND the voucher's value to where it was before the sale.
 * Keeping the deposit instead would leave the owner's account changed by the
 * refund (debt ledger not netted).
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
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import {
  getVoucherRepository,
  resetVoucherRepository,
} from "../VoucherRepository";
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

interface VoucherRow {
  status: string;
  redeemed_at: string | null;
  redeemed_by: number | null;
  redeemed_in_transaction: string | null;
  redeemed_transaction_id: number | null;
}

describe("LIRA-258 / G37 — whole-sale refund gives the gift card back", () => {
  let db: Database.Database;
  let repo: SalesRepository;
  let productId: number;
  let clientId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new SalesRepository();
    productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (1, 'Gift item', 'Product', 4, 10, 10)`,
        )
        .run().lastInsertRowid,
    );
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Owner', '03123456')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    resetTenantContext();
    resetAll();
    db.close();
  });

  function addVoucher(code: string, amount: number): void {
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, created_by)
       VALUES (1, ?, ?, 'Owner', ?, 'USD', 1)`,
    ).run(code, clientId, amount);
  }

  function voucher(code: string): VoucherRow {
    return db
      .prepare(
        `SELECT status, redeemed_at, redeemed_by, redeemed_in_transaction, redeemed_transaction_id
           FROM vouchers WHERE code = ?`,
      )
      .get(code) as VoucherRow;
  }

  /** $20 sale (two $10 units) paid entirely with the given gift card. */
  function giftCardSale(code: string, amount = 20): number {
    const r = repo.processSale(
      {
        client_id: clientId,
        items: [{ product_id: productId, quantity: 2, price: 10 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
        payments: [
          {
            method: "GIFT_CARD",
            currency_code: "USD",
            amount,
            voucher_code: code,
          },
        ],
      },
      USER_ID,
    );
    expect(r.success).toBe(true);
    return r.id!;
  }

  const UNREDEEMED: VoucherRow = {
    status: "pending",
    redeemed_at: null,
    redeemed_by: null,
    redeemed_in_transaction: null,
    redeemed_transaction_id: null,
  };

  it("refund nets every ledger to zero and the voucher is unredeemed again", () => {
    addVoucher("GIFT-G37-0001", 20);
    const beforeSale = snapshotLedgers(db);
    const saleId = giftCardSale("GIFT-G37-0001");
    expect(voucher("GIFT-G37-0001").status).toBe("redeemed");

    getTransactionRepository().refundBySaleId(saleId, USER_ID);

    expectPostings(beforeSale, snapshotLedgers(db), {});
    expect(voucher("GIFT-G37-0001")).toEqual(UNREDEEMED);
  });

  it("the restored gift card can be spent again", () => {
    addVoucher("GIFT-G37-0002", 20);
    const saleId = giftCardSale("GIFT-G37-0002");
    getTransactionRepository().refundBySaleId(saleId, USER_ID);

    const again = getVoucherRepository().redeemByCode({
      code: "GIFT-G37-0002",
      context: "test",
      transactionId: null,
      userId: USER_ID,
    });
    expect(again.status).toBe("redeemed");
  });

  it("a gift card worth more than the sale comes back at full value; the owner's leftover credit is taken back with it", () => {
    addVoucher("GIFT-G37-0003", 50);
    const beforeSale = snapshotLedgers(db);
    const saleId = giftCardSale("GIFT-G37-0003");
    // $50 deposited, $20 consumed by the sale → $30 left as account credit.
    expectPostings(beforeSale, snapshotLedgers(db), {
      debt: { [`${clientId}|USD`]: -30 },
    });

    getTransactionRepository().refundBySaleId(saleId, USER_ID);
    expectPostings(beforeSale, snapshotLedgers(db), {});
    expect(voucher("GIFT-G37-0003")).toEqual(UNREDEEMED);
  });

  it("a gift card redeemed in a DIFFERENT transaction stays redeemed", () => {
    addVoucher("GIFT-G37-0004", 20);
    addVoucher("GIFT-G37-OTHER", 20);
    const saleId = giftCardSale("GIFT-G37-0004");
    const otherSale = giftCardSale("GIFT-G37-OTHER");
    getTransactionRepository().refundBySaleId(saleId, USER_ID);

    expect(voucher("GIFT-G37-0004").status).toBe("pending");
    const other = voucher("GIFT-G37-OTHER");
    expect(other.status).toBe("redeemed");
    expect(other.redeemed_transaction_id).not.toBeNull();
    expect(otherSale).not.toBe(saleId);
  });
});
