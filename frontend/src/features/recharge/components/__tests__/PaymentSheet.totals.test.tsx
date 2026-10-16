/** @jest-environment jsdom */

/**
 * PaymentSheet — per-currency totals (LIRA-326, T010).
 *
 * A Mobile Recharge basket can owe LBP (Katsh / iPick) AND USD (Whish App in
 * USD) at once. The sheet forwards `totals` to MultiPaymentInput's own
 * `totals` (its multi-currency engine); without it the sheet owes its one
 * `totalAmount` as before.
 */
import { render, screen } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetProps } from "../PaymentSheet";

const seen: { totals?: unknown } = {};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  MultiPaymentInput: (props: { totals?: unknown }) => {
    seen.totals = props.totals;
    return <div data-testid="stub-mpi" />;
  },
}));

function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
  return render(
    <PaymentSheet
      open
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      totalAmount={90_000}
      totalAmountCurrency="LBP"
      currency="LBP"
      exchangeRate={89_500}
      paymentMethods={[{ code: "CASH", label: "Cash" }]}
      onPaymentChange={jest.fn()}
      {...overrides}
    />,
  );
}

describe("PaymentSheet — totals (LIRA-326)", () => {
  it("forwards several currencies to MultiPaymentInput and names them on Pay", () => {
    const totals = [
      { amount: 90_000, currency: "LBP" },
      { amount: 10, currency: "USD" },
    ];
    renderSheet({ totals });
    expect(seen.totals).toEqual(totals);
    expect(
      screen.getByRole("button", { name: "Pay 90,000 LBP + $10.00" }),
    ).toBeInTheDocument();
  });

  it("owes the single total when no totals are given (unchanged)", () => {
    renderSheet();
    expect(seen.totals).toEqual([{ amount: 90_000, currency: "LBP" }]);
    expect(
      screen.getByRole("button", { name: "Pay 90,000 LBP" }),
    ).toBeInTheDocument();
  });
});
