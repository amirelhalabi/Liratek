/**
 * CardGridPayView — active-session gating (note 19)
 *
 * Sibling forms (TelecomForm's own recharge/days flow, KatchForm) switch
 * their trigger button to "Add to Cart" and submit straight to the session
 * basket when a customer session is active, skipping the PaymentSheet
 * entirely. CardGridPayView (the shared Alfa Gift / MTC Voucher flow) used
 * to hardcode "Pay" and always open the PaymentSheet, so an Alfa gift sold
 * during an open session bypassed the basket.
 *
 * These tests never actually open the PaymentSheet (so MultiPaymentInput,
 * which needs its own API/context wiring, is never mounted) — they only
 * assert the trigger button's label and click behavior for both states.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CardGridPayView, type CardGridPayItem } from "../CardGridPayView";

const items: CardGridPayItem[] = [
  {
    id: "tier-a",
    label: "5$ Gift",
    costLbp: 400000,
    sellLbp: 450000,
    valueUsd: 5,
  },
];

type Props = ComponentProps<typeof CardGridPayView>;

function renderView(overrides: Partial<Props> = {}) {
  const onConfirm = jest.fn();
  const props: Props = {
    heading: "Select Alfa Gift",
    items,
    selectedId: "tier-a",
    onSelect: jest.fn(),
    accent: "red",
    showProfit: false,
    sheetTitle: "Alfa Gift Payment",
    onConfirm,
    isSubmitting: false,
    paymentMethods: [{ code: "CASH", label: "Cash" }],
    clientId: null,
    exchangeRate: 89000,
    onPaymentChange: jest.fn(),
    onDiscountChange: jest.fn(),
    clientName: "",
    onClientNameChange: jest.fn(),
    transactionTime: undefined,
    onTransactionTimeChange: jest.fn(),
    ...overrides,
  };
  render(<CardGridPayView {...props} />);
  return { onConfirm };
}

describe("CardGridPayView active-session gating", () => {
  it('shows "Pay" and does not confirm directly when no session is active', () => {
    const { onConfirm } = renderView();

    const button = screen.getByRole("button", { name: /pay/i });
    expect(button).toHaveTextContent("Pay");

    fireEvent.click(button);
    // Standalone mode opens the PaymentSheet instead of confirming directly.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows "Add to Cart" and confirms directly (skipping the PaymentSheet) when a session is active', () => {
    const { onConfirm } = renderView({ hasActiveSession: true });

    const button = screen.getByRole("button", { name: /add to cart/i });
    expect(button).toHaveTextContent("Add to Cart");

    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // The PaymentSheet must never open in session mode.
    expect(screen.queryByText("Alfa Gift Payment")).not.toBeInTheDocument();
  });
});
