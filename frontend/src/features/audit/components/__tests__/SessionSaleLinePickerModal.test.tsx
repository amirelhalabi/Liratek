/** @jest-environment jsdom */
/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — the line-picker the Transactions
 * page's session-group "Refund item" action opens for a SALE member (which
 * may bundle more than one sale line): pick ONE remaining line to refund, or
 * refund every remaining line in one operation (owner answer Q2). Written
 * failing-first: the module does not exist yet at authoring time.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSaleLinePickerModal } from "../SessionSaleLinePickerModal";

const ITEMS = [
  { id: 9, name: "iPhone 13", quantity: 1, refunded_quantity: 0, sold_price_usd: 1500 },
  { id: 10, name: "Charger", quantity: 2, refunded_quantity: 0, sold_price_usd: 15 },
  { id: 11, name: "Case", quantity: 1, refunded_quantity: 1, sold_price_usd: 20 },
];

describe("SessionSaleLinePickerModal", () => {
  it("lists only lines with remaining quantity (fully-refunded lines are hidden)", () => {
    render(
      <SessionSaleLinePickerModal
        items={ITEMS}
        onPickLine={jest.fn()}
        onRefundAllRemaining={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("iPhone 13")).toBeInTheDocument();
    expect(screen.getByText("Charger")).toBeInTheDocument();
    expect(screen.queryByText("Case")).not.toBeInTheDocument();
  });

  it("shows the remaining quantity, not the original quantity", () => {
    render(
      <SessionSaleLinePickerModal
        items={ITEMS}
        onPickLine={jest.fn()}
        onRefundAllRemaining={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText(/Qty: 1 remaining/)).toBeInTheDocument();
  });

  it("clicking a line's Refund button calls onPickLine with that item", () => {
    const onPickLine = jest.fn();
    render(
      <SessionSaleLinePickerModal
        items={ITEMS}
        onPickLine={onPickLine}
        onRefundAllRemaining={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Refund" });
    fireEvent.click(buttons[0]);

    expect(onPickLine).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("'Refund All Remaining' calls onRefundAllRemaining with no arguments", () => {
    const onRefundAllRemaining = jest.fn();
    render(
      <SessionSaleLinePickerModal
        items={ITEMS}
        onPickLine={jest.fn()}
        onRefundAllRemaining={onRefundAllRemaining}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Refund All Remaining" }),
    );
    expect(onRefundAllRemaining).toHaveBeenCalledWith();
  });

  it("Cancel calls onCancel", () => {
    const onCancel = jest.fn();
    render(
      <SessionSaleLinePickerModal
        items={ITEMS}
        onPickLine={jest.fn()}
        onRefundAllRemaining={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
