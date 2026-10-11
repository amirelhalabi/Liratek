/** @jest-environment jsdom */
/**
 * MultiPaymentInput — the Waive button (LIRA-310, owner decisions 2026-10-11).
 *
 * - Limit: $5 for a USD total, 450,000 LBP for an LBP total, UP TO AND
 *   INCLUDING, compared in the total's own currency (SHORTFALL_MAX).
 * - Waive follows Remaining: it lives in the Remaining row, so whenever that
 *   row is hidden (paid, overpaid, payout keep, auto-debt line) Waive is too.
 * - Never on a payout (automatic kept change covers that).
 * - External path (`onWaiveRemaining`): the page decides what waiving means;
 *   it receives the shortfall rounded to the total's currency plus the
 *   per-currency remainder.
 * - Built-in path (no `onWaiveRemaining`): the gap is added to the
 *   component's own discount — only when that discount is shown, lowers the
 *   total, is booked by the page (`onDiscountChange`) and fits `maxDiscount`.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const RATE = 90_000;

type Extra = Partial<React.ComponentProps<typeof MultiPaymentInput>>;

function renderMpi(
  total: number,
  totalCurrency: "USD" | "LBP",
  extra: Extra = {},
) {
  return render(
    <MultiPaymentInput
      totals={[{ amount: total, currency: totalCurrency }]}
      currency={totalCurrency}
      totalAmountCurrency={totalCurrency}
      hasClient={false}
      requiresClientForDebt={true}
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={RATE}
      showDiscount={false}
      onChange={jest.fn()}
      {...extra}
    />,
  );
}

/** Type the amount the customer handed over on the single line. */
function pay(amount: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value: amount } });
}

const waive = () => screen.queryByTestId("waive-remaining");

describe("MultiPaymentInput — Waive (LIRA-310)", () => {
  describe("external path (onWaiveRemaining)", () => {
    it("shows for a $0.50 gap and calls back with the rounded amount and the per-currency remainder", () => {
      const onWaive = jest.fn();
      renderMpi(16.5, "USD", { onWaiveRemaining: onWaive });
      pay("16");
      fireEvent.click(waive()!);
      expect(onWaive).toHaveBeenCalledTimes(1);
      const [amount, byCurrency] = onWaive.mock.calls[0];
      expect(amount).toBe(0.5);
      expect(byCurrency).toEqual([{ currency: "USD", amount: 0.5 }]);
    });

    it("rounds the amount to cents on a USD total", () => {
      const onWaive = jest.fn();
      renderMpi(10.333, "USD", { onWaiveRemaining: onWaive });
      pay("10");
      fireEvent.click(waive()!);
      expect(onWaive.mock.calls[0][0]).toBe(0.33);
    });

    it("USD total: shows at exactly $5.00, hides at $5.01", () => {
      const { unmount } = renderMpi(105, "USD", { onWaiveRemaining: jest.fn() });
      pay("100");
      expect(waive()).toBeInTheDocument();
      unmount();
      renderMpi(105.01, "USD", { onWaiveRemaining: jest.fn() });
      pay("100");
      expect(waive()).not.toBeInTheDocument();
    });

    it("LBP total: shows at exactly 450,000, hides at 450,001", () => {
      const { unmount } = renderMpi(1_450_000, "LBP", {
        onWaiveRemaining: jest.fn(),
      });
      pay("1000000");
      expect(waive()).toBeInTheDocument();
      unmount();
      renderMpi(1_450_001, "LBP", { onWaiveRemaining: jest.fn() });
      pay("1000000");
      expect(waive()).not.toBeInTheDocument();
    });

    it("hides when the gap is more than the room left (waiveRemainingMax)", () => {
      renderMpi(16.5, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveRemainingMax: 0.3,
      });
      pay("16");
      expect(waive()).not.toBeInTheDocument();
    });

    it("never shows on a payout", () => {
      renderMpi(100.5, "USD", {
        onWaiveRemaining: jest.fn(),
        payer: "payout",
      });
      pay("100");
      expect(waive()).not.toBeInTheDocument();
    });

    it("follows Remaining: hidden when an automatic account line covers the gap", () => {
      renderMpi(16.5, "USD", {
        onWaiveRemaining: jest.fn(),
        hasClient: true,
        autoDebtRemainder: true,
      });
      pay("16");
      expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });
  });

  describe("built-in path (the component's own discount)", () => {
    it("adds the gap to the discount and clears Remaining", () => {
      const onDiscount = jest.fn<void, [number]>();
      renderMpi(16.5, "USD", {
        showDiscount: true,
        maxDiscount: 2,
        onDiscountChange: onDiscount,
      });
      pay("16");
      fireEvent.click(waive()!);
      expect(onDiscount).toHaveBeenLastCalledWith(0.5);
      expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
    });

    it("hides when discount + gap would go over maxDiscount", () => {
      renderMpi(16.5, "USD", {
        showDiscount: true,
        maxDiscount: 0.3,
        onDiscountChange: jest.fn(),
      });
      pay("16");
      expect(waive()).not.toBeInTheDocument();
    });

    it("hides when the page does not book the discount (no onDiscountChange)", () => {
      renderMpi(16.5, "USD", { showDiscount: true });
      pay("16");
      expect(waive()).not.toBeInTheDocument();
    });

    it("LBP total paid in USD with a USD discount: clears Remaining without showing change", () => {
      const onDiscount = jest.fn<void, [number]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 1_000_000, currency: "LBP" }]}
          currency="USD"
          totalAmountCurrency="LBP"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={true}
          maxDiscount={100_000}
          onDiscountChange={onDiscount}
          onChange={jest.fn()}
        />,
      );
      pay("11"); // 990,000 LBP — 10,000 LBP short
      fireEvent.click(waive()!);
      expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("return-usd")).not.toBeInTheDocument();
      const last = onDiscount.mock.calls.at(-1)![0];
      expect(Math.abs(last - 10_000)).toBeLessThanOrEqual(100);
    });
  });
});
