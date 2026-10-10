import type { RecentTransaction } from "@/api/reads";

import {
  formatAmounts,
  sessionLines,
  txnCashLine,
  txnDirection,
  txnDisplayAmount,
  txnRate,
  txnRowDetail,
} from "../activity";

const leg = (direction: "in" | "out", amount: number, currency_code: string, method = "CASH") => ({
  direction,
  amount,
  signed_amount: direction === "in" ? amount : -amount,
  currency_code,
  method,
});

const row = (over: Partial<RecentTransaction>): RecentTransaction => ({
  id: 1,
  type: "SALE",
  amount_usd: 10,
  amount_lbp: 0,
  summary: null,
  metadata_json: null,
  created_at: "2026-10-10 10:00:00",
  ...over,
});

describe("Activity row reads like the web Transactions row", () => {
  it("words a sale's cash as paid / change, LBP shortened on the row", () => {
    const sale = row({ payments: [leg("in", 20, "USD"), leg("out", 450000, "LBP")] });
    expect(txnCashLine(sale)).toBe("paid $20 · change 450k LBP");
    expect(txnCashLine(sale, false)).toBe("paid $20.00 · change 450,000 LBP");
  });

  it("uses in: / out: for other types, own cash legs only (no account legs)", () => {
    const repay = row({
      type: "DEBT_REPAYMENT",
      amount_usd: 115,
      amount_lbp: 200000,
      exchange_rate: 89000,
      payments: [leg("in", 115, "USD"), leg("in", 200000, "LBP")],
      account_payments: [leg("out", 115, "USD", "CUSTOMER_ACCOUNT")],
    });
    expect(txnCashLine(repay)).toBe("in: $115 + 200k LBP");
    expect(txnRowDetail(repay)).toBe("in: $115 + 200k LBP · @ 89,000 · on account");
  });

  it("shows the rate the basket was paid at, and none for a row that moves nothing", () => {
    expect(txnRate(row({ exchange_rate: 89000, display_exchange_rate: 89500 }))).toBe("@ 89,500");
    expect(txnRate(row({ amount_usd: 0, exchange_rate: 89000 }))).toBeNull();
  });

  it("shows a sale's value, not the cash handed over, as a magnitude", () => {
    expect(formatAmounts(txnDisplayAmount(row({ amount_usd: -4.25, amount_lbp: -450000 })), true)).toBe("$4.25");
  });

  it("gives the basket header its pooled Session line", () => {
    expect(sessionLines(row({ session_id: 38, session_payments: [leg("in", 134, "USD")] }))).toEqual([
      "Session: in: $134",
    ]);
  });

  it("uses the shared arrow: sale in, voided sale out, supplier credit as credit", () => {
    expect(txnDirection(row({}))).toBe("in");
    expect(txnDirection(row({ reverses_id: 9, amount_usd: -10 }))).toBe("out");
    expect(
      txnDirection(row({ type: "SUPPLIER_PAYMENT", metadata_json: JSON.stringify({ is_credit: true }) })),
    ).toBe("credit");
  });
});
