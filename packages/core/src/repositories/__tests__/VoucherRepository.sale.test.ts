/**
 * LIRA-339 T010 — selling a voucher is a money flow.
 *
 * Driven through the real `VoucherService.createVoucher` on the real schema
 * (create_db.sql) so the test runs against the pre-feature code and fails
 * for a behaviour reason (no VOUCHER_SALE row, drawer unchanged), rule 17.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  paymentsOf,
  debtRowsOf,
  countRows,
  OWNER,
  OWNER_NO_PHONE,
} from "../testHelpers/voucherSaleDb";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";
import { getVoucherService } from "../../services/VoucherService";
import { TransactionRepository } from "../TransactionRepository";
import type { VoucherCreateInput } from "../../validators/voucher";

type SaleLeg = NonNullable<VoucherCreateInput["payments"]>[number];

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => {
  jest.restoreAllMocks();
  uninstallVoucherSaleDb(db);
});

function sell(clientId: number, amount: number, payments: SaleLeg[]) {
  return getVoucherService().createVoucher(
    { clientId, amount, currency: "USD", payments },
    1,
  );
}

describe("T010 — voucher sale", () => {
  it("$50 paid $60 cash with $10 change: one VOUCHER_SALE, legs +60/−10, General USD +50", () => {
    const before = snapshotLedgers(db);
    const res = sell(OWNER, 50, [
      { method: "CASH", currency_code: "USD", amount: 60 },
      { method: "CASH", currency_code: "USD", amount: 10, direction: "OUT" },
    ]);
    expect(res.success).toBe(true);
    const voucherId = res.voucher!.id;

    const rows = voucherTxns(db, voucherId, "VOUCHER_SALE");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_table: "vouchers",
      source_id: voucherId,
      amount_usd: 50,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      client_id: OWNER,
      client_name: "Jane Owner",
      client_phone: "70111222",
    });
    expect((res as { transactionId?: number }).transactionId).toBe(rows[0].id);
    expect(paymentsOf(db, rows[0].id).map((p) => [p.method, p.amount])).toEqual(
      [
        ["CASH", 60],
        ["CASH", -10],
      ],
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 50 },
    });
  });

  it("refuses legs that do not cover the face value, writing nothing", () => {
    const res = sell(OWNER, 50, [
      { method: "CASH", currency_code: "USD", amount: 40 },
    ]);
    expect(res.success).toBe(false);
    expect(countRows(db, "vouchers")).toBe(0);
    expect(countRows(db, "payments")).toBe(0);
  });

  it("refuses a GIFT_CARD leg (a voucher cannot buy a voucher)", () => {
    const legs = [
      { method: "GIFT_CARD", currency_code: "USD", amount: 50 },
    ] as unknown as SaleLeg[];
    const res = sell(OWNER, 50, legs);
    expect(res.success).toBe(false);
    expect(countRows(db, "vouchers")).toBe(0);
  });

  it("$20 cash + $30 on account: drawer +20, ONE 'Voucher Debt' +30 on the sale id, no payment row for the account leg", () => {
    const before = snapshotLedgers(db);
    const res = sell(OWNER, 50, [
      { method: "CASH", currency_code: "USD", amount: 20 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ]);
    expect(res.success).toBe(true);
    const [sale] = voucherTxns(db, res.voucher!.id, "VOUCHER_SALE");
    expect(sale).toBeDefined();
    expect(paymentsOf(db, sale.id).map((p) => [p.method, p.amount])).toEqual([
      ["CASH", 20],
    ]);
    expect(debtRowsOf(db, sale.id)).toEqual([
      {
        client_id: OWNER,
        transaction_type: "Voucher Debt",
        amount_usd: 30,
        amount_lbp: 0,
        transaction_id: sale.id,
      },
    ]);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 20 },
      debt: { [`${OWNER}|USD`]: 30 },
    });
  });

  it("refuses an account leg when the owner has no phone", () => {
    const res = sell(OWNER_NO_PHONE, 50, [
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
    ]);
    expect(res.success).toBe(false);
    expect(countRows(db, "vouchers")).toBe(0);
    expect(countRows(db, "debt_ledger")).toBe(0);
  });

  it("a failure part-way rolls back the voucher row too", () => {
    jest
      .spyOn(TransactionRepository.prototype, "createTransaction")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    const res = sell(OWNER, 50, [
      { method: "CASH", currency_code: "USD", amount: 50 },
    ]);
    expect(res.success).toBe(false);
    expect(countRows(db, "vouchers")).toBe(0);
    expect(countRows(db, "payments")).toBe(0);
  });

  it("a back-dated sale back-dates the voucher too (Hold Money precedent)", () => {
    const when = "2026-09-01 10:15:00";
    const res = getVoucherService().createVoucher(
      {
        clientId: OWNER,
        amount: 50,
        currency: "USD",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        transaction_time: when,
      },
      1,
    );
    expect(res.success).toBe(true);
    const sale = db
      .prepare(
        "SELECT created_at FROM transactions WHERE type = 'VOUCHER_SALE' AND source_id = ?",
      )
      .get(res.voucher!.id) as { created_at: string };
    const voucher = db
      .prepare("SELECT created_at FROM vouchers WHERE id = ?")
      .get(res.voucher!.id) as { created_at: string };
    expect(voucher.created_at).toBe(when);
    expect(sale.created_at).toBe(when);
  });
});
