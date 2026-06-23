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
 *   - the initial line auto-fills with the full totalAmount
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

import { render, screen, fireEvent, within } from "@testing-library/react";
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

interface RenderOptions {
  totalAmount?: number;
  currency?: string;
  totalAmountCurrency?: string;
  hasClient?: boolean;
  requiresClientForDebt?: boolean;
  onChange?: ChangeMock;
}

function renderMpi(opts: RenderOptions = {}) {
  const onChange: ChangeMock = opts.onChange ?? jest.fn();
  const utils = render(
    <MultiPaymentInput
      totalAmount={opts.totalAmount ?? 100}
      currency={opts.currency ?? "USD"}
      totalAmountCurrency={opts.totalAmountCurrency ?? "USD"}
      hasClient={opts.hasClient ?? false}
      requiresClientForDebt={opts.requiresClientForDebt ?? true}
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={EXCHANGE_RATE}
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

describe("MultiPaymentInput", () => {
  describe("initial render", () => {
    it("renders the root, a single payment line, summary and split toggle", () => {
      renderMpi();

      expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
      expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
      expect(screen.getByTestId("split-toggle")).toBeInTheDocument();
      expect(allLines()).toHaveLength(1);
    });

    it("auto-fills the single line's amount with the full totalAmount", () => {
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
});
