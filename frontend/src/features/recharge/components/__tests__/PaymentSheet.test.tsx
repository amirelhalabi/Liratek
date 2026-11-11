/**
 * PaymentSheet — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetProps } from "../PaymentSheet";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("PaymentSheet.counterFlow", () => {
  beforeAll(resetBetweenFiles);

  /**
   * PaymentSheet — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D.
   *
   * PaymentSheet is a thin wrapper around MultiPaymentInput (which already
   * owns the `counterFlow` opt-in section, shipped in Phase C —
   * MultiPaymentInput.test.tsx). This file proves ONLY the pass-through: a
   * `counterFlow` prop given to PaymentSheet reaches the real, unmocked
   * MultiPaymentInput and renders its counter-flow section — no `@liratek/ui`
   * mocking here, unlike the form-level tests, specifically so this exercises
   * the real component tree end to end.
   *
   * rule 17: proven failing-first — pre-change, `PaymentSheetProps` has no
   * `counterFlow` field and the prop is never forwarded to MultiPaymentInput,
   * so passing it is a silent no-op and `counter-flow-section` never renders.
   */

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
    return render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={100}
        totalAmountCurrency="USD"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        {...overrides}
      />,
    );
  }

  describe("PaymentSheet — counterFlow pass-through (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D)", () => {
    it("does not render a counter-flow section when the prop is absent (regression)", () => {
      renderSheet();

      expect(
        screen.queryByTestId("counter-flow-section"),
      ).not.toBeInTheDocument();
    });

    it("renders the real MultiPaymentInput's counter-flow section, label, and seeded line when counterFlow is supplied", () => {
      const onChange = jest.fn();
      renderSheet({
        counterFlow: {
          label: "Customer pays — fee",
          totalAmount: 5,
          currency: "USD",
          onChange,
        },
      });

      expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
      expect(screen.getByText("Customer pays — fee")).toBeInTheDocument();
      expect(
        screen.getByTestId("direction-chip-customer-pays"),
      ).toHaveTextContent("Customer pays");

      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      );
      expect(amountInput?.value).toBe("5");

      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "USD",
          amount: 5,
        }),
      ]);
    });

    it("forwards counterFlow.paymentMethods/requiresClient/hasClient to MultiPaymentInput", () => {
      const onChange = jest.fn();
      renderSheet({
        counterFlow: {
          label: "Customer pays — fee",
          totalAmount: 5,
          currency: "USD",
          onChange,
          paymentMethods: [{ code: "CASH", label: "Cash" }],
          requiresClient: true,
          hasClient: false,
        },
      });

      // CUSTOMER_ACCOUNT is excluded from the counter-flow method list because
      // requiresClient && !hasClient (mirrors canChargeToCustomerAccount-grade
      // gating — MultiPaymentInput.test.tsx covers the underlying behavior).
      const methodSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="counter-flow-method-"]',
      );
      const optionValues = Array.from(methodSelect?.options ?? []).map(
        (o) => o.value,
      );
      expect(optionValues).toEqual(["CASH"]);
    });

    it("emits counter-flow edits through the SAME onChange only — the main payment section keeps working unaffected", () => {
      const mainOnChange = jest.fn();
      const counterFlowOnChange = jest.fn();
      renderSheet({
        onPaymentChange: mainOnChange,
        counterFlow: {
          label: "Customer pays — fee",
          totalAmount: 5,
          currency: "USD",
          onChange: counterFlowOnChange,
        },
      });

      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      );
      fireEvent.change(amountInput as HTMLInputElement, {
        target: { value: "7" },
      });

      const lastCounterFlowLines = counterFlowOnChange.mock.calls.at(-1)?.[0];
      expect(lastCounterFlowLines).toEqual([
        expect.objectContaining({ amount: 7 }),
      ]);
      // The main section's own onChange never saw a "7" line — proves the two
      // are wired independently, exactly as MultiPaymentInput's own contract
      // promises.
      for (const call of mainOnChange.mock.calls) {
        expect(call[0]).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ amount: 7 })]),
        );
      }
    });

    // LIRA-321 (T009): the sheet gates Confirm on the page's verdict and
    // forwards the new "Customer pays" fields to the real MultiPaymentInput.
    describe("LIRA-321 — confirmDisabled and the new counterFlow fields", () => {
      it("confirmDisabled disables the Confirm button; without it Confirm stays enabled", () => {
        const { rerender } = renderSheet({ confirmLabel: "Confirm" });
        expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
        rerender(
          <PaymentSheet
            open
            onClose={jest.fn()}
            onConfirm={jest.fn()}
            totalAmount={100}
            totalAmountCurrency="USD"
            currency="USD"
            paymentMethods={PAYMENT_METHODS}
            onPaymentChange={jest.fn()}
            confirmLabel="Confirm"
            confirmDisabled
          />,
        );
        expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
      });

      it("forwards seedLines, lockCurrency and onStateChange to MultiPaymentInput", () => {
        const onStateChange = jest.fn();
        renderSheet({
          payer: "payout",
          counterFlow: {
            label: "Customer pays — fee",
            totalAmount: 105,
            currency: "USD",
            onChange: jest.fn(),
            seedLines: [
              { method: "CASH", currencyCode: "USD", amount: 100 },
              { method: "CASH", currencyCode: "USD", amount: 5 },
            ],
            lockCurrency: true,
            onStateChange,
          },
        });

        expect(
          document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
        ).toHaveLength(2);
        for (const sel of Array.from(
          document.querySelectorAll<HTMLSelectElement>(
            '[data-testid^="counter-flow-currency-"]',
          ),
        )) {
          expect(sel).toBeDisabled();
        }
        expect(onStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
          paid: 105,
          balanced: true,
        });
        // Payout labels (contracts/payment-box.md).
        expect(screen.getByTestId("direction-chip-you-pay")).toHaveTextContent(
          "OUT",
        );
        expect(
          screen.getByTestId("direction-chip-customer-pays"),
        ).toHaveTextContent("IN");
        expect(screen.getByText("Customer pays — USD")).toBeInTheDocument();
      });

      it("forwards maxForgive — a small Discount closes the shortfall", () => {
        const onStateChange = jest.fn();
        renderSheet({
          counterFlow: {
            label: "Customer pays — fee",
            totalAmount: 5,
            currency: "USD",
            onChange: jest.fn(),
            maxForgive: 5,
            onStateChange,
          },
        });
        const amount = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        ) as HTMLInputElement;
        fireEvent.change(amount, { target: { value: "3" } });
        const section = screen.getByTestId("counter-flow-section");
        const removes = section.querySelectorAll<HTMLButtonElement>(
          'button[title="Remove"]',
        );
        fireEvent.click(removes[removes.length - 1]);
        // LIRA-365 US2: the Discount line replaces the Forgive button.
        fireEvent.change(screen.getByTestId("counter-flow-discount-input"), {
          target: { value: "2" },
        });
        expect(onStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
          forgiven: 2,
          balanced: true,
        });
      });
    });

    // LIRA-321 follow-up (seen live): the disabled Confirm read as an empty
    // bar. index.css repaints the pair `bg-slate-600 text-slate-400` to the
    // SAME colour in dark mode (--s-600 and --t-600 are both #3e4d7d), so the
    // label vanished. Written before the fix (rule 17).
    it("a disabled Confirm keeps its label readable (not the same colour as its background)", () => {
      renderSheet({ confirmDisabled: true });
      const btn = screen.getByRole("button", { name: "Pay $100.00" });
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent("Pay $100.00");
      const classes = btn.className.split(/\s+/);
      expect(classes).not.toContain("text-transparent");
      expect(
        classes.includes("bg-slate-600") && classes.includes("text-slate-400"),
      ).toBe(false);
      // A visible, readable text colour on the disabled fill.
      expect(classes).toContain("text-slate-300");
    });
  });
});

