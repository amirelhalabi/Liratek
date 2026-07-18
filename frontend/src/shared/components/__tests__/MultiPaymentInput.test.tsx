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

    it("renders a Waive button when the shortfall is below the $1 threshold and calls back with the shortfall", () => {
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
      expect(onWaiveRemaining).toHaveBeenCalledWith(0.5);
    });

    it("does not render a Waive button when the shortfall is at or above the $1 threshold", () => {
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

  describe("keep change (T3 — return nothing, book the extra as profit)", () => {
    // docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-0. Failing-first (rule 17): before
    // the feature, the two CASH return fields auto-balance each other, so
    // returning nothing is structurally impossible and no keep-change control
    // exists.
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
              kept: { usd: number; lbp: number } | null,
            ) => void
          }
          cashOnlyReturn={true}
          {...(opts.smartSplitOverpay ? { smartSplitOverpay: true } : {})}
        />,
      );
    }

    it("renders no keep-change control until the customer overpays", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      // Exact payment (auto-filled) → no return block, no keep button.
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    });

    it("OPT-IN: renders no keep-change button when the parent did not wire onKeptChange", () => {
      // Consumers whose backend doesn't accept kept_change_* yet must not
      // show the button — it would suppress the return legs while validation
      // strips the kept amounts (change neither returned nor stamped).
      renderMpi({ totalAmount: 100 });
      fireEvent.change(firstAmountInput(), { target: { value: "150" } });

      expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    });

    it("activating keep-change drops the return legs and reports the kept amounts; deactivating restores", () => {
      const onKeptChange = jest.fn();
      const onReturnChange = jest.fn();
      renderOverpaid({ onKeptChange, onReturnChange });

      // Overpay $150 on a $100 total → $50 suggested change.
      fireEvent.change(firstAmountInput(), { target: { value: "150" } });
      expect(screen.getByTestId("return-usd")).toHaveValue("50.00");

      fireEvent.click(screen.getByTestId("keep-change"));

      // No OUT legs — the drawer keeps the full tender…
      const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
      expect(lastLegs).toEqual([]);
      // …and the kept split is reported for the profit stamp.
      expect(onKeptChange).toHaveBeenLastCalledWith({ usd: 50, lbp: 0 });

      // Toggle off: suggested change comes back as OUT legs, kept cleared.
      fireEvent.click(screen.getByTestId("keep-change"));
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

      fireEvent.click(screen.getByTestId("keep-change"));

      // …but KEEPING is physical: the drawer holds the excess tender itself —
      // $4.73 USD (what the customer overpaid in), no LBP involved. A
      // cross-denominated kept split corrupts per-currency netting (lira-107).
      expect(onKeptChange).toHaveBeenLastCalledWith({ usd: 4.73, lbp: 0 });
      expect(onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toEqual(
        [],
      );
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
});
