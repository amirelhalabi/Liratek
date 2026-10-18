/** @jest-environment jsdom */
/**
 * MultiPaymentInput — payout round-up (LIRA-334, research R6).
 *
 * The mirror of payout kept change: when the shop hands out a little MORE
 * than it owes (owner example: $102.90 owed, $103 handed over), a consumer
 * that passes `onRoundUpChange` accepts the overpay up to the shared core cap
 * (`isWithinShortfallMax`, $5 / 450,000 LBP) as a round-up the shop books as
 * a change-rounding expense. The Paid figure is not red, an emerald note
 * says so, and `onRoundUpChange` reports `{usd, lbp}` in the total's
 * currency. Without the prop an overpaid payout is still a problem (red).
 *
 * Rule 17: written before the component change and run against it first —
 * see the task report for the recorded failures.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type MultiPaymentPayer } from "@liratek/ui";

type RoundUp = { usd: number; lbp: number } | null;

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function mpi(opts: {
  total: number;
  currency: "USD" | "LBP";
  payer?: MultiPaymentPayer;
  onRoundUpChange?: jest.Mock<void, [RoundUp]>;
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
      payer={opts.payer ?? "payout"}
      {...(opts.onRoundUpChange
        ? { onRoundUpChange: opts.onRoundUpChange }
        : {})}
      {...(opts.payoutExcessToAccount ? { payoutExcessToAccount: true } : {})}
    />
  );
}

function type(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

/** The "Paid" summary row — same reading as paidToneAndChangeCopy.test. */
function paidIsRed(): boolean {
  const label = screen.getByText("Paid", { selector: "span" });
  const row = label.parentElement;
  if (!row) throw new Error("Paid row not found");
  const amount = row.querySelector<HTMLElement>(".font-mono");
  if (!amount) throw new Error("Paid amount not found");
  return (
    amount.className.includes("text-red-400") ||
    !!row.querySelector("svg.text-red-400")
  );
}

describe("MultiPaymentInput — payout round-up (LIRA-334)", () => {
  it("owner example: $103 handed out on $102.90 owed → note, not red, reports {usd: 0.1, lbp: 0}", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
    // Auto-filled with the exact amount → nothing to round.
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();

    type("103");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
    const note = screen.getByTestId("payout-roundup-summary");
    expect(note).toHaveTextContent(/\$0\.10/);
    expect(note.className).toContain("text-emerald-400");
    expect(paidIsRed()).toBe(false);
  });

  it("goes back to null when the overpay disappears", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
    type("103");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
    type("102.9");
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
  });

  it("accepts exactly $5 (the cap is inclusive)", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
    type("107.9");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 5, lbp: 0 });
    expect(paidIsRed()).toBe(false);
  });

  it("LBP payout: 5,000 LBP over → reports {usd: 0, lbp: 5000}", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ total: 8_995_000, currency: "LBP", onRoundUpChange }));
    type("9000000");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0, lbp: 5_000 });
    expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
    expect(paidIsRed()).toBe(false);
  });

  it("over the cap → null, no note, and the Paid figure is red", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
    type("108");
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    expect(onRoundUpChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
    expect(paidIsRed()).toBe(true);
  });

  it("OPT-IN: without the prop an overpaid payout is unchanged (red, no note)", () => {
    render(mpi({ total: 102.9, currency: "USD" }));
    type("103");
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
    expect(paidIsRed()).toBe(true);
  });

  it("payoutExcessToAccount wins: the round-up never fires", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        payoutExcessToAccount: true,
      }),
    );
    type("103");
    expect(onRoundUpChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("payout-excess-summary")).toBeInTheDocument();
  });

  it("switching the payer away from payout reports null (no stale round-up)", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    const { rerender } = render(
      mpi({ total: 102.9, currency: "USD", onRoundUpChange }),
    );
    type("103");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
    rerender(
      mpi({
        total: 102.9,
        currency: "USD",
        onRoundUpChange,
        payer: "customer",
      }),
    );
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
  });
});
