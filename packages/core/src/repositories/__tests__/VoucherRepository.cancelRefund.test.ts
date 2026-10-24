/**
 * LIRA-339 T012 + T021 — cancelling a sold voucher refunds what the sale took
 * in, leg by leg: the cash part through payout legs, the on-account part as a
 * 'Refund Reversal' on the customer's account (rule 20: create + cancel net 0
 * on every ledger, per currency). Legacy vouchers (no sale row) refund 0.
 *
 * Real `VoucherService` on the real schema. The new cancel signature is passed
 * through an `unknown` cast so this file runs (red) against the old service.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  paymentsOf,
  debtRowsOf,
  OWNER,
  RATE,
} from "../testHelpers/voucherSaleDb";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";
import { getVoucherService } from "../../services/VoucherService";
import { getVoucherRepository } from "../VoucherRepository";
import { getDebtRepository } from "../DebtRepository";
import type {
  VoucherCreateInput,
  VoucherCancelInput,
} from "../../validators/voucher";

type SaleLeg = NonNullable<VoucherCreateInput["payments"]>[number];
type RefundLeg = NonNullable<VoucherCancelInput["payments"]>[number];

interface CancelResult {
  success: boolean;
  error?: string;
  transactionId?: number;
  voucher?: { status: string };
  refunded?: {
    cash: { usd: number; lbp: number };
    toAccount: { usd: number; lbp: number };
  };
}

interface ListRow {
  id: number;
  sale_usd: number;
  sale_lbp: number;
  sale_account_usd: number;
  sale_account_lbp: number;
}

type CancelFn = (
  id: number,
  input: VoucherCancelInput,
  cancelledBy: number,
) => CancelResult;

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => uninstallVoucherSaleDb(db));

function sell(
  amount: number,
  payments: SaleLeg[],
  currency: "USD" | "LBP" = "USD",
  expiryDate?: string,
): number {
  const res = getVoucherService().createVoucher(
    {
      clientId: OWNER,
      amount,
      currency,
      exchange_rate: RATE,
      payments,
      ...(expiryDate ? { expiryDate } : {}),
    },
    1,
  );
  expect(res.success).toBe(true);
  return res.voucher!.id;
}

function cancel(id: number, input: VoucherCancelInput): CancelResult {
  const svc = getVoucherService();
  const fn = svc.cancelVoucher.bind(svc) as unknown as CancelFn;
  return fn(id, input, 1);
}

function listRow(id: number): ListRow {
  const res = getVoucherService().getVouchers({});
  const row = (res.vouchers as unknown as ListRow[]).find((v) => v.id === id);
  return row!;
}

function cashLeg(currency: "USD" | "LBP", amount: number): RefundLeg {
  return { method: "CASH", currency_code: currency, amount };
}

/** A voucher written straight to the table: the pre-feature shape, no sale. */
function legacyVoucher(): number {
  return getVoucherRepository().createVoucher({
    code: "GIFT-LEGA-CY01",
    client_id: OWNER,
    client_name: "Jane Owner",
    client_phone: "70111222",
    amount: 40,
    currency_code: "USD",
    expiry_date: null,
    note: null,
    created_by: 1,
  }).id;
}

