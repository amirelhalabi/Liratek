/**
 * isReversibleRow — Void/Refund row-actionability gate (note 21d).
 *
 * Pre-fix, the Transactions viewer's inline gate
 * (`ACTIONABLE_TYPES.has(type) && status !== "VOIDED" && type !== "REFUND"
 * && !reverses_id`) never went false once a transaction was refunded: the
 * refunded ORIGINAL row keeps status=ACTIVE and reverses_id=null (see
 * TransactionRepository.refundTransaction), so Void/Refund stayed visible
 * and a second click was only rejected server-side ("Transaction has
 * already been refunded"). `reversed_by_id` (TransactionRepository.getRecent)
 * is the new read-model signal that closes the gap.
 *
 * Failing-first (rule 17): a row shaped exactly like a refunded original
 * (ACTIVE, no reverses_id, reversed_by_id set) is asserted NOT reversible.
 * Against the pre-fix gate (which never read reversed_by_id at all) this
 * would report `true` — the bug this test guards.
 */
import { isReversibleRow, type ActionGatingFields } from "../actionGating";

function row(overrides: Partial<ActionGatingFields>): ActionGatingFields {
  return {
    type: "SALE",
    status: "ACTIVE",
    reverses_id: null,
    reversed_by_id: null,
    ...overrides,
  };
}

describe("isReversibleRow", () => {
  it("an ordinary ACTIVE, never-refunded row is reversible", () => {
    expect(isReversibleRow(row({}))).toBe(true);
  });

  it("a refunded original (ACTIVE, reversed_by_id set) is NOT reversible — the bug this guards", () => {
    expect(isReversibleRow(row({ reversed_by_id: 42 }))).toBe(false);
  });

  it("a VOIDED row is not reversible", () => {
    expect(isReversibleRow(row({ status: "VOIDED" }))).toBe(false);
  });

  it("a REFUND row (type REFUND) is not reversible", () => {
    expect(isReversibleRow(row({ type: "REFUND", reverses_id: 1 }))).toBe(
      false,
    );
  });

  it("a VOID reversal row (reverses_id set) is not reversible", () => {
    expect(isReversibleRow(row({ reverses_id: 7 }))).toBe(false);
  });

  it("a non-actionable type (e.g. CHECKPOINT) is not reversible regardless of other fields", () => {
    expect(isReversibleRow(row({ type: "CHECKPOINT" }))).toBe(false);
  });
});
