/** @jest-environment jsdom */
/**
 * Refund window wording (production test 2026-10-07), through the real,
 * unmocked MultiPaymentInput.
 *
 * The window said the total "must match what the customer originally paid"
 * and then accepted $4.00 against a $4.25 refund (refund kept change), and
 * its "Paid $4.00" line was really the amount the shop HANDS BACK. For a
 * refund:
 *   - the summary line reads "Hand back", never "Paid";
 *   - when kept change is allowed, the subtitle says the refund may be a
 *     little short (less than the server's own cap, PAYOUT_KEEP_CHANGE_MAX,
 *     in the refund's currency) and the rest is kept as profit;
 *   - "Keeping $0.25 as profit." shows exactly ONCE (the payment form's
 *     payout mode already renders it — no duplicate line).
 * Validation behaviour is unchanged (the existing keptChange suite pins it).
 *
 * Rule 17: written before the fix; the red run is in the task report.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { RefundMethodModal } from "../RefundMethodModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

const cashIn = (
  amount: number,
  currency_code = "USD",
): TransactionPaymentLeg => ({
  direction: "in",
  amount,
  signed_amount: amount,
  currency_code,
  method: "CASH",
});

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "WHISH", label: "Whish Wallet" },
];

function renderModal(legs: TransactionPaymentLeg[], allowKeptChange: boolean) {
  render(
    <RefundMethodModal
      legs={legs}
      paymentMethods={PAYMENT_METHODS}
      exchangeRate={89_000}
      allowKeptChange={allowKeptChange}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );
}

describe("RefundMethodModal — refund wording", () => {
  it("labels the summary figure 'Hand back', not 'Paid'", () => {
    renderModal([cashIn(4.25)], false);
    expect(screen.getByText("Hand back")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });

  it("with kept change allowed: subtitle explains the short refund and the kept profit", () => {
    renderModal([cashIn(4.25)], true);
    const subtitle = screen.getByTestId("refund-subtitle");
    expect(subtitle).toHaveTextContent(/less than \$1/);
    expect(subtitle).toHaveTextContent(/kept as profit/);
    expect(subtitle).not.toHaveTextContent(/must match what the customer/);
  });

  it("an LBP refund states the LBP limit", () => {
    renderModal([cashIn(400_000, "LBP")], true);
    expect(screen.getByTestId("refund-subtitle")).toHaveTextContent(
      /less than 100,000 LBP/,
    );
  });

  it("without kept change the subtitle keeps the exact-amount rule and never mentions profit", () => {
    renderModal([cashIn(4.25)], false);
    const subtitle = screen.getByTestId("refund-subtitle");
    expect(subtitle).toHaveTextContent(/must match what the customer/);
    expect(subtitle).not.toHaveTextContent(/profit/);
  });

  it("$4.25 handed back as $4.00 shows 'Keeping $0.25 as profit.' exactly once", () => {
    renderModal([cashIn(4.25)], true);
    fireEvent.change(screen.getByTestId(/payment-amount-/), {
      target: { value: "4" },
    });
    expect(screen.getAllByText(/Keeping \$0\.25 .*as profit/)).toHaveLength(1);
    expect(screen.getByText("Hand back")).toBeInTheDocument();
  });
});
