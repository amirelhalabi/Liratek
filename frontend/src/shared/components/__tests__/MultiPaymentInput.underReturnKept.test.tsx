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
 * Two UI paths produce those legs:
 *   A. the cashier just types 10,000 into the LBP change field (no toggle)
 *      — on an opt-in consumer (`keepUnreturnedChange`), the shortfall is
 *      kept instead of submitting an unbalanced payload;
 *   B. the cashier taps "Keep change" first, then types 10,000 LBP — before
 *      the fix the LBP return was clamped against the LBP change (0, the
 *      customer paid no LBP), so the OUT leg silently vanished.
 *
 * Rule 17: path B and the full-return control were run against the unfixed
 * component first (see the LIRA-259 report for the recorded failure). The
 * path-A cases use a prop that did not exist before the fix, so they could
 * only fail to compile there — "not proven failing-first" at this layer;
 * KatchForm.underReturnKept.test.tsx is path A's failing-first guard.
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
  onKeptChange: jest.Mock<void, [Kept]>;
  keepUnreturnedChange?: boolean;
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
      onKeptChange={opts.onKeptChange}
      {...(opts.keepUnreturnedChange ? { keepUnreturnedChange: true } : {})}
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

  it("path B: Keep change, then return 10,000 LBP of a dollar tender — the LBP OUT leg survives and $0.25 is kept", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.click(screen.getByTestId("keep-change"));
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
      "Keeping $0.25 as profit",
    );
  });

  it("path B: a cross-currency return larger than the whole change is clamped — never a negative kept amount", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.click(screen.getByTestId("keep-change"));
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "999999" },
    });

    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 30_000, direction: "OUT" },
    ]);
    expect(lastKept(onKeptChange)).toEqual(
      expect.objectContaining({ usd: 0, lbp: 0 }),
    );
  });

  it("path A (opt-in): typing 10,000 into the LBP field keeps the un-returned $0.25 — no red warning, a 'Keeping' summary instead", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({
      onReturnChange,
      onKeptChange,
      keepUnreturnedChange: true,
    });

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
      "Keeping $0.25 as profit — the rest is returned above.",
    );
  });

  it("path A (opt-in): an OVER-return is still flagged and nothing is kept", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({
      onReturnChange,
      onKeptChange,
      keepUnreturnedChange: true,
    });

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

  it("without the opt-in, an under-return is still only flagged (other pages unchanged)", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "10000" },
    });

    expect(lastKept(onKeptChange)).toBeNull();
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "0.25$ of the change is not covered",
    );
  });

  it("path B: both fields at the full change together are clamped jointly — never more than the change goes out", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderOwnerScenario({ onReturnChange, onKeptChange });

    fireEvent.click(screen.getByTestId("keep-change"));
    // $0.375 change: the cashier types the full change in BOTH fields.
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0.38" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "30000" },
    });

    const legs = lastLegs(onReturnChange);
    const outUsdEquivalent = legs.reduce(
      (sum, l) =>
        sum + (l.currencyCode === "USD" ? l.amount : l.amount / RATE),
      0,
    );
    expect(outUsdEquivalent).toBeLessThanOrEqual(0.38 + 1e-9);
    expect(lastKept(onKeptChange)).toEqual(
      expect.objectContaining({ usd: 0, lbp: 0 }),
    );
  });
});
