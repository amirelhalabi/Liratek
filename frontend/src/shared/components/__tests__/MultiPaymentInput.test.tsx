/** @jest-environment jsdom */
/**
 * RTL render tests for MultiPaymentInput (re-exported from @liratek/ui).
 *
 * Replaces the previous logic-only test (which asserted on inline arrays and
 * never rendered the component) and captures the intent of the heavy Electron
 * e2e spec (MultiPaymentInput.spec.ts, S1–S8 across 6 modules / 75 hard waits).
 *
 * Covered here by actually rendering + interacting with the component:
 *   - renders a single initial payment line, summary and split toggle
 *   - the initial line auto-fills with the full total (per-currency `totals`)
 *   - method options come from the paymentMethods prop
 *   - CUSTOMER_ACCOUNT selection surfaces the "client required" debt warning
 *   - the exchange-rate field renders in both modes; split reveals the
 *     add-line button
 *   - adding a line creates a second payment line auto-filled with the remainder
 *   - removing a line returns to a single line
 *   - switching a split line's currency (USD → LBP) converts the amount by rate
 *   - the summary reflects remaining / overpaid / exact totals
 *   - onChange is invoked with the typed PaymentLine[] payload
 *
 * Note: the component is the canonical implementation in
 * packages/ui/src/components/ui/MultiPaymentInput.tsx — imported here exactly
 * as feature pages consume it. jest.config maps "@liratek/ui" → that package's
 * source. crypto.randomUUID (used for line ids) is available in the jest jsdom
 * environment, so no polyfill is required.
 *
 * jest-dom matchers are registered globally via jest.setup.ts.
 */

import { StrictMode } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import {
  MultiPaymentInput,
  type PaymentLine,
  type PaymentMethod,
  type Currency,
} from "@liratek/ui";

// ── Typed fixtures (no `any`) ───────────────────────────────────────────────

const PAYMENT_METHODS: PaymentMethod[] = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account (Debt)" },
];

const CURRENCIES: Currency[] = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

const EXCHANGE_RATE = 90000;

type ChangeMock = jest.Mock<void, [PaymentLine[]]>;
type RateMock = jest.Mock<void, [number]>;

interface RenderOptions {
  /** Shorthand: becomes totals=[{amount, currency: totalAmountCurrency}]. */
  totalAmount?: number;
  currency?: string;
  totalAmountCurrency?: string;
  hasClient?: boolean;
  requiresClientForDebt?: boolean;
  autoDebtRemainder?: boolean;
  onChange?: ChangeMock;
  exchangeRate?: number;
  initialLines?: Array<{
    method?: string;
    currencyCode: string;
    amount: number;
  }>;
  onExchangeRateChange?: RateMock;
  totals?: Array<{ amount: number; currency: string }>;
}

function renderMpi(opts: RenderOptions = {}) {
  const onChange: ChangeMock = opts.onChange ?? jest.fn();
  const totals = opts.totals ?? [
    {
      amount: opts.totalAmount ?? 100,
      currency: opts.totalAmountCurrency ?? "USD",
    },
  ];
  const utils = render(
    <MultiPaymentInput
      totals={totals}
      currency={opts.currency ?? "USD"}
      totalAmountCurrency={opts.totalAmountCurrency ?? "USD"}
      hasClient={opts.hasClient ?? false}
      requiresClientForDebt={opts.requiresClientForDebt ?? true}
      autoDebtRemainder={opts.autoDebtRemainder ?? false}
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={opts.exchangeRate ?? EXCHANGE_RATE}
      {...(opts.initialLines ? { initialLines: opts.initialLines } : {})}
      {...(opts.onExchangeRateChange
        ? { onExchangeRateChange: opts.onExchangeRateChange }
        : {})}
      // Hide the discount field so the summary stays focused on totals.
      showDiscount={false}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

/** Read the first payment line's generated id from its data-testid. */
function firstLineId(): string {
  const line = document.querySelector('[data-testid^="payment-line-"]');
  const testId = line?.getAttribute("data-testid") ?? "";
  return testId.replace("payment-line-", "");
}

/** All rendered payment-line root elements. */
function allLines(): Element[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="payment-line-"]'),
  );
}

/** The first payment line's amount input. */
function firstAmountInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  return input;
}

/** Type a new value into the header exchange-rate field (commas allowed). */
function setRate(value: string): void {
  fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
    target: { value },
  });
}

