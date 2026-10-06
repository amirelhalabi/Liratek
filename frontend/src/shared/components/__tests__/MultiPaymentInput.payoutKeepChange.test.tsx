/** @jest-environment jsdom */
/**
 * MultiPaymentInput — payout-mode "Keep change" (owner decision 2026-10-06,
 * D9 refined).
 *
 * On a PAYOUT sheet (Exchange: each line is cash the shop hands out) the
 * keep-change toggle runs opposite to T3: it is offered when the lines are
 * SHORT of the total by a small leftover (under $1 / 100,000 LBP — the shared
 * core PAYOUT_KEEP_CHANGE_MAX), and `onKeptChange` reports that shortfall.
 * Owner example: $101.12 owed, $101 handed over → kept $0.12.
 *
 * Rule 17 disclosure: written after the component change — NOT proven
 * failing-first.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";
import { PaymentSheet } from "@/features/recharge/components/PaymentSheet";

type Kept = {
  usd: number;
  lbp: number;
  exactUsd: number;
  exactLbp: number;
} | null;

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function renderMpi(opts: {
  total: number;
  currency: "USD" | "LBP";
  direction?: "payment" | "payout";
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  return render(
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
      {...(opts.direction ? { direction: opts.direction } : {})}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
    />,
  );
}

function amountInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return input;
}

function type(value: string): void {
  fireEvent.change(amountInput(), { target: { value } });
}

describe("MultiPaymentInput — payout keep-change", () => {
  it("owner example: $101 paid against $101.12 owed → toggle appears and reports the $0.12 shortfall", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });

    // Auto-filled with the full amount → nothing short, no toggle.
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();

    type("101");
    const toggle = screen.getByTestId("keep-change");
    expect(toggle).toHaveTextContent("Keep change");
    // Not active yet → nothing kept.
    expect(onKeptChange).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ usd: 0.12 }),
    );

    fireEvent.click(toggle);
    const kept = onKeptChange.mock.calls.at(-1)?.[0];
    expect(kept?.usd).toBe(0.12);
    expect(kept?.lbp).toBe(0);
    expect(kept?.exactUsd).toBeCloseTo(0.12, 9);
    expect(kept?.exactLbp).toBe(0);
    expect(screen.getByTestId("keep-change")).toHaveTextContent("Keeping ✓");
    expect(
      within(screen.getByTestId("remaining-row")).getByText("Change kept (profit)"),
    ).toBeInTheDocument();

    // Toggle off → kept cleared.
    fireEvent.click(screen.getByTestId("keep-change"));
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
  });

  it("clears the kept amount when the shortfall disappears (no stale 0.12 rides into the payload)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101");
    fireEvent.click(screen.getByTestId("keep-change"));
    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.12);

    type("101.12");
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();

    // The shortfall comes back → the toggle is offered again but NOT active
    // (must be tapped again, like T3's reset when the overpay clears).
    type("101");
    expect(screen.getByTestId("keep-change")).toHaveTextContent("Keep change");
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
  });

  it("follows the shortfall live while active", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101");
    fireEvent.click(screen.getByTestId("keep-change"));
    type("100.5");
    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.62);
  });

  it("no toggle when the shortfall is $1 or more (a real shortchange, not change)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("100.12");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
  });

  it("an OVERPAID payout offers neither keep-change nor a Return/Change block", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101.5");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
  });

  it("LBP payout: reports the LBP leftover (under 100,000 LBP)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 8_912_345, currency: "LBP", direction: "payout", onKeptChange });
    type("8900000");
    fireEvent.click(screen.getByTestId("keep-change"));
    expect(onKeptChange).toHaveBeenLastCalledWith({
      usd: 0,
      lbp: 12_345,
      exactUsd: 0,
      exactLbp: 12_345,
    });
  });

  it("LBP payout: no toggle at 100,000 LBP short or more", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 8_912_345, currency: "LBP", direction: "payout", onKeptChange });
    type("8812345");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
  });

  it("OPT-IN: payout mode without onKeptChange shows no toggle", () => {
    renderMpi({ total: 101.12, currency: "USD", direction: "payout" });
    type("101");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
  });

  it("default (payment) mode is unchanged: an UNDERPAID payment never offers keep-change and still reads as debt", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", onKeptChange });
    type("101");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    expect(screen.getByText("Remaining (Debt)")).toBeInTheDocument();
  });
});

describe("PaymentSheet — direction pass-through", () => {
  it("forwards direction=\"payout\" to the real MultiPaymentInput (toggle appears when short)", () => {
    const onKeptChange = jest.fn();
    render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={101.12}
        totalAmountCurrency="USD"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        direction="payout"
        onKeptChange={onKeptChange}
      />,
    );
    type("101");
    fireEvent.click(screen.getByTestId("keep-change"));
    expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ usd: 0.12, lbp: 0 }),
    );
  });

  it("without direction, an underpaid sheet shows no keep-change (other pages unchanged)", () => {
    render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={101.12}
        totalAmountCurrency="USD"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        onKeptChange={jest.fn()}
      />,
    );
    type("101");
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
  });
});
