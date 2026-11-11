/**
 * LIRA-382 — shared steps for the "− Less | + Extra" line on payout screens.
 *
 * One table of cases runs on every payout screen (see the
 * `*.payoutExtraLess.test.tsx` files): the cashier types in the line, the
 * payment line follows, and the page's payload carries the existing
 * `rounding_given_*` / `kept_change_*` fields (read off the payload AFTER it
 * is parsed through that screen's core schema — rule 24).
 */
import { fireEvent, screen, within } from "@testing-library/react";

export type PayoutLineSide = "extra" | "less";

/** Type `value` into the line's `side`, as the cashier does. */
export function setPayoutLine(side: PayoutLineSide, value: string): void {
  const line = screen.getByTestId("payout-extra-less");
  const button = within(line).queryByTestId(
    side === "extra" ? "discount-mode-extra" : "discount-mode-discount",
  );
  if (button && button.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(button);
  }
  const input = within(line).getByTestId<HTMLInputElement>(
    "payout-extra-less-input",
  );
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** What the line's field shows (commas removed). */
export function payoutLineValue(): string {
  const line = screen.getByTestId("payout-extra-less");
  return within(line)
    .getByTestId<HTMLInputElement>("payout-extra-less-input")
    .value.replace(/,/g, "");
}

/** The amounts of the payout's own payment lines, as shown. */
export function payoutLegAmounts(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[data-testid^="payment-amount-"]',
    ),
  ).map((el) => parseFloat(el.value.replace(/,/g, "")) || 0);
}
