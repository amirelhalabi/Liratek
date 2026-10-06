/** @jest-environment jsdom */
/**
 * MultiPaymentInput — payout-mode kept change (owner decision 2026-10-06,
 * D9 refined; automatic since the later 2026-10-06 decision that removed the
 * "Keep change" button).
 *
 * On a PAYOUT sheet (Exchange: each line is cash the shop hands out) keeping
 * runs opposite to T3: when the lines are SHORT of the total by a small
 * leftover (under $1 / 100,000 LBP — the shared core PAYOUT_KEEP_CHANGE_MAX)
 * the leftover is kept automatically and `onKeptChange` reports it, with a
 * green note. Owner example: $101.12 owed, $101 handed over → kept $0.12.
 *
 * Rule 17 disclosure: originally written after the component change — NOT
 * proven failing-first. Rewritten from the button-tap version (rule 24); the
 * automatic behaviour's failing-first guard is
 * MultiPaymentInput.autoKeepChange.test.tsx (case c).
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

describe("MultiPaymentInput — payout kept change (automatic)", () => {
  it("owner example: $101 paid against $101.12 owed → the $0.12 shortfall is kept with no tap and no button", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });

    // Auto-filled with the full amount → nothing short, nothing kept.
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();

    type("101");
    const kept = onKeptChange.mock.calls.at(-1)?.[0];
    expect(kept?.usd).toBe(0.12);
    expect(kept?.lbp).toBe(0);
    expect(kept?.exactUsd).toBeCloseTo(0.12, 9);
    expect(kept?.exactLbp).toBe(0);
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("remaining-row")).getByText("Change kept (profit)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.12 | 10,680 LBP as profit.",
    );
  });

  it("clears the kept amount when the shortfall disappears (no stale 0.12 rides into the payload)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101");
    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.12);

    type("101.12");
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();

    // The shortfall comes back → kept again, automatically.
    type("101");
    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.12);
  });

  it("follows the shortfall live", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101");
    type("100.5");
    expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.62);
  });

  it("nothing kept when the shortfall is $1 or more (a real shortchange, not change) — 'Remaining to pay out'", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("100.12");
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
    expect(
      within(screen.getByTestId("remaining-row")).getByText("Remaining to pay out"),
    ).toBeInTheDocument();
  });

  it("an OVERPAID payout keeps nothing and shows no Return/Change block", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", direction: "payout", onKeptChange });
    type("101.5");
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
  });

  it("LBP payout: reports the LBP leftover (under 100,000 LBP)", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 8_912_345, currency: "LBP", direction: "payout", onKeptChange });
    type("8900000");
    expect(onKeptChange).toHaveBeenLastCalledWith({
      usd: 0,
      lbp: 12_345,
      exactUsd: 0,
      exactLbp: 12_345,
    });
  });

  it("LBP payout: nothing kept at 100,000 LBP short or more", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 8_912_345, currency: "LBP", direction: "payout", onKeptChange });
    type("8812345");
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ lbp: expect.any(Number) }),
    );
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
  });

  it("OPT-IN: payout mode without onKeptChange keeps nothing — 'Remaining to pay out'", () => {
    renderMpi({ total: 101.12, currency: "USD", direction: "payout" });
    type("101");
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("remaining-row")).getByText("Remaining to pay out"),
    ).toBeInTheDocument();
  });

  it("default (payment) mode is unchanged: an UNDERPAID payment keeps nothing and still reads as debt", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 101.12, currency: "USD", onKeptChange });
    type("101");
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
    expect(onKeptChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Remaining (Debt)")).toBeInTheDocument();
  });
});

describe("PaymentSheet — direction pass-through", () => {
  it("forwards direction=\"payout\" to the real MultiPaymentInput (the short leftover is kept)", () => {
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
    expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ usd: 0.12, lbp: 0 }),
    );
  });

  it("without direction, an underpaid sheet keeps nothing (other pages unchanged)", () => {
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
        onKeptChange={onKeptChange}
      />,
    );
    type("101");
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
    expect(onKeptChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: expect.any(Number) }),
    );
  });
});
