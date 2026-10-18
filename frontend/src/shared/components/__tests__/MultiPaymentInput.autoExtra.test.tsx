/** @jest-environment jsdom */
/**
 * MultiPaymentInput — customer-pays round-up autofill (LIRA-334, research R7,
 * spec User Story 3).
 *
 * Owner example: a sale totals $102.90, the customer hands over $103 and says
 * keep the change. With `onExtraChange` (Extra allowed), the built-in line
 * switches to "+ Extra" with 0.10 filled in, so the total matches what was
 * paid and no change box opens. Clearing it (or switching back to
 * Discount) opens the change box as today and does not refill it until the
 * payment amounts change. A typed discount, an overpay above the cap and a
 * payout never autofill.
 *
 * Rule 17: written before the component change and run against it first —
 * see the task report for the recorded failures.
 */

import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function renderBox(
  props: Partial<ComponentProps<typeof MultiPaymentInput>> = {},
) {
  const onExtra = jest.fn<void, [number]>();
  const onLines = jest.fn<void, [PaymentLine[]]>();
  const onReturn = jest.fn<void, [PaymentLine[]]>();
  render(
    <MultiPaymentInput
      totals={[{ amount: 102.9, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      onChange={onLines}
      onReturnChange={onReturn}
      onDiscountChange={jest.fn()}
      onExtraChange={onExtra}
      {...props}
    />,
  );
  return { onExtra, onLines, onReturn };
}

/** The last reported return legs, and whether the last lines carry an OUT
 *  leg — an autofilled extra must leave NO change leg behind, or the page
 *  would book the 0.10 twice (as extra AND as change, rule 16). */
function lastReturnLegs(onReturn: jest.Mock<void, [PaymentLine[]]>) {
  return onReturn.mock.calls.at(-1)?.[0] ?? [];
}
function lastLinesHaveOut(onLines: jest.Mock<void, [PaymentLine[]]>) {
  const lines = (onLines.mock.calls.at(-1)?.[0] ?? []) as Array<
    PaymentLine & { direction?: string }
  >;
  return lines.some((l) => l.direction === "OUT");
}

function pay(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

const field = (name: "Discount" | "Extra") =>
  screen.getByLabelText(name, { selector: "input" }) as HTMLInputElement;

const HINT = "Rounded up — clear it to give change";

describe("MultiPaymentInput — round-up autofill of the built-in Extra (LIRA-334)", () => {
  it("$103 on $102.90 → the line switches to Extra 0.10, onExtraChange(0.1), no change box", () => {
    const { onExtra, onLines, onReturn } = renderBox();
    pay("103");
    expect(lastReturnLegs(onReturn)).toEqual([]);
    expect(lastLinesHaveOut(onLines)).toBe(false);
    expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 103 }),
    ]);
    expect(screen.getByTestId("discount-mode-extra")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field("Extra").value).toBe("0.1");
    expect(onExtra).toHaveBeenLastCalledWith(0.1);
    expect(screen.getByTestId("after-page-extra")).toHaveTextContent("$103.00");
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("clearing it opens the change box and does not refill it", () => {
    const { onExtra, onReturn } = renderBox();
    pay("103");
    expect(onExtra).toHaveBeenLastCalledWith(0.1);
    fireEvent.change(field("Extra"), { target: { value: "" } });
    expect(field("Extra").value).toBe("");
    // The change comes back as a return leg once the extra is cleared.
    expect(lastReturnLegs(onReturn)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 0.1 }),
    ]);
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("switching back to Discount opens the change box and does not refill it", () => {
    const { onExtra } = renderBox();
    pay("103");
    fireEvent.click(screen.getByTestId("discount-mode-discount"));
    expect(field("Discount").value).toBe("");
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
  });

  it("after clearing, a change of the total alone does not refill it (only the payment lines re-arm it)", () => {
    // Not proven failing-first (rule 17): written after the implementation
    // to exercise the dismiss ref, which the clear/switch cases above do not.
    const props = {
      totals: [{ amount: 102.9, currency: "USD" as const }],
      currency: "USD",
      totalAmountCurrency: "USD",
      paymentMethods: PAYMENT_METHODS,
      currencies: CURRENCIES,
      exchangeRate: 89_000,
      onChange: jest.fn(),
      onDiscountChange: jest.fn(),
    };
    const onExtra = jest.fn<void, [number]>();
    const { rerender } = render(
      <MultiPaymentInput {...props} onExtraChange={onExtra} />,
    );
    pay("103");
    fireEvent.change(field("Extra"), { target: { value: "" } });
    expect(onExtra).toHaveBeenLastCalledWith(0);
    rerender(
      <MultiPaymentInput
        {...props}
        totals={[{ amount: 102.8, currency: "USD" }]}
        onExtraChange={onExtra}
      />,
    );
    expect(field("Extra").value).toBe("");
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
  });

  it("after clearing, changing the payment amount fills it again", () => {
    const { onExtra } = renderBox();
    pay("103");
    fireEvent.change(field("Extra"), { target: { value: "" } });
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
    pay("104");
    expect(field("Extra").value).toBe("1.1");
    expect(onExtra).toHaveBeenLastCalledWith(1.1);
    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
  });

  it("correcting the payment back to the exact total removes the autofilled extra (no stale extra)", () => {
    const { onExtra } = renderBox();
    pay("103");
    expect(onExtra).toHaveBeenLastCalledWith(0.1);
    pay("102.9");
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field("Discount").value).toBe("");
    expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
  });

  it("a typed discount is never replaced", () => {
    const { onExtra } = renderBox();
    fireEvent.change(field("Discount"), { target: { value: "1" } });
    pay("103");
    expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field("Discount").value).toBe("1");
    expect(onExtra).not.toHaveBeenCalledWith(0.1);
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
  });

  it("an overpay above the $5 cap ($6) fills nothing and opens the change box", () => {
    const { onExtra } = renderBox();
    pay("108.9");
    expect(field("Discount").value).toBe("");
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
  });

  it("a payout never autofills", () => {
    const { onExtra } = renderBox({ payer: "payout" });
    pay("103");
    expect(
      screen.queryByLabelText("Extra", { selector: "input" }),
    ).not.toBeInTheDocument();
    expect(onExtra).not.toHaveBeenCalledWith(0.1);
  });

  it("without onExtraChange nothing is filled (today's change box)", () => {
    render(
      <MultiPaymentInput
        totals={[{ amount: 102.9, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        onChange={jest.fn()}
        onDiscountChange={jest.fn()}
      />,
    );
    pay("103");
    expect(field("Discount").value).toBe("");
    expect(screen.getByTestId("return-change")).toBeInTheDocument();
  });
});