describe("MultiPaymentInput", () => {
  describe("initial render", () => {
    it("renders the root, a single payment line, summary and split toggle", () => {
      renderMpi();

      expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
      expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
      expect(screen.getByTestId("split-toggle")).toBeInTheDocument();
      expect(allLines()).toHaveLength(1);
    });

    it("auto-fills the single line's amount with the full total", () => {
      renderMpi({ totalAmount: 75 });

      const amount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      expect(amount).not.toBeNull();
      // fmtNum formats with commas; 75 → "75".
      expect(amount?.value).toBe("75");
    });

    it("exposes every paymentMethods entry as an <option>", () => {
      renderMpi();

      const id = firstLineId();
      const method = screen.getByTestId(`payment-method-${id}`);
      const optionValues = within(method)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value);

      expect(optionValues).toEqual(["CASH", "OMT", "CUSTOMER_ACCOUNT"]);
    });

    it("emits the edited line through onChange when the amount changes", () => {
      // On mount the initial line already equals totalAmount, so the auto-sync
      // effect is a no-op; the first emit is driven by a user edit. We assert
      // the payload shape the parent receives.
      const { onChange } = renderMpi({ totalAmount: 100 });

      const amount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(amount, { target: { value: "42" } });

      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastCall).toHaveLength(1);
      expect(lastCall[0].method).toBe("CASH");
      expect(lastCall[0].currencyCode).toBe("USD");
      expect(lastCall[0].amount).toBe(42);
    });
  });

  describe("CUSTOMER_ACCOUNT / debt detection", () => {
    it("shows the debt warning when CUSTOMER_ACCOUNT is picked without a client", () => {
      renderMpi({ hasClient: false });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });

      expect(
        screen.getByText(/Client is required when using DEBT payment method/i),
      ).toBeInTheDocument();
    });

    it("hides the debt warning when a client is attached", () => {
      renderMpi({ hasClient: true });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });

      expect(
        screen.queryByText(
          /Client is required when using DEBT payment method/i,
        ),
      ).not.toBeInTheDocument();
    });

    it("reports CUSTOMER_ACCOUNT to the parent via onChange", () => {
      const { onChange } = renderMpi({ hasClient: true });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });

      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(true);
    });
  });

  describe("split mode — add / remove / currency", () => {
    it("shows the exchange-rate field in both modes; split reveals the add-line button", () => {
      renderMpi();

      // Exchange-rate row ("1 USD = … LBP") renders in single mode too — the
      // rate drives USD↔LBP conversion regardless of mode.
      expect(screen.getByText(/1 USD =/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Add .*Line/i }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("split-toggle"));

      expect(screen.getByText(/1 USD =/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Add .*Line/i }),
      ).toBeInTheDocument();
    });

    it("adds a second payment line auto-filled with the remaining amount", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      expect(allLines()).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));
      expect(allLines()).toHaveLength(2);

      // First line keeps the full amount; the second auto-fills the remainder
      // (effectiveTotalAmount - totalPaid). With a fully-paid first line that
      // remainder is 0 → the new line starts empty.
      const amounts = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        ),
      ).map((i) => i.value);
      expect(amounts[0]).toBe("100");
      expect(amounts[1]).toBe(""); // 0 renders as empty via fmtNum
    });

    it("auto-fills the new line with the outstanding remainder when underpaid", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));

      // Reduce the first line so there's an outstanding balance.
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "60" } });

      fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));

      const amounts = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        ),
      ).map((i) => i.value);
      expect(amounts[0]).toBe("60");
      // remaining = 100 - 60 = 40 (USD line, same currency as total).
      expect(amounts[1]).toBe("40");
    });

    it("removes a payment line, returning to a single line", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));
      expect(allLines()).toHaveLength(2);

      // The second line's remove button (the first line's is disabled).
      const secondLine = allLines()[1];
      const removeBtn = within(secondLine as HTMLElement).getByTitle("Remove");
      fireEvent.click(removeBtn);

      expect(allLines()).toHaveLength(1);
    });

    it("keeps the lone remove button disabled in single-line split mode", () => {
      renderMpi();

      fireEvent.click(screen.getByTestId("split-toggle"));
      const line = allLines()[0];
      const removeBtn = within(line as HTMLElement).getByTitle("Remove");
      expect(removeBtn).toBeDisabled();
    });

    it("converts a line's amount when its currency switches USD → LBP", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));

      const line = allLines()[0] as HTMLElement;
      // The currency <select> is the one whose option values are USD/LBP.
      const selects = within(line).getAllByRole("combobox");
      const currencySelect = selects.find((s) =>
        Array.from((s as HTMLSelectElement).options).some(
          (o) => o.value === "LBP",
        ),
      ) as HTMLSelectElement;

      fireEvent.change(currencySelect, { target: { value: "LBP" } });

      const amount = within(line).getByDisplayValue(
        (100 * EXCHANGE_RATE).toLocaleString("en-US"),
      );
      // 100 USD * 90000 = 9,000,000 LBP.
      expect((amount as HTMLInputElement).value).toBe("9,000,000");
    });
  });

  describe("summary totals", () => {
    it("shows a remaining (debt) row when the line underpays the total", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "60" } });

      const summary = screen.getByTestId("payment-summary");
      expect(
        within(summary).getByText(/Remaining \(Debt\)/i),
      ).toBeInTheDocument();
      // |100 - 60| = 40 → "$40.00".
      expect(within(summary).getByText("$40.00")).toBeInTheDocument();
    });

    it("shows a return/change block when the line pays more than the total", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "150" } });

      const summary = screen.getByTestId("payment-summary");
      expect(within(summary).getByTestId("return-change")).toBeInTheDocument();
      expect(
        within(summary).getByText(/Return \/ Change/i),
      ).toBeInTheDocument();
      // |100 - 150| = 50 → CASH return auto-fills the USD field with "50.00".
      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
    });

    it("shows neither remaining nor return/change when the amount matches exactly", () => {
      renderMpi({ totalAmount: 100 });

      // Single mode auto-fills the exact total; no warning rows render.
      const summary = screen.getByTestId("payment-summary");
      expect(
        within(summary).queryByText(/Remaining \(Debt\)/i),
      ).not.toBeInTheDocument();
      expect(
        within(summary).queryByTestId("return-change"),
      ).not.toBeInTheDocument();
    });
  });

  describe("CASH return fields — independent (owner note, 2026-09-24)", () => {
    // NOT RUN — proven at the end-of-batch gate (owner process rule,
    // 2026-09-24 batch: build first, verify once at the end).
    //
    // Rule 17 (failing-first): before this fix, `handleReturnUSDChange` /
    // `handleReturnLBPChange` each recomputed the OTHER field from the
    // remaining overpay. Reverting to that pre-fix pair (temporarily
    // restoring the removed remainder-recompute logic in
    // packages/ui/src/components/ui/MultiPaymentInput.tsx) makes the second
    // assertion below fail: typing "10000" into LBP after "45" into USD
    // rewrote USD to "49.89" (50 - 10000/90000, rounded) — the operator's
    // own second keystroke silently undid the first, exactly the "40$ +
    // 10,000 LBP cannot be entered" bug the owner reported.
    it("typing into one CASH return field never rewrites the other", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      // Overpay $150 on $100 -> $50 suggested change.
      fireEvent.change(firstAmount, { target: { value: "150" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "45" },
      });
      expect(screen.getByTestId("return-usd")).toHaveValue("45");
      // The LBP field is untouched by editing USD — it stays whatever it
      // already was (the auto-init effect leaves it empty for a USD total).
      expect(screen.getByTestId("return-lbp")).toHaveValue("");

      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });
      expect(screen.getByTestId("return-lbp")).toHaveValue("10000");
      // The operator's "45" in USD survives — editing LBP never rewrites it.
      expect(screen.getByTestId("return-usd")).toHaveValue("45");
    });

    it("both fields can be set to an arbitrary combination — '40 + 10,000 LBP' is enterable", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "150" } });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "40" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(screen.getByTestId("return-usd")).toHaveValue("40");
      expect(screen.getByTestId("return-lbp")).toHaveValue("10000");
    });

    // Fix-round finding #4: field independence (above) drops the only
    // mechanism that kept sum(return legs) == overpaid — this is the
    // restored invariant check, as a visible flag instead of a silent
    // auto-fill (which the two tests above prove is gone for good).
    it("flags a return that under-covers the overpaid amount", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      // Overpay $150 on $100 -> $50 suggested change, auto-seeded to USD.
      fireEvent.change(firstAmount, { target: { value: "150" } });
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();

      // Edit USD down to $45 — LBP stays at its auto-seeded "" (0), so only
      // $45 of the $50 owed is covered.
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "45" },
      });
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "$5.00",
      );
    });

    it("shows no mismatch warning once both fields correctly sum to the overpaid amount", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      // Overpay $150 on $100 -> $50 owed. $45 + 450,000 LBP (@ 90,000) == $50.
      fireEvent.change(firstAmount, { target: { value: "150" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "45" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "450000" },
      });

      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
    });
  });

  describe("waive-remaining button (opt-in)", () => {
    it("does not render a Waive button when onWaiveRemaining is not provided", () => {
      renderMpi({ totalAmount: 100 });

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "99.50" } });

      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });

    // LIRA-310: the callback also receives the per-currency remainder.
    it("renders a Waive button for a small shortfall and calls back with the shortfall", () => {
      const onWaiveRemaining = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onWaiveRemaining={onWaiveRemaining}
        />,
      );

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "99.50" } });

      const waiveBtn = screen.getByTestId("waive-remaining");
      expect(waiveBtn).toBeInTheDocument();
      fireEvent.click(waiveBtn);
      expect(onWaiveRemaining).toHaveBeenCalledWith(0.5, [
        { currency: "USD", amount: 0.5 },
      ]);
    });

    it("does not render a Waive button when the shortfall is over the $5 cap", () => {
      const onWaiveRemaining = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onWaiveRemaining={onWaiveRemaining}
        />,
      );

      fireEvent.click(screen.getByTestId("split-toggle"));
      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "60" } });

      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });

  describe("cashOnlyReturn (opt-in)", () => {
    it("forces the CASH return fields even with multiple payment methods available", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          cashOnlyReturn={true}
        />,
      );

      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      fireEvent.change(firstAmount, { target: { value: "150" } });

      // Multiple non-CASH methods exist (OMT, CUSTOMER_ACCOUNT), so without
      // cashOnlyReturn the method selector would render — it must not here.
      expect(screen.queryByTestId("return-method")).not.toBeInTheDocument();
      expect(screen.getByTestId("return-usd")).toBeInTheDocument();
      expect(screen.getByTestId("return-lbp")).toBeInTheDocument();
    });
  });

  describe("smartSplitOverpay (opt-in)", () => {
    it("splits an overpaid USD amount into integer USD notes + LBP remainder", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          smartSplitOverpay={true}
        />,
      );

      const firstAmount = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!;
      // Overpay by $4.73 — without smartSplitOverpay this would seed a single
      // "4.73" USD lump; with it, integer USD + LBP-bill-rounded remainder.
      fireEvent.change(firstAmount, { target: { value: "104.73" } });

      // 0.73 * 90000 = 65,700 → rounds up to nearest 5,000 → 70,000.
      expect(screen.getByTestId("return-usd")).toHaveValue("4");
      expect(screen.getByTestId("return-lbp")).toHaveValue("70000");
    });
  });

  describe("retained business-logic assertions", () => {
    // Lightweight derivations kept from the original logic-only test — they
    // mirror the component's internal calculations and read well as a spec.
    it("sums payment line amounts into a total paid", () => {
      const lines: PaymentLine[] = [
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "2", method: "OMT", currencyCode: "USD", amount: 30 },
      ];
      const totalPaid = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
      expect(totalPaid).toBe(80);
    });

    it("detects a CUSTOMER_ACCOUNT line in a payment set", () => {
      const lines: PaymentLine[] = [
        {
          id: "1",
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 100,
        },
      ];
      expect(lines.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(true);
    });
  });

  describe("characterization — rate-driven conversion (current contract)", () => {
    // These pin the CURRENT cross-currency math so the engine rewire (MCP-2,
    // docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md) can prove zero behavior
    // change. For a genuinely single-currency total (e.g. a POS sale
    // denominated in USD), re-deriving the other currency's amount from the
    // rate IS correct — these tests must stay green through every phase.

    it("converts a single-mode currency switch at the edited rate, not the prop rate", () => {
      renderMpi({ totalAmount: 100 });

      setRate("100,000");
      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-currency-${id}`), {
        target: { value: "LBP" },
      });

      // 100 USD × 100,000 (edited) — not × 90,000 (prop).
      expect(firstAmountInput().value).toBe("10,000,000");
    });

    it("re-syncs a cross-currency single line when the rate is edited", () => {
      renderMpi({ totalAmount: 100 });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-currency-${id}`), {
        target: { value: "LBP" },
      });
      expect(firstAmountInput().value).toBe("9,000,000"); // 100 × 90,000

      setRate("100,000");
      expect(firstAmountInput().value).toBe("10,000,000"); // 100 × 100,000
    });

    it("stops re-syncing once the amount was manually edited (overpayment preserved)", () => {
      renderMpi({ totalAmount: 100 });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-currency-${id}`), {
        target: { value: "LBP" },
      });
      fireEvent.change(firstAmountInput(), { target: { value: "8000000" } });
      expect(firstAmountInput().value).toBe("8,000,000");

      setRate("100,000");
      // Touched line is NOT re-derived to 10,000,000.
      expect(firstAmountInput().value).toBe("8,000,000");
    });

    it("emits the rate via onExchangeRateChange on mount and on every edit", () => {
      const onExchangeRateChange: RateMock = jest.fn();
      renderMpi({ onExchangeRateChange });

      // Mount effect reports the prop rate (Debts seeds repayModalRate off this).
      expect(onExchangeRateChange).toHaveBeenCalledWith(EXCHANGE_RATE);

      setRate("95,000");
      expect(onExchangeRateChange).toHaveBeenLastCalledWith(95000);
    });
  });

  describe("rate field manual-edit protection (async rate-fetch race)", () => {
    // Caller pages commonly seed the `exchangeRate` prop from an async
    // rate-fetch hook (e.g. useSellRate for Recharge forms) that starts at a
    // fallback and overwrites itself once its own fetch resolves. Before this
    // fix, the "sync custom rate from prop" effect had no touched-guard (unlike
    // the analogous singleAmountTouchedRef for the amount field) and re-fired
    // on every exchangeRate prop change — silently discarding an operator's
    // manually typed rate, and the value reported to the parent via
    // onExchangeRateChange, the instant the late fetch resolved.
    // Proven failing-first on the pre-fix code (rule 17).
    it("keeps the operator's manually-typed rate when exchangeRate changes afterward (late async resolve)", () => {
      const onExchangeRateChange: RateMock = jest.fn();
      const ui = (rate: number) => (
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={rate}
          showDiscount={false}
          onChange={jest.fn()}
          onExchangeRateChange={onExchangeRateChange}
        />
      );
      const { rerender } = render(ui(90_000));

      // Operator types a custom rate before the "live" rate fetch resolves.
      setRate("89,000");
      expect(onExchangeRateChange).toHaveBeenLastCalledWith(89000);

      // The caller's async rate-fetch hook resolves late with a slightly
      // different live rate — this is the trigger condition for the bug.
      rerender(ui(90_500));

      // The operator's edit must survive — not be clobbered by the new prop.
      expect(screen.getByTestId("payment-exchange-rate")).toHaveValue("89,000");
      expect(onExchangeRateChange).toHaveBeenLastCalledWith(89000);
    });

    it("still seeds the rate field from the prop on the FIRST render (mount-sync unaffected)", () => {
      const onExchangeRateChange: RateMock = jest.fn();
      renderMpi({ exchangeRate: 91_000, onExchangeRateChange });

      expect(screen.getByTestId("payment-exchange-rate")).toHaveValue("91,000");
      expect(onExchangeRateChange).toHaveBeenCalledWith(91000);
    });
  });

  describe("T2 — native-LBP total round-tripped through the USD scalar (bug proof)", () => {
    // Sprint task T2 (docs/tickets/CURRENT_SPRINT.md), owner repro 2026-07-12:
    // a 600,000 LBP debt opened at rate 89,000 showed 606,742 after editing
    // the rate to 90,000 — the native-LBP amount was re-derived from the USD
    // scalar (600000/89000 × 90000). Fixed in MCP-3 by feeding per-currency
    // `totals` (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md). The rule-17
    // failing-first proof lived here as an `it.failing` against the scalar
    // `totalAmount` prop until MCP-5 deleted that prop (its documented death;
    // see the plan for the recorded 600,000 → 606,742 failure output).

    // The PERMANENT regression guard — mirrors the fixed Debts modal wiring
    // (per-currency totals). Proven failing-first on the pre-fix code (rule 17).
    it("totals contract: keeps a pure-LBP debt prefill invariant under rate edits", () => {
      renderMpi({
        totals: [{ amount: 600_000, currency: "LBP" }],
        exchangeRate: 89_000,
        initialLines: [{ currencyCode: "LBP", amount: 600_000 }],
      });

      expect(firstAmountInput().value).toBe("600,000");

      setRate("90,000");

      // The debt is 600,000 LBP regardless of the rate — paying LBP against
      // an LBP debt involves no exchange.
      expect(firstAmountInput().value).toBe("600,000");
      expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
    });

    it("totals contract: a mixed USD+LBP debt only re-derives the USD part on rate edits", () => {
      // $50 + 600,000 LBP, seeded per currency (split mode, like the modal).
      renderMpi({
        totals: [
          { amount: 50, currency: "USD" },
          { amount: 600_000, currency: "LBP" },
        ],
        exchangeRate: 89_000,
        initialLines: [
          { currencyCode: "USD", amount: 50 },
          { currencyCode: "LBP", amount: 600_000 },
        ],
      });

      const amounts = () =>
        Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-testid^="payment-amount-"]',
          ),
        ).map((i) => i.value);
      expect(amounts()).toEqual(["50", "600,000"]);

      setRate("90,000");

      // Split-mode seeded lines are never auto-rewritten; the native LBP
      // figure in particular must not budge.
      expect(amounts()).toEqual(["50", "600,000"]);
    });
  });

  describe("kept change (T3 — the shop keeps what it does not hand back)", () => {
    // docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-0, as changed by the
    // owner decision of 2026-10-06: the "Keep change" button is gone. Handing
    // back LESS than the change due (down to nothing — both fields cleared)
    // keeps the gap as profit automatically. Rewritten from the button-tap
    // versions (rule 24); the new behaviour's failing-first guard is
    // MultiPaymentInput.autoKeepChange.test.tsx.
    function renderOverpaid(opts: {
      onKeptChange: jest.Mock;
      onReturnChange: jest.Mock;
      smartSplitOverpay?: boolean;
    }) {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={
            opts.onReturnChange as unknown as (legs: PaymentLine[]) => void
          }
          onKeptChange={
            opts.onKeptChange as unknown as (
              kept: {
                usd: number;
                lbp: number;
                exactUsd: number;
                exactLbp: number;
              } | null,
            ) => void
          }
          cashOnlyReturn={true}
          {...(opts.smartSplitOverpay ? { smartSplitOverpay: true } : {})}
        />,
      );
    }

    /** Hand back nothing: both change fields emptied. */
    function clearReturn() {
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "" },
      });
    }

    it("never renders a Keep change button — not even once the customer overpays", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      // Exact payment (auto-filled) → no return block, no button.
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    });

    it("OPT-IN: without onKeptChange an under-return is flagged 'not covered' and nothing is kept", () => {
      // Consumers whose backend doesn't accept kept_change_* do not wire
      // onKeptChange — the server would reject the unbalanced legs, so the
      // cashier must still see the red warning there.
      renderMpi({ totalAmount: 100 });
      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      clearReturn();

      expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "of the change is not covered",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });

    it("clearing the return drops the OUT legs and reports the kept amounts; returning the full change again clears it", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      // Overpay $150 on a $100 total → $50 suggested change.
      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
      // Untouched seed → nothing kept.
      expect(onKeptChange).toHaveBeenLastCalledWith(null);

      clearReturn();

      // No OUT legs — the drawer keeps the full tender…
      const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLegs).toEqual([]);
      // …and the kept split is reported for the profit stamp: `usd`/`lbp`
      // are the rounded DISPLAY figure, `exactUsd`/`exactLbp` the unrounded
      // accounting figure a cross-currency consumer (e.g. debt reduction)
      // must use instead (owner note #8, 2026-09-23). $150 - $100 is exact
      // in both forms here — no float dust to speak of.
      expect(onKeptChange).toHaveBeenLastCalledWith({
        usd: 50,
        lbp: 0,
        exactUsd: 50,
        exactLbp: 0,
      });

      // Hand the full change back: OUT leg returns, kept cleared.
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "50" },
      });
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      const restored = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(
        restored.some((l) => l.direction === "OUT" && l.amount === 50),
      ).toBe(true);
    });

    it("reports the kept amounts in the TENDER currency, not the smart-split return suggestion", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange, smartSplitOverpay: true });

      // Overpay $104.73 on $100 → the RETURN suggestion smart-splits into
      // 4 USD notes + 70,000 LBP (drawer convenience)…
      fireEvent.change(firstAmountInput(), { target: { value: "104.73" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("4");
      expect(screen.getByTestId("return-lbp")).toHaveValue("70000");

      clearReturn();

      // …but KEEPING is physical: the drawer holds the excess tender itself —
      // $4.73 USD (what the customer overpaid in), no LBP involved. A
      // cross-denominated kept split corrupts per-currency netting (lira-107).
      const lastKept = onKeptChange.mock.calls.at(-1)?.[0] as {
        usd: number;
        lbp: number;
        exactUsd: number;
        exactLbp: number;
      };
      expect(lastKept.usd).toBe(4.73);
      expect(lastKept.lbp).toBe(0);
      // Exact (unrounded) companion — float subtraction dust (104.73 - 100)
      // included, deliberately NOT snapped to 4.73: this is exactly the
      // figure a cross-currency accounting consumer must use instead of the
      // rounded `usd` above (owner note #8).
      expect(lastKept.exactUsd).toBeCloseTo(4.73, 9);
      expect(lastKept.exactLbp).toBe(0);
      expect(onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toEqual(
        [],
      );
    });
  });

  // LIRA-084 (owner decision 2026-10-02) — keeping is PARTIAL, per currency,
  // instead of all-or-nothing; since 2026-10-06 it is automatic (no button):
  // what the fields hold goes back, the rest is kept. Rule 17 disclosure: the
  // original LIRA-084 guards were written AFTER that fix (not proven
  // failing-first); rewritten here for the automatic behaviour (rule 24).
  describe("partial kept change (LIRA-084, automatic since 2026-10-06)", () => {
    function renderOverpaid(opts: {
      onKeptChange: jest.Mock;
      onReturnChange: jest.Mock;
    }) {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={
            opts.onReturnChange as unknown as (legs: PaymentLine[]) => void
          }
          onKeptChange={
            opts.onKeptChange as unknown as (
              kept: {
                usd: number;
                lbp: number;
                exactUsd: number;
                exactLbp: number;
              } | null,
            ) => void
          }
          cashOnlyReturn={true}
        />,
      );
    }

    it("an untouched seed returns the whole change and keeps nothing; clearing it keeps everything", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
      expect(onKeptChange).toHaveBeenLastCalledWith(null);

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      expect(onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toEqual(
        [],
      );
      expect(onKeptChange).toHaveBeenLastCalledWith({
        usd: 50,
        lbp: 0,
        exactUsd: 50,
        exactLbp: 0,
      });
    });

    // A FULL keep (nothing handed back) keeps the pre-LIRA-084 feedback the
    // operator relies on (lira-107's debt-repayment e2e asserts this exact
    // text), plus the green "Keeping … as profit." line.
    it("full keep (nothing handed back) shows 'Change kept (profit)' and the green note without the 'rest is returned' tail", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });

      expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        /^Keeping \$50\.00 \| 4,500,000 LBP as profit\.$/,
      );
    });

    it("owner's own example: 140,000 LBP change, return 100,000 and keep 40,000 — the OUT leg carries only the returned amount", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100000, currency: "LBP" }]}
          currency="LBP"
          totalAmountCurrency="LBP"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={
            onReturnChange as unknown as (legs: PaymentLine[]) => void
          }
          onKeptChange={
            onKeptChange as unknown as (
              kept: {
                usd: number;
                lbp: number;
                exactUsd: number;
                exactLbp: number;
              } | null,
            ) => void
          }
          cashOnlyReturn={true}
        />,
      );

      // Tender 240,000 LBP against a 100,000 LBP total → 140,000 LBP change.
      fireEvent.change(firstAmountInput(), { target: { value: "240000" } });
      expect(screen.getByTestId("return-lbp")).toHaveValue("140000");

      // Operator lowers the return to what they actually hand back.
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "100000" },
      });

      const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLegs).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "LBP",
          amount: 100000,
          direction: "OUT",
        }),
      ]);
      expect(onKeptChange).toHaveBeenLastCalledWith({
        usd: 0,
        lbp: 40000,
        exactUsd: 0,
        exactLbp: 40000,
      });
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Keeping $0.44 | 40,000 LBP as profit — the rest is returned above.",
      );
    });

    it("returning the whole change keeps nothing — the OUT leg carries all of it", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      // $104.73 tendered on a $100 total; no smart-split prop here, so the
      // auto-seed puts the whole $4.73 on the USD field.
      fireEvent.change(firstAmountInput(), { target: { value: "104.73" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "4.73" },
      });

      const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLegs).toEqual([
        expect.objectContaining({
          currencyCode: "USD",
          amount: 4.73,
          direction: "OUT",
        }),
      ]);
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });

    it("a typed return bigger than the actual change is flagged red — it is never kept change", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      // Operator fat-fingers a return bigger than the $50 actually received.
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "9999" },
      });

      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "more than the customer overpaid",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });

    it("'$' (return-all-usd) after a partial return restores the full return and clears the kept amount", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "20" },
      });
      expect(onKeptChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ usd: 30 }),
      );
      fireEvent.click(screen.getByTestId("return-all-usd"));

      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      const restored = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(
        restored.some((l) => l.direction === "OUT" && l.amount === 50),
      ).toBe(true);
    });

    // Was a StrictMode guard on the toggle's updater side effects; the toggle
    // is gone, so it now pins that under StrictMode an under-return is
    // always reported as kept (green note), never as "not covered".
    it("under StrictMode, clearing and restoring the return twice flips cleanly between kept and returned, never 'not covered'", () => {
      const onKeptChange = jest.fn();
      render(
        <StrictMode>
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onReturnChange={jest.fn()}
            onKeptChange={onKeptChange}
            cashOnlyReturn={true}
          />
        </StrictMode>,
      );
      fireEvent.change(firstAmountInput(), { target: { value: "151.01" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("51.01");
      for (let i = 0; i < 2; i++) {
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "" },
        });
        expect(screen.getByTestId("keep-change-summary")).toBeInTheDocument();
        expect(onKeptChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ usd: 51.01 }),
        );
        fireEvent.click(screen.getByTestId("return-all-usd"));
        expect(screen.getByTestId("return-usd")).toHaveValue("51.01");
        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        expect(
          screen.queryByText(/of the change is not covered/),
        ).not.toBeInTheDocument();
      }
    });

    // 2026-10-13 (owner, compact change box): Customer Account is no longer
    // a return METHOD (the change box's Account button does that job), so
    // this case now hands the change back by OMT — still a non-CASH method
    // whose full leg posts to it — and guards that CUSTOMER_ACCOUNT is not
    // offered. Rewritten after the fix: not proven failing-first (rule 17).
    it("keeping only applies to a CASH return — a non-CASH method (OMT) already routes its full leg to that method; CUSTOMER_ACCOUNT is not a return method", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={true}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={
            onReturnChange as unknown as (legs: PaymentLine[]) => void
          }
          onKeptChange={
            onKeptChange as unknown as (
              kept: {
                usd: number;
                lbp: number;
                exactUsd: number;
                exactLbp: number;
              } | null,
            ) => void
          }
        />,
      );

      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      const methodSelect =
        screen.getByTestId<HTMLSelectElement>("return-method");
      expect(
        Array.from(methodSelect.options).map((o) => o.value),
      ).not.toContain("CUSTOMER_ACCOUNT");
      fireEvent.change(methodSelect, { target: { value: "OMT" } });

      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      // The full $50 routes to the OMT leg — nothing kept.
      const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(
        lastLegs.some(
          (l) => l.method === "OMT" && l.amount === 50 && l.direction === "OUT",
        ),
      ).toBe(true);
      expect(lastLegs.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(false);
    });
  });

  describe("EUR-readiness (MCP-5 acceptance)", () => {
    // The design's acceptance test: adding a currency is DATA — a registry/
    // rate-table entry — with zero component changes. A EUR total prefill is
    // native, and the USD↔LBP header rate field cannot touch it.
    it("a EUR total prefills natively and is invariant to the LBP header rate", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 90, currency: "EUR" }]}
          rateTable={{
            base: "USD",
            rates: {
              LBP: { buy: 89_000, sell: 89_500 },
              EUR: { buy: 0.9, sell: 0.92 },
            },
          }}
          side="buy"
          currency="EUR"
          totalAmountCurrency="EUR"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={[...CURRENCIES, { code: "EUR", symbol: "€" }]}
          exchangeRate={89_000}
          showDiscount={false}
          onChange={jest.fn()}
        />,
      );

      expect(firstAmountInput().value).toBe("90");

      // The header field edits the USD↔LBP pair only — EUR math is untouched.
      setRate("100,000");
      expect(firstAmountInput().value).toBe("90");
    });
  });

  describe("auto-debt remainder (real incident: $315 WHISH send, $300 typed as cash)", () => {
    // Owner-reported 2026-07-15: a $315 send, operator typed "$300" intending
    // "$300 cash + $15 debt". Single-payment mode discarded the typed amount —
    // only the method + the FULL total ever reached the backend — so the
    // whole $315 was silently charged to CUSTOMER_ACCOUNT with zero cash
    // recorded. Fix: the instant an edit creates a shortfall, materialize a
    // live remainder leg — synchronously, so onChange is correct even before
    // any debounced reveal (a fast Enter/Pay must not race the visual
    // split-toggle animation, the same class of bug as the SearchBar A5 fix).
    //
    // OPT-IN (post-review hardening): the feature fires ONLY when the
    // consumer passes autoDebtRemainder={<its validated charge predicate>} —
    // hasClient alone proved polysemous across consumers (name-only in some,
    // cashout-credit semantics on RECEIVE flows) and produced sign inversions.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("OPT-IN default: without autoDebtRemainder, underpayment never auto-splits even with a client", () => {
      const { onChange } = renderMpi({ totalAmount: 315, hasClient: true });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(onChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toHaveLength(1);
      expect(allLines()).toHaveLength(1);
      expect(
        within(screen.getByTestId("payment-summary")).getByText(
          /Remaining \(Debt\)/i,
        ),
      ).toBeInTheDocument();
    });

    it("emits a 2-leg payload IMMEDIATELY on underpayment — no wait for the visual reveal", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: true,
        autoDebtRemainder: true,
      });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });

      // No jest.advanceTimersByTime — this is the exact moment a fast
      // confirm click would read the parent's state. Pre-fix this would be
      // [{ CASH, 300 }], silently dropping the $15 debt on submit.
      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(2);
      expect(lastLines[0]).toMatchObject({ method: "CASH", amount: 300 });
      expect(lastLines[1]).toMatchObject({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "USD",
        amount: 15,
      });
    });

    it("does NOT auto-split without a chargeable client — keeps the honest Remaining (Debt) warning", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: false,
        autoDebtRemainder: true,
      });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });

      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(1);
      expect(
        within(screen.getByTestId("payment-summary")).getByText(
          /Remaining \(Debt\)/i,
        ),
      ).toBeInTheDocument();
    });

    it("does NOT auto-split when CUSTOMER_ACCOUNT isn't an offered payment method (Settings toggle off)", () => {
      const onChange = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 315, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={true}
          requiresClientForDebt={true}
          autoDebtRemainder={true}
          paymentMethods={[
            { code: "CASH", label: "Cash" },
            { code: "OMT", label: "OMT" },
          ]}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={onChange}
        />,
      );

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });

      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(1);
    });

    it("leaves a lone CUSTOMER_ACCOUNT line's own reduced amount untouched (no second real-money method for the rest)", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: true,
        autoDebtRemainder: true,
      });

      const id = firstLineId();
      fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });
      fireEvent.change(firstAmountInput(), { target: { value: "300" } });

      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(1);
      expect(lastLines[0]).toMatchObject({
        method: "CUSTOMER_ACCOUNT",
        amount: 300,
      });
    });

    it("reveals the second row visually only ~500ms after the operator stops typing", () => {
      renderMpi({ totalAmount: 315, hasClient: true, autoDebtRemainder: true });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      // Data is already correct (previous test) but the UI hasn't flipped yet.
      expect(allLines()).toHaveLength(1);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(allLines()).toHaveLength(2);
    });

    it("keeps live-tracking the remainder as the first line keeps changing, until manually edited", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: true,
        autoDebtRemainder: true,
      });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      expect(
        (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
      ).toMatchObject({ amount: 15 });

      fireEvent.change(firstAmountInput(), { target: { value: "280" } });
      expect(
        (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
      ).toMatchObject({ amount: 35 });

      // Reveal, then edit the debt line directly — it detaches (frozen).
      act(() => {
        jest.advanceTimersByTime(500);
      });
      const debtLineEl = allLines()[1] as HTMLElement;
      const debtAmountInput = within(debtLineEl).getByTestId(/payment-amount-/);
      fireEvent.change(debtAmountInput, { target: { value: "50" } });

      fireEvent.change(firstAmountInput(), { target: { value: "200" } });
      const finalLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(finalLines[0]).toMatchObject({ amount: 200 });
      // Frozen at the manually-set 50 — NOT resized to 115.
      expect(finalLines[1]).toMatchObject({ amount: 50 });
    });

    it("removing the auto-added debt line clears tracking (no phantom resurrection)", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: true,
        autoDebtRemainder: true,
      });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(allLines()).toHaveLength(2);

      const secondLine = allLines()[1];
      const removeBtn = within(secondLine as HTMLElement).getByTitle("Remove");
      fireEvent.click(removeBtn);

      expect(allLines()).toHaveLength(1);
      const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(1);
      expect(lastLines[0]).toMatchObject({ method: "CASH", amount: 300 });
    });

    // Review finding (code-review 2026-07-17): the withdraw branch used to
    // run BEFORE the touched-guard, silently deleting a manually edited debt
    // leg when the primary later covered the total. Fixed by detach-on-touch:
    // an edited auto leg becomes an ordinary manual line the effect never
    // deletes. Proven failing-first against the pre-fix effect ordering.
    it("a manually edited debt leg is NOT deleted when the primary later covers the total", () => {
      const { onChange } = renderMpi({
        totalAmount: 315,
        hasClient: true,
        autoDebtRemainder: true,
      });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Operator takes ownership of the debt leg (deliberate $50 entry).
      const debtLineEl = allLines()[1] as HTMLElement;
      fireEvent.change(within(debtLineEl).getByTestId(/payment-amount-/), {
        target: { value: "50" },
      });

      // Primary now covers the whole total — the detached leg must survive.
      fireEvent.change(firstAmountInput(), { target: { value: "315" } });

      const lines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({
        method: "CUSTOMER_ACCOUNT",
        amount: 50,
      });
      expect(allLines()).toHaveLength(2);
    });

    // Review finding: after an auto-reveal, covering the total removed the
    // debt leg but left the sheet stuck in a one-line "Split" UI. The
    // withdraw path now folds an AUTO-revealed split back to single mode
    // (a manually toggled split is never folded).
    it("auto-revealed split folds back to single mode when the primary covers the total", () => {
      renderMpi({ totalAmount: 315, hasClient: true, autoDebtRemainder: true });

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(allLines()).toHaveLength(2);
      expect(screen.getByTestId("split-toggle")).toHaveTextContent(
        "Split Active",
      );

      fireEvent.change(firstAmountInput(), { target: { value: "315" } });

      expect(allLines()).toHaveLength(1);
      expect(screen.getByTestId("split-toggle")).not.toHaveTextContent(
        "Split Active",
      );
    });

    // Shop-day bug 13 (2026-10-17): picking a wallet on the OMT/Whish page
    // raises the total by the 1% payment-method fee (101 → 102). The
    // untouched single line must simply follow the new total. The auto-debt
    // effect ran in the same commit as the auto-sync, read the stale $101
    // line and pushed a $1 CUSTOMER_ACCOUNT leg on top — the page then saw
    // two lines, dropped its single-line method fee, and the server refused
    // the send ("expected $101.00 … got $102.00"). Failing-first.
    it("an untouched single line follows a raised total — no auto-debt leg (bug 13)", () => {
      const onChange: ChangeMock = jest.fn();
      const ui = (total: number) => (
        <MultiPaymentInput
          totals={[{ amount: total, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={true}
          requiresClientForDebt={true}
          autoDebtRemainder={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={onChange}
        />
      );
      const { rerender } = render(ui(101));
      fireEvent.change(screen.getByTestId(`payment-method-${firstLineId()}`), {
        target: { value: "OMT" },
      });

      rerender(ui(102));
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      const lines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lines).toEqual([
        expect.objectContaining({ method: "OMT", amount: 102 }),
      ]);
      expect(allLines()).toHaveLength(1);
    });

    // Review finding: the effect's deps omitted the totals, so a total that
    // changed while the sheet was open left a stale debt-leg amount (an
    // underbooked shortfall). totalsKey is now a dependency.
    it("re-derives the debt leg when the totals prop changes mid-payment", () => {
      const onChange: ChangeMock = jest.fn();
      const ui = (total: number) => (
        <MultiPaymentInput
          totals={[{ amount: total, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={true}
          requiresClientForDebt={true}
          autoDebtRemainder={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={onChange}
        />
      );
      const { rerender } = render(ui(315));

      fireEvent.change(firstAmountInput(), { target: { value: "300" } });
      expect(
        (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
      ).toMatchObject({ amount: 15 });

      rerender(ui(400));

      expect(
        (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
      ).toMatchObject({ method: "CUSTOMER_ACCOUNT", amount: 100 });
    });
  });

  describe("counterFlow (opt-in, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase C)", () => {
    // Owner decision #2: ONE payment form, a direction per line, never a
    // second form — a RECEIVE cashout's main lines are the shop's payout
    // ("You pay") while a counter-flow section collects a customer-paid fee
    // ("Customer pays"), in the SAME card. Proven failing-first (rule 17):
    // before the `counterFlow` prop existed, none of these testids/chips
    // rendered and the extra onChange was never called.
    interface CounterFlowRenderOpts {
      counterFlowOnChange: jest.Mock;
      totalAmount?: number;
      currency?: string;
      requiresClient?: boolean;
      hasClient?: boolean;
      // LIRA-321 additions
      payer?: "payout";
      label?: string;
      seedLines?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
      }>;
      lockCurrency?: boolean;
      maxForgive?: number;
      onStateChange?: jest.Mock;
      /** Counter-flow method list (default PAYMENT_METHODS). */
      counterFlowMethods?: Array<{ code: string; label: string }>;
    }
    function counterFlowElement(
      opts: CounterFlowRenderOpts,
      mainOnChange: jest.Mock,
    ) {
      return (
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          hasClient={false}
          requiresClientForDebt={true}
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={EXCHANGE_RATE}
          showDiscount={false}
          onChange={mainOnChange}
          {...(opts.payer ? { payer: opts.payer } : {})}
          {...(opts.label !== undefined ? { label: opts.label } : {})}
          counterFlow={{
            label: "Customer pays — OMT fee",
            totalAmount: opts.totalAmount ?? 5,
            currency: opts.currency ?? "USD",
            onChange: opts.counterFlowOnChange,
            paymentMethods: opts.counterFlowMethods ?? PAYMENT_METHODS,
            requiresClient: opts.requiresClient ?? true,
            hasClient: opts.hasClient ?? false,
            ...(opts.seedLines ? { seedLines: opts.seedLines } : {}),
            ...(opts.lockCurrency ? { lockCurrency: true } : {}),
            ...(opts.maxForgive !== undefined
              ? { maxForgive: opts.maxForgive }
              : {}),
            ...(opts.onStateChange
              ? { onStateChange: opts.onStateChange }
              : {}),
          }}
        />
      );
    }
    function renderWithCounterFlow(opts: CounterFlowRenderOpts) {
      const mainOnChange = jest.fn();
      const utils = render(counterFlowElement(opts, mainOnChange));
      const rerenderWith = (next: Partial<CounterFlowRenderOpts>) =>
        utils.rerender(counterFlowElement({ ...opts, ...next }, mainOnChange));
      return { ...utils, mainOnChange, rerenderWith };
    }

    it("does not render the section or either chip when counterFlow is absent (regression)", () => {
      renderMpi();

      expect(
        screen.queryByTestId("counter-flow-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("direction-chip-you-pay"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("direction-chip-customer-pays"),
      ).not.toBeInTheDocument();
    });

    it("renders the section, both direction chips, and seeds one CASH line at totalAmount", () => {
      const counterFlowOnChange = jest.fn();
      // LIRA-321: payout screens read OUT / IN (testids unchanged).
      renderWithCounterFlow({
        counterFlowOnChange,
        totalAmount: 5,
        payer: "payout",
      });

      expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
      expect(screen.getByTestId("direction-chip-you-pay")).toHaveTextContent(
        "OUT",
      );
      expect(
        screen.getByTestId("direction-chip-customer-pays"),
      ).toHaveTextContent("IN");
      expect(screen.getByText("Customer pays")).toBeInTheDocument();

      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      );
      expect(amountInput?.value).toBe("5");

      const methodSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="counter-flow-method-"]',
      );
      expect(methodSelect?.value).toBe("CASH");

      expect(counterFlowOnChange).toHaveBeenCalled();
      const lastLines = counterFlowOnChange.mock.calls.at(
        -1,
      )?.[0] as PaymentLine[];
      expect(lastLines).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "USD",
          amount: 5,
        }),
      ]);
    });

    it("emits counter-flow edits through counterFlow.onChange only — never contaminates the main onChange", () => {
      const counterFlowOnChange = jest.fn();
      const { mainOnChange } = renderWithCounterFlow({
        counterFlowOnChange,
        totalAmount: 5,
      });

      const mainCallsBefore = mainOnChange.mock.calls.length;

      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      )!;
      fireEvent.change(amountInput, { target: { value: "3" } });

      const lastLines = counterFlowOnChange.mock.calls.at(
        -1,
      )?.[0] as PaymentLine[];
      expect(lastLines[0]).toMatchObject({ amount: 3 });

      // The main section's onChange must not have fired again from this edit.
      expect(mainOnChange.mock.calls.length).toBe(mainCallsBefore);
      // And the main line must still read the untouched payout amount (100),
      // proving the counter-flow edit never reached the main lines/totals.
      const mainAmountInput = document.querySelector<HTMLInputElement>(
        '[data-testid="payment-summary"]',
      );
      expect(mainAmountInput).toBeInTheDocument();
      const mainLastLines = mainOnChange.mock.calls.at(
        -1,
      )?.[0] as PaymentLine[];
      expect(mainLastLines).toHaveLength(1);
      expect(mainLastLines[0].amount).toBe(100);
    });

    it("does NOT add a CASH leftover by itself when less is typed and the account is not offered (LIRA-321 safety; was: auto CASH leftover)", () => {
      // Rule 24 rewrite: this used to assert an auto-added CASH leftover of 3.
      // That line booked cash the customer never handed over and let the
      // section balance — now nothing is added and the shortfall stays open.
      const counterFlowOnChange = jest.fn();
      renderWithCounterFlow({ counterFlowOnChange, totalAmount: 5 });

      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      )!;
      fireEvent.change(amountInput, { target: { value: "2" } });

      const lines = document.querySelectorAll(
        '[data-testid^="counter-flow-line-"]',
      );
      expect(lines).toHaveLength(1);

      const lastLines = counterFlowOnChange.mock.calls.at(
        -1,
      )?.[0] as PaymentLine[];
      expect(lastLines).toHaveLength(1);
      expect(lastLines[0]).toMatchObject({ amount: 2 });
    });

    it("disables CUSTOMER_ACCOUNT in the counter-flow method list when requiresClient && !hasClient", () => {
      const counterFlowOnChange = jest.fn();
      renderWithCounterFlow({
        counterFlowOnChange,
        requiresClient: true,
        hasClient: false,
      });

      const methodSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="counter-flow-method-"]',
      )!;
      const optionValues = Array.from(methodSelect.options).map((o) => o.value);
      expect(optionValues).not.toContain("CUSTOMER_ACCOUNT");
    });

    it("allows CUSTOMER_ACCOUNT in the counter-flow method list when hasClient is true", () => {
      const counterFlowOnChange = jest.fn();
      renderWithCounterFlow({
        counterFlowOnChange,
        requiresClient: true,
        hasClient: true,
      });

      const methodSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="counter-flow-method-"]',
      )!;
      const optionValues = Array.from(methodSelect.options).map((o) => o.value);
      expect(optionValues).toContain("CUSTOMER_ACCOUNT");
    });

    // LIRA-321 step 1 — the leftover a customer did not pay goes on their
    // account by default. Before this, "+ Add line" always started the
    // leftover as CASH and the cashier had to switch it by hand.
    describe("leftover line method (LIRA-321 step 1)", () => {
      function addLeftoverAfterTyping(
        typed: string,
        opts: { requiresClient: boolean; hasClient: boolean },
      ): PaymentLine[] {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({ counterFlowOnChange, totalAmount: 5, ...opts });
        const amountInput = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        )!;
        fireEvent.change(amountInput, { target: { value: typed } });
        // LIRA-321: a fully paid section stays in single mode, which has no
        // "+ Add line" — the cashier turns Split on first.
        if (!screen.queryByTestId("counter-flow-add-split")) {
          fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
        }
        fireEvent.click(screen.getByTestId("counter-flow-add-split"));
        return counterFlowOnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      }

      it("starts the leftover as CUSTOMER_ACCOUNT when a client is linked", () => {
        const lines = addLeftoverAfterTyping("3", {
          requiresClient: true,
          hasClient: true,
        });
        expect(lines[1]).toMatchObject({
          method: "CUSTOMER_ACCOUNT",
          amount: 2,
        });
      });

      it("keeps the leftover as CASH when no client is linked", () => {
        const lines = addLeftoverAfterTyping("3", {
          requiresClient: true,
          hasClient: false,
        });
        expect(lines[1]).toMatchObject({ method: "CASH", amount: 2 });
      });

      it("keeps a new line as CASH when nothing is left over", () => {
        const lines = addLeftoverAfterTyping("5", {
          requiresClient: true,
          hasClient: true,
        });
        expect(lines[1]).toMatchObject({ method: "CASH", amount: 0 });
      });
    });

    // LIRA-321 (T008) — the "Customer pays" section becomes a real money-in
    // side: single vs split mode, its own Split button, a leftover line,
    // balance reporting, a currency lock, Forgive, and the payout layout.
    describe("Customer pays section — single/split, balance, payout layout (LIRA-321)", () => {
      type CfState = {
        paid: number;
        owedToAccount: number;
        forgiven: number;
        balanced: boolean;
        overpaid: boolean;
        needsClient: boolean;
        unaccounted: number;
      };
      const section = () => screen.getByTestId("counter-flow-section");
      const cfLines = () =>
        Array.from(
          document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
        );
      const cfAmountInputs = () =>
        Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-testid^="counter-flow-amount-"]',
          ),
        );
      const cfMethodSelects = () =>
        Array.from(
          document.querySelectorAll<HTMLSelectElement>(
            '[data-testid^="counter-flow-method-"]',
          ),
        );
      const lastState = (m: jest.Mock): CfState =>
        m.mock.calls.at(-1)?.[0] as CfState;
      const typeFirst = (value: string) =>
        fireEvent.change(cfAmountInputs()[0], { target: { value } });

      it("(a) one seed line opens in single mode — no '+ Add line', no remove ×", () => {
        renderWithCounterFlow({ counterFlowOnChange: jest.fn() });
        expect(cfLines()).toHaveLength(1);
        expect(
          screen.queryByTestId("counter-flow-add-split"),
        ).not.toBeInTheDocument();
        expect(within(section()).queryByTitle("Remove")).toBeNull();
        expect(
          screen.getByTestId("counter-flow-split-toggle"),
        ).toHaveTextContent("Split");
      });

      it("(b) two seedLines open in split mode with both lines", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 105,
          seedLines: [
            { method: "OMT", currencyCode: "USD", amount: 100 },
            { method: "CASH", currencyCode: "USD", amount: 5 },
          ],
        });
        expect(cfLines()).toHaveLength(2);
        expect(
          screen.getByTestId("counter-flow-add-split"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("counter-flow-split-toggle"),
        ).toHaveTextContent("Split Active");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 100 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
        ]);
      });

      it("(c) typing less in single mode switches to split and adds the leftover as CUSTOMER_ACCOUNT when offered", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 50,
          hasClient: true,
        });
        typeFirst("30");
        expect(cfLines()).toHaveLength(2);
        expect(
          screen.getByTestId("counter-flow-add-split"),
        ).toBeInTheDocument();
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 30 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 20 }),
        ]);
      });

      it("(c) the auto leftover keeps following the first line while untouched (account offered)", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("1"); // first keystroke
        typeFirst("12"); // second keystroke
        expect(cfLines()).toHaveLength(2);
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 12 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 38 }),
        ]);
      });

      // LIRA-321 safety fix — with no client (CUSTOMER_ACCOUNT not offered)
      // the section used to auto-add a CASH leftover, balance itself, and
      // turn Confirm on: the drawer would book cash never handed over
      // (spec US1.3 / US2.6). Now nothing is added and the gap stays open.
      it("(l) no client: typing less stays single, adds NO cash line, and reports the gap", () => {
        const counterFlowOnChange = jest.fn();
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          onStateChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
          maxForgive: 5,
        });
        typeFirst("30");
        expect(cfLines()).toHaveLength(1);
        expect(
          screen.queryByTestId("counter-flow-add-split"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByTestId("counter-flow-split-toggle"),
        ).not.toHaveTextContent("Split Active");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 30 }),
        ]);
        expect(lastState(onStateChange)).toMatchObject({
          paid: 30,
          owedToAccount: 0,
          balanced: false,
          unaccounted: 20,
        });
        const hint = screen.getByTestId("counter-flow-unaccounted");
        expect(hint).toHaveTextContent(
          /Still to settle: 20(\.00)? USD — pick a client to put it on their account$/,
        );
        expect(hint).not.toHaveTextContent(/forgive/i);
      });

      it("(l) then picking a client adds the CUSTOMER_ACCOUNT leftover and balances", () => {
        const counterFlowOnChange = jest.fn();
        const onStateChange = jest.fn();
        const { rerenderWith } = renderWithCounterFlow({
          counterFlowOnChange,
          onStateChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
        });
        typeFirst("30");
        rerenderWith({ hasClient: true });
        expect(cfLines()).toHaveLength(2);
        expect(
          screen.getByTestId("counter-flow-split-toggle"),
        ).toHaveTextContent("Split Active");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 30 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 20 }),
        ]);
        expect(lastState(onStateChange)).toMatchObject({
          paid: 30,
          owedToAccount: 20,
          balanced: true,
          unaccounted: 0,
        });
      });

      it("(l) unpicking the client drops the auto account line — never turns it into cash", () => {
        const counterFlowOnChange = jest.fn();
        const onStateChange = jest.fn();
        const { rerenderWith } = renderWithCounterFlow({
          counterFlowOnChange,
          onStateChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("30");
        expect(cfLines()).toHaveLength(2);
        rerenderWith({ hasClient: false });
        expect(cfLines()).toHaveLength(1);
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 30 }),
        ]);
        expect(lastState(onStateChange)).toMatchObject({
          paid: 30,
          balanced: false,
          unaccounted: 20,
        });
      });

      it("(l) no client, shortfall within maxForgive: the hint offers to forgive", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
          maxForgive: 5,
        });
        typeFirst("47");
        expect(cfLines()).toHaveLength(1);
        expect(
          screen.getByTestId("counter-flow-unaccounted"),
        ).toHaveTextContent(
          /Still to settle: 3(\.00)? USD — pick a client to put it on their account, or forgive it$/,
        );
        expect(screen.getByTestId("counter-flow-forgive")).toBeInTheDocument();
      });

      // Owner decision 2026-10-14: a caller that offers no account at all
      // (Exchange when the customer pays in EUR) must not tell the cashier
      // to pick a client — picking one would change nothing.
      it("(l) no account in the caller's methods: the hint never says 'pick a client'", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
          counterFlowMethods: PAYMENT_METHODS.filter(
            (m) => m.code !== "CUSTOMER_ACCOUNT",
          ),
        });
        typeFirst("30");
        const hint = screen.getByTestId("counter-flow-unaccounted");
        expect(hint).toHaveTextContent(/Still to settle: 20(\.00)? USD$/);
        expect(hint).not.toHaveTextContent(/pick a client/);
      });

      it("(l) with the account offered, the hint carries no 'pick a client' wording", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("30");
        // Rule 24 rewrite: this used to turn the auto account line into cash
        // and lower it — in split mode a gap with the account offered now
        // gets a new account leftover (LIRA-321 follow-up), so that edit no
        // longer leaves anything unsettled. Removing the account line does.
        const removes = within(section()).getAllByTitle("Remove");
        fireEvent.click(removes[1]);
        const hint = screen.getByTestId("counter-flow-unaccounted");
        expect(hint).toHaveTextContent(/Still to settle: 20(\.00)? USD$/);
      });

      it("(d) counter-flow-split-toggle switches single ↔ split; back to single re-seeds one full line", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({ counterFlowOnChange, totalAmount: 5 });
        const toggle = () => screen.getByTestId("counter-flow-split-toggle");

        fireEvent.click(toggle());
        expect(toggle()).toHaveTextContent("Split Active");
        expect(
          screen.getByTestId("counter-flow-add-split"),
        ).toBeInTheDocument();
        typeFirst("2"); // in split mode: no auto-leftover, just one line of 2
        fireEvent.click(screen.getByTestId("counter-flow-add-split"));
        expect(cfLines()).toHaveLength(2);

        fireEvent.click(toggle());
        expect(toggle()).not.toHaveTextContent("Split Active");
        expect(cfLines()).toHaveLength(1);
        expect(
          screen.queryByTestId("counter-flow-add-split"),
        ).not.toBeInTheDocument();
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ currencyCode: "USD", amount: 5 }),
        ]);
      });

      it("(e) onStateChange — exact amount is balanced", () => {
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 5,
          onStateChange,
        });
        expect(lastState(onStateChange)).toEqual({
          paid: 5,
          owedToAccount: 0,
          forgiven: 0,
          balanced: true,
          overpaid: false,
          needsClient: false,
          unaccounted: 0,
        });
      });

      it("(e) onStateChange — short with an account line is balanced and reports owedToAccount", () => {
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          hasClient: true,
          onStateChange,
        });
        typeFirst("30");
        expect(lastState(onStateChange)).toMatchObject({
          paid: 30,
          owedToAccount: 20,
          balanced: true,
          overpaid: false,
          needsClient: false,
          unaccounted: 0,
        });
      });

      it("(e) onStateChange — more than the total is overpaid, never auto-corrected", () => {
        const onStateChange = jest.fn();
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 5,
          onStateChange,
        });
        typeFirst("8");
        expect(lastState(onStateChange)).toMatchObject({
          paid: 8,
          balanced: false,
          overpaid: true,
        });
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ amount: 8 }),
        ]);
      });

      it("(e) onStateChange — an account line with no client needs a client", () => {
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          requiresClient: false, // CUSTOMER_ACCOUNT offered without a client
          hasClient: false,
          onStateChange,
        });
        typeFirst("30");
        expect(lastState(onStateChange)).toMatchObject({
          owedToAccount: 20,
          needsClient: true,
        });
      });

      it("(f) lockCurrency disables every currency select and new lines use the section currency", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 450000,
          currency: "LBP",
          lockCurrency: true,
        });
        fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
        fireEvent.click(screen.getByTestId("counter-flow-add-split"));
        const selects = Array.from(
          document.querySelectorAll<HTMLSelectElement>(
            '[data-testid^="counter-flow-currency-"]',
          ),
        );
        expect(selects).toHaveLength(2);
        for (const sel of selects) {
          expect(sel).toBeDisabled();
          expect(sel.value).toBe("LBP");
        }
        // Each locked select shows a small lock icon; unlocked rows do not.
        expect(
          document.querySelectorAll('[data-testid^="counter-flow-lock-"]'),
        ).toHaveLength(2);
        expect(
          document.querySelectorAll('[data-testid^="payment-lock-"]'),
        ).toHaveLength(0);
      });

      it("(g) payout: Customer pays sits above Shop pays, with OUT / IN chips and the plain title", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          payer: "payout",
          label: "Cashout",
        });
        const youPay = screen.getByTestId("direction-chip-you-pay");
        expect(
          section().compareDocumentPosition(youPay) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          section().compareDocumentPosition(
            screen.getByTestId("payment-summary"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.getByText("Shop pays")).toBeInTheDocument();
        expect(screen.queryByText("Cashout")).not.toBeInTheDocument();
        expect(youPay).toHaveTextContent("OUT");
        expect(
          screen.getByTestId("direction-chip-customer-pays"),
        ).toHaveTextContent("IN");
        expect(
          within(section()).getByText("Customer pays"),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Customer pays — OMT fee"),
        ).not.toBeInTheDocument();
      });

      it("(g) payout + lockCurrency: title reads 'Customer pays — LBP'", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          payer: "payout",
          totalAmount: 450000,
          currency: "LBP",
          lockCurrency: true,
        });
        expect(
          within(section()).getByText("Customer pays — LBP"),
        ).toBeInTheDocument();
      });

      it("(h) not a payout: header still reads 'Payment' and the section keeps its own label", () => {
        renderWithCounterFlow({ counterFlowOnChange: jest.fn() });
        expect(screen.getByText("Payment")).toBeInTheDocument();
        expect(screen.queryByText("Shop pays")).not.toBeInTheDocument();
        expect(screen.getByText("Customer pays — OMT fee")).toBeInTheDocument();
        expect(screen.getByTestId("direction-chip-you-pay")).toHaveTextContent(
          "You pay",
        );
        // Section stays below the main lines on money-in screens.
        expect(
          screen
            .getByTestId("direction-chip-you-pay")
            .compareDocumentPosition(section()) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      /** Short by 2 with nothing covering it: type 3 of 5 with no client
       *  (no account offered, so no leftover line is added). */
      function leaveShortfallOf2(opts: Partial<CounterFlowRenderOpts>) {
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 5,
          onStateChange,
          ...opts,
        });
        typeFirst("3");
        expect(cfLines()).toHaveLength(1);
        return onStateChange;
      }

      it("(i) a shortfall within maxForgive can be forgiven and is reported in `forgiven`", () => {
        const onStateChange = leaveShortfallOf2({ maxForgive: 5 });
        expect(lastState(onStateChange)).toMatchObject({
          paid: 3,
          forgiven: 0,
          balanced: false,
          unaccounted: 2,
        });
        fireEvent.click(screen.getByTestId("counter-flow-forgive"));
        expect(lastState(onStateChange)).toMatchObject({
          paid: 3,
          forgiven: 2,
          balanced: true,
          unaccounted: 0,
        });
      });

      it("(i) no Forgive control when the shortfall is above maxForgive", () => {
        leaveShortfallOf2({ maxForgive: 1 });
        expect(
          screen.queryByTestId("counter-flow-forgive"),
        ).not.toBeInTheDocument();
      });

      it("(j) while short, 'Still to settle' shows the amount and onStateChange reports `unaccounted`", () => {
        const onStateChange = leaveShortfallOf2({});
        expect(
          screen.getByTestId("counter-flow-unaccounted"),
        ).toHaveTextContent(/Still to settle: 2(\.00)? USD/);
        expect(lastState(onStateChange).unaccounted).toBe(2);
      });

      it("(k) with the account offered from the start, typing less auto-adds the account leftover (unchanged)", () => {
        const counterFlowOnChange = jest.fn();
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          onStateChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("30");
        expect(cfMethodSelects()[1].value).toBe("CUSTOMER_ACCOUNT");
        expect(lastState(onStateChange)).toMatchObject({
          paid: 30,
          owedToAccount: 20,
          balanced: true,
        });
      });

      it("(k) a line the cashier added with '+ Add line' keeps its method when a client is picked (was: auto leftover CASH → account)", () => {
        // Rule 24 rewrite: the premise (an auto CASH leftover with no client)
        // no longer exists. A manual line is explicit — it keeps CASH, and no
        // extra account line appears because nothing is left unsettled.
        const counterFlowOnChange = jest.fn();
        const { rerenderWith } = renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
        });
        typeFirst("30");
        fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
        fireEvent.click(screen.getByTestId("counter-flow-add-split"));
        expect(cfMethodSelects()[1].value).toBe("CASH");
        rerenderWith({ hasClient: true });
        expect(cfLines()).toHaveLength(2);
        expect(cfMethodSelects()[1].value).toBe("CASH");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "CASH", amount: 30 }),
          expect.objectContaining({ method: "CASH", amount: 20 }),
        ]);
      });

      // ── LIRA-321 follow-up — four defects seen live on test.liratek.shop ──
      // Written before the fixes (rule 17); each failed on the unfixed code.

      it("(m) a locked currency shows the full code with the lock and no dropdown caret", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          payer: "payout",
          totalAmount: 450000,
          currency: "LBP",
          lockCurrency: true,
          hasClient: true,
        });
        typeFirst("400000"); // auto account leftover → two locked rows
        const controls = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-testid^="counter-flow-currency-"]',
          ),
        );
        expect(controls).toHaveLength(2);
        for (const c of controls) {
          // The app stylesheet paints a dropdown caret on EVERY <select>
          // (index.css, `select { background-image: … }`) and reserves
          // 2.5rem for it — that is what cut "LBP" down to "LE". A locked
          // currency is not a choice, so it is not a select at all.
          expect(c.tagName).not.toBe("SELECT");
          expect(c.value).toBe("LBP");
          expect(c).toBeDisabled();
        }
        expect(
          document.querySelectorAll('[data-testid^="counter-flow-lock-"]'),
        ).toHaveLength(2);
        // Unlocked rows (the shop's side) keep their dropdown.
        expect(
          document.querySelector('[data-testid^="payment-currency-"]')?.tagName,
        ).toBe("SELECT");
      });

      it("(n) payout footer shows what the customer paid and what the client will owe", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          payer: "payout",
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("30");
        const summary = screen.getByTestId("payment-summary");
        expect(
          within(summary).getByTestId("counter-flow-summary-paid"),
        ).toHaveTextContent(/^Customer paid:\s*30 USD$/);
        const owed = within(summary).getByTestId("counter-flow-summary-owed");
        expect(owed).toHaveTextContent(/^Client will owe:\s*20 USD$/);
        expect(owed.className).toMatch(/text-amber-/);
        expect(
          screen.queryByTestId("counter-flow-summary-forgiven"),
        ).not.toBeInTheDocument();
      });

      it("(n) payout footer: nothing owed → no owe line; forgiven → 'Forgiven' line", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          payer: "payout",
          totalAmount: 50,
          requiresClient: true,
          hasClient: false,
          maxForgive: 5,
        });
        expect(
          screen.getByTestId("counter-flow-summary-paid"),
        ).toHaveTextContent(/^Customer paid:\s*50 USD$/);
        expect(
          screen.queryByTestId("counter-flow-summary-owed"),
        ).not.toBeInTheDocument();
        typeFirst("47");
        fireEvent.click(screen.getByTestId("counter-flow-forgive"));
        expect(
          screen.getByTestId("counter-flow-summary-forgiven"),
        ).toHaveTextContent(/^Forgiven:\s*3 USD$/);
      });

      it("(n) money-in screens: the footer is unchanged (no customer-side lines)", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 50,
          requiresClient: true,
          hasClient: true,
        });
        typeFirst("30");
        expect(
          screen.queryByTestId("counter-flow-summary-paid"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("counter-flow-summary-owed"),
        ).not.toBeInTheDocument();
      });

      /** Live case: Whish App receive, seeded Whish $100 + Cash $5. */
      const WHISH_SEED = [
        { method: "OMT", currencyCode: "USD", amount: 100 },
        { method: "CASH", currencyCode: "USD", amount: 5 },
      ];

      it("(o) split + client: lowering a line below what is owed adds a following Customer Account line", () => {
        const counterFlowOnChange = jest.fn();
        const onStateChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          onStateChange,
          totalAmount: 105,
          requiresClient: true,
          hasClient: true,
          seedLines: WHISH_SEED,
        });
        typeFirst("90");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 90 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 10 }),
        ]);
        expect(lastState(onStateChange)).toMatchObject({
          paid: 95,
          owedToAccount: 10,
          balanced: true,
        });
        // It follows later edits …
        typeFirst("97");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 97 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 3 }),
        ]);
        // … and goes away when the gap closes.
        typeFirst("100");
        expect(cfLines()).toHaveLength(2);
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 100 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
        ]);
      });

      it("(o) split + client: unpicking the client drops the auto account line", () => {
        const counterFlowOnChange = jest.fn();
        const { rerenderWith } = renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 105,
          requiresClient: true,
          hasClient: true,
          seedLines: WHISH_SEED,
        });
        typeFirst("90");
        expect(cfLines()).toHaveLength(3);
        rerenderWith({ hasClient: false });
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 90 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
        ]);
      });

      it("(o) split + client: an account line the cashier edited by hand is never touched", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 105,
          requiresClient: true,
          hasClient: true,
          seedLines: WHISH_SEED,
        });
        typeFirst("90");
        fireEvent.change(cfAmountInputs()[2], { target: { value: "4" } });
        typeFirst("80");
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 80 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
          expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 4 }),
        ]);
      });

      it("(o) split, no client: no auto line; the hint says to pick a client or press + Add line", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 105,
          requiresClient: true,
          hasClient: false,
          seedLines: WHISH_SEED,
        });
        typeFirst("90");
        expect(cfLines()).toHaveLength(2);
        expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({ method: "OMT", amount: 90 }),
          expect.objectContaining({ method: "CASH", amount: 5 }),
        ]);
        expect(
          screen.getByTestId("counter-flow-unaccounted"),
        ).toHaveTextContent(
          /^Still to settle: 10(\.00)? USD — pick a client to put it on their account, or press \+ Add line$/,
        );
      });

      it("(o) split, no client, gap within maxForgive: the hint keeps the forgive wording", () => {
        renderWithCounterFlow({
          counterFlowOnChange: jest.fn(),
          totalAmount: 105,
          requiresClient: true,
          hasClient: false,
          maxForgive: 20,
          seedLines: WHISH_SEED,
        });
        typeFirst("90");
        expect(
          screen.getByTestId("counter-flow-unaccounted"),
        ).toHaveTextContent(
          /^Still to settle: 10(\.00)? USD — pick a client to put it on their account, or forgive it$/,
        );
      });
    });
  });

  // ── Tender-rate sanity warning (LIRA-240, owner decision 2026-09-28) ──
  // The ±15% band used to REFUSE a payment server-side; it now only drives
  // this non-blocking warning. `renderMpi`'s default exchangeRate is
  // EXCHANGE_RATE = 90000 — that is the "shop rate" the warning compares
  // the typed rate against.
  describe("tender-rate sanity warning (not proven failing-first — LIRA-223: written alongside the LIRA-240 fix, not independently ahead of it)", () => {
    it("shows no warning when the typed rate equals the shop rate", () => {
      renderMpi();
      expect(
        screen.queryByTestId("tender-rate-warning"),
      ).not.toBeInTheDocument();
    });

    it("shows no warning at exactly the +15% band boundary (103,500)", () => {
      renderMpi();
      setRate("103500");
      expect(
        screen.queryByTestId("tender-rate-warning"),
      ).not.toBeInTheDocument();
    });

    it("shows no warning at exactly the -15% band boundary (76,500)", () => {
      renderMpi();
      setRate("76500");
      expect(
        screen.queryByTestId("tender-rate-warning"),
      ).not.toBeInTheDocument();
    });

    it("shows a warning just past the +15% band (103,501)", () => {
      renderMpi();
      setRate("103501");
      expect(screen.getByTestId("tender-rate-warning")).toBeInTheDocument();
    });

    it("shows the owner's exact +16% example (104,400) with the shop rate named in the text", () => {
      renderMpi();
      setRate("104400");
      const warning = screen.getByTestId("tender-rate-warning");
      expect(warning).toHaveTextContent(/16% away/);
      expect(warning).toHaveTextContent(/90,000/);
      expect(warning).not.toHaveTextContent(/typo/i);
    });

    it("uses the stronger 'check for a typo' wording past 50% deviation", () => {
      renderMpi();
      setRate("135000"); // 90,000 * 1.5 = exactly +50% (not yet typo-level)
      expect(screen.getByTestId("tender-rate-warning")).not.toHaveTextContent(
        /typo/i,
      );

      setRate("135001"); // just past +50%
      expect(screen.getByTestId("tender-rate-warning")).toHaveTextContent(
        /typo/i,
      );
    });

    it("never disables the amount input, method select, or rate field — the warning is advisory only, never blocking", () => {
      renderMpi();
      setRate("300000"); // wildly off (~233% deviation)
      expect(screen.getByTestId("tender-rate-warning")).toBeInTheDocument();

      expect(firstAmountInput()).not.toBeDisabled();
      expect(screen.getByTestId("payment-exchange-rate")).not.toBeDisabled();
      const id = firstLineId();
      expect(screen.getByTestId(`payment-method-${id}`)).not.toBeDisabled();
    });

    it("keeps emitting onChange normally while the warning is showing — typing a payment amount is never suppressed", () => {
      const { onChange } = renderMpi();
      setRate("300000");
      onChange.mockClear();

      fireEvent.change(firstAmountInput(), { target: { value: "55" } });

      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastCall[0].amount).toBe(55);
    });
  });
});
