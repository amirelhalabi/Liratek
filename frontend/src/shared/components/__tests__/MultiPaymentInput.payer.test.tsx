/** @jest-environment jsdom */
/**
 * MultiPaymentInput — the ONE `payer` prop (owner decisions 2026-10-07).
 *
 * From a single declaration of who pays, the component decides: whether the
 * change (OUT) fields show, the kept-change math, the note copy, what
 * `onKeptChange` reports, and that a payout never emits OUT legs.
 *
 *   customer (default) — customer pays the shop; under-returned change is
 *                        shop profit ("Change kept (profit)", "Keeping X as
 *                        profit").
 *   payout             — shop hands money to a customer; a small shortfall
 *                        (under PAYOUT_KEEP_CHANGE_MAX) is profit; no change
 *                        fields, never an OUT leg.
 *   shop               — shop pays an outsider (Expenses); change the
 *                        outsider did not return is ADDED TO THE COST
 *                        ("Not returned: X — added to the cost"), never
 *                        profit.
 *
 * Rule 17: run against the pre-change component (which ignored `payer`):
 * 6 of 10 failed — the two payout cases, the precedence case, the two shop
 * "not returned" cases, and the PaymentSheet pass-through. Four pass
 * pre-change BY DESIGN and are regression guards, not failing-first proofs:
 * the two `customer` default cases, the `direction="payout"` alias, and the
 * shop "full change back → nothing reported" case (identical in every mode).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
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
const RATE = 90_000;

function renderMpi(opts: {
  total: number;
  payer?: "customer" | "payout" | "shop";
  direction?: "payment" | "payout";
  onKeptChange: jest.Mock<void, [Kept]>;
  onReturnChange: jest.Mock<void, [PaymentLine[]]>;
}) {
  return render(
    <MultiPaymentInput
      totals={[{ amount: opts.total, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={RATE}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={jest.fn()}
      onReturnChange={opts.onReturnChange}
      onKeptChange={opts.onKeptChange}
      {...(opts.payer ? { payer: opts.payer } : {})}
      {...(opts.direction ? { direction: opts.direction } : {})}
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

function setReturn(usd: string, lbp: string): void {
  fireEvent.change(screen.getByTestId("return-usd"), {
    target: { value: usd },
  });
  fireEvent.change(screen.getByTestId("return-lbp"), {
    target: { value: lbp },
  });
}

const lastKept = (m: jest.Mock<void, [Kept]>): Kept =>
  m.mock.calls.at(-1)?.[0] ?? null;
const allOutLegs = (m: jest.Mock<void, [PaymentLine[]]>) =>
  m.mock.calls.flatMap((c) => c[0]).filter((l) => l.direction === "OUT");

describe('MultiPaymentInput payer="customer" (default) — regression guard', () => {
  it.each([["explicit", "customer" as const], ["default", undefined]])(
    "%s: $7 due, $10 paid, $2 returned → $1 kept as profit with the existing copy",
    (_label, payer) => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({
        total: 7,
        ...(payer ? { payer } : {}),
        onKeptChange,
        onReturnChange,
      });
      pay("10");
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      setReturn("2", "");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });
      expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 2, direction: "OUT" }),
      ]);
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Keeping $1.00 | 90,000 LBP as profit — the rest is returned above.",
      );
      // Clearing both fields keeps everything — lira-107 asserts this label.
      setReturn("", "");
      expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 3, lbp: 0 });
    },
  );
});

describe('MultiPaymentInput payer="payout"', () => {
  it("a small shortfall is kept as profit and reported", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 101.12, payer: "payout", onKeptChange, onReturnChange });
    pay("101");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.12, lbp: 0 });
    expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Keeping $0.12 | 10,800 LBP as profit.",
    );
  });

  it("an overpaid payout shows no change fields and never emits an OUT leg", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 50, payer: "payout", onKeptChange, onReturnChange });
    pay("60");
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-usd")).not.toBeInTheDocument();
    expect(allOutLegs(onReturnChange)).toEqual([]);
    expect(lastKept(onKeptChange)).toBeNull();
  });

  it('direction="payout" stays a working alias — regression guard', () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 101.12, direction: "payout", onKeptChange, onReturnChange });
    pay("101");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.12 });
  });

  it("payer wins over a conflicting direction", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({
      total: 50,
      payer: "payout",
      direction: "payment",
      onKeptChange,
      onReturnChange,
    });
    pay("60");
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
  });
});

describe('MultiPaymentInput payer="shop" (Expenses — the shop pays an outsider)', () => {
  it("$7 bill, $10 handed, $2 back → $1 not returned, reported, and said to be added to the cost — never profit", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
    pay("10");
    // The change fields show: the outsider owes the shop change.
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    setReturn("2", "");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });
    // The change the outsider hands back is still an opposite-direction leg.
    expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 2, direction: "OUT" }),
    ]);
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Not returned: $1.00 | 90,000 LBP — added to the cost.",
    );
    expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
  });

  it("nothing returned at all → the whole $3 is cost, no profit label", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
    pay("10");
    setReturn("", "");
    expect(lastKept(onKeptChange)).toMatchObject({ usd: 3, lbp: 0 });
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "Not returned: $3.00 | 270,000 LBP — added to the cost.",
    );
    expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
  });

  it("full change back → nothing reported", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
    pay("10");
    setReturn("3", "");
    expect(lastKept(onKeptChange)).toBeNull();
    expect(screen.queryByTestId("keep-change-summary")).not.toBeInTheDocument();
  });
});

describe("PaymentSheet forwards payer", () => {
  it('payer="payout" reaches MultiPaymentInput (the short leftover is kept)', () => {
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
        payer="payout"
        onKeptChange={onKeptChange}
      />,
    );
    pay("101");
    expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ usd: 0.12, lbp: 0 }),
    );
  });
});
