/**
 * LIRA-232 round-2 review (finding 2) — `isSessionItemRefundRow` identifies a
 * REFUND row `TransactionRepository.refundSessionBasketItem` wrote (it
 * stamps `metadata_json.refundType = "sessionItem"` on every REFUND row it
 * creates). `TransactionsViewer` uses this to hide "Void basket" once a
 * session has ANY per-item refund — `voidSessionBasket` hard-refuses on a
 * basket touched by an item refund, so the button must be hidden rather than
 * offered and left to error on click. Extracted as a pure helper in
 * auditConstants.ts (same pattern as `isAutoSupplierPayment`/
 * `isExpenseVisible`) so the rule is unit-testable without rendering the
 * page. Written failing-first: at authoring time `isSessionItemRefundRow`
 * did not exist in auditConstants.ts at all.
 */
import { isSessionItemRefundRow } from "../auditConstants";

const sessionItemRefundMeta = JSON.stringify({
  refundType: "sessionItem",
  sessionId: 7,
  memberTransactionId: 55,
});
const wholeBasketRefundMeta = JSON.stringify({
  refundType: "sessionWholeBasket",
});
const plainRefundMeta = JSON.stringify({ note: "ordinary refund" });

describe("isSessionItemRefundRow", () => {
  it("true only for a REFUND row carrying metadata.refundType === 'sessionItem'", () => {
    expect(isSessionItemRefundRow("REFUND", sessionItemRefundMeta)).toBe(
      true,
    );
  });

  it("false for a REFUND row with a DIFFERENT refundType (e.g. a whole-basket reversal)", () => {
    expect(isSessionItemRefundRow("REFUND", wholeBasketRefundMeta)).toBe(
      false,
    );
  });

  it("false for a REFUND row with no refundType at all", () => {
    expect(isSessionItemRefundRow("REFUND", plainRefundMeta)).toBe(false);
  });

  it("false for a non-REFUND row, even with matching metadata (type gate first)", () => {
    expect(isSessionItemRefundRow("SALE", sessionItemRefundMeta)).toBe(false);
  });

  it("false for missing/malformed metadata — historical rows default to NOT a session item refund", () => {
    expect(isSessionItemRefundRow("REFUND", null)).toBe(false);
    expect(isSessionItemRefundRow("REFUND", undefined)).toBe(false);
    expect(isSessionItemRefundRow("REFUND", "not-json{")).toBe(false);
  });
});