describe("PaymentSheet.extra (LIRA-319)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * PaymentSheet — extra-charge pass-through (LIRA-319, T044).
   *
   * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock). The
   * sheet must forward `onExtraChange` / `maxExtra` so the recharge forms (and
   * the other forms that use this sheet) get the "− Discount | + Extra" switch:
   *  - with `onExtraChange` the switch shows; an extra of 20,000 on a 300,000
   *    LBP sale is reported and the payment line follows 320,000;
   *  - `maxExtra` caps it ("Capped to max");
   *  - without `onExtraChange` there is no switch (today's sheet, unchanged).
   */

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
    return render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={300_000}
        totalAmountCurrency="LBP"
        currency="LBP"
        exchangeRate={90_000}
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        onDiscountChange={jest.fn()}
        {...overrides}
      />,
    );
  }

  function lineAmount(): number {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return parseFloat(input.value.replace(/,/g, ""));
  }

  const extraField = () =>
    screen.getByLabelText("Extra", { selector: "input" }) as HTMLInputElement;

  describe("PaymentSheet — extra pass-through (LIRA-319)", () => {
    it("forwards onExtraChange: the switch shows and the extra reaches the page", () => {
      const onExtraChange = jest.fn();
      renderSheet({ onExtraChange });
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(extraField(), { target: { value: "20000" } });
      expect(onExtraChange).toHaveBeenLastCalledWith(20_000);
      expect(lineAmount()).toBe(320_000);
    });

    it("forwards maxExtra: an extra above it is capped", () => {
      const onExtraChange = jest.fn();
      renderSheet({ onExtraChange, maxExtra: 10_000 });
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(extraField(), { target: { value: "20000" } });
      expect(onExtraChange).toHaveBeenLastCalledWith(10_000);
      expect(screen.getByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max",
      );
    });

    it("without onExtraChange the sheet offers no extra", () => {
      renderSheet();
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("PaymentSheet.lira369Currencies (LIRA-369)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-369 (T012/T020) — PaymentSheet passes `currencies` and `accountRate`
   * to the real MultiPaymentInput, so an Exchange paying out euros can list
   * EUR, book an Account line at "1 EUR = … USD", and its Confirm button
   * reads in euros. Without the props the sheet lists USD + LBP as before.
   *
   * Rule 17: seen failing before the props existed.
   */

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
    return render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={100}
        totalAmountCurrency="USD"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        {...overrides}
      />,
    );
  }

  const currencyOptions = (): string[] =>
    Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        '[data-testid^="payment-currency-"] option',
      ),
    ).map((o) => o.value);

  describe("PaymentSheet — LIRA-369 currencies + accountRate pass-through", () => {
    it("defaults to USD + LBP when no currencies are given (regression)", () => {
      renderSheet();
      expect(currencyOptions()).toEqual(["USD", "LBP"]);
      expect(screen.queryByTestId("payment-account-rate")).toBeNull();
    });

    it("an EUR sheet lists only EUR and the Confirm button reads in euros", () => {
      renderSheet({
        totalAmountCurrency: "EUR",
        currency: "EUR",
        currencies: [{ code: "EUR", symbol: "€" }],
      });
      expect(currencyOptions().every((c) => c === "EUR")).toBe(true);
      const confirm = screen
        .getAllByRole("button")
        .find((b) => /100\.00/.test(b.textContent ?? ""));
      expect(confirm?.textContent).toContain("€100.00");
      expect(confirm?.textContent).not.toContain("$");
    });

    it("an EUR Account line shows the account rate box; edits reach the page", () => {
      const onChange = jest.fn();
      renderSheet({
        totalAmountCurrency: "EUR",
        currency: "EUR",
        currencies: [{ code: "EUR", symbol: "€" }],
        hasClient: true,
        initialPaymentMethod: "CUSTOMER_ACCOUNT",
        accountRate: { currency: "EUR", value: 1.1, onChange },
      });
      const box = screen.getByTestId(
        "payment-account-rate",
      ) as HTMLInputElement;
      expect(box.value).toBe("1.1");
      act(() => {
        fireEvent.change(box, { target: { value: "1.15" } });
      });
      expect(onChange).toHaveBeenLastCalledWith(1.15);
    });
  });
});

