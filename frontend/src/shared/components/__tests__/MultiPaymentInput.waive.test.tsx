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
      const { unmount } = renderMpi(105, "USD", {
        onWaiveRemaining: jest.fn(),
      });
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

  describe("waiveDisabled (owner decision 2026-10-12: no Waive on the Suppliers page)", () => {
    it("hides the external Waive", () => {
      renderMpi(16.5, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveDisabled: true,
      });
      pay("16");
      expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("hides the built-in Waive but keeps the Discount field", () => {
      renderMpi(16.5, "USD", {
        showDiscount: true,
        maxDiscount: 2,
        onDiscountChange: jest.fn(),
        waiveDisabled: true,
      });
      pay("16");
      expect(waive()).not.toBeInTheDocument();
      expect(screen.getByText("Discount")).toBeInTheDocument();
    });
  });
});

/**
 * Owner decision 2026-10-12 (LIRA-310 follow-up) — `waiveTotals`: Waive
 * measures the gap against these totals (the Debts sheet passes the TICKED
 * items' sum, net of its discount) instead of the whole amount owed. The
 * gap is shown on its own "Remaining on ticked" line, Waive sits inside that
 * line, and the whole-debt Remaining row keeps its figure without a Waive.
 * Owner example: $14 sale unticked + $20 Loto ticked, $18.50 paid →
 * Remaining $15.50, Remaining on ticked $1.50 [Waive].
 */
describe("MultiPaymentInput — Waive against waiveTotals (ticked items only)", () => {
  const ticked = (amount: number, currency: "USD" | "LBP" = "USD") => [
    { amount, currency },
  ];
  const tickedRow = () => screen.queryByTestId("remaining-ticked-row");

  it("owner example: gap measured against the ticked $20, Waive only in that line", () => {
    const onWaive = jest.fn();
    renderMpi(34, "USD", {
      onWaiveRemaining: onWaive,
      waiveTotals: ticked(20),
    });
    pay("18.5");
    // Whole-debt Remaining keeps showing $15.50, with no Waive inside it.
    const remainingRow = screen.getByTestId("remaining-row");
    expect(remainingRow.textContent).toContain("15.50");
    expect(
      remainingRow.querySelector('[data-testid="waive-remaining"]'),
    ).toBeNull();
    // Its own line: Remaining on ticked $1.50 [Waive].
    const row = tickedRow()!;
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain("Remaining on ticked");
    expect(row.textContent).toContain("1.50");
    expect(row.querySelector('[data-testid="waive-remaining"]')).not.toBeNull();
    fireEvent.click(waive()!);
    expect(onWaive).toHaveBeenCalledTimes(1);
    const [amount, byCurrency] = onWaive.mock.calls[0];
    expect(amount).toBe(1.5);
    expect(byCurrency).toEqual([{ currency: "USD", amount: 1.5 }]);
  });

  it("ticked items fully paid: no Waive even though the whole debt is short by $1", () => {
    renderMpi(21, "USD", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(20),
    });
    pay("20");
    expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
    expect(tickedRow()).not.toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("cap is applied to the ticked gap: Waive at exactly $5.00, not at $5.01", () => {
    const { unmount } = renderMpi(100, "USD", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(20),
    });
    pay("15");
    expect(waive()).toBeInTheDocument();
    unmount();
    renderMpi(100, "USD", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(20.01),
    });
    pay("15");
    expect(tickedRow()).toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("LBP cap on the ticked gap: 450,000 waivable, 450,001 not", () => {
    const { unmount } = renderMpi(5_000_000, "LBP", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(1_450_000, "LBP"),
    });
    pay("1000000");
    expect(waive()).toBeInTheDocument();
    unmount();
    renderMpi(5_000_000, "LBP", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(1_450_001, "LBP"),
    });
    pay("1000000");
    expect(waive()).not.toBeInTheDocument();
  });

  it("never on a payout", () => {
    renderMpi(34, "USD", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(20),
      payer: "payout",
    });
    pay("18.5");
    expect(tickedRow()).not.toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });

  it("waiveDisabled hides it", () => {
    renderMpi(34, "USD", {
      onWaiveRemaining: jest.fn(),
      waiveTotals: ticked(20),
      waiveDisabled: true,
    });
    pay("18.5");
    expect(waive()).not.toBeInTheDocument();
  });

  it("everything ticked (ticked gap = whole gap): one Remaining row with Waive, no duplicate line", () => {
    const onWaive = jest.fn();
    renderMpi(20, "USD", {
      onWaiveRemaining: onWaive,
      waiveTotals: ticked(20),
    });
    pay("18.5");
    expect(tickedRow()).not.toBeInTheDocument();
    const remainingRow = screen.getByTestId("remaining-row");
    expect(
      remainingRow.querySelector('[data-testid="waive-remaining"]'),
    ).not.toBeNull();
    fireEvent.click(waive()!);
    expect(onWaive.mock.calls[0][0]).toBe(1.5);
  });
});