describe("T012 — cancel refunds the sale", () => {
  it("cash sale, cash payout in the sale currency: every drawer nets 0, one VOUCHER_CANCEL, voucher cancelled", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [cashLeg("USD", 50)]);
    expect(listRow(id)).toMatchObject({
      sale_usd: 50,
      sale_lbp: 0,
      sale_account_usd: 0,
      sale_account_lbp: 0,
    });

    const res = cancel(id, { payments: [cashLeg("USD", 50)] });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(res.voucher?.status).toBe("cancelled");
    expect(res.refunded).toEqual({
      cash: { usd: 50, lbp: 0 },
      toAccount: { usd: 0, lbp: 0 },
    });
    const rows = voucherTxns(db, id, "VOUCHER_CANCEL");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_usd: 50,
      profit_usd: 0,
      profit_lbp: 0,
      client_id: OWNER,
    });
    expect(res.transactionId).toBe(rows[0].id);
    expect(paymentsOf(db, rows[0].id).map((p) => p.amount)).toEqual([-50]);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("an empty input ({}) refunds the cash part in cash (fallback leg)", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [cashLeg("USD", 50)]);
    const res = cancel(id, {});
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("cross-currency: USD voucher paid in LBP, refunded in USD — USD-equivalent net 0 at the stamped rate", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [cashLeg("LBP", 50 * RATE)]);
    const res = cancel(id, {
      payments: [cashLeg("USD", 50)],
      exchange_rate: RATE,
    });
    expect(res.success).toBe(true);
    const d = ledgerDeltas(before, snapshotLedgers(db)).drawers;
    expect(d).toEqual({ "General|LBP": 50 * RATE, "General|USD": -50 });
    const netUsd = (d["General|USD"] ?? 0) + (d["General|LBP"] ?? 0) / RATE;
    expect(netUsd).toBeCloseTo(0, 6);
  });

  it("a legacy voucher (no sale row) cancels with 0 amount and no payments; payout legs are refused", () => {
    const id = legacyVoucher();
    expect(listRow(id)).toMatchObject({ sale_usd: 0, sale_lbp: 0 });

    const refused = cancel(id, { payments: [cashLeg("USD", 40)] });
    expect(refused.success).toBe(false);
    expect(getVoucherRepository().findById(id)?.status).toBe("pending");

    const before = snapshotLedgers(db);
    const res = cancel(id, {});
    expect(res.success).toBe(true);
    const rows = voucherTxns(db, id, "VOUCHER_CANCEL");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount_usd: 0, amount_lbp: 0 });
    expect(JSON.parse(rows[0].metadata_json ?? "{}")).toMatchObject({
      legacy: true,
    });
    expect(paymentsOf(db, rows[0].id)).toEqual([]);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("a redeemed voucher is refused", () => {
    const id = sell(50, [cashLeg("USD", 50)]);
    db.prepare(`UPDATE vouchers SET status = 'redeemed' WHERE id = ?`).run(id);
    const before = snapshotLedgers(db);
    const res = cancel(id, {});
    expect(res.success).toBe(false);
    expect(voucherTxns(db, id, "VOUCHER_CANCEL")).toHaveLength(0);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("a second cancel is refused and only one refund row exists", () => {
    const id = sell(50, [cashLeg("USD", 50)]);
    expect(cancel(id, {}).success).toBe(true);
    const before = snapshotLedgers(db);
    expect(cancel(id, {}).success).toBe(false);
    expect(voucherTxns(db, id, "VOUCHER_CANCEL")).toHaveLength(1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("an expired pending sold voucher refunds in full (expiry noted from the client day)", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [cashLeg("USD", 50)], "USD", "2026-01-31");
    const res = cancel(id, { client_day: "2026-10-24" });
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {});
    const [row] = voucherTxns(db, id, "VOUCHER_CANCEL");
    expect(JSON.parse(row.metadata_json ?? "{}")).toMatchObject({
      expired_at_cancel: true,
    });
  });

  it("payout legs that do not reconcile to the cash part are refused, nothing written", () => {
    const id = sell(50, [cashLeg("USD", 50)]);
    const before = snapshotLedgers(db);
    const res = cancel(id, { payments: [cashLeg("USD", 30)] });
    expect(res.success).toBe(false);
    expect(getVoucherRepository().findById(id)?.status).toBe("pending");
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("$20 cash + $30 account, cancel with $20 cash: drawer AND account net 0; payout over $20 refused", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [
      cashLeg("USD", 20),
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ]);
    expect(listRow(id)).toMatchObject({
      sale_usd: 50,
      sale_account_usd: 30,
    });

    expect(cancel(id, { payments: [cashLeg("USD", 50)] }).success).toBe(false);

    const res = cancel(id, { payments: [cashLeg("USD", 20)] });
    expect(res.success).toBe(true);
    expect(res.refunded).toEqual({
      cash: { usd: 20, lbp: 0 },
      toAccount: { usd: 30, lbp: 0 },
    });
    const [sale] = voucherTxns(db, id, "VOUCHER_SALE");
    expect(
      debtRowsOf(db, sale.id).map((r) => [r.transaction_type, r.amount_usd]),
    ).toEqual([
      ["Voucher Debt", 30],
      ["Refund Reversal", -30],
    ]);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("all on account: cancel moves no cash, debt nets 0, any payout leg refused", () => {
    const before = snapshotLedgers(db);
    const id = sell(50, [
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
    ]);
    expect(cancel(id, { payments: [cashLeg("USD", 1)] }).success).toBe(false);
    const res = cancel(id, {});
    expect(res.success).toBe(true);
    const [row] = voucherTxns(db, id, "VOUCHER_CANCEL");
    expect(paymentsOf(db, row.id)).toEqual([]);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("partly repaid: $30 on account, $20 repaid, cancel → account −$20 (credit), drawer +$20 from the repayment only", () => {
    const before = snapshotLedgers(db);
    const id = sell(30, [
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ]);
    getDebtRepository().addRepayment({
      client_id: OWNER,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
      paid_by_method: "CASH",
    });
    const res = cancel(id, {});
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 20 },
      debt: { [`${OWNER}|USD`]: -20 },
    });
  });
});
