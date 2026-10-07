/** @jest-environment jsdom */
/**
 * MultiPaymentInput — production testing 2026-10-07:
 *
 * 1. The change warnings read "Returning 0.53$ more…" with the dollar sign
 *    AFTER the number. They must use the form's own money formatting
 *    ("$0.53"), like every other figure on the sheet.
 * 2. The "Paid" figure turned red with a warning icon whenever change was due
 *    or kept — normal states that looked like an error to the cashier. Red
 *    (and the warning icon) is kept for real problems only: underpaid with no
 *    kept change, or a change return that does not add up.
 *
 * The Paid figure is located through its visible "Paid" label (not a test id
 * added with the fix) so these cases can fail on the pre-fix component.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";

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
  direction?: "payment" | "payout";
  payer?: "customer" | "shop";
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  return render(
    <MultiPaymentInput
      totals={[{ amount: opts.total, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={jest.fn()}
      {...(opts.direction ? { direction: opts.direction } : {})}
      {...(opts.payer ? { payer: opts.payer } : {})}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
    />,
  );
}

function pay(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

/** The "Paid" summary row: its amount span and whether it shows red / a
 *  warning icon. */
function paidRow() {
  const label = screen.getByText("Paid", { selector: "span" });
  const row = label.parentElement;
  if (!row) throw new Error("Paid row not found");
  const amount = row.querySelector<HTMLElement>(".font-mono");
  if (!amount) throw new Error("Paid amount not found");
  return {
    amount,
    isRed: amount.className.includes("text-red-400"),
    hasWarningIcon: !!row.querySelector("svg.text-red-400"),
  };
}

describe("MultiPaymentInput — change warning money format", () => {
  it("over-return reads '$0.53', not '0.53$'", () => {
    renderMpi({ total: 9.47, onKeptChange: jest.fn() });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "1.06" },
    });
    const warning = screen.getByTestId("return-mismatch-warning");
    expect(warning).toHaveTextContent(
      "Returning $0.53 more than the customer overpaid.",
    );
    expect(warning.textContent).not.toMatch(/\d\$/);
  });

  it("under-return on a page that cannot keep change reads '$0.53 of the change…'", () => {
    renderMpi({ total: 9.47 });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "$0.53 of the change is not covered by these fields yet.",
    );
  });

  it("shop payer over-return reads 'Getting back $0.53 more…'", () => {
    renderMpi({ total: 9.47, payer: "shop", onKeptChange: jest.fn() });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "1.06" },
    });
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      "Getting back $0.53 more than was overpaid.",
    );
  });
});

describe("MultiPaymentInput — Paid figure is red only for a real problem", () => {
  it("exact payment: not red, no warning", () => {
    renderMpi({ total: 10 });
    pay("10");
    const row = paidRow();
    expect(row.isRed).toBe(false);
    expect(row.hasWarningIcon).toBe(false);
  });

  it("change due, returned in full: not red, no warning icon", () => {
    renderMpi({ total: 9.47, onKeptChange: jest.fn() });
    pay("10");
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
    const row = paidRow();
    expect(row.amount).toHaveTextContent("$10.00");
    expect(row.isRed).toBe(false);
    expect(row.hasWarningIcon).toBe(false);
  });

  it("change kept (under-return kept as profit): not red, no warning icon", () => {
    renderMpi({ total: 9.47, onKeptChange: jest.fn() });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    expect(screen.getByTestId("keep-change-summary")).toBeInTheDocument();
    const row = paidRow();
    expect(row.isRed).toBe(false);
    expect(row.hasWarningIcon).toBe(false);
  });

  it("payout short by a few cents, kept automatically: not red, no warning icon", () => {
    renderMpi({ total: 101.12, direction: "payout", onKeptChange: jest.fn() });
    pay("101");
    expect(screen.getByTestId("keep-change-summary")).toBeInTheDocument();
    const row = paidRow();
    expect(row.isRed).toBe(false);
    expect(row.hasWarningIcon).toBe(false);
  });

  it("over-return (handing back more than the change due): red with warning", () => {
    renderMpi({ total: 9.47, onKeptChange: jest.fn() });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "1.06" },
    });
    const row = paidRow();
    expect(row.isRed).toBe(true);
    expect(row.hasWarningIcon).toBe(true);
  });

  it("under-return on a page that cannot keep change: red with warning", () => {
    renderMpi({ total: 9.47 });
    pay("10");
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    const row = paidRow();
    expect(row.isRed).toBe(true);
    expect(row.hasWarningIcon).toBe(true);
  });

  it("underpaid with no debt line: red with warning", () => {
    renderMpi({ total: 10 });
    pay("5");
    const row = paidRow();
    expect(row.isRed).toBe(true);
    expect(row.hasWarningIcon).toBe(true);
  });

  it("payout overpaid (handing out more than owed): red with warning", () => {
    renderMpi({ total: 50, direction: "payout", onKeptChange: jest.fn() });
    pay("60");
    const row = paidRow();
    expect(row.isRed).toBe(true);
    expect(row.hasWarningIcon).toBe(true);
  });
});
