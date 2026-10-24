/**
 * LIRA-339 T013 — rule 20 gate: VOUCHER_SALE (cash or on account) and
 * VOUCHER_CANCEL are module-owned (reversal owner:
 * VoucherRepository.cancelWithRefund), so the generic void and refund refuse
 * them and leave every drawer and the customer's account untouched.
 *
 * Precondition asserts make this red on the pre-feature code (no rows yet),
 * not vacuously green.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  OWNER,
} from "../testHelpers/voucherSaleDb";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";
import { getVoucherService } from "../../services/VoucherService";
import { getTransactionRepository } from "../TransactionRepository";
import type {
  VoucherCreateInput,
  VoucherCancelInput,
} from "../../validators/voucher";

type SaleLeg = NonNullable<VoucherCreateInput["payments"]>[number];
type CancelFn = (
  id: number,
  input: VoucherCancelInput,
  cancelledBy: number,
) => { success: boolean };

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => uninstallVoucherSaleDb(db));

function sell(payments: SaleLeg[]): number {
  const res = getVoucherService().createVoucher(
    { clientId: OWNER, amount: 50, currency: "USD", payments },
    1,
  );
  expect(res.success).toBe(true);
  return res.voucher!.id;
}

function expectGated(txnId: number): void {
  const repo = getTransactionRepository();
  const before = snapshotLedgers(db);
  expect(() => repo.voidTransaction(txnId, 1)).toThrow(/cannot be voided/);
  expect(() => repo.refundTransaction(txnId, 1)).toThrow(/cannot be voided/);
  expectPostings(before, snapshotLedgers(db), {});
}

describe("T013 — voucher rows are not reversible from Transactions", () => {
  it("a cash VOUCHER_SALE is refused by void and refund", () => {
    const id = sell([{ method: "CASH", currency_code: "USD", amount: 50 }]);
    const [sale] = voucherTxns(db, id, "VOUCHER_SALE");
    expect(sale).toBeDefined();
    expectGated(sale.id);
  });

  it("an on-account VOUCHER_SALE is refused, the account untouched", () => {
    const id = sell([
      { method: "CASH", currency_code: "USD", amount: 20 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ]);
    const [sale] = voucherTxns(db, id, "VOUCHER_SALE");
    expect(sale).toBeDefined();
    expectGated(sale.id);
  });

  it("a VOUCHER_CANCEL is refused", () => {
    const id = sell([{ method: "CASH", currency_code: "USD", amount: 50 }]);
    const svc = getVoucherService();
    const cancel = svc.cancelVoucher.bind(svc) as unknown as CancelFn;
    expect(cancel(id, {}, 1).success).toBe(true);
    const [row] = voucherTxns(db, id, "VOUCHER_CANCEL");
    expect(row).toBeDefined();
    expectGated(row.id);
  });
});