describe("PaymentSheet.roundUp (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * PaymentSheet — payout round-up pass-through (LIRA-334, T023).
   *
   * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock). On a
   * payout sheet it must forward `onRoundUpChange`, so handing out $103 on
   * $102.90 owed reports a $0.10 round-up to the page. Without the prop the
   * sheet reports nothing (today's sheet, unchanged).
   *
   * Rule 17: run against the pre-change sheet first — see the task report.
   */

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
    return render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={102.9}
        totalAmountCurrency="USD"
        currency="USD"
        exchangeRate={89_000}
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        showDiscount={false}
        payer="payout"
        {...overrides}
      />,
    );
  }

  function typeAmount(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  describe("PaymentSheet — payout round-up pass-through (LIRA-334)", () => {
    it("forwards onRoundUpChange: $103 on $102.90 reports {usd: 0.1, lbp: 0}", () => {
      const onRoundUpChange = jest.fn();
      renderSheet({ onRoundUpChange });
      typeAmount("103");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
    });

    it("without onRoundUpChange an overpaid payout is not a round-up", () => {
      renderSheet();
      typeAmount("103");
      expect(
        document.querySelector('[data-testid="payout-roundup-summary"]'),
      ).toBeNull();
    });
  });
});

describe("PaymentSheet.waive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * PaymentSheet — Waive pass-through (LIRA-310, T011).
   *
   * PaymentSheet wraps the REAL MultiPaymentInput (no `@liratek/ui` mock), so
   * these cases exercise the actual Waive button:
   *  - `onWaiveRemaining`, `waiveRemainingThreshold` and `waiveRemainingMax`
   *    given to the sheet must reach MultiPaymentInput;
   *  - with no `onWaiveRemaining`, the six recharge forms get the built-in
   *    waive because they already pass `showDiscount` + `maxDiscount` +
   *    `onDiscountChange`.
   */

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  function renderSheet(overrides: Partial<PaymentSheetProps> = {}) {
    return render(
      <PaymentSheet
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        totalAmount={16.5}
        totalAmountCurrency="USD"
        currency="USD"
        exchangeRate={90_000}
        paymentMethods={PAYMENT_METHODS}
        onPaymentChange={jest.fn()}
        showDiscount={false}
        {...overrides}
      />,
    );
  }

  /** Type what the customer handed over on the single line. */
  function pay(amount: string) {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value: amount } });
  }

  const waive = () => screen.queryByTestId("waive-remaining");

  describe("PaymentSheet — Waive pass-through (LIRA-310)", () => {
    it("forwards onWaiveRemaining: the click reaches the page with the gap", () => {
      const onWaiveRemaining = jest.fn();
      renderSheet({ onWaiveRemaining });
      pay("16");
      const button = waive();
      expect(button).toBeInTheDocument();
      fireEvent.click(button!);
      expect(onWaiveRemaining).toHaveBeenCalledWith(0.5, [
        { currency: "USD", amount: 0.5 },
      ]);
    });

    it("forwards waiveRemainingMax: hidden when the gap exceeds the room left", () => {
      renderSheet({ onWaiveRemaining: jest.fn(), waiveRemainingMax: 0.3 });
      pay("16");
      expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("forwards waiveRemainingThreshold: hidden when the gap exceeds it", () => {
      renderSheet({
        onWaiveRemaining: jest.fn(),
        waiveRemainingThreshold: 0.25,
      });
      pay("16");
      expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("built-in waive shows with showDiscount + maxDiscount + onDiscountChange and fills the discount", () => {
      const onDiscountChange = jest.fn();
      renderSheet({ showDiscount: true, maxDiscount: 2, onDiscountChange });
      pay("16");
      fireEvent.click(waive()!);
      expect(onDiscountChange).toHaveBeenLastCalledWith(0.5);
      expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
    });

    it("built-in waive hides when the gap would go over maxDiscount", () => {
      renderSheet({
        showDiscount: true,
        maxDiscount: 0.3,
        onDiscountChange: jest.fn(),
      });
      pay("16");
      expect(waive()).not.toBeInTheDocument();
    });
  });
});
