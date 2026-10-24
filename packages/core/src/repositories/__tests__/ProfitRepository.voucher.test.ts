/**
 * LIRA-339 T014 — a voucher is a liability, not income: selling and
 * cancelling one leaves the profit summary and revenue exactly as they were.
 * The row-exists preconditions keep this from passing vacuously on the
 * pre-feature code.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  OWNER,
} from "../testHelpers/voucherSaleDb";
import { resetProfitRepository } from "../ProfitRepository";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import { getVoucherService } from "../../services/VoucherService";
import type { VoucherCancelInput } from "../../validators/voucher";

type CancelFn = (
  id: number,
  input: VoucherCancelInput,
  cancelledBy: number,
) => { success: boolean };

const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => uninstallVoucherSaleDb(db));

function summary() {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getSummary(FROM, TO);
}

describe("T014 — vouchers stay out of profits", () => {
  it("profit summary and revenue are identical before and after a sale and a cancel", () => {
    const before = summary();

    const res = getVoucherService().createVoucher(
      {
        clientId: OWNER,
        amount: 50,
        currency: "USD",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
      },
      1,
    );
    expect(res.success).toBe(true);
    const id = res.voucher!.id;
    expect(voucherTxns(db, id, "VOUCHER_SALE")).toHaveLength(1);
    expect(summary()).toEqual(before);

    const svc = getVoucherService();
    const cancel = svc.cancelVoucher.bind(svc) as unknown as CancelFn;
    expect(cancel(id, {}, 1).success).toBe(true);
    expect(voucherTxns(db, id, "VOUCHER_CANCEL")).toHaveLength(1);
    expect(summary()).toEqual(before);
  });
});
