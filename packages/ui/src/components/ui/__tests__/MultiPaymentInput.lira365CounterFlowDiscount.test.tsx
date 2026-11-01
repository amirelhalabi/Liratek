/** @jest-environment jsdom */
/**
 * LIRA-365 US2 (T018) — the "Customer pays" box shows the same Discount as
 * every other payment form (owner 2026-11-01): "Total Amount", the Discount
 * line, then "After Discount". The old "Forgive" button and any Waive
 * button of its own are gone; there is no Extra switch.
 *
 * The typed discount is reported as `forgiven` (the page sends it as
 * `customer_waived_amount`, booked as before), held at `maxForgive`. The
 * box's single line follows the discounted total, and editing a line keeps
 * the discount.
 *
 * Example: an exchange where the customer owes 9,000,000 LBP for $100.
 * Rule 17: seen failing before the box was changed.
 */
import { render, fireEvent, screen, act } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput from "../MultiPaymentInput";
import type { LinesSectionState } from "../useLinesSection";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const METHODS = [{ code: "CASH", label: "Cash" }];

const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

const cfAmounts = (): HTMLInputElement[] =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    ),
  );
const digits = (s: string | null | undefined) =>
  Number((s ?? "").replace(/[^\d.]/g, ""));

function renderExchange() {
  const states: LinesSectionState[] = [];
  render(
    <MultiPaymentInput
      payer="payout"
      totals={[{ amount: 100, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      showDiscount={false}
      onChange={() => {}}
      counterFlow={{
        label: "Customer pays",
        totalAmount: 9_000_000,
        currency: "LBP",
        lockCurrency: true,
        seedLines: [{ method: "CASH", currencyCode: "LBP", amount: 9_000_000 }],
        maxForgive: 450_000,
        onChange: () => {},
        onStateChange: (s) => states.push(s),
      }}
    />,
  );
  return { last: () => states[states.length - 1] };
}

const discountInput = () =>
  screen.getByTestId("counter-flow-discount-input") as HTMLInputElement;

beforeAll(async () => {
  await loadLanguage("en");
  await i18n.changeLanguage("en");
});

describe("LIRA-365 US2 — Discount line in the Customer pays box", () => {
  it("shows Total Amount and a Discount line; no Forgive, no Waive, no Extra", () => {
    renderExchange();
    const section = screen.getByTestId("counter-flow-section");
    expect(screen.queryByTestId("counter-flow-forgive")).toBeNull();
    expect(
      section.querySelector('[data-testid="waive-remaining"]'),
    ).toBeNull();
    expect(screen.queryByTestId("discount-mode-extra")).toBeNull();
    expect(digits(screen.getByTestId("counter-flow-total").textContent)).toBe(
      9_000_000,
    );
    expect(screen.getByTestId("counter-flow-discount")).toBeTruthy();
    expect(screen.queryByTestId("counter-flow-after-discount")).toBeNull();
  });

  it("50,000 discount → line follows to 8,950,000, reported as forgiven, balanced", () => {
    const { last } = renderExchange();
    act(() => type(discountInput(), "50000"));
    expect(cfAmounts()).toHaveLength(1);
    expect(digits(cfAmounts()[0].value)).toBe(8_950_000);
    expect(
      digits(screen.getByTestId("counter-flow-after-discount").textContent),
    ).toBe(8_950_000);
    expect(last()).toMatchObject({
      paid: 8_950_000,
      forgiven: 50_000,
      unaccounted: 0,
      balanced: true,
      overpaid: false,
    });
  });

  it("over the cap → held at 450,000 with the Capped to max note", () => {
    const { last } = renderExchange();
    act(() => type(discountInput(), "600000"));
    expect(screen.getByTestId("discount-cap-note")).toBeTruthy();
    expect(digits(cfAmounts()[0].value)).toBe(8_550_000);
    expect(last()).toMatchObject({ forgiven: 450_000, balanced: true });
  });

  it("editing the line keeps the discount", () => {
    const { last } = renderExchange();
    act(() => type(discountInput(), "50000"));
    act(() => type(cfAmounts()[0], "8000000"));
    expect(discountInput().value.replace(/,/g, "")).toBe("50000");
    expect(last()).toMatchObject({
      paid: 8_000_000,
      forgiven: 50_000,
      unaccounted: 950_000,
      balanced: false,
    });
  });

  it("line typed lower first, then the discount → balanced", () => {
    const { last } = renderExchange();
    act(() => type(cfAmounts()[0], "8950000"));
    expect(last()).toMatchObject({ unaccounted: 50_000, balanced: false });
    act(() => type(discountInput(), "50000"));
    expect(last()).toMatchObject({
      paid: 8_950_000,
      forgiven: 50_000,
      unaccounted: 0,
      balanced: true,
    });
  });
});
