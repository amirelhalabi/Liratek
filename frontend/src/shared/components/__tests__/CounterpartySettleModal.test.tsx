/** @jest-environment jsdom */
/**
 * RTL render tests for CounterpartySettleModal (CQ-11 shared settlement
 * shell, re-exported from @liratek/ui — canonical implementation lives at
 * packages/ui/src/components/ui/CounterpartySettleModal.tsx; jest.config
 * maps "@liratek/ui" to that package's source, same as MultiPaymentInput's
 * own tests in this directory).
 *
 * The component is presentation + layout only (no transport, no business
 * math of its own — the leg-sum/discount-cap logic it wires together lives
 * in each page's own helpers, e.g. capSettlementDiscount/applyDebtDiscount,
 * already unit-tested where they're defined). What's tested here is the
 * INTEGRATION contract every adopting page relies on:
 *   - modal vs inline variant shell (backdrop present/absent, title placement)
 *   - MultiPaymentInput is rendered from the `multiPaymentInput` prop bag,
 *     and skipped entirely when it's null/undefined (Partners' CLIENT_ACCOUNT
 *     mode, which has no legs to render)
 *   - discountSlot / children render in the documented order
 *   - footer wiring: onCancel is optional (single-button footer), onConfirm
 *     always fires, isSubmitting/confirmDisabled gate the Confirm button and
 *     swap its label to "Processing..."
 *   - backdrop click invokes onCancel (modal variant only)
 *   - showCloseButton toggles the header (X) icon independently of the
 *     footer Cancel button
 */

import { render, screen, fireEvent } from "@testing-library/react";
import {
  CounterpartySettleModal,
  type MultiPaymentInputProps,
  type PaymentMethod,
  type Currency,
} from "@liratek/ui";

const PAYMENT_METHODS: PaymentMethod[] = [{ code: "CASH", label: "Cash" }];
const CURRENCIES: Currency[] = [{ code: "USD", symbol: "$" }];

function mpiProps(
  overrides: Partial<MultiPaymentInputProps> = {},
): MultiPaymentInputProps {
  return {
    totals: [{ amount: 100, currency: "USD" }],
    currency: "USD",
    onChange: jest.fn(),
    paymentMethods: PAYMENT_METHODS,
    currencies: CURRENCIES,
    showDiscount: false,
    ...overrides,
  };
}

describe("CounterpartySettleModal — modal variant", () => {
  it("renders a backdrop, title, MultiPaymentInput, and Cancel/Confirm footer", () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <CounterpartySettleModal
        title="Process Repayment"
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmLabel="Confirm Payment"
        multiPaymentInput={mpiProps()}
      />,
    );

    expect(screen.getByTestId("counterparty-settle-modal")).toBeInTheDocument();
    expect(screen.getByText("Process Repayment")).toBeInTheDocument();
    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Payment" }),
    ).toBeInTheDocument();
  });

  it("clicking the backdrop invokes onCancel; clicking inside the panel does not", () => {
    const onCancel = jest.fn();
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={onCancel}
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
        multiPaymentInput={mpiProps()}
      />,
    );

    fireEvent.mouseDown(screen.getByTestId("counterparty-settle-body"));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("counterparty-settle-modal"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("omits the footer Cancel button (and the close-X) when onCancel is not provided", () => {
    render(
      <CounterpartySettleModal
        title="Settle"
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
        showCloseButton
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows the close (X) button only when showCloseButton is true", () => {
    const { rerender } = render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    rerender(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
        showCloseButton
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("skips rendering MultiPaymentInput when multiPaymentInput is omitted (Partners CLIENT_ACCOUNT mode)", () => {
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
      />,
    );
    expect(screen.queryByTestId("multi-payment-input")).toBeNull();
  });

  it("renders discountSlot after MultiPaymentInput and children after that", () => {
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm"
        multiPaymentInput={mpiProps()}
        discountSlot={<div data-testid="discount-row">Discount row</div>}
      >
        <div data-testid="note-field">Note field</div>
      </CounterpartySettleModal>,
    );
    const body = screen.getByTestId("counterparty-settle-body");
    const order = Array.from(body.children).map(
      (el) => (el as HTMLElement).getAttribute("data-testid") ?? el.tagName,
    );
    const mpiIdx = order.indexOf("multi-payment-input");
    const discountIdx = order.indexOf("discount-row");
    const noteIdx = order.indexOf("note-field");
    expect(mpiIdx).toBeGreaterThanOrEqual(0);
    expect(discountIdx).toBeGreaterThan(mpiIdx);
    expect(noteIdx).toBeGreaterThan(discountIdx);
  });

  it("invokes onConfirm when the Confirm button is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        confirmLabel="Confirm Settlement"
        multiPaymentInput={mpiProps()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm Settlement" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables Confirm and shows 'Processing...' while isSubmitting", () => {
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm Settlement"
        isSubmitting
        multiPaymentInput={mpiProps()}
      />,
    );
    const button = screen.getByRole("button", { name: "Processing..." });
    expect(button).toBeDisabled();
    // Cancel is disabled too while a submit is in flight (matches the
    // orphaned batch-settle confirm modal's original behavior).
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("disables Confirm when confirmDisabled is true, independent of isSubmitting", () => {
    render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Confirm Settlement"
        confirmDisabled
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Confirm Settlement" }),
    ).toBeDisabled();
  });

  it("applies the requested confirmColor to the Confirm button (e.g. Suppliers' red PAY / green RECEIVE)", () => {
    const { rerender } = render(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Record Payment"
        confirmColor="red"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record Payment" }).className,
    ).toContain("bg-red-600");

    rerender(
      <CounterpartySettleModal
        title="Settle"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        confirmLabel="Record Receipt"
        confirmColor="green"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record Receipt" }).className,
    ).toContain("bg-green-600");
  });
});

describe("CounterpartySettleModal — inline variant", () => {
  it("renders no backdrop, and a single right-aligned Confirm-only footer when onCancel is omitted", () => {
    render(
      <CounterpartySettleModal
        variant="inline"
        onConfirm={jest.fn()}
        confirmLabel="Record Payment"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.queryByTestId("counterparty-settle-modal")).toBeNull();
    expect(
      screen.getByTestId("counterparty-settle-inline"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record Payment" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("renders an optional section title above beforeContent, or none at all", () => {
    const { rerender } = render(
      <CounterpartySettleModal
        variant="inline"
        onConfirm={jest.fn()}
        confirmLabel="Record Payment"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();

    rerender(
      <CounterpartySettleModal
        variant="inline"
        title="Pay / Receive"
        onConfirm={jest.fn()}
        confirmLabel="Record Payment"
        multiPaymentInput={mpiProps()}
      />,
    );
    expect(screen.getByText("Pay / Receive")).toBeInTheDocument();
  });

  it("forwards beforeContent above the MultiPaymentInput", () => {
    render(
      <CounterpartySettleModal
        variant="inline"
        onConfirm={jest.fn()}
        confirmLabel="Record Payment"
        beforeContent={<div data-testid="direction-toggle">PAY / RECEIVE</div>}
        multiPaymentInput={mpiProps()}
      />,
    );
    const body = screen.getByTestId("counterparty-settle-body");
    const order = Array.from(body.children).map(
      (el) => (el as HTMLElement).getAttribute("data-testid") ?? el.tagName,
    );
    expect(order.indexOf("direction-toggle")).toBe(0);
    expect(order.indexOf("multi-payment-input")).toBe(1);
  });
});
