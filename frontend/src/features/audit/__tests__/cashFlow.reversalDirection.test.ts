/**
 * Production test 2026-10-07 — the ↓/↑ arrow on void rows did not match the
 * sign of the amount. A void copies the original's `type` and
 * `metadata_json` (TransactionRepository._voidTransactionInternal), so the
 * per-type lookup answered the ORIGINAL's direction: a voided sale showed a
 * green "cash in" arrow next to money that went back out. A REFUND row had no
 * arrow at all.
 *
 * Contract pinned here (`getRowCashFlowDirection`):
 *   - a void row (reverses_id set, not a REFUND) shows the original's
 *     direction reversed — "both" and "no badge" stay as they are;
 *   - the original's direction is rebuilt from the original's inputs
 *     (signed amounts negated back, legs flipped back) BEFORE reversing, so
 *     sign-driven types (historical partner rows) are not flipped twice;
 *   - a REFUND row's arrow follows its own legs.
 */
import {
  getRowCashFlowDirection,
  type TransactionPaymentLeg,
} from "../cashFlow";

function leg(direction: "in" | "out", amount: number): TransactionPaymentLeg {
  return {
    direction,
    amount,
    signed_amount: direction === "out" ? -amount : amount,
    currency_code: "USD",
    method: "CASH",
  };
}

describe("getRowCashFlowDirection — voids and refunds", () => {
  it("a sale is IN; its void is OUT", () => {
    expect(
      getRowCashFlowDirection({
        type: "SALE",
        metadata_json: null,
        amount_usd: 4.25,
        amount_lbp: 0,
        reverses_id: null,
        payments: [leg("in", 5), leg("out", 0.5)],
      }),
    ).toBe("in");
    expect(
      getRowCashFlowDirection({
        type: "SALE",
        metadata_json: null,
        amount_usd: -4.25,
        amount_lbp: 0,
        reverses_id: 99,
        payments: [leg("out", 5), leg("in", 0.5)],
      }),
    ).toBe("out");
  });

  it("void of an expense (OUT) is IN", () => {
    expect(
      getRowCashFlowDirection({
        type: "EXPENSE",
        metadata_json: null,
        amount_usd: -20,
        amount_lbp: 0,
        reverses_id: 5,
        payments: [leg("in", 20)],
      }),
    ).toBe("in");
  });

  it("void of a partner settlement whose flow is in the copied metadata is reversed", () => {
    expect(
      getRowCashFlowDirection({
        type: "PARTNER_SETTLEMENT",
        metadata_json: JSON.stringify({ counterparty: { flow: "IN" } }),
        amount_usd: -50,
        amount_lbp: 0,
        reverses_id: 8,
        payments: [],
      }),
    ).toBe("out");
  });

  it("void of a HISTORICAL partner settlement (direction from the sign) is not flipped twice", () => {
    // Original: +50 (cash in). The void stores −50. Reading the void's own
    // sign already says "out"; flipping that again would wrongly say "in".
    expect(
      getRowCashFlowDirection({
        type: "PARTNER_SETTLEMENT",
        metadata_json: null,
        amount_usd: -50,
        amount_lbp: 0,
        reverses_id: 8,
        payments: [],
      }),
    ).toBe("out");
  });

  it("void of a fee-on-top RECEIVE (both ways) stays 'both'", () => {
    expect(
      getRowCashFlowDirection({
        type: "FINANCIAL_SERVICE",
        metadata_json: JSON.stringify({ service_type: "RECEIVE" }),
        amount_usd: -100,
        amount_lbp: 0,
        reverses_id: 12,
        payments: [leg("in", 100), leg("out", 3)],
      }),
    ).toBe("both");
  });

  it("void of a type with no badge keeps no badge", () => {
    expect(
      getRowCashFlowDirection({
        type: "SUPPLIER_ADJUSTMENT",
        metadata_json: null,
        amount_usd: -10,
        amount_lbp: 0,
        reverses_id: 3,
        payments: [],
      }),
    ).toBeNull();
  });

  it("a REFUND that handed money back is OUT", () => {
    expect(
      getRowCashFlowDirection({
        type: "REFUND",
        metadata_json: null,
        amount_usd: -4.25,
        amount_lbp: 0,
        reverses_id: 99,
        payments: [leg("out", 4)],
      }),
    ).toBe("out");
  });

  it("a REFUND of a payout (money came back in) is IN; with no cash legs, no badge", () => {
    expect(
      getRowCashFlowDirection({
        type: "REFUND",
        metadata_json: null,
        amount_usd: -100,
        amount_lbp: 0,
        reverses_id: 40,
        payments: [leg("in", 100)],
      }),
    ).toBe("in");
    expect(
      getRowCashFlowDirection({
        type: "REFUND",
        metadata_json: null,
        amount_usd: -4.25,
        amount_lbp: 0,
        reverses_id: 99,
        payments: [],
      }),
    ).toBeNull();
  });
});
