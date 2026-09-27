/**
 * Round-2 finding #10a (LOW) — `quantity` without `saleItemId` used to pass
 * schema validation and reach `TransactionRepository.refundSessionBasketItem`,
 * which reads `quantity` as meaningless in that shape (the Q2 "all remaining
 * lines" branch only fires when `saleItemId` is omitted, and silently ignores
 * `quantity` in that case) — silently refunding every remaining line instead
 * of the one line the caller probably meant. Reject it at the schema, in ONE
 * place shared by both transports (rule 14), before it ever reaches the
 * repository.
 *
 * Rule 17: written and run against the pre-fix schema (no `.refine()`) first
 * — see the recorded RED below — then the fix landed and this file was rerun
 * green.
 */
import {
  sessionItemRefundSchema,
  sessionItemRefundPreviewSchema,
} from "../transaction.js";

describe("sessionItemRefundSchema / sessionItemRefundPreviewSchema — quantity requires saleItemId", () => {
  it("rejects quantity given without saleItemId (write schema)", () => {
    const result = sessionItemRefundSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      quantity: 1,
      clientDay: undefined,
    });
    // RED on the pre-fix schema: this parsed successfully.
    expect(result.success).toBe(false);
  });

  it("rejects quantity given without saleItemId (preview schema)", () => {
    const result = sessionItemRefundPreviewSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      quantity: 1,
    });
    expect(result.success).toBe(false);
  });

  it("still accepts saleItemId + quantity together", () => {
    const result = sessionItemRefundSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      saleItemId: 3,
      quantity: 1,
      clientDay: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("still accepts BOTH omitted (Q2 — every remaining line)", () => {
    const result = sessionItemRefundSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      clientDay: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("still rejects saleItemId given without quantity (unchanged requirement)", () => {
    const result = sessionItemRefundSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      saleItemId: 3,
      clientDay: undefined,
    });
    expect(result.success).toBe(false);
  });
});
