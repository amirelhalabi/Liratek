/** @jest-environment jsdom */
/**
 * LIRA-078 — RefundMethodModal RTL tests.
 *
 * Covers the ticket's "modal test" requirement: prefill from the original
 * legs, method switch, and the payload shape sent to `onConfirm` —
 * including the "plain refund (no modal interaction) behaves exactly as
 * today" contract (`onConfirm(undefined)` when the operator changes
 * nothing, `onConfirm([...])` once they pick a different method).
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

describe("RefundMethodModal", () => {
  it("prefills one line per original currency, defaulting to the original method", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$100 via Cash",
    );
  });

  it("confirming without touching anything sends NO override (byte-identical to today)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("switching the method updates the summary and sends the override payload on confirm", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    const methodSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(methodSelect, { target: { value: "OMT" } });

    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$100 via OMT Wallet",
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith([
      { method: "OMT", currencyCode: "USD", amount: 100 },
    ]);
  });

  it("disables Confirm and shows a validation hint when the operator lowers the amount", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "60" } });

    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).toBeDisabled();
  });

  it("prefills TWO lines for a mixed-currency transaction, one per currency", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 60, "USD", "CASH"), leg("in", 900_000, "LBP", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$60 via Cash",
    );
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "900,000 LBP via Cash",
    );
  });
});
