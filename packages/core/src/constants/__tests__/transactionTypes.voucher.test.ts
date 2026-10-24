/**
 * LIRA-339 (T001–T003) — voucher transaction types, their direction/labels,
 * the 'Voucher Debt' classification and the paid_via_voucher own tuples.
 * Written before the constants exist (rule 17).
 */
import {
  TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
  MODULE_DEBT_TRANSACTION_TYPES,
  REPAYMENT_COVERABLE_DEBT_TYPES,
} from "../transactionTypes";
import { TRANSACTION_CASH_DIRECTION } from "../../utils/cashFlow";
import { TRANSACTION_TYPE_LABELS } from "../../utils/transactionText";
import { PAID_VIA_VOUCHER_OWN_TUPLES } from "../paidViaVoucher";
import * as browserEntry from "../../browser";

describe("LIRA-339 voucher transaction types", () => {
  it("defines VOUCHER_SALE and VOUCHER_CANCEL", () => {
    expect(TRANSACTION_TYPES).toMatchObject({
      VOUCHER_SALE: "VOUCHER_SALE",
      VOUCHER_CANCEL: "VOUCHER_CANCEL",
    });
  });

  it("gates both as non-reversible (the Vouchers page cancel owns them)", () => {
    expect([...NON_REVERSIBLE_TRANSACTION_TYPES]).toEqual(
      expect.arrayContaining(["VOUCHER_SALE", "VOUCHER_CANCEL"]),
    );
  });

  it("classifies 'Voucher Debt' as a module charge that repayments cover", () => {
    expect(MODULE_DEBT_TRANSACTION_TYPES).toContain("Voucher Debt");
    expect(REPAYMENT_COVERABLE_DEBT_TYPES).toContain("Voucher Debt");
  });

  it("sale reads as cash in, cancel as cash out", () => {
    const dir = TRANSACTION_CASH_DIRECTION as Record<string, unknown>;
    expect(dir.VOUCHER_SALE).toBe("in");
    expect(dir.VOUCHER_CANCEL).toBe("out");
  });

  it("labels both rows", () => {
    const labels = TRANSACTION_TYPE_LABELS as Record<string, string | null>;
    expect(labels.VOUCHER_SALE).toBe("Voucher sold");
    expect(labels.VOUCHER_CANCEL).toBe("Voucher cancelled");
  });

  it("paid_via_voucher own tuples are the two voucher types, exported from the browser entry", () => {
    expect(PAID_VIA_VOUCHER_OWN_TUPLES).toEqual([
      { type: "VOUCHER_SALE" },
      { type: "VOUCHER_CANCEL" },
    ]);
    expect(
      (browserEntry as Record<string, unknown>).PAID_VIA_VOUCHER_OWN_TUPLES,
    ).toBe(PAID_VIA_VOUCHER_OWN_TUPLES);
  });
});
