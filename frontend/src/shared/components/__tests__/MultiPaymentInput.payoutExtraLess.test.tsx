/** @jest-environment jsdom */
/**
 * MultiPaymentInput — the "− Less | + Extra" line on a payout (LIRA-382).
 *
 * Owner 2026-11-11: "Visible line, same booking." A payout that wires the
 * LIRA-334 round-up (`onRoundUpChange`) shows the same line pay-in screens
 * show under the total. "+ Extra" makes the payment line hand out more (the
 * difference is reported through `onRoundUpChange`, booked as change
 * rounding); "− Less" makes it hand out less (reported through
 * `onKeptChange`, booked as change kept). Same cap: $5 / 450,000 LBP.
 * The line never computes a value of its own: it moves what the payment
 * line fills to, and what it shows is read back from the lines.
 *
 * Rule 17: written before the component change and run against it first —
 * see the task report for the recorded failure.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";
import {
  setPayoutLine,
  payoutLineValue,
  payoutLegAmounts,
} from "@/shared/testing/payoutExtraLess";

type Pair = { usd: number; lbp: number } | null;

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function mpi(opts: {
  total: number;
  currency: "USD" | "LBP";
  onRoundUpChange?: jest.Mock;
  onKeptChange?: jest.Mock;
  payoutExcessToAccount?: boolean;
}) {
  return (
    <MultiPaymentInput
      totals={[{ amount: opts.total, currency: opts.currency }]}
      currency={opts.currency}
      totalAmountCurrency={opts.currency}
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={jest.fn()}
      payer="payout"
      {...(opts.onRoundUpChange
        ? { onRoundUpChange: opts.onRoundUpChange }
        : {})}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
      {...(opts.payoutExcessToAccount ? { payoutExcessToAccount: true } : {})}
    />
  );
}

function typeLeg(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    'input[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

describe("MultiPaymentInput — payout '− Less | + Extra' line (LIRA-382)", () => {
  it("shows the line, empty, on a payout that wires the round-up", () => {
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange: jest.fn(),
        onKeptChange: jest.fn(),
      }),
    );
    const line = screen.getByTestId("payout-extra-less");
    expect(within(line).getByText("+ Extra")).toBeInTheDocument();
    expect(within(line).getByText("− Less")).toBeInTheDocument();
    expect(payoutLineValue()).toBe("");
  });

  it("no line without the round-up wired, nor when the excess goes to the account", () => {
    const { unmount } = render(
      mpi({ total: 102.9, currency: "USD", onKeptChange: jest.fn() }),
    );
    expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
    unmount();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange: jest.fn(),
        payoutExcessToAccount: true,
      }),
    );
    expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
  });

  it("owner example: + Extra 0.10 on $102.90 → the line pays $103.00 and reports {usd: 0.1}", () => {
    const onRoundUpChange = jest.fn<void, [Pair]>();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        onKeptChange: jest.fn(),
      }),
    );
    setPayoutLine("extra", "0.10");
    expect(payoutLegAmounts()).toEqual([103]);
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
    expect(screen.getByTestId("payout-you-pay")).toHaveTextContent("103.00");
    expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
  });

  it("− Less 5,000 on 1,345,000 LBP → the line pays 1,340,000 and reports kept {lbp: 5000}", () => {
    const onKeptChange = jest.fn();
    render(
      mpi({
        total: 1_345_000,
        currency: "LBP",
        onRoundUpChange: jest.fn(),
        onKeptChange,
      }),
    );
    setPayoutLine("less", "5000");
    expect(payoutLegAmounts()).toEqual([1_340_000]);
    expect(onKeptChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ usd: 0, lbp: 5_000 }),
    );
  });

  it("6 is held at the $5 cap, with the message", () => {
    const onRoundUpChange = jest.fn<void, [Pair]>();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        onKeptChange: jest.fn(),
      }),
    );
    setPayoutLine("extra", "6");
    expect(payoutLineValue()).toBe("5.00");
    expect(payoutLegAmounts()).toEqual([107.9]);
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 5, lbp: 0 });
    expect(
      within(screen.getByTestId("payout-extra-less")).getByTestId(
        "discount-cap-note",
      ),
    ).toHaveTextContent(/5\.00/);
  });

  it("switching sides clears the other: Extra 0.10 then Less → empty, back to $102.90", () => {
    const onRoundUpChange = jest.fn<void, [Pair]>();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        onKeptChange: jest.fn(),
      }),
    );
    setPayoutLine("extra", "0.10");
    expect(payoutLegAmounts()).toEqual([103]);
    fireEvent.click(
      within(screen.getByTestId("payout-extra-less")).getByTestId(
        "discount-mode-discount",
      ),
    );
    expect(payoutLineValue()).toBe("");
    expect(payoutLegAmounts()).toEqual([102.9]);
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
  });

  it("typing $103 in the payment line fills + Extra with 0.10; clearing the line restores $102.90", () => {
    const onRoundUpChange = jest.fn<void, [Pair]>();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        onKeptChange: jest.fn(),
      }),
    );
    typeLeg("103");
    expect(payoutLineValue()).toBe("0.10");
    expect(
      within(screen.getByTestId("payout-extra-less")).getByTestId(
        "discount-mode-extra",
      ),
    ).toHaveAttribute("aria-pressed", "true");

    setPayoutLine("extra", "");
    expect(payoutLegAmounts()).toEqual([102.9]);
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
  });

  it("typing less in the payment line fills − Less", () => {
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange: jest.fn(),
        onKeptChange: jest.fn(),
      }),
    );
    typeLeg("102");
    expect(payoutLineValue()).toBe("0.90");
    expect(
      within(screen.getByTestId("payout-extra-less")).getByTestId(
        "discount-mode-discount",
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("without kept change wired the line is + Extra only", () => {
    render(mpi({ total: 102.9, currency: "USD", onRoundUpChange: jest.fn() }));
    const line = screen.getByTestId("payout-extra-less");
    expect(within(line).queryByText("− Less")).not.toBeInTheDocument();
    setPayoutLine("extra", "0.1");
    expect(payoutLegAmounts()).toEqual([103]);
  });

  it("a line hidden and shown again (e.g. a cash payout switched away and back) starts empty — no extra carried over", () => {
    const onRoundUpChange = jest.fn<void, [Pair]>();
    const onKeptChange = jest.fn();
    const { rerender } = render(
      mpi({ total: 102.9, currency: "USD", onRoundUpChange, onKeptChange }),
    );
    setPayoutLine("extra", "0.10");
    expect(payoutLegAmounts()).toEqual([103]);
    rerender(mpi({ total: 102.9, currency: "USD", onKeptChange }));
    expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
    rerender(
      mpi({ total: 102.9, currency: "USD", onRoundUpChange, onKeptChange }),
    );
    expect(payoutLineValue()).toBe("");
    expect(payoutLegAmounts()).toEqual([102.9]);
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
  });
});
