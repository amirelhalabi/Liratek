/** @jest-environment jsdom */
/**
 * MultiPaymentInput — built-in "− Discount | + Extra" line (LIRA-319).
 *
 * Owner 2026-10-13: the payment box's Discount line can instead ADD a small
 * extra charge. With `onExtraChange` the line gets a switch; in extra mode
 * the amount is added to what is owed, the row below reads "After Extra",
 * the payment line follows the new total, and the extra is capped to the
 * total before it ("Capped to max (…)"). A payout never offers it.
 *
 * Not proven failing-first: these props are new (rule 17) — there was no
 * earlier code to run the test against.
 */

import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

function lineAmount(): number {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return parseFloat(input.value.replace(/,/g, ""));
}

function renderBox(
  props: Partial<ComponentProps<typeof MultiPaymentInput>> = {},
  withExtra = true,
) {
  const onExtra = jest.fn<void, [number]>();
  const onDiscount = jest.fn<void, [number]>();
  const onLines = jest.fn<void, [PaymentLine[]]>();
  render(
    <MultiPaymentInput
      totals={[{ amount: 14, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={89_000}
      onChange={onLines}
      onDiscountChange={onDiscount}
      {...(withExtra ? { onExtraChange: onExtra } : {})}
      {...props}
    />,
  );
  return { onExtra, onDiscount, onLines };
}

const field = (name: "Discount" | "Extra") =>
  screen.getByLabelText(name, { selector: "input" }) as HTMLInputElement;

describe("MultiPaymentInput — extra mode (LIRA-319)", () => {
  it("the switch flips the line's label between Discount and Extra", () => {
    renderBox();
    expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field("Discount")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    expect(screen.getByTestId("discount-mode-extra")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field("Extra")).toBeInTheDocument();
    expect(screen.getByText("Extra")).toBeInTheDocument();
  });

  it("extra 1 on 14 → After Extra $15.00, the payment fills 15, the extra is reported and the discount stays 0", () => {
    const { onExtra, onDiscount, onLines } = renderBox();
    expect(lineAmount()).toBe(14);
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(field("Extra"), { target: { value: "1" } });
    expect(screen.getByTestId("after-page-extra")).toHaveTextContent("$15.00");
    expect(lineAmount()).toBe(15);
    expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 15 }),
    ]);
    expect(onExtra).toHaveBeenLastCalledWith(1);
    expect(onDiscount).toHaveBeenLastCalledWith(0);
    // No "After Discount" row in extra mode.
    expect(screen.queryByText("After Discount")).not.toBeInTheDocument();
  });

  it("switching back to Discount clears the extra (never both)", () => {
    const { onExtra } = renderBox();
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(field("Extra"), { target: { value: "2" } });
    expect(onExtra).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByTestId("discount-mode-discount"));
    expect(field("Discount").value).toBe("");
    expect(onExtra).toHaveBeenLastCalledWith(0);
    expect(screen.queryByTestId("after-page-extra")).not.toBeInTheDocument();
    expect(lineAmount()).toBe(14);
  });

  it("an extra above the total before it is capped and says so", () => {
    const { onExtra } = renderBox();
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(field("Extra"), { target: { value: "20" } });
    expect(screen.getByText("Capped to max ($14.00)")).toBeInTheDocument();
    expect(onExtra).toHaveBeenLastCalledWith(14);
    expect(lineAmount()).toBe(28);
  });

  it("maxExtra overrides the default cap", () => {
    const { onExtra } = renderBox({ maxExtra: 3 });
    fireEvent.click(screen.getByTestId("discount-mode-extra"));
    fireEvent.change(field("Extra"), { target: { value: "5" } });
    expect(screen.getByText("Capped to max ($3.00)")).toBeInTheDocument();
    expect(onExtra).toHaveBeenLastCalledWith(3);
  });

  it("with the discount hidden the line is extra-only (no switch)", () => {
    const { onExtra } = renderBox({ showDiscount: false });
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
    fireEvent.change(field("Extra"), { target: { value: "1" } });
    expect(onExtra).toHaveBeenLastCalledWith(1);
    expect(lineAmount()).toBe(15);
  });

  it("a payout never offers the switch or an extra", () => {
    renderBox({ payer: "payout" });
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Extra", { selector: "input" }),
    ).not.toBeInTheDocument();
  });

  it("without onExtraChange the line is today's plain Discount (no switch)", () => {
    renderBox({}, false);
    expect(
      screen.queryByTestId("discount-mode-discount"),
    ).not.toBeInTheDocument();
    expect(field("Discount")).toBeInTheDocument();
  });
});
