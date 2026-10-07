/** @jest-environment jsdom */
/**
 * MultiPaymentInput — kept change is AUTOMATIC (owner decision 2026-10-06,
 * after reviewing mock-ups): "The keep-change pill blocks the payment but
 * sits far from the Pay button — bad UX. Remove the Keep change button.
 * Always show 'Keeping X as profit' when the returned amount does not match
 * the change due."
 *
 *   (a) payment mode: handing back LESS than the change due keeps the gap as
 *       profit — no pill anywhere, the green "Keeping … as profit" note, and
 *       `onKeptChange` reports the gap. Clearing both fields keeps it all.
 *   (b) handing back MORE than the change due is still the red warning, and
 *       nothing is kept.
 *   (c) payout mode (Exchange): a small shortfall under the cap is kept
 *       automatically with the green note; at/over the cap it is "Remaining
 *       to pay out" (red) and nothing is kept.
 *   Guards: an untouched, freshly seeded return keeps NOTHING (otherwise any
 *   seed that lands a hair under the change due would silently book profit
 *   on every page), and a page that never wired `onKeptChange` (its backend
 *   cannot book kept change) still gets the red "not covered" warning.
 *
 * Rule 17: (a), (b) and (c) were run against the pre-change component (pill
 * present, keep only on tap / behind the `keepUnreturnedChange` opt-in) and
 * failed first — see the task report. The two guards pass on both versions
 * by design (they pin behaviour that must NOT change).
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
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

function amountInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return input;
}

function pay(value: string): void {
  fireEvent.change(amountInput(), { target: { value } });
}

function lastKept(onKeptChange: jest.Mock<void, [Kept]>): Kept {
  return onKeptChange.mock.calls.at(-1)?.[0] ?? null;
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

/** Owner's Katsh scenario: a 450,000 LBP card paid with $6 at 80,000 — the
 *  change due is 30,000 LBP ($0.375). */
function renderLbpCardPaidInDollars(opts: {
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  render(
    <MultiPaymentInput
      totals={[{ amount: 450_000, currency: "LBP" }]}
      totalAmountCurrency="LBP"
      currency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={80_000}
      showDiscount={false}
      onChange={jest.fn()}
      {...(opts.onReturnChange ? { onReturnChange: opts.onReturnChange } : {})}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
    />,
  );
  pay("6");
}

describe("MultiPaymentInput — automatic kept change (payment mode)", () => {
  it("(a) under-return: no Keep change button, the gap is kept and the green note says so", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    renderLbpCardPaidInDollars({ onReturnChange, onKeptChange });

    // The pill is gone for good — not even while overpaid.
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();

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
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.25 | 20,000 LBP as profit — the rest is returned above.",
    );
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
  });

  it("(a) clearing both fields keeps the whole change — no OUT legs, 'Change kept (profit)'", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    const onKeptChange = jest.fn<void, [Kept]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 45, currency: "USD" }]}
        totalAmountCurrency="USD"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        onChange={jest.fn()}
        onReturnChange={onReturnChange}
        onKeptChange={onKeptChange}
      />,
    );
    pay("50");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "" },
    });

    expect(lastLegs(onReturnChange)).toEqual([]);
    expect(lastKept(onKeptChange)).toEqual(
      expect.objectContaining({ usd: 5, lbp: 0 }),
    );
    expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      /^Keeping \$5\.00 \| 445,000 LBP as profit\.$/,
    );
  });

  it("(b) over-return is still the red warning, nothing is kept, and there is no pill", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderLbpCardPaidInDollars({ onKeptChange });

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
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
  });

  describe("guard: an untouched seeded return keeps nothing", () => {
    it.each([
      { name: "plain USD", total: 4.27, currency: "USD" as const, tender: "10", smart: false },
      { name: "USD smart split", total: 4.27, currency: "USD" as const, tender: "10", smart: true },
      { name: "LBP total", total: 425_000, currency: "LBP" as const, tender: "500000", smart: false },
    ])("$name", ({ total, currency, tender, smart }) => {
      const onKeptChange = jest.fn<void, [Kept]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: total, currency }]}
          totalAmountCurrency={currency}
          currency={currency}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          showDiscount={false}
          smartSplitOverpay={smart}
          onChange={jest.fn()}
          onKeptChange={onKeptChange}
        />,
      );
      pay(tender);

      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(lastKept(onKeptChange)).toBeNull();
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
    });
  });

  it("guard: a page that does not wire onKeptChange still flags an under-return as not covered", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderLbpCardPaidInDollars({ onReturnChange });

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
});

describe("MultiPaymentInput — automatic kept change (payout mode)", () => {
  function renderPayout(onKeptChange: jest.Mock<void, [Kept]>) {
    render(
      <MultiPaymentInput
        totals={[{ amount: 101.12, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        direction="payout"
        onChange={jest.fn()}
        onKeptChange={onKeptChange}
      />,
    );
  }

  it("(c) a shortfall under the cap is kept automatically — no tap, no pill, green note", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderPayout(onKeptChange);

    pay("101");

    const kept = lastKept(onKeptChange);
    expect(kept?.usd).toBe(0.12);
    expect(kept?.lbp).toBe(0);
    expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    const row = screen.getByTestId("remaining-row");
    expect(within(row).getByText("Change kept (profit)")).toBeInTheDocument();
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.12 | 10,680 LBP as profit.",
    );
  });

  it("(c) a shortfall at or over the cap is 'Remaining to pay out' and nothing is kept", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderPayout(onKeptChange);

    pay("101");
    expect(lastKept(onKeptChange)?.usd).toBe(0.12);

    pay("100.12");
    expect(lastKept(onKeptChange)).toBeNull();
    expect(
      within(screen.getByTestId("remaining-row")).getByText(
        "Remaining to pay out",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
  });
});
