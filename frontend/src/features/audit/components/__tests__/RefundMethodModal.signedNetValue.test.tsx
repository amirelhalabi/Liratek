/** @jest-environment jsdom */
/**
 * LIRA-236 round-2/final review, finding F1 (BLOCKER, frontend half) —
 * `validateRefundValue` (refundLegOverride.ts) used to compare `Math.abs`'d
 * per-currency totals instead of the SIGNED net, which stacks an IN leg and
 * an OUT leg in different currencies instead of netting them against each
 * other. `refundLegOverride.test.ts` proves the pure function in isolation;
 * THIS file proves the same bug/fix through the real, unmocked
 * `MultiPaymentInput` — the reviewer's own note is that a mocked MPI hides
 * this class of bug, since it's the real per-line remove/edit interactions
 * (and RefundMethodModal's wiring of `overrideLines`/`originalNet`/
 * `currentRate` into `validateRefundValue`) that reproduce it, not the pure
 * function alone.
 *
 * Written failing-first: every scenario below was run against the pre-fix
 * (abs-based) `validateRefundValue` and confirmed failing before the
 * signed-net rewrite (see refundLegOverride.ts and the sibling
 * refundLegOverride.test.ts describe block for the exact numbers).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { RefundMethodModal } from "../RefundMethodModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
  method = "CASH",
): TransactionPaymentLeg => ({
  direction,
  amount,
  signed_amount: direction === "out" ? -amount : amount,
  currency_code,
  method,
});

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
];

describe("RefundMethodModal — LIRA-236 F1 signed-net value matching (real MultiPaymentInput)", () => {
  it("a $90 sale (paid $100 cash, 895,000 LBP change given back): $90 enables Confirm, $110 (the old abs-sum) doesn't", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[
          leg("in", 100, "USD", "CASH"),
          leg("out", 895_000, "LBP", "CASH"),
        ]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89_500}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Two default lines pre-fill (LIRA-078's per-currency mirror, one per
    // currency — unaffected by this ticket). Drop the LBP "change" line so
    // the operator is left with a single USD line, reproducing the
    // reviewer's finding directly: they want to hand back the net $90.
    const removeButtons = screen.getAllByTitle("Remove");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]); // the LBP line

    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "90" } });
    expect(
      screen.queryByTestId("refund-validation-error"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "USD", amount: 90 }],
      undefined,
      89_500,
    );

    fireEvent.change(amountInput, { target: { value: "110" } });
    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).toBeDisabled();
  });

  it("a fee-on-top payout (RECEIVE shape) refund switched to LBP validates with the CORRECT direction — the net $95, not the old abs-sum $105", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        // $5 fee paid IN (USD), $100 payout OUT (as 8,900,000 LBP @ 89000).
        legs={[
          leg("in", 5, "USD", "CASH"),
          leg("out", 8_900_000, "LBP", "CASH"),
        ]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89_000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Drop the USD fee line, keep the LBP payout line, and dial it down from
    // the payout's own 8,900,000 to the net $95 the shop actually owes back
    // (5 - 100 = -95) — NOT the abs sum of both legs (5 + 100 = $105), which
    // is what the pre-fix per-currency-abs rule required.
    const removeButtons = screen.getAllByTitle("Remove");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]); // the USD fee line

    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "8455000" } }); // $95 worth
    expect(
      screen.queryByTestId("refund-validation-error"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "LBP", amount: 8_455_000 }],
      undefined,
      89_000,
    );
  });

  it("a wash exchange ($100 USD in, 8,900,000 LBP out at the SAME rate — net value $0) rejects a $200 refund that merely sums the abs legs", () => {
    render(
      <RefundMethodModal
        legs={[
          leg("in", 100, "USD", "CASH"),
          leg("out", 8_900_000, "LBP", "CASH"),
        ]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89_000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    // Drop the LBP line, leaving the USD line, then bump it from its default
    // $100 up to $200 — the abs-sum ($100 + 8,900,000/89000 = $200) the OLD
    // rule accepted even though the transaction's real net value is $0.
    const removeButtons = screen.getAllByTitle("Remove");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]); // the LBP line

    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "200" } });

    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).toBeDisabled();
  });
});
