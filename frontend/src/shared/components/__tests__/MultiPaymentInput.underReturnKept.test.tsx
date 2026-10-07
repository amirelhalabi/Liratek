/** @jest-environment jsdom */
/**
 * MultiPaymentInput — handing back LESS change than due (LIRA-259, owner
 * 2026-10-06, Katsh page).
 *
 * Owner's scenario: a 450,000 LBP card, customer pays $6 cash. The change
 * due (at the till's 80,000 rate) is 30,000 LBP ($0.375); the cashier hands
 * back only 10,000 LBP and keeps the rest. The legs the till must emit are
 * IN $6 / OUT 10,000 LBP, and the un-returned part ($0.25 — reported in the
 * TENDER currency, the customer paid dollars) must reach the parent as kept
 * change so the server's leg reconciliation balances and the profit is
 * booked.
 *
 * The cashier just types 10,000 into the LBP change field. Originally this
 * was opt-in (`keepUnreturnedChange`, Katsh/iPick only) next to a "Keep
 * change" button (path B: tap, then type — the LBP return used to be clamped
 * against the LBP change, 0, so the OUT leg vanished). The owner decision of
 * 2026-10-06 removed the button and made the under-return keep the DEFAULT
 * for every consumer that wires `onKeptChange`; the path-B cases below are
 * rewritten to type directly (rule 24) and still guard the cross-currency
 * arithmetic.
 *
 * Rule 17: the original path-B and full-return cases were run against the
 * pre-LIRA-259 component first (see the LIRA-259 report). The automatic
 * behaviour's failing-first guard is MultiPaymentInput.autoKeepChange.test.tsx.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

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
const RATE = 80_000;
const PRICE_LBP = 450_000;

function renderOwnerScenario(opts: {
  onReturnChange: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  render(
    <MultiPaymentInput
      totals={[{ amount: PRICE_LBP, currency: "LBP" }]}
      totalAmountCurrency="LBP"
      currency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={RATE}
      showDiscount={false}
      onChange={jest.fn()}
      onReturnChange={opts.onReturnChange}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
    />,
  );
  const amount = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!amount) throw new Error("no payment-amount input rendered");
  // The customer hands over $6.
  fireEvent.change(amount, { target: { value: "6" } });
}

function lastLegs(onReturnChange: jest.Mock<void, [PaymentLine[]]>) {
  const legs = onReturnChange.mock.calls.at(-1)?.[0] ?? [];
  return legs.map(({ method, currencyCode, amount, direction }) => ({
    method,
    currencyCode,
    amount,
    direction,
  }));
}

function lastKept(onKeptChange: jest.Mock<void, [Kept]>): Kept {
  return onKeptChange.mock.calls.at(-1)?.[0] ?? null;
}

describe("MultiPaymentInput — handing back less change than due (LIRA-259)", () => {
  it("control: returning the full 30,000 LBP keeps nothing and shows no warning", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "30000" },
    });

    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 30_000, direction: "OUT" },
    ]);
    expect(lastKept(onKeptChange)).toBeNull();
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
  });

  it("returning only 10,000 LBP of a dollar tender (USD field emptied) — the LBP OUT leg survives and $0.25 is kept", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "10000" },
    });

    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 10_000, direction: "OUT" },
    ]);
    const kept = lastKept(onKeptChange);
    expect(kept?.usd).toBe(0.25);
    expect(kept?.lbp).toBe(0);
    expect(kept?.exactUsd).toBeCloseTo(0.25, 9);
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.25 | 20,000 LBP as profit",
    );
  });

  it("a cross-currency return larger than the whole change is flagged red — never kept change, never a negative kept amount", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "999999" },
    });

    expect(lastKept(onKeptChange)).toBeNull();
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "more than the customer overpaid",
    );
  });

  it("typing 10,000 into the LBP field keeps the un-returned $0.25 — no red warning, a 'Keeping' summary instead", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "10000" },
    });

    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 10_000, direction: "OUT" },
    ]);
    const kept = lastKept(onKeptChange);
    expect(kept?.usd).toBe(0.25);
    expect(kept?.lbp).toBe(0);
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.25 | 20,000 LBP as profit — the rest is returned above.",
    );
  });

  it("an OVER-return is still flagged and nothing is kept", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "50000" },
    });

    expect(lastKept(onKeptChange)).toBeNull();
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "more than the customer overpaid",
    );
  });

  it("a page that does not wire onKeptChange still only flags an under-return (its backend cannot book kept change)", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderOwnerScenario({ onReturnChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "10000" },
    });

    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "$0.25 of the change is not covered",
    );
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
  });

  it("the full change typed in BOTH fields is an over-return — flagged red, nothing kept", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    // $0.375 change: the cashier types the full change in BOTH fields.
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0.38" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "30000" },
    });

    expect(lastKept(onKeptChange)).toBeNull();
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "more than the customer overpaid",
    );
  });
});
