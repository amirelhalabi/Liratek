import {
  isSwapTransactionType,
  SWAP_TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
  TRANSACTION_TYPES,
  type TransactionType,
} from "../transactionTypes.js";

describe("isSwapTransactionType", () => {
  it.each(["EXCHANGE", "WALLET_EXCHANGE", "DRAWER_TRANSFER"])(
    "%s is a swap",
    (t) => expect(isSwapTransactionType(t)).toBe(true),
  );
  it.each(["SALE", "FINANCIAL_SERVICE", "REFUND", "", null, undefined])(
    "%s is not a swap",
    (t) => expect(isSwapTransactionType(t as string | null)).toBe(false),
  );
  it("every swap type is refundable (not in NON_REVERSIBLE)", () => {
    for (const t of SWAP_TRANSACTION_TYPES) {
      expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(t as TransactionType)).toBe(
        false,
      );
      expect(Object.values(TRANSACTION_TYPES)).toContain(t);
    }
  });
});
