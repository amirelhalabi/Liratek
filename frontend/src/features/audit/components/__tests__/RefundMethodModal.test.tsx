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

// LIRA-143 Phase 6b — "Returned phones" units section.
describe("RefundMethodModal — units (phone-refund extras)", () => {
  it("renders no units section when `units` is omitted (byte-identical to pre-Phase-6b)", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("refund-units-section"),
    ).not.toBeInTheDocument();
  });

  it("confirming with units present but untouched calls onConfirm with ONE argument (no unitExtras)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("refund-units-section")).toBeInTheDocument();
    expect(screen.getByText("356938035643809")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(onConfirm.mock.calls[0]).toHaveLength(1);
  });

  it("checking Defective sends unitExtras as a SECOND argument alongside refundLegs", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 1, is_defective: true },
    ]);
  });

  it("setting a warranty-override date sends it in unitExtras", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    const dateInput = screen.getByLabelText("New warranty expiry");
    fireEvent.change(dateInput, { target: { value: "2027-01-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 1, warranty_override_until: "2027-01-15" },
    ]);
  });

  it("a units-only refund (no drawer legs) skips MultiPaymentInput and stays confirmable", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByTestId("multi-payment-input")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("refund-return-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 1, is_defective: true },
    ]);
  });

  it("renders one row per linked unit, each with its own checkbox", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[
          { id: 1, imei: "111111111111111" },
          { id: 2, imei: "222222222222222" },
        ]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("refund-unit-1")).toBeInTheDocument();
    expect(screen.getByTestId("refund-unit-2")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 2, is_defective: true },
    ]);
  });
});
