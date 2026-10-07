/** @jest-environment jsdom */
/**
 * Refund kept change (owner decision 2026-10-07) through the real, unmocked
 * MultiPaymentInput: a $20.12 refund handed back as $20 keeps $0.12 as shop
 * profit — under $1, same currency, cash only, and only where the caller
 * says this refund can keep change (`allowKeptChange`, the server's
 * `REFUND_KEPT_CHANGE_TYPES`).
 *
 * The kept amount rides as onConfirm's FOURTH argument, named from the
 * shared core schema (`refundKeptChangeSchema`, rule 24).
 *
 * Rule 17: written before RefundMethodModal was changed; failure text is in
 * the change report.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { refundKeptChangeSchema } from "@liratek/core";
import { RefundMethodModal } from "../RefundMethodModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

const cashIn = (amount: number, currency_code = "USD"): TransactionPaymentLeg => ({
  direction: "in",
  amount,
  signed_amount: amount,
  currency_code,
  method: "CASH",
});

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
];

function renderModal(
  legs: TransactionPaymentLeg[],
  allowKeptChange: boolean,
  onConfirm = jest.fn(),
) {
  render(
    <RefundMethodModal
      legs={legs}
      paymentMethods={PAYMENT_METHODS}
      exchangeRate={89_000}
      allowKeptChange={allowKeptChange}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

const confirmButton = () =>
  screen.getByRole("button", { name: "Confirm Refund" });

describe("RefundMethodModal — refund kept change", () => {
  it("$20.12 handed back as $20: Confirm enabled and the $0.12 kept rides as the 4th argument", () => {
    const onConfirm = renderModal([cashIn(20.12)], true);
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "20" },
    });
    expect(
      screen.queryByTestId("refund-validation-error"),
    ).not.toBeInTheDocument();
    expect(confirmButton()).not.toBeDisabled();

    fireEvent.click(confirmButton());
    const expectedKept = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      undefined,
      89_000,
      expectedKept,
    );
  });

  it("not allowed for this refund: handing back $20 of $20.12 stays blocked", () => {
    renderModal([cashIn(20.12)], false);
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "20" },
    });
    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("a non-cash return line cannot keep change", () => {
    renderModal([cashIn(20.12)], true);
    fireEvent.change(screen.getByTestId(/payment-method-/), {
      target: { value: "OMT" },
    });
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "20" },
    });
    expect(screen.getByTestId("refund-validation-error")).toHaveTextContent(
      /cash/i,
    );
    expect(confirmButton()).toBeDisabled();
  });

  it("$1 or more short is not kept change — stays blocked", () => {
    renderModal([cashIn(21)], true);
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "20" },
    });
    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("handing back MORE than the refund stays blocked", () => {
    renderModal([cashIn(20.12)], true);
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "20.5" },
    });
    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("cross-currency refund a cent or so short (inside the old value tolerance) still confirms, with no kept change", () => {
    // LIRA-236 regression guard: a USD sale refunded all in LBP, a little
    // short of the exact conversion ($20.12 × 89,000 = 1,790,680 LBP;
    // 1,789,500 is $0.013 short — over MPI's $0.01 match tolerance, under
    // the $0.02 refund value tolerance). Payout mode reports that as kept,
    // but it is not keepable (not in USD) — the plain value check must
    // still accept it, as before.
    const onConfirm = renderModal([cashIn(20.12)], true);
    fireEvent.change(screen.getByTestId(/payment-currency-/), {
      target: { value: "LBP" },
    });
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "1789500" },
    });
    expect(
      screen.queryByTestId("refund-validation-error"),
    ).not.toBeInTheDocument();
    expect(confirmButton()).not.toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "LBP", amount: 1_789_500 }],
      undefined,
      89_000,
    );
  });

  it("untouched exact refund still sends no override and no kept change", () => {
    const onConfirm = renderModal([cashIn(20.12)], true);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });
});
