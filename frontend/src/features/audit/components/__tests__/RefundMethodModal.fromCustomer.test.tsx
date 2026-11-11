/** @jest-environment jsdom */
/**
 * LIRA-381 — the refund window in the "customer pays back" direction (a
 * basket payout being refunded: the customer hands the money back). Same
 * window, its own wording; kept change / "customer gives change" are never
 * offered on this side. Written with the change (not proven failing-first
 * by a run: before LIRA-381 the modal had no `direction` prop at all).
 */
import { render, screen } from "@testing-library/react";
import { RefundMethodModal } from "../RefundMethodModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

const PRIZE_LEG: TransactionPaymentLeg = {
  direction: "in",
  amount: 500000,
  signed_amount: 500000,
  currency_code: "LBP",
  method: "CASH",
};

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "WHISH", label: "Whish Wallet" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];

describe("RefundMethodModal — direction from_customer (LIRA-381)", () => {
  it("reads 'Customer pays back', pre-fills the payout, and offers no kept change", () => {
    render(
      <RefundMethodModal
        legs={[PRIZE_LEG]}
        paymentMethods={METHODS}
        exchangeRate={89000}
        direction="from_customer"
        allowKeptChange
        allowAddedChange
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText("Refund — Customer pays back")).toBeInTheDocument();
    expect(screen.getByTestId("refund-subtitle")).toHaveTextContent(
      "The customer gives this payout back",
    );
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "Customer pays: 500,000 LBP via Cash",
    );
    expect(
      screen.queryByText(/Customer gives change/i),
    ).not.toBeInTheDocument();
  });

  it("the default direction is unchanged (money handed back)", () => {
    render(
      <RefundMethodModal
        legs={[PRIZE_LEG]}
        paymentMethods={METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.getByText("Refund — Choose Return Method"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "Returning:",
    );
  });
});
